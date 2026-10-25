// Merges WebM / Matroska tracks (YouTube's VP9 / AV1 video and Opus audio DASH files) into one
// regular `.webm` without re-encoding.
//
// The inputs are indexed first (only element headers and the first bytes of each block are
// read); the output is then planned completely — clusters starting at video keyframes, block
// timecodes rebased, tracks renumbered 1…n — so every size and the Cues positions are known
// before writing, and the frame data is copied input → output in order. Block payloads (lacing
// included) are copied as they are; BlockGroups keep their other children (BlockDuration,
// ReferenceBlock, DiscardPadding…).

import { randomBytes } from 'node:crypto'
import { open, stat, type FileHandle } from 'node:fs/promises'

// MARK: Element ids

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  CodecID: 0x86,
  DefaultDuration: 0x23e383,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Void: 0xec,
  Tags: 0x1254c367,
  Chapters: 0x1043a770,
  Attachments: 0x1941a469,
}

/** Elements that end a Cluster of unknown size. */
const TOP_LEVEL = new Set([ID.Cluster, ID.Cues, ID.Tags, ID.Chapters, ID.Attachments, ID.SeekHead, ID.Info, ID.Tracks])

// MARK: Reading

class FileReader {
  private cache = Buffer.alloc(0)
  private cacheStart = 0

  constructor(
    readonly fh: FileHandle,
    readonly size: number,
  ) {}

  /** `length` bytes at `offset` (fewer at the end of the file). */
  async bytes(offset: number, length: number): Promise<Buffer> {
    const end = Math.min(offset + length, this.size)
    if (offset >= this.cacheStart && end <= this.cacheStart + this.cache.length) {
      return this.cache.subarray(offset - this.cacheStart, end - this.cacheStart)
    }
    if (length > 1 << 20) {
      const buf = Buffer.alloc(Math.max(0, end - offset))
      let read = 0
      while (read < buf.length) {
        const { bytesRead } = await this.fh.read(buf, read, buf.length - read, offset + read)
        if (bytesRead === 0) break
        read += bytesRead
      }
      return buf.subarray(0, read)
    }
    const window = Math.max(4 << 20, length)
    const buf = Buffer.alloc(Math.max(0, Math.min(window, this.size - offset)))
    let read = 0
    while (read < buf.length) {
      const { bytesRead } = await this.fh.read(buf, read, buf.length - read, offset + read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    this.cache = buf.subarray(0, read)
    this.cacheStart = offset
    return this.cache.subarray(0, Math.max(0, Math.min(length, read)))
  }
}

function vintLength(first: number): number {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1
  return 0
}

export interface ElementHeader {
  id: number
  /** Payload size; -1 = unknown. */
  size: number
  headerLength: number
}

export function readHeader(buf: Buffer, offset: number): ElementHeader | null {
  if (offset >= buf.length) return null
  const idLength = vintLength(buf[offset])
  if (idLength === 0 || idLength > 4 || offset + idLength >= buf.length) return null
  let id = 0
  for (let i = 0; i < idLength; i++) id = id * 256 + buf[offset + i]
  const sizeOffset = offset + idLength
  const sizeLength = vintLength(buf[sizeOffset])
  if (sizeLength === 0 || sizeOffset + sizeLength > buf.length) return null
  let size = buf[sizeOffset] & (0xff >> sizeLength)
  let allOnes = size === 0xff >> sizeLength
  for (let i = 1; i < sizeLength; i++) {
    const b = buf[sizeOffset + i]
    if (b !== 0xff) allOnes = false
    size = size * 256 + b
  }
  return { id, size: allOnes ? -1 : size, headerLength: idLength + sizeLength }
}

function readUint(buf: Buffer): number {
  let value = 0
  for (const b of buf) value = value * 256 + b
  return value
}

function readFloat(buf: Buffer): number {
  if (buf.length === 4) return buf.readFloatBE(0)
  if (buf.length === 8) return buf.readDoubleBE(0)
  return 0
}

/** Children of an element payload held in memory. */
function childrenOf(payload: Buffer): { id: number; start: number; end: number; headerLength: number }[] {
  const list: { id: number; start: number; end: number; headerLength: number }[] = []
  let offset = 0
  while (offset < payload.length) {
    const header = readHeader(payload, offset)
    if (!header || header.size < 0) break
    const end = offset + header.headerLength + header.size
    if (end > payload.length) break
    list.push({ id: header.id, start: offset, end, headerLength: header.headerLength })
    offset = end
  }
  return list
}

// MARK: Model

interface InputTrack {
  file: number
  number: number
  type: number
  codecId: string
  /** Children of the TrackEntry (raw), to be written again with a new number. */
  entry: Buffer
}

interface Frame {
  file: number
  track: number
  /** Milliseconds. */
  time: number
  keyframe: boolean
  /** File offset of the Block / SimpleBlock payload. */
  offset: number
  size: number
  /** Track number vint + int16 timecode + flags. */
  blockHeaderLength: number
  flags: number
  /** BlockGroup: its other children (raw); null for SimpleBlock. */
  groupExtras: Buffer | null
}

interface ParsedInput {
  tracks: InputTrack[]
  frames: Frame[]
  durationMs: number
}

async function readVintAt(reader: FileReader, offset: number): Promise<ElementHeader | null> {
  return readHeader(await reader.bytes(offset, 12), 0)
}

async function parseInput(path: string, fileIndex: number, signal?: AbortSignal): Promise<ParsedInput> {
  const fh = await open(path, 'r')
  try {
    const size = (await fh.stat()).size
    const reader = new FileReader(fh, size)
    let offset = 0
    const ebml = await readVintAt(reader, 0)
    if (!ebml || ebml.id !== ID.EBML || ebml.size < 0) throw new Error('not a Matroska / WebM file')
    offset = ebml.headerLength + ebml.size
    const segment = await readVintAt(reader, offset)
    if (!segment || segment.id !== ID.Segment) throw new Error('missing Segment')
    const segmentStart = offset + segment.headerLength
    const segmentEnd = segment.size < 0 ? size : Math.min(size, segmentStart + segment.size)

    let timecodeScale = 1_000_000
    let durationUnits = 0
    const tracks: InputTrack[] = []
    const frames: Frame[] = []
    const toMs = (units: number) => (units * timecodeScale) / 1_000_000

    offset = segmentStart
    while (offset < segmentEnd) {
      if (signal?.aborted) throw new Error('cancelled')
      const header = await readVintAt(reader, offset)
      if (!header) break
      const dataStart = offset + header.headerLength
      if (header.id === ID.Info && header.size >= 0) {
        const payload = Buffer.from(await reader.bytes(dataStart, header.size))
        for (const c of childrenOf(payload)) {
          const value = payload.subarray(c.start + c.headerLength, c.end)
          if (c.id === ID.TimecodeScale) timecodeScale = readUint(value) || 1_000_000
          else if (c.id === ID.Duration) durationUnits = readFloat(value)
        }
      } else if (header.id === ID.Tracks && header.size >= 0) {
        const payload = Buffer.from(await reader.bytes(dataStart, header.size))
        for (const entry of childrenOf(payload)) {
          if (entry.id !== ID.TrackEntry) continue
          const body = payload.subarray(entry.start + entry.headerLength, entry.end)
          let number = 0
          let type = 0
          let codecId = ''
          for (const c of childrenOf(body)) {
            const value = body.subarray(c.start + c.headerLength, c.end)
            if (c.id === ID.TrackNumber) number = readUint(value)
            else if (c.id === ID.TrackType) type = readUint(value)
            else if (c.id === ID.CodecID) codecId = value.toString('latin1')
          }
          if (number > 0) tracks.push({ file: fileIndex, number, type, codecId, entry: Buffer.from(body) })
        }
      } else if (header.id === ID.Cluster) {
        const clusterEnd = header.size < 0 ? segmentEnd : Math.min(segmentEnd, dataStart + header.size)
        let clusterTime = 0
        let p = dataStart
        while (p < clusterEnd) {
          const child = await readVintAt(reader, p)
          if (!child || child.size < 0) break
          if (header.size < 0 && TOP_LEVEL.has(child.id)) break
          const childData = p + child.headerLength
          if (child.id === ID.Timecode) {
            clusterTime = readUint(await reader.bytes(childData, child.size))
          } else if (child.id === ID.SimpleBlock) {
            const frame = await blockFrame(reader, childData, child.size, fileIndex, clusterTime, toMs)
            if (frame) {
              frame.keyframe = (frame.flags & 0x80) !== 0
              frames.push(frame)
            }
          } else if (child.id === ID.BlockGroup) {
            // Walk the group's children from the file (the Block can be large).
            let g = childData
            const groupEnd = childData + child.size
            let block: Frame | null = null
            const extras: Buffer[] = []
            let referenced = false
            while (g < groupEnd) {
              const gc = await readVintAt(reader, g)
              if (!gc || gc.size < 0) break
              if (gc.id === ID.Block) {
                block = await blockFrame(reader, g + gc.headerLength, gc.size, fileIndex, clusterTime, toMs)
              } else {
                if (gc.id === ID.ReferenceBlock) referenced = true
                extras.push(Buffer.from(await reader.bytes(g, gc.headerLength + gc.size)))
              }
              g += gc.headerLength + gc.size
            }
            if (block) {
              block.keyframe = !referenced
              block.groupExtras = Buffer.concat(extras)
              frames.push(block)
            }
          }
          p = childData + child.size
        }
        offset = header.size < 0 ? p : clusterEnd
        continue
      }
      if (header.size < 0) break
      offset = dataStart + header.size
    }
    return { tracks, frames, durationMs: toMs(durationUnits) }
  } finally {
    await fh.close()
  }
}

async function blockFrame(
  reader: FileReader,
  offset: number,
  size: number,
  fileIndex: number,
  clusterTime: number,
  toMs: (units: number) => number,
): Promise<Frame | null> {
  const head = await reader.bytes(offset, Math.min(size, 12))
  const trackLength = vintLength(head[0])
  if (trackLength === 0 || head.length < trackLength + 3) return null
  let track = head[0] & (0xff >> trackLength)
  for (let i = 1; i < trackLength; i++) track = track * 256 + head[i]
  const relative = head.readInt16BE(trackLength)
  const flags = head[trackLength + 2]
  return {
    file: fileIndex,
    track,
    time: toMs(clusterTime + relative),
    keyframe: false,
    offset,
    size,
    blockHeaderLength: trackLength + 3,
    flags,
    groupExtras: null,
  }
}

// MARK: Writing helpers

function idBytes(id: number): Buffer {
  const length = id < 0x100 ? 1 : id < 0x10000 ? 2 : id < 0x1000000 ? 3 : 4
  const b = Buffer.alloc(length)
  for (let i = length - 1, v = id; i >= 0; i--, v = Math.floor(v / 256)) b[i] = v & 0xff
  return b
}

/** Size vint; `width` forces a length (8 for sizes patched in later). */
function sizeBytes(size: number, width?: number): Buffer {
  let length = width ?? 1
  if (!width) while (length < 8 && size >= 2 ** (7 * length) - 1) length++
  const b = Buffer.alloc(length)
  let v = size
  for (let i = length - 1; i >= 0; i--) {
    b[i] = v % 256
    v = Math.floor(v / 256)
  }
  b[0] |= 0x80 >> (length - 1)
  return b
}

function element(id: number, payload: Buffer, sizeWidth?: number): Buffer {
  return Buffer.concat([idBytes(id), sizeBytes(payload.length, sizeWidth), payload])
}

function uintPayload(value: number, width?: number): Buffer {
  let length = width ?? 1
  if (!width) while (length < 8 && value >= 2 ** (8 * length)) length++
  const b = Buffer.alloc(length)
  let v = value
  for (let i = length - 1; i >= 0; i--) {
    b[i] = v % 256
    v = Math.floor(v / 256)
  }
  return b
}

function uintElement(id: number, value: number, width?: number): Buffer {
  return element(id, uintPayload(value, width))
}

function floatElement(id: number, value: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeDoubleBE(value)
  return element(id, b)
}

function stringElement(id: number, value: string): Buffer {
  return element(id, Buffer.from(value, 'utf8'))
}

/** A TrackEntry with a new number / UID, every other child kept as it was. */
function trackEntry(track: InputTrack, number: number): Buffer {
  const parts: Buffer[] = [uintElement(ID.TrackNumber, number), uintElement(ID.TrackUID, randomBytes(6).readUIntBE(0, 6) || number)]
  for (const c of childrenOf(track.entry)) {
    if (c.id === ID.TrackNumber || c.id === ID.TrackUID) continue
    parts.push(track.entry.subarray(c.start, c.end))
  }
  return element(ID.TrackEntry, Buffer.concat(parts))
}

class Writer {
  private chunks: Buffer[] = []
  private pending = 0
  written = 0

  constructor(private readonly fh: FileHandle) {}

  async write(data: Buffer): Promise<void> {
    this.chunks.push(data)
    this.pending += data.length
    if (this.pending >= 4 << 20) await this.flush()
  }

  async flush(): Promise<void> {
    if (!this.pending) return
    const data = Buffer.concat(this.chunks)
    this.chunks = []
    this.pending = 0
    let done = 0
    while (done < data.length) {
      const { bytesWritten } = await this.fh.write(data, done, data.length - done, this.written + done)
      done += bytesWritten
    }
    this.written += data.length
  }
}

// MARK: Planning

interface PlannedBlock {
  frame: Frame
  newTrack: number
  relative: number
  /** Size of the written element (SimpleBlock or BlockGroup). */
  size: number
}

interface PlannedCluster {
  time: number
  blocks: PlannedBlock[]
  /** Position relative to the Segment payload. */
  position: number
  size: number
  cue: boolean
}

function blockElementSize(frame: Frame, newTrack: number): number {
  const payload = sizeBytes(newTrack).length + 3 + (frame.size - frame.blockHeaderLength)
  if (!frame.groupExtras) return 1 + sizeBytes(payload).length + payload
  const block = 1 + sizeBytes(payload).length + payload
  const group = block + frame.groupExtras.length
  return 1 + sizeBytes(group).length + group
}

const CLUSTER_MS = 5000
const MAX_RELATIVE = 30_000

export interface WebmMuxOptions {
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export async function muxWebm(inputs: string[], output: string, options: WebmMuxOptions = {}): Promise<void> {
  const parsed: ParsedInput[] = []
  for (let i = 0; i < inputs.length; i++) parsed.push(await parseInput(inputs[i], i, options.signal))

  // Video tracks first, then audio (then anything else); numbered from 1.
  const order = (t: InputTrack) => (t.type === 1 ? 0 : t.type === 2 ? 1 : 2)
  const tracks = parsed.flatMap((p) => p.tracks).sort((a, b) => order(a) - order(b) || a.file - b.file)
  if (tracks.length === 0) throw new Error('no tracks')
  const numbers = new Map<string, number>()
  tracks.forEach((t, i) => numbers.set(`${t.file}:${t.number}`, i + 1))
  const cueTrack = 1
  const cueIsVideo = tracks[0].type === 1

  // Interleave by time, keeping each track's own (decode) order.
  const queues = parsed.map((p) => p.frames.filter((f) => numbers.has(`${f.file}:${f.track}`)))
  const heads = queues.map(() => 0)
  const merged: Frame[] = []
  for (;;) {
    let best = -1
    for (let q = 0; q < queues.length; q++) {
      if (heads[q] >= queues[q].length) continue
      if (best < 0 || queues[q][heads[q]].time < queues[best][heads[best]].time) best = q
    }
    if (best < 0) break
    merged.push(queues[best][heads[best]++])
  }
  if (merged.length === 0) throw new Error('no frames')

  // Clusters: a new one at each video keyframe after CLUSTER_MS (and whenever timecodes would overflow).
  const clusters: PlannedCluster[] = []
  let current: PlannedCluster | null = null
  for (const frame of merged) {
    const newTrack = numbers.get(`${frame.file}:${frame.track}`)!
    const time = Math.round(frame.time)
    const isCueFrame = newTrack === cueTrack && frame.keyframe
    const start =
      !current ||
      time - current.time > MAX_RELATIVE ||
      time - current.time < -30_000 ||
      (isCueFrame && cueIsVideo && time - current.time >= CLUSTER_MS) ||
      (!cueIsVideo && time - current.time >= CLUSTER_MS)
    if (start) {
      current = { time: Math.max(0, time), blocks: [], position: 0, size: 0, cue: isCueFrame }
      clusters.push(current)
    }
    current!.blocks.push({ frame, newTrack, relative: time - current!.time, size: blockElementSize(frame, newTrack) })
  }

  const header = Buffer.concat([
    element(
      ID.EBML,
      Buffer.concat([
        uintElement(ID.EBMLVersion, 1),
        uintElement(ID.EBMLReadVersion, 1),
        uintElement(ID.EBMLMaxIDLength, 4),
        uintElement(ID.EBMLMaxSizeLength, 8),
        stringElement(ID.DocType, 'webm'),
        uintElement(ID.DocTypeVersion, 4),
        uintElement(ID.DocTypeReadVersion, 2),
      ]),
    ),
  ])

  const lastTime = merged.reduce((max, f) => Math.max(max, f.time), 0)
  const durationMs = parsed.reduce((max, p) => Math.max(max, p.durationMs), lastTime)
  const info = element(
    ID.Info,
    Buffer.concat([uintElement(ID.TimecodeScale, 1_000_000), floatElement(ID.Duration, durationMs), stringElement(ID.MuxingApp, 'DVDTube'), stringElement(ID.WritingApp, 'DVDTube')]),
  )
  const tracksElement = element(ID.Tracks, Buffer.concat(tracks.map((t, i) => trackEntry(t, i + 1))))

  // Fixed-size SeekHead (8-byte positions) so it can be written before the positions are known.
  const seekEntry = (id: number, position: number) =>
    element(ID.Seek, Buffer.concat([element(ID.SeekID, idBytes(id)), element(ID.SeekPosition, uintPayload(position, 8))]))
  const seekHeadSize = element(ID.SeekHead, Buffer.concat([seekEntry(ID.Info, 0), seekEntry(ID.Tracks, 0), seekEntry(ID.Cues, 0)])).length

  let position = seekHeadSize + info.length + tracksElement.length
  const infoPosition = seekHeadSize
  const tracksPosition = seekHeadSize + info.length
  for (const cluster of clusters) {
    const timecode = uintElement(ID.Timecode, cluster.time)
    const payload = timecode.length + cluster.blocks.reduce((n, b) => n + b.size, 0)
    cluster.position = position
    cluster.size = 4 + 8 + payload
    position += cluster.size
  }
  const cuesPosition = position
  const cuePoints = clusters
    .filter((c) => c.cue)
    .map((c) =>
      element(
        ID.CuePoint,
        Buffer.concat([
          uintElement(ID.CueTime, c.time),
          element(ID.CueTrackPositions, Buffer.concat([uintElement(ID.CueTrack, cueTrack), uintElement(ID.CueClusterPosition, c.position)])),
        ]),
      ),
    )
  const cues = element(ID.Cues, Buffer.concat(cuePoints))
  const seekHead = element(ID.SeekHead, Buffer.concat([seekEntry(ID.Info, infoPosition), seekEntry(ID.Tracks, tracksPosition), seekEntry(ID.Cues, cuesPosition)]))
  const segmentSize = cuesPosition + cues.length
  const totalBytes = header.length + 12 + segmentSize

  // Writing.
  const handles = await Promise.all(inputs.map(async (path) => {
    const fh = await open(path, 'r')
    return new FileReader(fh, (await stat(path)).size)
  }))
  const out = await open(output, 'w')
  const writer = new Writer(out)
  try {
    await writer.write(header)
    await writer.write(Buffer.concat([idBytes(ID.Segment), sizeBytes(segmentSize, 8)]))
    await writer.write(seekHead)
    await writer.write(info)
    await writer.write(tracksElement)
    let lastReport = 0
    for (const cluster of clusters) {
      if (options.signal?.aborted) throw new Error('cancelled')
      const timecode = uintElement(ID.Timecode, cluster.time)
      await writer.write(Buffer.concat([idBytes(ID.Cluster), sizeBytes(cluster.size - 12, 8), timecode]))
      for (const block of cluster.blocks) {
        const frame = block.frame
        const data = await handles[frame.file].bytes(frame.offset + frame.blockHeaderLength, frame.size - frame.blockHeaderLength)
        const head = Buffer.alloc(3)
        head.writeInt16BE(Math.max(-32768, Math.min(32767, block.relative)), 0)
        head[2] = frame.flags
        const payload = Buffer.concat([sizeBytes(block.newTrack), head, data])
        if (!frame.groupExtras) {
          await writer.write(element(ID.SimpleBlock, payload))
        } else {
          await writer.write(element(ID.BlockGroup, Buffer.concat([element(ID.Block, payload), frame.groupExtras])))
        }
      }
      const fraction = (writer.written + 1) / totalBytes
      if (fraction - lastReport > 0.02) {
        lastReport = fraction
        options.onProgress?.(Math.min(1, fraction))
      }
    }
    await writer.write(cues)
    await writer.flush()
    options.onProgress?.(1)
  } finally {
    await out.close()
    await Promise.all(handles.map((h) => h.fh.close()))
  }
}

// MARK: Inspection (tests)

export async function probeWebm(path: string): Promise<{ tracks: { number: number; type: number; codecId: string; frames: number; keyframes: number }[]; durationMs: number }> {
  const parsed = await parseInput(path, 0)
  return {
    tracks: parsed.tracks.map((t) => ({
      number: t.number,
      type: t.type,
      codecId: t.codecId,
      frames: parsed.frames.filter((f) => f.track === t.number).length,
      keyframes: parsed.frames.filter((f) => f.track === t.number && f.keyframe).length,
    })),
    durationMs: parsed.durationMs,
  }
}

/** Frame payloads (without block headers) of one track type, in stored order (tests). */
export async function webmFrames(path: string, type: number): Promise<Buffer[]> {
  const parsed = await parseInput(path, 0)
  const track = parsed.tracks.find((t) => t.type === type)
  if (!track) return []
  const fh = await open(path, 'r')
  try {
    const reader = new FileReader(fh, (await fh.stat()).size)
    const out: Buffer[] = []
    for (const f of parsed.frames.filter((x) => x.track === track.number)) {
      out.push(Buffer.from(await reader.bytes(f.offset + f.blockHeaderLength, f.size - f.blockHeaderLength)))
    }
    return out
  } finally {
    await fh.close()
  }
}
