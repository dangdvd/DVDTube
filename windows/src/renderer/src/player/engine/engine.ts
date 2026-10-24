// One shaka Player bound to one <video> element: loads a source (in-memory DASH, HLS,
// progressive file), exposes qualities / audio tracks / stats and reports errors in Vietnamese.

import type { AppSettings } from '@shared/settings'
import { googlevideoRequestFilter } from './network'
import { setupShaka, shaka } from './shaka'

export type SourceKind = 'download' | 'dash' | 'hls' | 'dash-live' | 'progressive'

export interface PlaybackSource {
  kind: SourceKind
  uri: string
  mimeType: string
  /** The source has no picture (audio-only DASH manifest or an .m4a download). */
  audioOnly?: boolean
}

export interface EnginePrefs {
  /** Highest height ABR may pick; 0 = no limit. */
  maxHeight: number
  codec: AppSettings['preferredCodec']
  audioLanguage: string | null
}

export interface QualityOption {
  height: number
  fps: number
  hdr: boolean
  /** "1080p60", "2160p HDR"… */
  label: string
  /** "HD", "4K", "8K" or null. */
  badge: string | null
}

export interface AudioTrackOption {
  id: string
  label: string
  language: string | null
  isDefault: boolean
}

export interface EngineError {
  code: number
  /** shaka.util.Error.Severity: 1 recoverable, 2 critical. */
  severity: number
  message: string
  detail: string
  httpStatus: number | null
}

export interface EngineStats {
  width: number
  height: number
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  streamBandwidth: number
  estimatedBandwidth: number
  droppedFrames: number
  decodedFrames: number
  bufferAhead: number
}

const RETRY = {
  maxAttempts: 4,
  baseDelay: 400,
  backoffFactor: 2,
  fuzzFactor: 0.5,
  timeout: 20000,
  stallTimeout: 10000,
  connectionTimeout: 10000,
}

const BANDWIDTH_KEY = 'dvd-player-bandwidth'

/** Among codecs offering the same resolution, prefer what the GPU decodes smoothly / efficiently. */
const DECODING_ATTRIBUTES = ['smooth', 'powerEfficient']

/** Last measured bandwidth, so the next video starts at a sensible quality. */
function savedBandwidth(): number {
  try {
    const value = Number(localStorage.getItem(BANDWIDTH_KEY))
    return Number.isFinite(value) && value > 100_000 ? value : 5_000_000
  } catch {
    return 5_000_000
  }
}

function saveBandwidth(value: number): void {
  if (!Number.isFinite(value) || value < 100_000) return
  try {
    localStorage.setItem(BANDWIDTH_KEY, String(Math.round(value)))
  } catch {
    // Storage unavailable: keep the default estimate.
  }
}

export function codecPreference(codec: AppSettings['preferredCodec']): string[] {
  switch (codec) {
    case 'av1':
      return ['av01']
    case 'vp9':
      return ['vp09', 'vp9']
    case 'h264':
      return ['avc1']
    default:
      return []
  }
}

export function qualityLabel(height: number, fps: number, hdr: boolean): string {
  return `${height}p${fps >= 48 ? Math.round(fps) : ''}${hdr ? ' HDR' : ''}`
}

export function qualityBadge(height: number): string | null {
  if (height >= 4320) return '8K'
  if (height >= 2160) return '4K'
  if (height >= 720) return 'HD'
  return null
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['vi'], { type: 'language' })
  } catch {
    return null
  }
})()

export function languageName(code: string | null | undefined): string {
  if (!code || code === 'und') return 'Không rõ'
  try {
    const name = languageNames?.of(code)
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code
  } catch {
    return code
  }
}

export function describeError(error: unknown): EngineError {
  const e = (error ?? {}) as { code?: number; severity?: number; data?: unknown[]; message?: string }
  const code = typeof e.code === 'number' ? e.code : 0
  const data = Array.isArray(e.data) ? e.data : []
  let httpStatus: number | null = null
  let message = 'Không phát được video'
  let detail: string
  switch (Math.floor(code / 1000)) {
    case 1:
      message = 'Lỗi mạng khi tải video'
      if (code === 1001) {
        httpStatus = Number(data[1]) || null
        detail = httpStatus === 403 ? 'Máy chủ video từ chối truy cập (HTTP 403)' : `Máy chủ video trả về lỗi HTTP ${httpStatus ?? '?'}`
      } else if (code === 1003) {
        detail = 'Hết thời gian chờ phản hồi từ máy chủ video'
      } else {
        detail = 'Không kết nối được tới máy chủ video'
      }
      break
    case 3:
      if (code === 3016) {
        // data[0] = MediaError code: 2 network, 3 decode, 4 source not supported / not found.
        const mediaCode = Number(data[0])
        detail =
          mediaCode === 2
            ? 'Lỗi mạng khi tải tệp video'
            : mediaCode === 3
              ? 'Trình phát không giải mã được luồng video'
              : 'Không tải được tệp video hoặc định dạng không được hỗ trợ'
      } else {
        detail = 'Lỗi khi đưa dữ liệu vào trình phát'
      }
      break
    case 4:
      detail = code === 4032 ? 'Định dạng video không được hỗ trợ trên máy này' : 'Không đọc được danh sách luồng video'
      break
    case 5:
      detail = 'Lỗi khi tải các đoạn video'
      break
    case 6:
      detail = 'Video được bảo vệ bản quyền (DRM), không phát được'
      break
    default:
      detail = e.message || 'Lỗi không xác định'
  }
  return { code, severity: e.severity ?? 2, message, detail: code ? `${detail} · mã ${code}` : detail, httpStatus }
}

/** Loads were interrupted by a newer load / unload: not an error worth showing. */
export function isInterruption(error: unknown): boolean {
  const code = (error as { code?: number } | null)?.code
  return code === 7000 || code === 7001 || code === 7003
}

export class PlaybackEngine {
  readonly video: HTMLVideoElement
  private readonly player: shaka.Player
  private readonly attached: Promise<unknown>
  source: PlaybackSource | null = null
  /** Height picked in the quality menu (0 = automatic). */
  manualHeight = 0

  onError: ((error: EngineError) => void) | null = null
  onTracksChanged: (() => void) | null = null
  onBuffering: ((buffering: boolean) => void) | null = null

  constructor(video: HTMLVideoElement) {
    setupShaka()
    this.video = video
    this.player = new shaka.Player()
    this.attached = this.player.attach(video).catch(() => {})
    this.player.getNetworkingEngine()?.registerRequestFilter(googlevideoRequestFilter)
    this.player.addEventListener('error', (event) => {
      this.onError?.(describeError((event as unknown as { detail?: unknown }).detail))
    })
    for (const name of ['variantchanged', 'adaptation', 'trackschanged', 'audiotrackschanged']) {
      this.player.addEventListener(name, () => this.onTracksChanged?.())
    }
    this.player.addEventListener('buffering', (event) => {
      this.onBuffering?.(!!(event as unknown as { buffering?: boolean }).buffering)
    })
    this.player.configure({
      streaming: {
        bufferingGoal: 30,
        rebufferingGoal: 2,
        bufferBehind: 30,
        retryParameters: RETRY,
      },
      manifest: { retryParameters: { ...RETRY, maxAttempts: 2 } },
      abr: { enabled: true, switchInterval: 4, defaultBandwidthEstimate: savedBandwidth() },
      preferredAudioCodecs: ['opus', 'mp4a'],
      preferredDecodingAttributes: DECODING_ATTRIBUTES,
      // Captions are drawn by the player UI from YouTube's own timed text.
      autoShowText: shaka.config.AutoShowText.NEVER,
    })
  }

  configure(prefs: EnginePrefs): void {
    this.player.configure({
      preferredVideoCodecs: codecPreference(prefs.codec),
      preferredAudioLanguage: prefs.audioLanguage ?? '',
      abr: { restrictions: { maxHeight: prefs.maxHeight > 0 ? prefs.maxHeight : Infinity } },
    })
  }

  /** Changes only the ABR height limit (mini player / window size) without touching the rest. */
  limitHeight(maxHeight: number): void {
    this.player.configure({ abr: { restrictions: { maxHeight: maxHeight > 0 ? maxHeight : Infinity } } })
  }

  async load(source: PlaybackSource, startAt: number | null): Promise<void> {
    await this.attached
    this.rememberBandwidth()
    this.source = source
    this.manualHeight = 0
    // shaka's decoding-attribute filter assumes every variant has video (it throws on an
    // audio-only manifest), so it is only used when there is a picture.
    this.player.configure({ abr: { enabled: true }, preferredDecodingAttributes: source.audioOnly ? [] : DECODING_ATTRIBUTES })
    await this.player.load(source.uri, startAt != null && startAt > 0 ? startAt : null, source.mimeType)
  }

  /** Starts fetching a source in the background; `loadPreloaded` then starts instantly. */
  async preload(source: PlaybackSource): Promise<shaka.media.PreloadManager | null> {
    await this.attached
    try {
      return await this.player.preload(source.uri, null, source.mimeType)
    } catch {
      return null
    }
  }

  async loadPreloaded(source: PlaybackSource, manager: shaka.media.PreloadManager): Promise<void> {
    await this.attached
    this.source = source
    this.manualHeight = 0
    this.player.configure({ abr: { enabled: true }, preferredDecodingAttributes: source.audioOnly ? [] : DECODING_ATTRIBUTES })
    await this.player.load(manager)
  }

  async unload(): Promise<void> {
    this.rememberBandwidth()
    this.source = null
    try {
      await this.player.unload()
    } catch {
      // Interrupted by a new load: nothing to clean up.
    }
  }

  private rememberBandwidth(): void {
    if (!this.source || this.source.kind === 'download') return
    try {
      saveBandwidth(this.player.getStats().estimatedBandwidth)
    } catch {
      // No stats before the first load.
    }
  }

  private activeVariant(): shaka.extern.Track | undefined {
    return this.player.getVariantTracks().find((t) => t.active)
  }

  qualities(): QualityOption[] {
    const byKey = new Map<string, QualityOption>()
    for (const track of this.player.getVariantTracks()) {
      if (!track.height || !track.videoId) continue
      const fps = Math.round(track.frameRate ?? 0)
      const hdr = !!track.hdr && track.hdr !== 'SDR'
      const key = `${track.height}|${hdr}`
      const existing = byKey.get(key)
      if (!existing || fps > existing.fps) {
        byKey.set(key, { height: track.height, fps, hdr, label: qualityLabel(track.height, fps, hdr), badge: qualityBadge(track.height) })
      }
    }
    return [...byKey.values()].sort((a, b) => b.height - a.height || Number(b.hdr) - Number(a.hdr))
  }

  /** Height / fps of what is playing now. */
  activeQuality(): { height: number; fps: number } | null {
    const track = this.activeVariant()
    if (track?.height) return { height: track.height, fps: Math.round(track.frameRate ?? 0) }
    return this.video.videoHeight ? { height: this.video.videoHeight, fps: 0 } : null
  }

  /** 0 = automatic (ABR); otherwise locks to that height (preferring the codec setting). */
  setQuality(height: number, codec: AppSettings['preferredCodec'] = 'auto'): void {
    this.manualHeight = height
    if (!height) {
      this.player.configure({ abr: { enabled: true } })
      return
    }
    const tracks = this.player.getVariantTracks().filter((t) => t.height === height)
    if (!tracks.length) return
    const active = this.activeVariant()
    const sameAudio = tracks.filter((t) => !active || t.audioId === active.audioId)
    const preferred = codecPreference(codec)
    const matches = (t: shaka.extern.Track) => preferred.some((c) => (t.videoCodec ?? '').startsWith(c))
    const pick = [...(sameAudio.length ? sameAudio : tracks)].sort((a, b) => Number(matches(b)) - Number(matches(a)) || b.bandwidth - a.bandwidth)[0]
    this.player.configure({ abr: { enabled: false } })
    this.player.selectVariantTrack(pick, true, 2)
  }

  audioTracks(): { options: AudioTrackOption[]; active: string | null } {
    const options = new Map<string, AudioTrackOption>()
    let active: string | null = null
    for (const track of this.player.getAudioTracks()) {
      const id = `${track.language}|${track.label ?? ''}`
      const isDefault = track.primary || track.roles.includes('main')
      const existing = options.get(id)
      options.set(id, {
        id,
        label: track.label || languageName(track.language),
        language: track.language && track.language !== 'und' ? track.language : null,
        isDefault: isDefault || !!existing?.isDefault,
      })
      if (track.active) active = id
    }
    return { options: [...options.values()], active }
  }

  setAudioTrack(id: string): void {
    const tracks = this.player.getAudioTracks().filter((t) => `${t.language}|${t.label ?? ''}` === id)
    if (!tracks.length) return
    const current = this.player.getAudioTracks().find((t) => t.active)
    const pick = tracks.find((t) => t.codecs === current?.codecs) ?? tracks[0]
    this.player.selectAudioTrack(pick)
  }

  isLive(): boolean {
    return this.player.isLive()
  }

  seekRange(): { start: number; end: number } {
    return this.player.seekRange()
  }

  goToLive(): void {
    this.player.goToLive()
  }

  /** Seconds buffered ahead of the playhead. */
  bufferAhead(): number {
    const time = this.video.currentTime
    const ranges = this.video.buffered
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= time + 0.5 && ranges.end(i) >= time) return Math.max(0, ranges.end(i) - time)
    }
    return 0
  }

  /** End of the buffered range containing the playhead (for the progress bar). */
  bufferedEnd(): number {
    return this.video.currentTime + this.bufferAhead()
  }

  stats(): EngineStats {
    const s = this.player.getStats()
    const track = this.activeVariant()
    const quality = this.video.getVideoPlaybackQuality?.()
    return {
      width: s.width || this.video.videoWidth,
      height: s.height || this.video.videoHeight,
      fps: track?.frameRate ?? null,
      videoCodec: track?.videoCodec ?? null,
      audioCodec: track?.audioCodec ?? null,
      streamBandwidth: s.streamBandwidth || track?.bandwidth || 0,
      estimatedBandwidth: s.estimatedBandwidth || 0,
      droppedFrames: quality?.droppedVideoFrames ?? s.droppedFrames ?? 0,
      decodedFrames: quality?.totalVideoFrames ?? s.decodedFrames ?? 0,
      bufferAhead: this.bufferAhead(),
    }
  }

  async destroy(): Promise<void> {
    await this.player.destroy().catch(() => {})
  }
}
