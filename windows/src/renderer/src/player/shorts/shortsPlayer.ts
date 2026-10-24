// The Shorts feed's own player: a second <video> + shaka instance (the main player keeps its
// state and is paused meanwhile). Player responses are cached and the next Short is
// preloaded so swiping starts instantly.

import type { PlayerInfo, VideoItem } from '@shared/models'
import { api, errorMessage, isElectron } from '@/lib/api'
import { settings, useSettings } from '@/state/settings'
import { applyAudioProcessing } from '../engine/audio'
import { PlaybackEngine, describeError, isInterruption, type PlaybackSource } from '../engine/engine'
import { downloadSource, planSources } from '../engine/sources'
import { noteMockVideo } from '../mock'
import type { shaka } from '../engine/shaka'

let element: HTMLVideoElement | null = null
let engine: PlaybackEngine | null = null
let token = 0
let currentId: string | null = null
const infos = new Map<string, Promise<PlayerInfo>>()
let preloaded: { id: string; source: PlaybackSource; manager: Promise<shaka.media.PreloadManager | null> } | null = null

export function shortsVideo(): HTMLVideoElement {
  if (!element) {
    element = document.createElement('video')
    element.className = 'dp-shorts-video'
    element.crossOrigin = 'anonymous'
    element.playsInline = true
    element.loop = true
    element.preload = 'auto'
    element.dataset.testid = 'shorts-video'
    applyVolume()
    useSettings.subscribe((s, p) => {
      if (s.settings.volume !== p.settings.volume || s.settings.muted !== p.settings.muted) applyVolume()
      if (s.settings.equalizer !== p.settings.equalizer) applyAudio()
    })
  }
  return element
}

function shortsEngine(): PlaybackEngine {
  engine ??= new PlaybackEngine(shortsVideo())
  return engine
}

function applyVolume(): void {
  if (!element) return
  const s = settings()
  element.volume = s.volume
  element.muted = s.muted
}

function applyAudio(): void {
  if (!element) return
  const s = settings()
  applyAudioProcessing(element, { equalizer: s.equalizer, stableVolume: false, loudnessDb: null })
}

function info(video: VideoItem): Promise<PlayerInfo> {
  let promise = infos.get(video.id)
  if (!promise) {
    if (!isElectron) noteMockVideo({ ...video, isShort: true })
    promise = api.player(video.id)
    promise.catch(() => infos.delete(video.id))
    infos.set(video.id, promise)
    if (infos.size > 30) infos.delete(infos.keys().next().value!)
  }
  return promise
}

function prefs() {
  const s = settings()
  return { maxHeight: s.defaultQuality ? Math.min(s.defaultQuality, 1080) : 1080, codec: s.preferredCodec, audioLanguage: s.preferredAudioLanguage }
}

export interface ShortsLoadResult {
  ok: boolean
  error?: string
}

/** Loads and plays a Short; resolves when it plays (or failed). */
export async function playShort(video: VideoItem): Promise<ShortsLoadResult> {
  const my = ++token
  currentId = video.id
  const e = shortsEngine()
  const v = shortsVideo()
  e.configure(prefs())
  applyVolume()
  applyAudio()
  try {
    const fileUrl = await api.downloadFileUrl(video.id).catch(() => null)
    let sources: PlaybackSource[]
    if (fileUrl) sources = [downloadSource(fileUrl)]
    else {
      const playerInfo = await info(video)
      if (my !== token) return { ok: false }
      sources = planSources(playerInfo, { audioOnly: false })
    }
    if (!sources.length) return { ok: false, error: 'Không tìm thấy luồng phát cho Short này' }
    let lastError = 'Không phát được video'
    for (let i = 0; i < sources.length; i++) {
      try {
        const ready = preloaded && preloaded.id === video.id && i === 0 ? await preloaded.manager : null
        if (my !== token) return { ok: false }
        if (ready && preloaded) await e.loadPreloaded(preloaded.source, ready)
        else await e.load(sources[i], null)
        preloaded = null
        if (my !== token) return { ok: false }
        v.loop = true
        await v.play().catch(() => {})
        return { ok: true }
      } catch (error) {
        preloaded = null
        if (my !== token || isInterruption(error)) return { ok: false }
        lastError = describeError(error).detail
      }
    }
    return { ok: false, error: lastError }
  } catch (error) {
    return my === token ? { ok: false, error: errorMessage(error) } : { ok: false }
  }
}

/** Fetches the next Short's streams and starts buffering it. */
export function preloadShort(video: VideoItem | undefined): void {
  if (!video || preloaded?.id === video.id || video.id === currentId) return
  const my = token
  void info(video)
    .then((playerInfo) => {
      if (my !== token || preloaded?.id === video.id) return
      const source = planSources(playerInfo, { audioOnly: false })[0]
      if (!source || source.kind === 'progressive') return
      const old = preloaded
      preloaded = { id: video.id, source, manager: shortsEngine().preload(source) }
      void old?.manager.then((m) => m?.destroy()).catch(() => {})
    })
    .catch(() => {})
}

/** Prefetches only the player response (cheap) for the Shorts after the next one. */
export function prefetchShortInfo(video: VideoItem | undefined): void {
  if (video) void info(video).catch(() => {})
}

export function pauseShorts(): void {
  element?.pause()
}

export async function stopShorts(): Promise<void> {
  token++
  currentId = null
  element?.pause()
  const old = preloaded
  preloaded = null
  void old?.manager.then((m) => m?.destroy()).catch(() => {})
  await engine?.unload()
}
