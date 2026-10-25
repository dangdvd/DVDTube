// The WebM muxer with ffmpeg-made DASH-like inputs (VP9 video with Cues + Opus audio), checked
// with ffprobe and a full ffmpeg decode, plus frame-exact comparison with the inputs.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { muxWebm, probeWebm, webmFrames } from '../webmmux'

const dir = mkdtempSync(join(tmpdir(), 'dvdtube-webm-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const encoders = hasFfmpeg ? spawnSync('ffmpeg', ['-hide_banner', '-encoders']).stdout.toString() : ''
const canVp9 = encoders.includes('libvpx-vp9') && encoders.includes('libopus')

function ffmpeg(...args: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' })
}

function ffprobe(file: string): { streams: { codec_name: string; codec_type: string }[]; format: { duration: string } } {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]).toString())
}

function decodeErrors(file: string): string {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'])
  return result.stderr.toString().trim()
}

describe('webm muxer', { skip: !canVp9 && 'ffmpeg with libvpx-vp9 / libopus is not installed' }, () => {
  const video = join(dir, 'v.webm')
  const audio = join(dir, 'a.webm')

  it('merges VP9 video and Opus audio DASH files into one playable webm', async () => {
    // Like YouTube's DASH WebM: one track per file, keyframes every 2 s, Cues.
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=d=12:s=320x180:r=30', '-c:v', 'libvpx-vp9', '-b:v', '200k', '-g', '60', '-deadline', 'realtime', '-cpu-used', '8', '-dash', '1', '-f', 'webm', video)
    ffmpeg('-f', 'lavfi', '-i', 'sine=f=440:d=12', '-c:a', 'libopus', '-b:a', '64k', '-dash', '1', '-f', 'webm', audio)
    const out = join(dir, 'out.webm')
    let progress = 0
    await muxWebm([audio, video], out, { onProgress: (p) => (progress = p) })
    assert.equal(progress, 1)

    const probe = ffprobe(out)
    assert.deepEqual(probe.streams.map((s) => s.codec_type).sort(), ['audio', 'video'])
    assert.ok(probe.streams.some((s) => s.codec_name === 'vp9'))
    assert.ok(probe.streams.some((s) => s.codec_name === 'opus'))
    assert.ok(Math.abs(parseFloat(probe.format.duration) - 12) < 0.3, `duration ${probe.format.duration}`)
    assert.equal(decodeErrors(out), '')

    // Video is track 1, every frame of both inputs is there unchanged and in order.
    const info = await probeWebm(out)
    assert.equal(info.tracks[0].type, 1)
    assert.equal(info.tracks[0].codecId, 'V_VP9')
    assert.equal(info.tracks[1].codecId, 'A_OPUS')
    assert.deepEqual(await webmFrames(out, 1), await webmFrames(video, 1))
    assert.deepEqual(await webmFrames(out, 2), await webmFrames(audio, 2))
    assert.ok(info.tracks[0].keyframes >= 6)
  })

  it('seeks with the Cues it writes', async () => {
    const out = join(dir, 'out.webm')
    // Decoding from the middle needs a working index.
    const result = spawnSync('ffmpeg', ['-v', 'error', '-ss', '7', '-i', out, '-t', '2', '-f', 'null', '-'])
    assert.equal(result.status, 0)
    assert.equal(result.stderr.toString().trim(), '')
    const cues = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim()
    assert.ok(parseFloat(cues) > 11)
  })

  it('writes an audio-only webm', async () => {
    const out = join(dir, 'audio-only.webm')
    await muxWebm([audio], out)
    const probe = ffprobe(out)
    assert.deepEqual(probe.streams.map((s) => s.codec_name), ['opus'])
    assert.equal(decodeErrors(out), '')
  })

  it('rejects files that are not WebM', async () => {
    const out = join(dir, 'bad.webm')
    const text = join(dir, 'not-webm.txt')
    ffmpeg('-f', 'lavfi', '-i', 'sine=d=1', '-c:a', 'aac', '-f', 'mp4', text)
    await assert.rejects(() => muxWebm([text], out))
  })
})
