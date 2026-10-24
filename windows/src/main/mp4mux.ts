// Merges MP4 tracks into one regular (progressive, "faststart") MP4 without re-encoding.
//
// YouTube's DASH streams are fragmented MP4 (ftyp, moov with mvex, sidx, moof/mdat pairs). The
// sample tables of the output (stts, ctts, stss, stsc, stsz, stco/co64) are rebuilt from the
// fragments' `trun` boxes; the sample data is copied chunk by chunk, interleaved by time, into a
// single mdat after the moov. Progressive inputs (sample tables in the moov) work too, so the
// same code also turns a DASH audio file into a plain `.m4a`.

import { open, type FileHandle } from 'node:fs/promises'

// MARK: Box reading

interface Box {
  type: string
  start: number
  size: number
  headerSize: number
}

function boxEnd(box: Box): number {
  return box.start + box.size
}

function contentStart(box: Box): number {
  return box.start + box.headerSize
}

/** Child boxes inside `buf[start, end)`; offsets are relative to `buf`. */
function children(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > end) break
      size = Number(buf.readBigUInt64BE(offset + 8))
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) break
    boxes.push({ type, start: offset, size, headerSize })
    offset += size
  }
  return boxes
}

function child(buf: Buffer, parent: Box, type: string): Box | undefined {
  return children(buf, contentStart(parent), boxEnd(parent)).find((b) => b.type === type)
}

function path(buf: Buffer, parent: Box, ...types: string[]): Box | undefined {
  let current: Box | undefined = parent
  for (const type of types) {
    if (!current) return undefined
    current = child(buf, current, type)
  }
  return current
}

function raw(buf: Buffer, box: Box | undefined): Buffer | null {
  return box ? Buffer.from(buf.subarray(box.start, boxEnd(box))) : null
}

/** Top-level boxes of a file (only headers are read). */
async function topLevelBoxes(fh: FileHandle, fileSize: number): Promise<Box[]> {
  const boxes: Box[] = []
  const header = Buffer.alloc(16)
  let offset = 0
  while (offset + 8 <= fileSize) {
    const { bytesRead } = await fh.read(header, 0, 16, offset)
    if (bytesRead < 8) break
    let size = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let headerSize = 8
    if (size === 1) {
      if (bytesRead < 16) break
      size = Number(header.readBigUInt64BE(8))
      headerSize = 16
    } else if (size === 0) {
      size = fileSize - offset
    }
    if (size < headerSize) break
    boxes.push({ type, start: offset, size: Math.min(size, fileSize - offset), headerSize })
    offset += size
  }
  return boxes
}

async function readBox(fh: FileHandle, box: Box): Promise<Buffer> {
  const buf = Buffer.alloc(box.size)
  let read = 0
  while (read < box.size) {
    const { bytesRead } = await fh.read(buf, read, box.size - read, box.start + read)
    if (bytesRead === 0) throw new Error('unexpected end of file')
    read += bytesRead
  }
  return buf
}

// MARK: Model

interface Sample {
  /** Absolute offset of the sample data in its input file. */
  offset: number
  size: number
  duration: number
  cts: number
  sync: boolean
}

interface EditEntry {
  segmentDuration: number
  mediaTime: number
  rateInt: number
  rateFrac: number
}

interface Track {
  file: number
  trackId: number
  handler: string
  timescale: number
  language: number
  movieTimescale: number
  width: number
  height: number
  volume: number
  layer: number
  alternateGroup: number
  matrix: Buffer
  hdlr: Buffer
  mediaHeader: Buffer | null
  stsd: Buffer
  edits: EditEntry[]
  samples: Sample[]
  defaults: { descriptionIndex: number; duration: number; size: number; flags: number }
}

const IDENTITY_MATRIX = (() => {
  const m = Buffer.alloc(36)
  m.writeUInt32BE(0x00010000, 0)
  m.writeUInt32BE(0x00010000, 16)
  m.writeUInt32BE(0x40000000, 32)
  return m
})()

function readUint64(buf: Buffer, offset: number): number {
  return Number(buf.readBigUInt64BE(offset))
}

function readInt64(buf: Buffer, offset: number): number {
  return Number(buf.readBigInt64BE(offset))
}

function parseTrak(buf: Buffer, trak: Box, file: number, movieTimescale: number): Track | null {
  const tkhd = child(buf, trak, 'tkhd')
  const mdia = child(buf, trak, 'mdia')
  if (!tkhd || !mdia) return null
  const mdhd = child(buf, mdia, 'mdhd')
  const hdlr = child(buf, mdia, 'hdlr')
  const minf = child(buf, mdia, 'minf')
  const stbl = minf ? child(buf, minf, 'stbl') : undefined
  const stsd = stbl ? child(buf, stbl, 'stsd') : undefined
  if (!mdhd || !hdlr || !minf || !stbl || !stsd) return null

  let p = contentStart(tkhd)
  const tkhdVersion = buf[p]
  p += 4
  p += tkhdVersion === 1 ? 16 : 8
  const trackId = buf.readUInt32BE(p)
  p += 8 + (tkhdVersion === 1 ? 8 : 4) // track_ID, reserved, duration
  p += 8 // reserved
  const layer = buf.readInt16BE(p)
  const alternateGroup = buf.readInt16BE(p + 2)
  const volume = buf.readInt16BE(p + 4)
  const matrix = Buffer.from(buf.subarray(p + 8, p + 44))
  const width = buf.readUInt32BE(p + 44)
  const height = buf.readUInt32BE(p + 48)

  p = contentStart(mdhd)
  const mdhdVersion = buf[p]
  p += 4 + (mdhdVersion === 1 ? 16 : 8)
  const timescale = buf.readUInt32BE(p)
  p += 4 + (mdhdVersion === 1 ? 8 : 4)
  const language = buf.readUInt16BE(p)

  const handler = buf.toString('latin1', contentStart(hdlr) + 8, contentStart(hdlr) + 12)
  const mediaHeader = raw(buf, child(buf, minf, 'vmhd') ?? child(buf, minf, 'smhd') ?? child(buf, minf, 'sthd') ?? child(buf, minf, 'nmhd'))

  const edits: EditEntry[] = []
  const elst = path(buf, trak, 'edts', 'elst')
  if (elst) {
    let q = contentStart(elst)
    const version = buf[q]
    const count = buf.readUInt32BE(q + 4)
    q += 8
    for (let i = 0; i < count && q < boxEnd(elst); i++) {
      if (version === 1) {
        edits.push({ segmentDuration: readUint64(buf, q), mediaTime: readInt64(buf, q + 8), rateInt: buf.readInt16BE(q + 16), rateFrac: buf.readInt16BE(q + 18) })
        q += 20
      } else {
        edits.push({ segmentDuration: buf.readUInt32BE(q), mediaTime: buf.readInt32BE(q + 4), rateInt: buf.readInt16BE(q + 8), rateFrac: buf.readInt16BE(q + 10) })
        q += 12
      }
    }
  }

  return {
    file,
    trackId,
    handler,
    timescale: timescale || 1000,
    language,
    movieTimescale,
    width,
    height,
    volume,
    layer,
    alternateGroup,
    matrix: matrix.length === 36 ? matrix : IDENTITY_MATRIX,
    hdlr: raw(buf, hdlr)!,
    mediaHeader,
    stsd: raw(buf, stsd)!,
    edits,
    samples: progressiveSamples(buf, stbl),
    defaults: { descriptionIndex: 1, duration: 0, size: 0, flags: 0 },
  }
}

/** Samples described by a regular (non-fragmented) sample table. */
function progressiveSamples(buf: Buffer, stbl: Box): Sample[] {
  const stsz = child(buf, stbl, 'stsz')
  const stsc = child(buf, stbl, 'stsc')
  const stco = child(buf, stbl, 'stco') ?? child(buf, stbl, 'co64')
  const stts = child(buf, stbl, 'stts')
  if (!stsz || !stsc || !stco || !stts) return []

  let p = contentStart(stsz) + 4
  const fixedSize = buf.readUInt32BE(p)
  const count = buf.readUInt32BE(p + 4)
  if (count === 0) return []
  p += 8
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(fixedSize !== 0 ? fixedSize : buf.readUInt32BE(p + i * 4))

  const durations: number[] = []
  p = contentStart(stts) + 4
  const sttsCount = buf.readUInt32BE(p)
  p += 4
  for (let i = 0; i < sttsCount; i++) {
    const n = buf.readUInt32BE(p + i * 8)
    const delta = buf.readUInt32BE(p + i * 8 + 4)
    for (let j = 0; j < n && durations.length < count; j++) durations.push(delta)
  }

  const ctsList: number[] = []
  const ctts = child(buf, stbl, 'ctts')
  if (ctts) {
    p = contentStart(ctts)
    const version = buf[p]
    const n = buf.readUInt32BE(p + 4)
    p += 8
    for (let i = 0; i < n; i++) {
      const runs = buf.readUInt32BE(p + i * 8)
      const offset = version === 1 ? buf.readInt32BE(p + i * 8 + 4) : buf.readUInt32BE(p + i * 8 + 4)
      for (let j = 0; j < runs && ctsList.length < count; j++) ctsList.push(offset)
    }
  }

  let syncSet: Set<number> | null = null
  const stss = child(buf, stbl, 'stss')
  if (stss) {
    syncSet = new Set()
    p = contentStart(stss) + 4
    const n = buf.readUInt32BE(p)
    for (let i = 0; i < n; i++) syncSet.add(buf.readUInt32BE(p + 4 + i * 4))
  }

  const chunkOffsets: number[] = []
  p = contentStart(stco) + 4
  const chunks = buf.readUInt32BE(p)
  p += 4
  for (let i = 0; i < chunks; i++) {
    chunkOffsets.push(stco.type === 'co64' ? readUint64(buf, p + i * 8) : buf.readUInt32BE(p + i * 4))
  }

  const stscEntries: { firstChunk: number; perChunk: number }[] = []
  p = contentStart(stsc) + 4
  const stscCount = buf.readUInt32BE(p)
  p += 4
  for (let i = 0; i < stscCount; i++) {
    stscEntries.push({ firstChunk: buf.readUInt32BE(p + i * 12), perChunk: buf.readUInt32BE(p + i * 12 + 4) })
  }

  const samples: Sample[] = []
  let sampleIndex = 0
  for (let chunk = 0; chunk < chunkOffsets.length && sampleIndex < count; chunk++) {
    let perChunk = 0
    for (const entry of stscEntries) if (entry.firstChunk <= chunk + 1) perChunk = entry.perChunk
    let offset = chunkOffsets[chunk]
    for (let j = 0; j < perChunk && sampleIndex < count; j++) {
      const size = sizes[sampleIndex]
      samples.push({
        offset,
        size,
        duration: durations[sampleIndex] ?? 0,
        cts: ctsList[sampleIndex] ?? 0,
        sync: syncSet ? syncSet.has(sampleIndex + 1) : true,
      })
      offset += size
      sampleIndex++
    }
  }
  return samples
}

/** Samples of one `moof` (offsets are absolute in the file; `moofStart` is the box's file offset). */
function fragmentSamples(buf: Buffer, moofStart: number, tracks: Map<number, Track>, fileIndex: number): void {
  const moof: Box = { type: 'moof', start: 0, size: buf.length, headerSize: 8 }
  let previousEnd = moofStart
  for (const traf of children(buf, contentStart(moof), boxEnd(moof)).filter((b) => b.type === 'traf')) {
    const tfhd = child(buf, traf, 'tfhd')
    if (!tfhd) continue
    let p = contentStart(tfhd)
    const flags = buf.readUInt32BE(p) & 0xffffff
    const trackId = buf.readUInt32BE(p + 4)
    p += 8
    const track = tracks.get(trackId)
    if (!track || track.file !== fileIndex) continue
    let base = moofStart
    if (flags & 0x1) {
      base = readUint64(buf, p)
      p += 8
    } else if (!(flags & 0x20000)) {
      base = previousEnd
    }
    if (flags & 0x2) p += 4
    let defaultDuration = track.defaults.duration
    let defaultSize = track.defaults.size
    let defaultFlags = track.defaults.flags
    if (flags & 0x8) {
      defaultDuration = buf.readUInt32BE(p)
      p += 4
    }
    if (flags & 0x10) {
      defaultSize = buf.readUInt32BE(p)
      p += 4
    }
    if (flags & 0x20) {
      defaultFlags = buf.readUInt32BE(p)
      p += 4
    }

    let dataPosition = base
    for (const trun of children(buf, contentStart(traf), boxEnd(traf)).filter((b) => b.type === 'trun')) {
      let q = contentStart(trun)
      const version = buf[q]
      const trunFlags = buf.readUInt32BE(q) & 0xffffff
      const count = buf.readUInt32BE(q + 4)
      q += 8
      if (trunFlags & 0x1) {
        dataPosition = base + buf.readInt32BE(q)
        q += 4
      }
      let firstFlags: number | null = null
      if (trunFlags & 0x4) {
        firstFlags = buf.readUInt32BE(q)
        q += 4
      }
      for (let i = 0; i < count; i++) {
        let duration = defaultDuration
        let size = defaultSize
        let sampleFlags = i === 0 && firstFlags !== null ? firstFlags : defaultFlags
        let cts = 0
        if (trunFlags & 0x100) {
          duration = buf.readUInt32BE(q)
          q += 4
        }
        if (trunFlags & 0x200) {
          size = buf.readUInt32BE(q)
          q += 4
        }
        if (trunFlags & 0x400) {
          const value = buf.readUInt32BE(q)
          q += 4
          if (!(i === 0 && firstFlags !== null)) sampleFlags = value
        }
        if (trunFlags & 0x800) {
          cts = version === 0 ? buf.readUInt32BE(q) : buf.readInt32BE(q)
          q += 4
        }
        track.samples.push({ offset: dataPosition, size, duration, cts, sync: ((sampleFlags >>> 16) & 1) === 0 })
        dataPosition += size
      }
    }
    previousEnd = dataPosition
  }
}

interface ParsedFile {
  fh: FileHandle
  tracks: Track[]
}

async function parseFile(path: string, fileIndex: number): Promise<ParsedFile> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const boxes = await topLevelBoxes(fh, size)
    const moovBox = boxes.find((b) => b.type === 'moov')
    if (!moovBox) throw new Error('không có moov')
    const moov = await readBox(fh, moovBox)
    const root: Box = { type: 'moov', start: 0, size: moov.length, headerSize: moovBox.headerSize }
    const mvhd = child(moov, root, 'mvhd')
    let movieTimescale = 1000
    if (mvhd) {
      const p = contentStart(mvhd)
      movieTimescale = moov.readUInt32BE(p + 4 + (moov[p] === 1 ? 16 : 8)) || 1000
    }
    const tracks: Track[] = []
    for (const trak of children(moov, contentStart(root), boxEnd(root)).filter((b) => b.type === 'trak')) {
      const track = parseTrak(moov, trak, fileIndex, movieTimescale)
      if (track) tracks.push(track)
    }
    const byId = new Map(tracks.map((t) => [t.trackId, t]))
    const mvex = child(moov, root, 'mvex')
    if (mvex) {
      for (const trex of children(moov, contentStart(mvex), boxEnd(mvex)).filter((b) => b.type === 'trex')) {
        const p = contentStart(trex) + 4
        const track = byId.get(moov.readUInt32BE(p))
        if (track) {
          track.defaults = {
            descriptionIndex: moov.readUInt32BE(p + 4),
            duration: moov.readUInt32BE(p + 8),
            size: moov.readUInt32BE(p + 12),
            flags: moov.readUInt32BE(p + 16),
          }
        }
      }
    }
    const fragmentStarts: { track: Track; index: number; decodeTime: number | null }[] = []
    for (const box of boxes.filter((b) => b.type === 'moof')) {
      const moof = await readBox(fh, box)
      // Remember where each fragment starts (for tracks whose samples carry no duration).
      for (const traf of children(moof, 8, moof.length).filter((b) => b.type === 'traf')) {
        const tfhd = child(moof, traf, 'tfhd')
        const tfdt = child(moof, traf, 'tfdt')
        if (!tfhd) continue
        const track = byId.get(moof.readUInt32BE(contentStart(tfhd) + 4))
        if (!track) continue
        let decodeTime: number | null = null
        if (tfdt) {
          const p = contentStart(tfdt)
          decodeTime = moof[p] === 1 ? readUint64(moof, p + 4) : moof.readUInt32BE(p + 4)
        }
        fragmentStarts.push({ track, index: track.samples.length, decodeTime })
      }
      fragmentSamples(moof, box.start, byId, fileIndex)
    }
    fillMissingDurations(fragmentStarts)
    return { fh, tracks }
  } catch (error) {
    await fh.close()
    throw error
  }
}

/** Fragments without sample durations: spread the gap between their decode times. */
function fillMissingDurations(starts: { track: Track; index: number; decodeTime: number | null }[]): void {
  for (let i = 0; i < starts.length; i++) {
    const current = starts[i]
    const next = starts.slice(i + 1).find((s) => s.track === current.track)
    const end = next ? next.index : current.track.samples.length
    const samples = current.track.samples.slice(current.index, end)
    if (samples.length === 0 || samples.some((s) => s.duration > 0)) continue
    if (next?.decodeTime == null || current.decodeTime == null) continue
    const each = Math.max(Math.round((next.decodeTime - current.decodeTime) / samples.length), 1)
    for (const s of samples) s.duration = each
  }
}

// MARK: Box writing

function box(type: string, ...parts: Buffer[]): Buffer {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(size, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, ...parts])
}

function fullBox(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  const vf = Buffer.alloc(4)
  vf.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff), 0)
  return box(type, vf, ...parts)
}

function u32(...values: number[]): Buffer {
  return u32Array(values)
}

/** Big tables must not go through argument spreading (engines cap the argument count). */
function u32Array(values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4)
  for (let i = 0; i < values.length; i++) b.writeUInt32BE(values[i] >>> 0, i * 4)
  return b
}

function u64(value: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(Math.max(0, Math.round(value))))
  return b
}

function i64(value: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigInt64BE(BigInt(Math.round(value)))
  return b
}

const UINT32_MAX = 0xffffffff

function ftyp(audioOnly: boolean): Buffer {
  const brands = audioOnly ? ['M4A ', 'isom', 'iso2', 'mp41'] : ['isom', 'iso2', 'avc1', 'mp41']
  return box('ftyp', Buffer.from(audioOnly ? 'M4A ' : 'isom', 'latin1'), u32(0x200), Buffer.from(brands.join(''), 'latin1'))
}

function mvhd(timescale: number, duration: number, nextTrackId: number): Buffer {
  const v1 = duration > UINT32_MAX
  const times = v1 ? Buffer.concat([u64(0), u64(0), u32(timescale), u64(duration)]) : u32(0, 0, timescale, duration)
  const rest = Buffer.alloc(80)
  rest.writeUInt32BE(0x00010000, 0) // rate 1.0
  rest.writeUInt16BE(0x0100, 4) // volume 1.0
  IDENTITY_MATRIX.copy(rest, 16)
  rest.writeUInt32BE(nextTrackId, 76)
  return fullBox('mvhd', v1 ? 1 : 0, 0, times, rest)
}

function tkhd(track: Track, trackId: number, movieDuration: number): Buffer {
  const v1 = movieDuration > UINT32_MAX
  const times = v1
    ? Buffer.concat([u64(0), u64(0), u32(trackId, 0), u64(movieDuration)])
    : u32(0, 0, trackId, 0, movieDuration)
  const rest = Buffer.alloc(60)
  rest.writeInt16BE(track.layer, 8)
  rest.writeInt16BE(track.alternateGroup, 10)
  rest.writeInt16BE(track.handler === 'soun' ? 0x0100 : track.volume, 12)
  track.matrix.copy(rest, 16)
  rest.writeUInt32BE(track.handler === 'vide' ? track.width : 0, 52)
  rest.writeUInt32BE(track.handler === 'vide' ? track.height : 0, 56)
  return fullBox('tkhd', v1 ? 1 : 0, 0x7, times, rest)
}

function mdhd(timescale: number, duration: number, language: number): Buffer {
  const v1 = duration > UINT32_MAX
  const times = v1 ? Buffer.concat([u64(0), u64(0), u32(timescale), u64(duration)]) : u32(0, 0, timescale, duration)
  const lang = Buffer.alloc(4)
  lang.writeUInt16BE(language || 0x55c4, 0) // "und"
  return fullBox('mdhd', v1 ? 1 : 0, 0, times, lang)
}

function elst(entries: EditEntry[]): Buffer {
  const v1 = entries.some((e) => e.segmentDuration > UINT32_MAX || e.mediaTime > 0x7fffffff)
  const parts = entries.map((e) => {
    const rate = Buffer.alloc(4)
    rate.writeInt16BE(e.rateInt, 0)
    rate.writeInt16BE(e.rateFrac, 2)
    if (v1) return Buffer.concat([u64(e.segmentDuration), i64(e.mediaTime), rate])
    const b = Buffer.alloc(8)
    b.writeUInt32BE(e.segmentDuration >>> 0, 0)
    b.writeInt32BE(e.mediaTime, 4)
    return Buffer.concat([b, rate])
  })
  return box('edts', fullBox('elst', v1 ? 1 : 0, 0, u32(entries.length), ...parts))
}

function runLength(values: number[]): [number, number][] {
  const runs: [number, number][] = []
  for (const v of values) {
    const last = runs[runs.length - 1]
    if (last && last[1] === v) last[0]++
    else runs.push([1, v])
  }
  return runs
}

interface OutChunk {
  track: number
  file: number
  first: number
  count: number
  /** Input byte range. */
  offset: number
  size: number
  /** Decode time of the first sample, seconds. */
  time: number
}

function stbl(track: Track, samples: Sample[], chunks: OutChunk[], chunkOffsets: number[], useCo64: boolean): Buffer {
  const stts = runLength(samples.map((s) => s.duration))
  const parts: Buffer[] = [track.stsd]
  parts.push(fullBox('stts', 0, 0, u32(stts.length), u32Array(stts.flat())))
  if (samples.some((s) => s.cts !== 0)) {
    const ctts = runLength(samples.map((s) => s.cts))
    parts.push(fullBox('ctts', 0, 0, u32(ctts.length), u32Array(ctts.flat())))
  }
  if (samples.some((s) => !s.sync)) {
    const sync: number[] = []
    for (let i = 0; i < samples.length; i++) if (samples[i].sync) sync.push(i + 1)
    parts.push(fullBox('stss', 0, 0, u32(sync.length), u32Array(sync)))
  }
  const stsc: number[] = []
  let lastCount = -1
  chunks.forEach((chunk, index) => {
    if (chunk.count !== lastCount) stsc.push(index + 1, chunk.count, 1)
    lastCount = chunk.count
  })
  parts.push(fullBox('stsc', 0, 0, u32(stsc.length / 3), u32Array(stsc)))
  parts.push(fullBox('stsz', 0, 0, u32(0, samples.length), u32Array(samples.map((s) => s.size))))
  if (useCo64) {
    const table = Buffer.alloc(chunkOffsets.length * 8)
    chunkOffsets.forEach((offset, i) => table.writeBigUInt64BE(BigInt(offset), i * 8))
    parts.push(fullBox('co64', 0, 0, u32(chunkOffsets.length), table))
  } else {
    parts.push(fullBox('stco', 0, 0, u32(chunkOffsets.length), u32Array(chunkOffsets)))
  }
  return box('stbl', ...parts)
}

function defaultMediaHeader(handler: string): Buffer {
  return handler === 'soun' ? fullBox('smhd', 0, 0, u32(0)) : fullBox('vmhd', 0, 1, Buffer.alloc(8))
}

const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)))

// MARK: Muxing

export interface MuxOptions {
  /** Output is audio only (`.m4a` brands). */
  audioOnly?: boolean
  /** 0…1 while the sample data is copied. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

const MOVIE_TIMESCALE = 1000

/**
 * Writes `output` with the first video track (unless `audioOnly`) and the first audio track
 * found in `inputs`.
 */
export async function muxMp4(inputs: string[], output: string, options: MuxOptions = {}): Promise<void> {
  const files: ParsedFile[] = []
  try {
    for (let i = 0; i < inputs.length; i++) files.push(await parseFile(inputs[i], i))
    const all = files.flatMap((f) => f.tracks).filter((t) => t.samples.length > 0)
    const video = options.audioOnly ? undefined : all.find((t) => t.handler === 'vide')
    const audio = all.find((t) => t.handler === 'soun')
    const tracks = [video, audio].filter((t): t is Track => !!t)
    if (tracks.length === 0) throw new Error('không có dữ liệu âm thanh / hình ảnh')

    // Negative composition offsets: shift them to ≥ 0 and compensate in the edit list.
    for (const track of tracks) {
      let minCts = 0
      for (const s of track.samples) if (s.cts < minCts) minCts = s.cts
      if (minCts < 0) {
        for (const s of track.samples) s.cts -= minCts
        if (track.edits.length === 0) track.edits = [{ segmentDuration: 0, mediaTime: 0, rateInt: 1, rateFrac: 0 }]
        for (const e of track.edits) if (e.mediaTime >= 0) e.mediaTime -= minCts
      }
      // Fragmented files rarely carry an edit list: start the presentation at the first frame
      // shown (B-frame reordering delays it), like ffmpeg does when it remuxes them.
      if (track.edits.length === 0) {
        let decode = 0
        let first = Number.MAX_SAFE_INTEGER
        for (let i = 0; i < Math.min(track.samples.length, 64); i++) {
          first = Math.min(first, decode + track.samples[i].cts)
          decode += track.samples[i].duration
        }
        if (first > 0 && first < Number.MAX_SAFE_INTEGER) {
          track.edits = [{ segmentDuration: 0, mediaTime: first, rateInt: 1, rateFrac: 0 }]
        }
      }
    }

    // Chunks: contiguous runs of samples, at most ~1 s each, interleaved by decode time.
    const chunks: OutChunk[] = []
    tracks.forEach((track, trackIndex) => {
      let decode = 0
      let current: OutChunk | null = null
      let chunkStartDecode = 0
      for (let i = 0; i < track.samples.length; i++) {
        const s = track.samples[i]
        if (!current || current.offset + current.size !== s.offset || decode - chunkStartDecode >= track.timescale) {
          current = { track: trackIndex, file: track.file, first: i, count: 0, offset: s.offset, size: 0, time: decode / track.timescale }
          chunkStartDecode = decode
          chunks.push(current)
        }
        current.count++
        current.size += s.size
        decode += s.duration
      }
    })
    chunks.sort((a, b) => a.time - b.time || a.track - b.track)
    const perTrack = tracks.map((_, i) => chunks.filter((c) => c.track === i))

    const mediaDurations = tracks.map((t) => t.samples.reduce((n, s) => n + s.duration, 0))
    // Where the last frame shown ends (composition offsets can push it past the decode end).
    const presentationEnds = tracks.map((t) => {
      let decode = 0
      let end = 0
      for (const s of t.samples) {
        end = Math.max(end, decode + s.cts + s.duration)
        decode += s.duration
      }
      return end
    })
    // Edit lists in the output movie's timescale; a single "whole track" edit is left out.
    const editLists = tracks.map((track, i): EditEntry[] => {
      const edits = track.edits.map((e) => ({
        ...e,
        segmentDuration:
          e.mediaTime < 0
            ? Math.round((e.segmentDuration * MOVIE_TIMESCALE) / (track.movieTimescale || MOVIE_TIMESCALE))
            : Math.max(0, Math.round(((presentationEnds[i] - e.mediaTime) * MOVIE_TIMESCALE) / track.timescale)),
      }))
      return edits.some((e) => e.mediaTime !== 0) ? edits : []
    })
    const movieDurations = mediaDurations.map((d, i) =>
      editLists[i].length > 0
        ? editLists[i].reduce((n, e) => n + e.segmentDuration, 0)
        : Math.round((d * MOVIE_TIMESCALE) / tracks[i].timescale),
    )
    const dataSize = chunks.reduce((n, c) => n + c.size, 0)
    const largeMdat = dataSize + 16 > UINT32_MAX
    const mdatHeader = largeMdat ? 16 : 8

    const buildMoov = (offsetsFor: (trackIndex: number) => number[], useCo64: boolean): Buffer => {
      const traks = tracks.map((track, i) => {
        return box(
          'trak',
          tkhd(track, i + 1, movieDurations[i]),
          ...(editLists[i].length > 0 ? [elst(editLists[i])] : []),
          box(
            'mdia',
            mdhd(track.timescale, mediaDurations[i], track.language),
            track.hdlr,
            box('minf', track.mediaHeader ?? defaultMediaHeader(track.handler), dinf, stbl(track, track.samples, perTrack[i], offsetsFor(i), useCo64)),
          ),
        )
      })
      return box('moov', mvhd(MOVIE_TIMESCALE, Math.max(...movieDurations), tracks.length + 1), ...traks)
    }

    const head = ftyp(!video)
    // The moov's size does not depend on the offset values, only on their width.
    const useCo64 = head.length + dataSize + mdatHeader + 1_048_576 > UINT32_MAX || largeMdat
    const placeholder = buildMoov((i) => perTrack[i].map(() => 0), useCo64)
    const dataStart = head.length + placeholder.length + mdatHeader
    const outputOffsets = new Map<OutChunk, number>()
    let position = dataStart
    for (const chunk of chunks) {
      outputOffsets.set(chunk, position)
      position += chunk.size
    }
    const moov = buildMoov((i) => perTrack[i].map((c) => outputOffsets.get(c)!), useCo64)
    if (moov.length !== placeholder.length) throw new Error('moov size changed')

    const mdat = Buffer.alloc(mdatHeader)
    if (largeMdat) {
      mdat.writeUInt32BE(1, 0)
      mdat.write('mdat', 4, 'latin1')
      mdat.writeBigUInt64BE(BigInt(dataSize + 16), 8)
    } else {
      mdat.writeUInt32BE(dataSize + 8, 0)
      mdat.write('mdat', 4, 'latin1')
    }

    const out = await open(output, 'w')
    try {
      let written = 0
      const write = async (data: Buffer) => {
        let done = 0
        while (done < data.length) {
          const { bytesWritten } = await out.write(data, done, data.length - done, written)
          done += bytesWritten
          written += bytesWritten
        }
      }
      await write(head)
      await write(moov)
      await write(mdat)
      const buffer = Buffer.alloc(4 << 20)
      let copied = 0
      let lastReport = 0
      for (const chunk of chunks) {
        if (options.signal?.aborted) throw new Error('cancelled')
        const fh = files[chunk.file].fh
        let remaining = chunk.size
        let from = chunk.offset
        while (remaining > 0) {
          const n = Math.min(remaining, buffer.length)
          const { bytesRead } = await fh.read(buffer, 0, n, from)
          if (bytesRead <= 0) throw new Error('tệp nguồn bị thiếu dữ liệu')
          await write(buffer.subarray(0, bytesRead))
          remaining -= bytesRead
          from += bytesRead
          copied += bytesRead
        }
        if (options.onProgress && (copied - lastReport > 8 << 20 || copied === dataSize)) {
          lastReport = copied
          options.onProgress(dataSize > 0 ? copied / dataSize : 1)
        }
      }
    } finally {
      await out.close()
    }
  } finally {
    await Promise.all(files.map((f) => f.fh.close().catch(() => {})))
  }
}

/** Track summary of an MP4 file (handler, sample count, duration in seconds) — for tests and logs. */
export async function probeMp4(file: string): Promise<{ handler: string; samples: number; duration: number; fragmented: boolean }[]> {
  const parsed = await parseFile(file, 0)
  try {
    return parsed.tracks.map((t) => ({
      handler: t.handler,
      samples: t.samples.length,
      duration: t.samples.reduce((n, s) => n + s.duration, 0) / t.timescale,
      fragmented: t.defaults.duration !== 0 || t.defaults.size !== 0,
    }))
  } finally {
    await parsed.fh.close()
  }
}

/** Raw bytes of every sample of the first track with `handler` (tests compare inputs and output). */
export async function sampleData(file: string, handler: string): Promise<Buffer[]> {
  const parsed = await parseFile(file, 0)
  try {
    const track = parsed.tracks.find((t) => t.handler === handler)
    if (!track) return []
    const result: Buffer[] = []
    for (const s of track.samples) {
      const b = Buffer.alloc(s.size)
      await parsed.fh.read(b, 0, s.size, s.offset)
      result.push(b)
    }
    return result
  } finally {
    await parsed.fh.close()
  }
}
