// The MP4 muxer: synthetic DASH-like inputs (always) and real ffmpeg-made inputs checked with
// ffprobe / a full ffmpeg decode (when ffmpeg is installed).

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { muxMp4, probeMp4, sampleData } from '../mp4mux'
import { syntheticFmp4 } from './fmp4'

const dir = mkdtempSync(join(tmpdir(), 'dvdtube-mux-'))
after(() => rmSync(dir, { recursive: true, force: true }))

function topLevel(file: string): string[] {
  const bytes = readFileSync(file)
  const types: string[] = []
  let offset = 0
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset)
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8))
    types.push(bytes.toString('latin1', offset + 4, offset + 8))
    if (size < 8) break
    offset += size
  }
  return types
}

describe('mp4 muxer (synthetic)', () => {
  it('merges a fragmented video and audio track into a progressive mp4', async () => {
    const video = syntheticFmp4({ handler: 'vide', timescale: 15360, fragments: [30, 30, 25], sampleDuration: 512, sidx: true }, 7)
    const audio = syntheticFmp4({ handler: 'soun', timescale: 44100, fragments: [100, 80], sampleDuration: 1024 }, 9)
    const v = join(dir, 'syn-v.mp4')
    const a = join(dir, 'syn-a.m4a')
    const out = join(dir, 'syn-out.mp4')
    writeFileSync(v, video.bytes)
    writeFileSync(a, audio.bytes)
    let lastProgress = 0
    await muxMp4([v, a], out, { onProgress: (p) => (lastProgress = p) })
    assert.equal(lastProgress, 1)
    assert.deepEqual(topLevel(out), ['ftyp', 'moov', 'mdat'])
    const tracks = await probeMp4(out)
    assert.equal(tracks.length, 2)
    const vt = tracks.find((t) => t.handler === 'vide')!
    const at = tracks.find((t) => t.handler === 'soun')!
    assert.equal(vt.samples, 85)
    assert.equal(at.samples, 180)
    assert.ok(Math.abs(vt.duration - (85 * 512) / 15360) < 1e-9)
    assert.ok(Math.abs(at.duration - (180 * 1024) / 44100) < 1e-9)
    assert.deepEqual(await sampleData(out, 'vide'), video.samples)
    assert.deepEqual(await sampleData(out, 'soun'), audio.samples)
  })

  it('keeps sync samples, composition offsets and trex default durations', async () => {
    const video = syntheticFmp4(
      { handler: 'vide', timescale: 90000, fragments: [12, 12], sampleDuration: 3000, cts: (i) => ((i % 3) - 1) * 3000, defaultDurations: true },
      3,
    )
    const v = join(dir, 'syn-cts.mp4')
    const out = join(dir, 'syn-cts-out.mp4')
    writeFileSync(v, video.bytes)
    await muxMp4([v], out)
    const [track] = await probeMp4(out)
    assert.equal(track.samples, 24)
    assert.ok(Math.abs(track.duration - (24 * 3000) / 90000) < 1e-9)
    assert.deepEqual(await sampleData(out, 'vide'), video.samples)
    const bytes = readFileSync(out)
    assert.ok(bytes.includes(Buffer.from('stss')), 'stss present for video with non-sync samples')
    assert.ok(bytes.includes(Buffer.from('ctts')), 'ctts present')
    assert.ok(bytes.includes(Buffer.from('elst')), 'negative offsets are compensated by an edit list')
  })

  it('writes audio only as m4a', async () => {
    const audio = syntheticFmp4({ handler: 'soun', timescale: 48000, fragments: [50, 50, 7], sampleDuration: 1024 }, 11)
    const a = join(dir, 'syn-audio.m4a')
    const out = join(dir, 'syn-audio-out.m4a')
    writeFileSync(a, audio.bytes)
    await muxMp4([a], out, { audioOnly: true })
    const bytes = readFileSync(out)
    assert.equal(bytes.toString('latin1', 8, 12), 'M4A ')
    const tracks = await probeMp4(out)
    assert.equal(tracks.length, 1)
    assert.equal(tracks[0].samples, 107)
    assert.deepEqual(await sampleData(out, 'soun'), audio.samples)
  })

  it('reads its own progressive output again (round trip)', async () => {
    const audio = syntheticFmp4({ handler: 'soun', timescale: 44100, fragments: [40], sampleDuration: 1024 }, 5)
    const a = join(dir, 'rt.m4a')
    const once = join(dir, 'rt-1.m4a')
    const twice = join(dir, 'rt-2.m4a')
    writeFileSync(a, audio.bytes)
    await muxMp4([a], once, { audioOnly: true })
    await muxMp4([once], twice, { audioOnly: true })
    assert.deepEqual(await sampleData(twice, 'soun'), audio.samples)
  })
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0

describe('mp4 muxer (ffmpeg inputs)', { skip: hasFfmpeg ? false : 'ffmpeg / ffprobe not installed' }, () => {
  const ffmpeg = (...args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' })
  const probe = (file: string) =>
    JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as {
      streams: { codec_type: string; codec_name: string; nb_frames?: string; duration?: string; start_time?: string }[]
      format: { duration: string }
    }
  const decodeErrors = (file: string) =>
    spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim()

  const variants: Record<string, string[]> = {
    'frag keyframe + empty moov': ['-movflags', '+frag_keyframe+empty_moov+default_base_moof'],
    'dash with global sidx': ['-movflags', '+dash+global_sidx+frag_keyframe+empty_moov+default_base_moof'],
    'negative cts offsets': ['-movflags', '+frag_keyframe+empty_moov+default_base_moof+negative_cts_offsets'],
    progressive: ['-movflags', '+faststart'],
  }

  for (const [name, flags] of Object.entries(variants)) {
    it(`video + audio: ${name}`, () => {
      const slug = name.replace(/\W+/g, '-')
      const v = join(dir, `${slug}-v.mp4`)
      const a = join(dir, `${slug}-a.m4a`)
      const out = join(dir, `${slug}-out.mp4`)
      ffmpeg('-f', 'lavfi', '-i', 'testsrc2=d=12:s=640x360:r=30', '-c:v', 'libx264', '-g', '60', '-pix_fmt', 'yuv420p', ...flags, '-f', 'mp4', v)
      ffmpeg('-f', 'lavfi', '-i', 'sine=d=12', '-c:a', 'aac', ...flags, '-f', 'mp4', a)
      return muxMp4([v, a], out).then(() => {
        const info = probe(out)
        assert.equal(info.streams.length, 2)
        const video = info.streams.find((s) => s.codec_type === 'video')!
        const audio = info.streams.find((s) => s.codec_type === 'audio')!
        assert.equal(video.codec_name, 'h264')
        assert.equal(audio.codec_name, 'aac')
        assert.equal(video.nb_frames, '360')
        // B-frame delay compensated: both tracks start together at 0.
        assert.ok(Math.abs(parseFloat(video.start_time ?? '1')) < 0.001, `video start ${video.start_time}`)
        assert.ok(Math.abs(parseFloat(audio.start_time ?? '1')) < 0.05, `audio start ${audio.start_time}`)
        assert.ok(Math.abs(parseFloat(video.duration ?? '0') - 12) < 0.05, `video duration ${video.duration}`)
        assert.ok(Math.abs(parseFloat(info.format.duration) - 12) < 0.15, `duration ${info.format.duration}`)
        assert.equal(decodeErrors(out), '')
        assert.deepEqual(topLevel(out), ['ftyp', 'moov', 'mdat'])
      })
    })
  }

  it('audio only from a fragmented AAC stream', async () => {
    const a = join(dir, 'only-a.m4a')
    const out = join(dir, 'only-out.m4a')
    ffmpeg('-f', 'lavfi', '-i', 'sine=d=7', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', '-f', 'mp4', a)
    await muxMp4([a], out, { audioOnly: true })
    const info = probe(out)
    assert.equal(info.streams.length, 1)
    assert.equal(info.streams[0].codec_name, 'aac')
    assert.ok(Math.abs(parseFloat(info.format.duration) - 7) < 0.1, `duration ${info.format.duration}`)
    assert.equal(decodeErrors(out), '')
  })
})
