// Builds small synthetic fragmented MP4 files (DASH-like: init segment + moof/mdat pairs) for the
// muxer tests, so they also run where ffmpeg is not installed.

function box(type: string, ...parts: Buffer[]): Buffer {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(size, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, ...parts])
}

function full(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  const vf = Buffer.alloc(4)
  vf.writeUInt32BE((version << 24) | flags, 0)
  return box(type, vf, ...parts)
}

function u32(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4)
  values.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4))
  return b
}

export interface SyntheticTrack {
  handler: 'vide' | 'soun'
  timescale: number
  /** Samples per fragment. */
  fragments: number[]
  sampleDuration: number
  /** Composition offsets (trun v1, may be negative). */
  cts?: (index: number) => number
  /** Leave durations out of the trun and use the tfhd default instead. */
  defaultDurations?: boolean
  /** Insert a sidx box after the moov (like YouTube's DASH files). */
  sidx?: boolean
}

export interface SyntheticFile {
  bytes: Buffer
  samples: Buffer[]
}

export function syntheticFmp4(track: SyntheticTrack, seed = 1): SyntheticFile {
  let state = seed
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state
  }
  const sampleEntry =
    track.handler === 'vide'
      ? box('avc1', Buffer.alloc(78, 0), box('avcC', Buffer.from([1, 0x64, 0, 0x1f, 0xff, 0xe0, 0])))
      : box('mp4a', Buffer.alloc(28, 0), full('esds', 0, 0, Buffer.from([3, 4, 0, 0, 0, 0])))
  const tkhdRest = Buffer.alloc(60)
  tkhdRest.writeUInt32BE(0x00010000, 16)
  tkhdRest.writeUInt32BE(0x00010000, 32)
  tkhdRest.writeUInt32BE(0x40000000, 48)
  if (track.handler === 'vide') {
    tkhdRest.writeUInt32BE(640 << 16, 52)
    tkhdRest.writeUInt32BE(360 << 16, 56)
  }
  const mvhdRest = Buffer.alloc(80)
  mvhdRest.writeUInt32BE(0x00010000, 0)
  mvhdRest.writeUInt32BE(2, 76)
  const hdlrName = Buffer.from(track.handler === 'vide' ? 'VideoHandler\0' : 'SoundHandler\0', 'latin1')
  const moov = box(
    'moov',
    full('mvhd', 0, 0, u32(0, 0, 1000, 0), mvhdRest),
    box(
      'trak',
      full('tkhd', 0, 3, u32(0, 0, 1, 0, 0), tkhdRest),
      box(
        'mdia',
        full('mdhd', 0, 0, u32(0, 0, track.timescale, 0), Buffer.from([0x55, 0xc4, 0, 0])),
        full('hdlr', 0, 0, u32(0), Buffer.from(track.handler, 'latin1'), u32(0, 0, 0), hdlrName),
        box(
          'minf',
          track.handler === 'vide' ? full('vmhd', 0, 1, Buffer.alloc(8)) : full('smhd', 0, 0, u32(0)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          box(
            'stbl',
            full('stsd', 0, 0, u32(1), sampleEntry),
            full('stts', 0, 0, u32(0)),
            full('stsc', 0, 0, u32(0)),
            full('stsz', 0, 0, u32(0, 0)),
            full('stco', 0, 0, u32(0)),
          ),
        ),
      ),
    ),
    box('mvex', full('trex', 0, 0, u32(1, 1, track.defaultDurations ? track.sampleDuration : 0, 0, 0x01010000))),
  )
  const parts: Buffer[] = [box('ftyp', Buffer.from('dash', 'latin1'), u32(0), Buffer.from('iso6mp41', 'latin1')), moov]
  if (track.sidx) parts.push(full('sidx', 0, 0, u32(1, track.timescale, 0, 0, 0)))

  const samples: Buffer[] = []
  let decodeTime = 0
  let index = 0
  track.fragments.forEach((count, fragment) => {
    const sizes: number[] = []
    const datas: Buffer[] = []
    for (let i = 0; i < count; i++) {
      const size = 50 + (random() % 400)
      const data = Buffer.alloc(size)
      for (let j = 0; j < size; j++) data[j] = random() & 0xff
      sizes.push(size)
      datas.push(data)
      samples.push(data)
    }
    let flags = 0x1 | 0x200 | 0x400
    if (!track.defaultDurations) flags |= 0x100
    if (track.cts) flags |= 0x800
    const perSample: Buffer[] = []
    for (let i = 0; i < count; i++) {
      const fields: number[] = []
      if (!track.defaultDurations) fields.push(track.sampleDuration)
      fields.push(sizes[i])
      // Only the first sample of a video fragment is a sync sample.
      fields.push(track.handler === 'vide' && i > 0 ? 0x01010000 : 0x02000000)
      const entry = u32(...fields)
      if (track.cts) {
        const cts = Buffer.alloc(4)
        cts.writeInt32BE(track.cts(index + i), 0)
        perSample.push(Buffer.concat([entry, cts]))
      } else {
        perSample.push(entry)
      }
    }
    const build = (dataOffset: number) =>
      box(
        'moof',
        full('mfhd', 0, 0, u32(fragment + 1)),
        box(
          'traf',
          full('tfhd', 0, 0x20000, u32(1)),
          full('tfdt', 1, 0, Buffer.from([0, 0, 0, 0]), u32(decodeTime)),
          full('trun', track.cts ? 1 : 0, flags, u32(count), (() => {
            const b = Buffer.alloc(4)
            b.writeInt32BE(dataOffset, 0)
            return b
          })(), ...perSample),
        ),
      )
    const probe = build(0)
    const moof = build(probe.length + 8)
    parts.push(moof, box('mdat', ...datas))
    decodeTime += count * track.sampleDuration
    index += count
  })
  return { bytes: Buffer.concat(parts), samples }
}
