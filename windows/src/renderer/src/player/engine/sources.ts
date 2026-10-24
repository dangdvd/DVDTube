// Which ways of playing a video to try, best first. Each one is tried at most once; when one
// fails the controller moves on to the next (keeping the position).
//
//   VOD:  in-memory DASH (adaptive formats) → HLS → YouTube's DASH manifest → muxed MP4 (itag 18)
//   Live: HLS → YouTube's DASH manifest
//
// Finished downloads are played from the file before any of these (see the controller).

import type { PlayerInfo, StreamFormat } from '@shared/models'
import { isAudioFormat } from '@shared/models'
import type { PlaybackSource } from './engine'
import { buildDashManifest, manifestUri, parseMime } from './manifest'

const HLS_MIME = 'application/x-mpegurl'
const DASH_MIME = 'application/dash+xml'

function bestMuxed(formats: StreamFormat[]): StreamFormat | null {
  const mp4 = formats.filter((f) => parseMime(f.mimeType).mime === 'video/mp4' && f.url)
  return [...mp4].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] ?? null
}

function bestAacAudio(formats: StreamFormat[]): StreamFormat | null {
  const aac = formats.filter((f) => isAudioFormat(f) && f.url && parseMime(f.mimeType).codecs.startsWith('mp4a'))
  const main = aac.filter((f) => f.isDefaultAudio)
  return [...(main.length ? main : aac)].sort((a, b) => b.bitrate - a.bitrate)[0] ?? null
}

export function planSources(info: PlayerInfo, options: { audioOnly: boolean }): PlaybackSource[] {
  const sources: PlaybackSource[] = []
  const hls: PlaybackSource | null = info.hlsUrl ? { kind: 'hls', uri: info.hlsUrl, mimeType: HLS_MIME } : null
  const youtubeDash: PlaybackSource | null = info.dashUrl ? { kind: 'dash-live', uri: info.dashUrl, mimeType: DASH_MIME } : null

  if (info.isLive) {
    if (hls) sources.push(hls)
    if (youtubeDash) sources.push(youtubeDash)
    return sources
  }

  const mpd = buildDashManifest(info, { audioOnly: options.audioOnly })
  if (mpd) sources.push({ kind: 'dash', uri: manifestUri(mpd), mimeType: DASH_MIME, audioOnly: options.audioOnly })
  if (hls) sources.push(hls)
  if (youtubeDash) sources.push(youtubeDash)
  if (options.audioOnly) {
    const audio = bestAacAudio(info.adaptiveFormats)
    if (audio) sources.push({ kind: 'progressive', uri: audio.url, mimeType: 'audio/mp4', audioOnly: true })
  }
  const muxed = bestMuxed(info.muxedFormats)
  if (muxed) sources.push({ kind: 'progressive', uri: muxed.url, mimeType: 'video/mp4' })
  return sources
}

/** A finished download (`.m4a` = audio only). */
export function downloadSource(fileUrl: string): PlaybackSource {
  const audioOnly = /\.m4a($|\?)/i.test(fileUrl)
  return { kind: 'download', uri: fileUrl, mimeType: audioOnly ? 'audio/mp4' : 'video/mp4', audioOnly }
}

export const SOURCE_LABELS: Record<PlaybackSource['kind'], string> = {
  download: 'Tệp đã tải xuống',
  dash: 'DASH (thích ứng)',
  hls: 'HLS',
  'dash-live': 'DASH của YouTube',
  progressive: 'MP4 ghép sẵn',
}
