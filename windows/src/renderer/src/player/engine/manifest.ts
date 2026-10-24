// Builds a static DASH manifest (MPD) in memory from the player endpoint's adaptive formats.
// YouTube serves every format as one file with an init segment and a segment index (sidx
// for MP4, Cues for WebM), which is exactly DASH's "SegmentBase" on-demand profile, so shaka
// can stream them adaptively (ABR, seeking, smooth quality switches) like YouTube's own player.

import type { PlayerInfo, StreamFormat } from '@shared/models'
import { isAudioFormat, isVideoFormat } from '@shared/models'

export interface ManifestOptions {
  /** Only the audio adaptation sets (audio-only mode: no picture is downloaded). */
  audioOnly?: boolean
}

interface ParsedMime {
  mime: string
  codecs: string
}

export function parseMime(mimeType: string): ParsedMime {
  const [mime, ...params] = mimeType.split(';').map((p) => p.trim())
  const codecsParam = params.find((p) => p.toLowerCase().startsWith('codecs='))
  const codecs = codecsParam ? codecsParam.slice(7).replace(/^"|"$/g, '').trim() : ''
  return { mime: mime.toLowerCase(), codecs }
}

/** "avc1", "vp9", "av1", "mp4a", "opus"… — formats of one family can switch seamlessly. */
export function codecFamily(codecs: string): string {
  const c = codecs.toLowerCase()
  if (c.startsWith('avc')) return 'avc1'
  if (c.startsWith('vp9') || c.startsWith('vp09')) return 'vp9'
  if (c.startsWith('av01')) return 'av1'
  if (c.startsWith('mp4a')) return 'mp4a'
  return c.split('.')[0] || 'unknown'
}

function isHdr(format: StreamFormat): boolean {
  return !!format.colorInfo && !/sdr/i.test(format.colorInfo)
}

/** DASH TransferCharacteristics (ISO/IEC 23001-8): 16 = PQ (HDR10), 18 = HLG. */
function transferCharacteristics(format: StreamFormat): number {
  return /hlg|b67/i.test(format.colorInfo ?? '') ? 18 : 16
}

function xml(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function range(r: { start: number; end: number }): string {
  return `${r.start}-${r.end}`
}

function isStreamable(format: StreamFormat): boolean {
  return (
    !!format.url &&
    !!format.initRange &&
    !!format.indexRange &&
    format.indexRange.end > format.indexRange.start &&
    format.initRange.end >= format.initRange.start
  )
}

/** Presentation duration in seconds, or null when nothing tells it. */
export function presentationDuration(info: PlayerInfo): number | null {
  const fromFormats = Math.max(0, ...info.adaptiveFormats.map((f) => f.approxDurationMs ?? 0)) / 1000
  if (fromFormats > 0) return fromFormats
  return info.lengthSeconds && info.lengthSeconds > 0 ? info.lengthSeconds : null
}

function representation(format: StreamFormat, id: string): string {
  const { codecs } = parseMime(format.mimeType)
  const attrs: string[] = [`id="${xml(id)}"`, `bandwidth="${Math.max(1, Math.round(format.bitrate || 1))}"`]
  if (codecs) attrs.push(`codecs="${xml(codecs)}"`)
  if (isVideoFormat(format)) {
    if (format.width) attrs.push(`width="${format.width}"`)
    if (format.height) attrs.push(`height="${format.height}"`)
    if (format.fps) attrs.push(`frameRate="${Math.round(format.fps)}"`)
  } else if (format.audioSampleRate) {
    attrs.push(`audioSamplingRate="${format.audioSampleRate}"`)
  }
  const channels = isAudioFormat(format)
    ? `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${format.audioChannels || 2}"/>`
    : ''
  return (
    `<Representation ${attrs.join(' ')}>${channels}` +
    `<BaseURL>${xml(format.url)}</BaseURL>` +
    `<SegmentBase indexRange="${range(format.indexRange!)}"><Initialization range="${range(format.initRange!)}"/></SegmentBase>` +
    `</Representation>`
  )
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = groups.get(k)
    if (list) list.push(item)
    else groups.set(k, [item])
  }
  return groups
}

/**
 * The MPD text, or null when the formats cannot be played as DASH (no byte ranges, no audio,
 * or no video unless audio only).
 */
export function buildDashManifest(info: PlayerInfo, options: ManifestOptions = {}): string | null {
  const usable = info.adaptiveFormats.filter(isStreamable)
  const video = options.audioOnly ? [] : usable.filter(isVideoFormat)
  const audio = usable.filter(isAudioFormat)
  if (!audio.length || (!options.audioOnly && !video.length)) return null

  let nextId = 0
  const sets: string[] = []

  // One adaptation set per container + codec family (+ HDR): switching inside a set never
  // needs a new decoder, and shaka picks the best family the hardware decodes smoothly.
  const videoGroups = groupBy(video, (f) => `${parseMime(f.mimeType).mime}|${codecFamily(parseMime(f.mimeType).codecs)}|${isHdr(f) ? 'hdr' : 'sdr'}`)
  for (const formats of videoGroups.values()) {
    const first = formats[0]
    const { mime } = parseMime(first.mimeType)
    const hdr = isHdr(first)
      ? `<SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:ColourPrimaries" value="9"/>` +
        `<SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:TransferCharacteristics" value="${transferCharacteristics(first)}"/>` +
        `<SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:MatrixCoefficients" value="9"/>`
      : ''
    const reps = [...formats].sort((a, b) => (a.height ?? 0) - (b.height ?? 0) || a.bitrate - b.bitrate)
    sets.push(
      `<AdaptationSet id="${sets.length}" contentType="video" mimeType="${xml(mime)}" subsegmentAlignment="true" subsegmentStartsWithSAP="1">` +
        hdr +
        reps.map((f) => representation(f, `v${f.itag}-${nextId++}`)).join('') +
        `</AdaptationSet>`,
    )
  }

  // One adaptation set per container + audio track (language / dubbed version). The default
  // track is marked "main" so shaka starts with it unless another language is preferred.
  const audioGroups = groupBy(audio, (f) => `${parseMime(f.mimeType).mime}|${f.audioLanguage ?? ''}|${f.audioTrackName ?? ''}`)
  const hasDefault = audio.some((f) => f.isDefaultAudio)
  for (const formats of audioGroups.values()) {
    const first = formats[0]
    const { mime } = parseMime(first.mimeType)
    const lang = first.audioLanguage ? ` lang="${xml(first.audioLanguage)}"` : ''
    const isMain = first.isDefaultAudio || !hasDefault
    const role = `<Role schemeIdUri="urn:mpeg:dash:role:2011" value="${isMain ? 'main' : 'dub'}"/>`
    const label = first.audioTrackName ? `<Label>${xml(first.audioTrackName)}</Label>` : ''
    const reps = [...formats].sort((a, b) => a.bitrate - b.bitrate)
    sets.push(
      `<AdaptationSet id="${sets.length}" contentType="audio" mimeType="${xml(mime)}"${lang} subsegmentAlignment="true" subsegmentStartsWithSAP="1">` +
        role +
        label +
        reps.map((f) => representation(f, `a${f.itag}-${nextId++}`)).join('') +
        `</AdaptationSet>`,
    )
  }

  const duration = presentationDuration(info)
  const durationAttr = duration ? ` mediaPresentationDuration="PT${duration.toFixed(3)}S"` : ''
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.5S"${durationAttr}>` +
    `<Period id="0" start="PT0S">${sets.join('')}</Period>` +
    `</MPD>`
  )
}

/** The manifest as a `data:` URI for `shaka.Player.load` (no blob URL to revoke later). */
export function manifestUri(mpd: string): string {
  const bytes = new TextEncoder().encode(mpd)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return 'data:application/dash+xml;base64,' + btoa(binary)
}
