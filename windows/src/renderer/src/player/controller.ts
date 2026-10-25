// Drives the main player: queue, loading with source fallback (native → YouTube's embed in the
// web player), history, captions, SponsorBlock, sleep timer, autoplay countdown, audio
// processing, music mode (audio only, next song prefetched and started without a countdown),
// alarms' fade-in, and casting (while connected to a DVDTube receiver everything played is sent
// there and the controls drive it). The UI talks to it only through `usePlayer`
// (state/player.ts); Media Session / taskbar wiring lives in session.ts.

import type { CaptionTrack, PlayerInfo, SponsorSegment, VideoItem, WatchInfo } from '@shared/models'
import { SPONSOR_CATEGORIES, feedVideos, formatDuration, isMix } from '@shared/models'
import { api, errorMessage, isElectron } from '@/lib/api'
import { noteRendererLine } from '@/lib/rendererLog'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { castTarget, useCast } from '@/state/cast'
import { useLibrary } from '@/state/library'
import { INITIAL_PLAYBACK, registerPlayerDriver, usePlayer, type PlayOptions, type PlayerDriver, type PlayerMode, type PlayerStore } from '@/state/player'
import { settings, useSettings } from '@/state/settings'
import { applyAudioProcessing, resumeAudio } from './engine/audio'
import { PlaybackEngine, describeError, isInterruption, type EngineError, type EnginePrefs, type PlaybackSource } from './engine/engine'
import { shakaSupported } from './engine/shaka'
import { downloadSource, planSources } from './engine/sources'
import { noteMockVideo } from './mock'
import { getStage } from './stage'
import { createWebPlayback, webLayer, type WebPlayback, type WebPlayerState } from './web/webPlayer'

const get = () => usePlayer.getState()
const set = (patch: Partial<PlayerStore>) => usePlayer.setState(patch)

let engineInstance: PlaybackEngine | null = null

function video(): HTMLVideoElement {
  return getStage().video
}

function engine(): PlaybackEngine {
  if (!engineInstance) {
    engineInstance = new PlaybackEngine(video())
    engineInstance.onError = (error) => {
      if (error.severity === 2 && !loadingSource) void handleFailure(token, error)
    }
    engineInstance.onTracksChanged = refreshTracks
    engineInstance.onBuffering = (buffering) => {
      const s = get()
      if (buffering && !video().paused && s.status !== 'loading') set({ status: 'buffering' })
      if (!buffering && s.status === 'buffering') set({ status: video().paused ? 'paused' : 'playing' })
    }
    wireVideo(video())
  }
  return engineInstance
}

// MARK: Per-video state

/** Bumped by every start / close; async work for an older video checks it and stops. */
let token = 0
let sources: PlaybackSource[] = []
let sourceIndex = 0
let loadingSource = false
let refreshedUrls = false
let playedSeconds = 0
let markedWatched = false
let lastSaved = 0
let upNextTimer: ReturnType<typeof setTimeout> | null = null
let fade = 1
/** Alarms: the volume rises from 0 until this moment. */
let fadeInStart = 0
let fadeInMs = 0
/** "Trình phát web" is playing the current video. */
let webActive = false
let webPlayer: WebPlayback | null = null
let webEnded = false
/** Music mode: the next song's streams, fetched ahead. */
let prefetched: { videoId: string; info: PlayerInfo; source: PlaybackSource; manager: Awaited<ReturnType<PlaybackEngine['preload']>> } | null = null
let prefetching: string | null = null
/** "Chỉ âm thanh" as it was before music mode turned it on. */
let audioOnlyBeforeMusic: boolean | null = null
/** Audio language picked in the player this session; later videos use it too. */
let sessionAudioLanguage: string | null = null
const skippedSegments = new Set<number>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function prefs(): EnginePrefs {
  const s = settings()
  const def = s.defaultQuality || 0
  const mini = get().mode === 'mini' ? s.miniPlayerQuality || 0 : 0
  const maxHeight = mini ? (def ? Math.min(def, mini) : mini) : def
  return { maxHeight, codec: s.preferredCodec, audioLanguage: sessionAudioLanguage ?? s.preferredAudioLanguage }
}

/** Where to resume this video (only between 10 s and the last 15 s). */
function resumePosition(videoId: string): number | null {
  if (!settings().resumePlayback) return null
  const progress = useLibrary.getState().progress[videoId]
  if (!progress) return null
  const { position, duration } = progress
  return position > 10 && (!duration || position < duration - 15) ? position : null
}

function applyVolume(): void {
  const s = settings()
  const v = video()
  v.volume = Math.min(1, Math.max(0, s.volume * fade))
  v.muted = s.muted
  if (webActive) {
    web().command('setVolume', [Math.round(Math.min(1, Math.max(0, s.volume * fade)) * 100)])
    web().command(s.muted ? 'mute' : 'unMute')
  }
}

/** Where playback is (the <video>, or the embed while the web player is used). */
function position(): number {
  return webActive ? get().currentTime : video().currentTime
}

function note(message: string): void {
  noteRendererLine('error', message)
}

// MARK: Web player (YouTube's embed, when every native source failed)

function web(): WebPlayback {
  if (!webPlayer) {
    webPlayer = createWebPlayback()
    webPlayer.onState = onWebState
    webPlayer.onReady = () => {
      if (!webActive) return
      applyVolume()
      const rate = get().boosted ? 2 : get().rate
      if (rate !== 1) web().command('setPlaybackRate', [rate])
    }
    webPlayer.onError = (message) => {
      if (!webActive) return
      note(`web player: ${message} (${get().current?.id ?? ''})`)
      set({ status: 'error', error: message, errorDetail: 'Trình phát web (YouTube nhúng)', playing: false })
    }
  }
  return webPlayer
}

function onWebState(state: WebPlayerState): void {
  if (!webActive || state.ad) {
    if (state.ad && get().status !== 'loading') set({ status: 'loading' })
    return
  }
  const status = state.s === 1 ? 'playing' : state.s === 2 ? 'paused' : state.s === 3 ? 'buffering' : state.s === 0 ? 'ended' : get().status
  const patch: Partial<PlayerStore> = { playing: state.s === 1 || state.s === 3 }
  if (status !== get().status) patch.status = status
  if (Number.isFinite(state.t) && Math.abs(state.t - get().currentTime) >= 0.2) patch.currentTime = state.t
  if (state.d > 0 && !get().live && Math.abs(state.d - get().duration) > 0.5) patch.duration = state.d
  set(patch)
  if (state.s === 0 && !webEnded) {
    webEnded = true
    if (get().loop) {
      webEnded = false
      web().command('seekTo', [0, true])
      web().command('playVideo')
    } else handleEnded()
  } else if (state.s !== 0) webEnded = false
}

/** Native playback is impossible here (bot check, 403, no streams) — not for offline / gone videos. */
function webFallbackAllowed(message: string | null | undefined): boolean {
  if (!settings().webPlayerFallback) return false
  // In the mock (no Electron) only when asked for (`localStorage.mockWebPlayer = '1'`).
  if (!isElectron) {
    try {
      if (localStorage.getItem('mockWebPlayer') !== '1') return false
    } catch {
      return false
    }
  }
  const text = message ?? ''
  return !/Kiểm tra mạng|Không có kết nối mạng|phản hồi quá chậm|Không kết nối được|Hết thời gian chờ|riêng tư|private|đã bị xóa|removed|không tồn tại|does not exist/i.test(text)
}

async function startWeb(my: number, startAt: number | null, reason: string): Promise<void> {
  const item = get().current
  if (!item || my !== token) return
  console.warn(`switching to the web player: ${reason}`)
  note(`player: native playback failed (${reason}); using the web player for ${item.id}`)
  if (engineInstance?.source) await engineInstance.unload()
  if (my !== token) return
  webActive = true
  webEnded = false
  set({ source: 'web', status: 'loading', error: null, errorDetail: null, pictureless: false, qualities: [], audioTracks: [], waitSeconds: 0, fallbackReason: reason })
  try {
    await web().load(item.id, startAt ?? 0, get().loop)
  } catch (error) {
    if (my === token) fail(errorMessage(error), 'Trình phát web (YouTube nhúng)')
  }
}

function stopWeb(): void {
  if (!webActive) return
  webActive = false
  webPlayer?.unload()
}

// MARK: Casting (the connected DVDTube receiver plays instead)

function remote(): boolean {
  return !!castTarget()
}

function applyAudio(): void {
  const s = settings()
  const info = get().info
  applyAudioProcessing(video(), {
    equalizer: s.equalizer,
    stableVolume: s.stableVolume,
    loudnessDb: info && info.videoId === get().current?.id ? (info.loudnessDb ?? null) : null,
  })
}

function refreshTracks(): void {
  const e = engineInstance
  if (!e?.source) return
  const adaptive = e.source.kind !== 'progressive' && e.source.kind !== 'download'
  const active = e.activeQuality()
  const audio = adaptive ? e.audioTracks() : { options: [], active: null }
  set({
    qualities: adaptive && !e.source.audioOnly ? e.qualities() : [],
    activeHeight: active?.height ?? null,
    activeFps: active?.fps ?? 0,
    audioTracks: audio.options.length > 1 ? audio.options : [],
    audioTrack: audio.active,
  })
}

// MARK: Loading

async function start(item: VideoItem, startAt: number | null): Promise<void> {
  saveProgress()
  const my = ++token
  cancelUpNext()
  if (!isElectron) noteMockVideo(item)
  sources = []
  sourceIndex = 0
  refreshedUrls = false
  playedSeconds = 0
  markedWatched = false
  skippedSegments.clear()
  fade = fadeInMs > 0 && Date.now() - fadeInStart < fadeInMs ? 0 : 1
  stopWeb()
  const v = video()
  const e = engine()
  v.loop = false
  // Stop the previous video right away (no stale frame or sound while the next one loads).
  if (e.source) void e.unload()
  set({
    ...INITIAL_PLAYBACK,
    current: item,
    status: 'loading',
    currentTime: startAt ?? 0,
    duration: item.isLive ? 0 : (item.durationSeconds ?? 0),
    live: !!item.isLive,
    rate: get().rate,
    restored: false,
  })
  // Connected to a DVDTube receiver: it plays the video, this computer is the remote.
  if (remote()) {
    const s = get()
    set({ status: 'paused', playing: false })
    void loadWatch(item.id, s.playlistId, my)
    void useCast.getState().send(item, { startSeconds: startAt, queue: s.queue, index: s.queueIndex, playlistId: s.playlistId })
    return
  }
  applyVolume()
  void loadWatch(item.id, get().playlistId, my)
  try {
    const fileUrl = await api.downloadFileUrl(item.id).catch(() => null)
    if (my !== token) return
    if (fileUrl) {
      sources = [downloadSource(fileUrl)]
      void loadInfo(item, my).catch(() => {})
      await loadSource(my, 0, startAt)
      return
    }
    if (!shakaSupported()) throw new Error('Trình phát video không được hỗ trợ trên máy này')
    const ready = prefetched?.videoId === item.id && !get().audioOnly === !prefetched.source.audioOnly ? prefetched : null
    prefetched = null
    const info = ready ? ready.info : await loadInfo(item, my)
    if (ready) applyInfo(item, ready.info, my)
    if (my !== token) return
    await waitUntilAvailable(info, my)
    if (my !== token) return
    sources = planSources(info, { audioOnly: get().audioOnly })
    if (!sources.length) throw new Error('Không tìm thấy luồng phát nào cho video này')
    if (ready?.manager && sources[0]?.uri === ready.source.uri) await loadSource(my, 0, startAt, ready.manager)
    else await loadSource(my, 0, startAt)
  } catch (error) {
    if (my !== token) return
    const message = errorMessage(error)
    if (webFallbackAllowed(message)) return startWeb(my, startAt, message)
    note(`player: ${item.id} failed before playback: ${message}`)
    fail(message, null)
  }
}

async function loadInfo(item: VideoItem, my: number): Promise<PlayerInfo> {
  const info = await api.player(item.id)
  applyInfo(item, info, my)
  return info
}

function applyInfo(item: VideoItem, info: PlayerInfo, my: number): void {
  if (my !== token) return
  set({
    info,
    live: info.isLive,
    captionTracks: info.captions,
    duration: info.isLive ? 0 : get().duration || info.lengthSeconds || 0,
  })
  enrichFromPlayer(info)
  applyAudio()
  autoSelectCaptions(info.captions)
  if (settings().sponsorBlock && !info.isLive) void loadSponsorSegments(item.id, my)
}

async function loadSponsorSegments(videoId: string, my: number): Promise<void> {
  try {
    const segments = await api.sponsorSegments(videoId, settings().sponsorCategories)
    if (my === token) set({ sponsorSegments: segments.filter((s) => s.end > s.start) })
  } catch {
    // SponsorBlock is optional: no segments.
  }
}

/** Server-side waiting time instead of ads ("Đang chuẩn bị video…"). */
async function waitUntilAvailable(info: PlayerInfo, my: number): Promise<void> {
  let remaining = info.availableAt - Date.now()
  while (remaining > 300 && my === token) {
    set({ waitSeconds: Math.ceil(remaining / 1000) })
    await sleep(Math.min(remaining, 1000))
    remaining = info.availableAt - Date.now()
  }
  if (my === token) set({ waitSeconds: 0 })
}

async function loadSource(my: number, index: number, startAt: number | null, preloaded?: Awaited<ReturnType<PlaybackEngine['preload']>>): Promise<void> {
  const source = sources[index]
  if (!source) return
  sourceIndex = index
  const e = engine()
  e.configure(prefs())
  set({ source: source.kind, pictureless: !!source.audioOnly, status: 'loading', error: null, errorDetail: null, quality: 0 })
  loadingSource = true
  try {
    if (preloaded) {
      await e.loadPreloaded(source, preloaded)
      if (startAt != null && startAt > 0) video().currentTime = startAt
    } else {
      await e.load(source, startAt)
    }
  } catch (error) {
    loadingSource = false
    if (my !== token || isInterruption(error)) return
    await handleFailure(my, describeError(error), startAt)
    return
  }
  loadingSource = false
  if (my !== token) return
  if (source.kind === 'hls' && get().audioOnly) e.limitHeight(144)
  const v = video()
  v.playbackRate = get().boosted ? 2 : get().rate
  v.loop = get().loop
  applyVolume()
  applyAudio()
  refreshTracks()
  try {
    await v.play()
  } catch (error) {
    if (my !== token) return
    if ((error as DOMException)?.name !== 'AbortError') set({ status: 'paused', playing: false })
  }
  if (get().musicMode) void prefetchNext(my)
}

/** Music mode: fetches the next song's streams now so it starts without a gap. */
async function prefetchNext(my: number): Promise<void> {
  const s = get()
  extendRadio()
  const next = s.queue[s.queueIndex + 1] ?? (s.loopQueue && s.queue.length > 1 ? s.queue[0] : null)
  if (!next || next.isLive || prefetched?.videoId === next.id || prefetching === next.id) return
  prefetching = next.id
  try {
    const downloaded = await api.downloadFileUrl(next.id).catch(() => null)
    if (downloaded || my !== token) return
    const info = await api.player(next.id)
    if (my !== token || info.availableAt > Date.now() + 1000) return
    const source = planSources(info, { audioOnly: get().audioOnly })[0]
    if (!source) return
    const manager = await engine().preload(source)
    if (my !== token) {
      void manager?.destroy()
      return
    }
    prefetched = { videoId: next.id, info, source, manager }
  } catch {
    // The next song simply loads normally.
  } finally {
    prefetching = null
  }
}

let extendingRadio = false

/** "Radio từ bài này" (RDAMVM… mixes) is endless: more songs are appended near the end. */
function extendRadio(): void {
  const s = get()
  if (!s.musicMode || !s.playlistId || !isMix(s.playlistId) || extendingRadio) return
  if (s.queueIndex < s.queue.length - 3) return
  const last = s.queue[s.queue.length - 1]
  if (!last) return
  extendingRadio = true
  const playlistId = s.playlistId
  api
    .watchInfo(last.id, playlistId)
    .then((watch) => {
      const now = get()
      if (now.playlistId !== playlistId || !watch.playlist) return
      const known = new Set(now.queue.map((v) => v.id))
      const extra = watch.playlist.videos.filter((v) => !known.has(v.id) && !v.isLive)
      if (extra.length) set({ queue: [...now.queue, ...extra] })
    })
    .catch(() => {})
    .finally(() => {
      extendingRadio = false
    })
}

async function handleFailure(my: number, error: EngineError, resumeAt?: number | null): Promise<void> {
  if (my !== token) return
  const current = get().current
  if (!current) return
  const v = video()
  const at = resumeAt ?? (v.currentTime > 0 ? v.currentTime : get().currentTime || null)
  const source = sources[sourceIndex]

  // The download is gone (deleted / moved): stream it instead.
  if (source?.kind === 'download') {
    try {
      const info = get().info?.videoId === current.id ? get().info! : await loadInfo(current, my)
      if (my !== token) return
      sources = planSources(info, { audioOnly: get().audioOnly })
      if (sources.length) return loadSource(my, 0, at)
    } catch (failure) {
      return fail(errorMessage(failure), null)
    }
  }

  // Stream URLs expire after some hours (403 / 410): fetch fresh ones once, same method.
  if (source && (error.httpStatus === 403 || error.httpStatus === 410) && !refreshedUrls) {
    refreshedUrls = true
    try {
      const info = await api.player(current.id)
      if (my !== token) return
      set({ info })
      sources = planSources(info, { audioOnly: get().audioOnly })
      const same = sources.findIndex((s) => s.kind === source.kind)
      return loadSource(my, same >= 0 ? same : 0, at)
    } catch {
      // Fall through to the next method.
    }
  }

  if (sourceIndex + 1 < sources.length) {
    console.warn(`playback via ${source?.kind} failed (${error.detail}); trying ${sources[sourceIndex + 1].kind}`)
    note(`player: ${current.id} via ${source?.kind} failed (${error.detail}, client ${get().info?.client ?? '?'}); trying ${sources[sourceIndex + 1].kind}`)
    return loadSource(my, sourceIndex + 1, at)
  }
  note(`player: ${current.id} failed on every source (${error.detail}, client ${get().info?.client ?? '?'}, last ${source?.kind})`)
  if (source?.kind !== 'download' && webFallbackAllowed(error.detail)) return startWeb(my, at, error.detail)
  fail(error.message, error.detail)
}

function fail(message: string, detail: string | null): void {
  set({ status: 'error', error: message || 'Không phát được video', errorDetail: detail, playing: false })
  note(`player error: ${message}${detail ? ` — ${detail}` : ''} (source ${get().source ?? '-'}, client ${get().info?.client ?? '-'})`)
}

async function loadWatch(videoId: string, playlistId: string | null, my: number): Promise<void> {
  try {
    const watch = await api.watchInfo(videoId, playlistId)
    if (my !== token) return
    set({ watch, watchError: null })
    enrichFromWatch(watch)
    applyPlaylist(watch)
  } catch (error) {
    if (my === token) set({ watchError: errorMessage(error) })
  }
}

/** A playlist (or mix) opened with the video becomes the queue. */
function applyPlaylist(watch: WatchInfo): void {
  const playlist = watch.playlist
  const s = get()
  if (!playlist || !playlist.videos.length || playlist.id !== s.playlistId) return
  const index = playlist.videos.findIndex((v) => v.id === s.current?.id)
  if (index < 0) return
  const videos = playlist.videos.map((v, i) => (i === index && s.current ? { ...v, ...s.current, title: s.current.title || v.title } : v))
  set({ queue: videos, queueIndex: index })
}

function replaceCurrent(updated: VideoItem): void {
  const s = get()
  const queue = s.queue.map((v, i) => (i === s.queueIndex && v.id === updated.id ? updated : v))
  set({ current: updated, queue })
}

function enrichFromPlayer(info: PlayerInfo): void {
  const item = get().current
  if (!item || item.id !== info.videoId) return
  const updated: VideoItem = { ...item }
  if (!updated.title) updated.title = info.title
  if (!updated.channelName && info.author) updated.channelName = info.author
  if (!updated.channelId && info.channelId) updated.channelId = info.channelId
  if (!updated.thumbnail && info.thumbnail) updated.thumbnail = info.thumbnail
  if (updated.durationSeconds == null && info.lengthSeconds && !info.isLive) {
    updated.durationSeconds = info.lengthSeconds
    updated.durationText = formatDuration(info.lengthSeconds)
  }
  if (info.isLive) updated.isLive = true
  if (JSON.stringify(updated) !== JSON.stringify(item)) replaceCurrent(updated)
}

function enrichFromWatch(watch: WatchInfo): void {
  const item = get().current
  if (!item || item.id !== watch.videoId) return
  const updated: VideoItem = { ...item }
  if (!updated.title && watch.title) updated.title = watch.title
  if (watch.channel) {
    updated.channelName ??= watch.channel.name
    updated.channelId ??= watch.channel.id
    updated.channelAvatar ??= watch.channel.avatar
  }
  if (!updated.viewCountText && watch.shortViewCountText) updated.viewCountText = watch.shortViewCountText
  if (!updated.publishedText && watch.relativeDateText) updated.publishedText = watch.relativeDateText
  if (JSON.stringify(updated) !== JSON.stringify(item)) replaceCurrent(updated)
}

// MARK: Video element events

function wireVideo(v: HTMLVideoElement): void {
  v.addEventListener('play', () => {
    resumeAudio()
    set({ playing: true })
  })
  v.addEventListener('playing', () => set({ status: 'playing', playing: true }))
  v.addEventListener('pause', () => {
    const s = get()
    if (v.ended || s.status === 'loading' || s.status === 'error') {
      set({ playing: false })
      return
    }
    set({ status: 'paused', playing: false })
    saveProgress()
  })
  v.addEventListener('waiting', () => {
    if (!v.paused && get().status !== 'loading') set({ status: 'buffering' })
  })
  v.addEventListener('timeupdate', () => {
    const t = v.currentTime
    if (Math.abs(t - get().currentTime) >= 0.2) set({ currentTime: t })
  })
  v.addEventListener('seeked', () => set({ currentTime: v.currentTime }))
  v.addEventListener('durationchange', () => {
    if (!get().live && Number.isFinite(v.duration) && v.duration > 0) set({ duration: v.duration })
  })
  v.addEventListener('loadedmetadata', refreshTracks)
  v.addEventListener('resize', refreshTracks)
  v.addEventListener('ended', handleEnded)
  v.addEventListener('enterpictureinpicture', () => set({ pip: true }))
  v.addEventListener('leavepictureinpicture', () => set({ pip: false }))
  document.addEventListener('fullscreenchange', () =>
    set({ fullscreen: !!document.fullscreenElement && (document.fullscreenElement === getStage().root || document.fullscreenElement === webLayer()) }),
  )
}

function handleEnded(): void {
  saveProgress(true)
  const s = get()
  if (s.sleepAtEnd) {
    set({ sleepAtEnd: false, status: 'ended', playing: false })
    fade = 1
    applyVolume()
    toast('Đã hết giờ hẹn – tạm dừng phát')
    return
  }
  set({ status: 'ended', playing: false })
  const queued = s.queueIndex + 1 < s.queue.length || (s.loopQueue && s.queue.length > 1)
  // Music: the next song follows right away (it was fetched ahead).
  if (s.musicMode) {
    if (queued) goNext()
    return
  }
  const next = queued ? s.queue[(s.queueIndex + 1) % s.queue.length] : relatedCandidate(true)
  if (next) startUpNext(next)
}

/** The first related video worth playing next (not watched recently, not live, not a Short). */
function relatedCandidate(respectAutoplay: boolean): VideoItem | null {
  if (respectAutoplay && !settings().autoplayNext) return null
  const s = get()
  if (!s.watch || s.watch.videoId !== s.current?.id) return null
  const library = useLibrary.getState()
  const related = feedVideos(s.watch.related).filter((v) => !library.isHidden(v))
  const recent = new Set([...library.history.slice(0, 50).map((h) => h.video.id), ...s.queue.map((v) => v.id)])
  return related.find((v) => !recent.has(v.id) && !v.isLive && !v.isShort) ?? related.find((v) => !v.isShort) ?? null
}

let nextCache: { key: unknown[]; value: VideoItem | null } | null = null

/** What ⏭ plays: the next queue item, else the first related video (cached: the UI asks often). */
export function nextVideo(): VideoItem | null {
  const s = get()
  const key = [s.current, s.queue, s.queueIndex, s.loopQueue, s.watch, useLibrary.getState().history]
  if (nextCache && nextCache.key.every((k, i) => k === key[i])) return nextCache.value
  let value: VideoItem | null
  if (s.queueIndex + 1 < s.queue.length) value = s.queue[s.queueIndex + 1]
  else if (s.loopQueue && s.queue.length > 1) value = s.queue[0]
  else value = relatedCandidate(false)
  nextCache = { key, value }
  return value
}

function startUpNext(next: VideoItem): void {
  if (upNextTimer) clearTimeout(upNextTimer)
  set({ upNext: next, upNextEndsAt: Date.now() + 5000 })
  upNextTimer = setTimeout(() => playUpNextNow(), 5000)
}

function cancelUpNext(): void {
  if (upNextTimer) clearTimeout(upNextTimer)
  upNextTimer = null
  if (get().upNext) set({ upNext: null, upNextEndsAt: null })
}

function playUpNextNow(): void {
  const next = get().upNext
  cancelUpNext()
  if (next) goNext()
}

function goNext(): void {
  const s = get()
  if (s.queueIndex + 1 < s.queue.length) return playQueueItem(s.queueIndex + 1)
  if (s.loopQueue && s.queue.length > 1) return playQueueItem(0)
  const next = relatedCandidate(false)
  if (!next) return
  set({ queue: [...s.queue, next], queueIndex: s.queue.length, playlistId: s.playlistId })
  void start(next, resumePosition(next.id))
}

function playQueueItem(index: number): void {
  const s = get()
  const item = s.queue[index]
  if (!item) return
  set({ queueIndex: index })
  void start(item, resumePosition(item.id))
}

// MARK: History

function saveProgress(completed = false): void {
  const s = get()
  const item = s.current
  if (!item || s.live) return
  if (s.restored || remote()) return
  const v = video()
  const duration = s.duration || (!webActive && Number.isFinite(v.duration) ? v.duration : 0)
  const at = completed ? duration : position()
  if (!completed && (!(at > 0) || s.status === 'loading' || s.status === 'error')) return
  lastSaved = Date.now()
  useLibrary.getState().recordWatch(item, at, duration)
}

function markWatched(): void {
  markedWatched = true
  const item = get().current
  if (!item || !useAccount.getState().signedIn || settings().incognito) return
  api.markWatched(item.id, get().duration).catch(() => {})
}

// MARK: Ticker (4×/s): buffer, live window, history, SponsorBlock, sleep timer

let lastTick = performance.now()

function tick(): void {
  const now = performance.now()
  const dt = (now - lastTick) / 1000
  lastTick = now
  const s = get()
  const e = engineInstance
  if (s.current && webActive) {
    if (s.playing) {
      playedSeconds += Math.min(dt, 1) * (s.boosted ? 2 : s.rate)
      if (playedSeconds >= 30 && !markedWatched) markWatched()
      if (Date.now() - lastSaved > 5000) saveProgress()
    }
    sponsorTick(s.currentTime)
    sleepTick(null)
    return
  }
  if (!s.current || !e?.source) return
  const v = video()
  const buffered = e.bufferedEnd()
  if (Math.abs(buffered - s.buffered) > 0.5) set({ buffered })
  if (s.live) {
    const range = e.seekRange()
    if (Number.isFinite(range.end) && (Math.abs(range.end - s.duration) > 1 || Math.abs(range.start - s.seekStart) > 1)) {
      set({ duration: range.end, seekStart: range.start })
    }
  }
  if (!v.paused && !v.ended) {
    playedSeconds += Math.min(dt, 1) * v.playbackRate
    if (playedSeconds >= 30 && !markedWatched) markWatched()
    if (Date.now() - lastSaved > 5000) saveProgress()
  }
  sponsorTick(v.currentTime)
  sleepTick(v)
}

function sponsorTick(time: number): void {
  const s = get()
  const cfg = settings()
  const segment =
    cfg.sponsorBlock && s.sponsorSegments.length
      ? s.sponsorSegments.find((x) => cfg.sponsorCategories.includes(x.category) && time >= x.start && time < x.end - 0.5)
      : undefined
  if (!segment || skippedSegments.has(segment.start)) {
    if (s.sponsorPrompt) set({ sponsorPrompt: null })
    return
  }
  if (cfg.sponsorMode === 'skip') {
    skippedSegments.add(segment.start)
    seek(segment.end)
    toast(`Đã bỏ qua: ${sponsorTitle(segment)}`, { action: { label: 'Hoàn tác', run: () => seek(segment.start) } })
  } else if (s.sponsorPrompt !== segment) {
    set({ sponsorPrompt: segment })
  }
}

export function sponsorTitle(segment: SponsorSegment): string {
  return SPONSOR_CATEGORIES.find((c) => c.id === segment.category)?.title ?? segment.category
}

function sleepTick(v: HTMLVideoElement | null): void {
  const s = get()
  let target = 1
  if (s.sleepEndsAt) {
    const remaining = s.sleepEndsAt - Date.now()
    if (remaining <= 0) {
      set({ sleepEndsAt: null })
      fade = 1
      pause()
      applyVolume()
      toast('Đã hết giờ hẹn — đã dừng phát')
      return
    }
    // The sound fades out over the last 10 seconds.
    if (remaining < 10_000) target = remaining / 10_000
  } else if (s.sleepAtEnd && s.duration > 0) {
    const left = s.duration - (v ? v.currentTime : s.currentTime)
    if (left < 10) target = Math.max(0, left / 10)
  }
  // Alarms: fade in.
  if (fadeInMs > 0) {
    const elapsed = Date.now() - fadeInStart
    if (elapsed >= fadeInMs) fadeInMs = 0
    else if (s.playing) target = Math.min(target, elapsed / fadeInMs)
    else target = Math.min(target, fade)
  }
  if (Math.abs(target - fade) > 0.01 || (target === 1 && fade !== 1)) {
    fade = target
    applyVolume()
  }
}

// MARK: Actions

function play(item: VideoItem, options: PlayOptions = {}): void {
  const s = get()
  applyMusicMode(!!options.music)
  if (options.fadeIn && options.fadeIn > 0) {
    fadeInStart = Date.now()
    fadeInMs = options.fadeIn * 1000
    fade = 0
    applyVolume()
  }
  const loaded = !!engineInstance?.source || webActive || remote()
  // Same video already loaded (e.g. expanding the mini player): keep it going.
  if (s.current?.id === item.id && s.status !== 'error' && !options.queue?.length && loaded && !s.restored) {
    if (options.startAt != null) seek(options.startAt)
    if (options.playlistId && options.playlistId !== s.playlistId) {
      set({ playlistId: options.playlistId })
      void loadWatch(item.id, options.playlistId, token)
    }
    return
  }
  let queue = s.queue
  let index = s.queueIndex
  let playlistId: string | null = options.playlistId ?? null
  if (options.queue?.length) {
    queue = options.queue
    index = Math.min(Math.max(0, options.index ?? queue.findIndex((v) => v.id === item.id)), queue.length - 1)
  } else {
    const at = s.queue.findIndex((v) => v.id === item.id)
    if (at >= 0 && (!options.playlistId || options.playlistId === s.playlistId)) {
      index = at
      playlistId = s.playlistId
    } else if (!options.playlistId && !s.playlistId && s.current && s.queue.length > 1) {
      // A queue the user built stays: the video is inserted after the current one.
      queue = [...s.queue.slice(0, s.queueIndex + 1), item, ...s.queue.slice(s.queueIndex + 1)]
      index = s.queueIndex + 1
    } else {
      queue = [item]
      index = 0
    }
  }
  set({ queue, queueIndex: index, playlistId, shuffled: options.queue?.length ? false : s.shuffled })
  void start(item, options.startAt ?? resumePosition(item.id))
}

/** Music mode turns "Chỉ âm thanh" on (setting); leaving it restores the previous choice. */
function applyMusicMode(music: boolean): void {
  const s = get()
  if (music === s.musicMode) return
  if (music) {
    audioOnlyBeforeMusic = s.audioOnly
    set({ musicMode: true, audioOnly: settings().musicAudioOnly ? true : s.audioOnly })
  } else {
    set({ musicMode: false, audioOnly: audioOnlyBeforeMusic ?? false })
    audioOnlyBeforeMusic = null
    prefetched = null
  }
}

function addToQueue(item: VideoItem): void {
  const s = get()
  if (!s.current) return play(item)
  const queue = s.queue.filter((v, i) => v.id !== item.id || i === s.queueIndex)
  set({ queue: [...queue, item], queueIndex: queue.findIndex((v) => v.id === s.current?.id) })
}

function playNext(item: VideoItem): void {
  const s = get()
  if (!s.current) return play(item)
  if (item.id === s.current.id) return
  const rest = s.queue.filter((v) => v.id !== item.id)
  const index = Math.max(0, rest.findIndex((v) => v.id === s.current?.id))
  rest.splice(index + 1, 0, item)
  set({ queue: rest, queueIndex: index })
}

function setMode(mode: PlayerMode): void {
  if (get().mode === mode) return
  set({ mode })
  const e = engineInstance
  if (e?.source && !e.manualHeight && !(get().audioOnly && e.source.kind === 'hls')) e.limitHeight(prefs().maxHeight)
}

function close(): void {
  saveProgress()
  token++
  cancelUpNext()
  stopWeb()
  prefetched = null
  if (remote()) useCast.getState().control('stop')
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {})
  sources = []
  fade = 1
  void engineInstance?.unload()
  set({ ...INITIAL_PLAYBACK, current: null, queue: [], queueIndex: 0, playlistId: null, mode: 'hidden', sleepEndsAt: null, sleepAtEnd: false, stats: false, chaptersOpen: false, restored: false, musicMode: false })
}

function pause(): void {
  if (remote()) return useCast.getState().control('pause')
  if (webActive) return web().command('pauseVideo')
  video().pause()
}

function resume(): void {
  const s = get()
  if (!s.current) return
  if (remote()) return useCast.getState().control('play')
  if (webActive && s.status !== 'error') {
    if (s.status === 'ended') return replay()
    web().command('playVideo')
    return
  }
  if (s.status === 'error' || !engineInstance?.source || webActive) {
    void start(s.current, s.currentTime > 0 ? s.currentTime : null)
    return
  }
  if (s.status === 'ended') return replay()
  cancelUpNext()
  resumeAudio()
  video()
    .play()
    .catch(() => {})
}

function togglePlay(): void {
  const s = get()
  if (remote()) return useCast.getState().control('toggle')
  if (s.status === 'ended') return replay()
  const paused = webActive ? !s.playing : video().paused
  if (paused || s.status === 'error') resume()
  else pause()
}

function replay(): void {
  cancelUpNext()
  seek(get().live ? get().seekStart : 0)
  if (webActive) {
    web().command('playVideo')
    return
  }
  video()
    .play()
    .catch(() => {})
}

function seek(seconds: number): void {
  const s = get()
  const v = video()
  if (remote()) {
    useCast.getState().control('seek', Math.max(0, seconds))
    return
  }
  if (webActive) {
    const target = Math.max(0, s.duration > 0 ? Math.min(seconds, s.duration - 0.5) : seconds)
    if (s.upNext) cancelUpNext()
    web().command('seekTo', [target, true])
    set({ currentTime: target, ...(s.status === 'ended' ? { status: 'paused' as const } : {}) })
    return
  }
  if (!engineInstance?.source) {
    set({ currentTime: Math.max(0, seconds) })
    return
  }
  let target = Math.max(s.live ? s.seekStart : 0, seconds)
  const duration = s.live ? s.duration : s.duration || v.duration
  if (Number.isFinite(duration) && duration > 0) target = Math.min(target, s.live ? duration : duration - 0.1)
  if (s.upNext && target < duration - 1) cancelUpNext()
  v.currentTime = target
  set({ currentTime: target, ...(s.status === 'ended' && target < duration - 0.5 ? { status: 'paused' as const } : {}) })
}

function seekBy(delta: number): void {
  if (remote()) {
    useCast.getState().control('skip', delta)
    return
  }
  seek(position() + delta)
}

function frameStep(direction: 1 | -1): void {
  if (webActive || remote()) return
  const v = video()
  if (!v.paused) v.pause()
  const fps = get().activeFps || 30
  seek(v.currentTime + direction / fps)
}

function next(): void {
  cancelUpNext()
  if (remote()) return useCast.getState().control('next')
  goNext()
}

function previous(): void {
  const s = get()
  if (remote()) return useCast.getState().control('previous')
  if (position() > 5 || s.queueIndex === 0) seek(0)
  else playQueueItem(s.queueIndex - 1)
}

function removeFromQueue(index: number): void {
  const s = get()
  if (index === s.queueIndex || index < 0 || index >= s.queue.length) return
  const queue = s.queue.filter((_, i) => i !== index)
  set({ queue, queueIndex: index < s.queueIndex ? s.queueIndex - 1 : s.queueIndex })
}

function shuffleQueue(): void {
  const s = get()
  if (s.queue.length < 2 || !s.current) return
  const others = s.queue.filter((_, i) => i !== s.queueIndex)
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[others[i], others[j]] = [others[j], others[i]]
  }
  set({ queue: [s.queue[s.queueIndex], ...others], queueIndex: 0, shuffled: true })
  toast('Đã trộn danh sách phát')
}

function setLoopQueue(on: boolean): void {
  set({ loopQueue: on })
  toast(on ? 'Đã bật lặp lại danh sách phát' : 'Đã tắt lặp lại danh sách phát')
}

function setLoop(on: boolean): void {
  set({ loop: on })
  if (!webActive) video().loop = on
  toast(on ? 'Đã bật phát lặp lại' : 'Đã tắt phát lặp lại')
}

function setRate(rate: number): void {
  const value = Math.min(4, Math.max(0.25, Math.round(rate * 100) / 100))
  set({ rate: value })
  if (get().boosted) return
  if (webActive) web().command('setPlaybackRate', [value])
  else video().playbackRate = value
}

function setBoost(on: boolean): void {
  const s = get()
  if (on === s.boosted) return
  if (on && ((webActive ? !s.playing : video().paused) || s.live || remote())) return
  set({ boosted: on })
  if (webActive) web().command('setPlaybackRate', [on ? 2 : s.rate])
  else video().playbackRate = on ? 2 : s.rate
}

function setQuality(height: number): void {
  const e = engineInstance
  if (!e?.source) return
  e.setQuality(height, settings().preferredCodec)
  set({ quality: height })
  if (!height && !(get().audioOnly && e.source.kind === 'hls')) e.limitHeight(prefs().maxHeight)
}

function setAudioTrack(id: string): void {
  const e = engineInstance
  if (!e?.source) return
  e.setAudioTrack(id)
  const option = get().audioTracks.find((t) => t.id === id)
  sessionAudioLanguage = option?.language ?? sessionAudioLanguage
  set({ audioTrack: id })
  if (option) toast(`Bản âm thanh: ${option.label}`)
}

function setCaption(track: CaptionTrack | null, translateTo: string | null = null, remember = true): void {
  const my = token
  set({ captionTrack: track, captionTranslate: track ? translateTo : null, captionCues: [] })
  if (remember) {
    useSettings.getState().update(
      track ? { captionsEnabled: true, captionLanguage: track.languageCode, captionTranslateTo: translateTo } : { captionsEnabled: false },
    )
  }
  if (!track) return
  api
    .captions(track, translateTo)
    .then((cues) => {
      if (my !== token || get().captionTrack !== track) return
      set({ captionCues: cues })
      if (!cues.length) toast('Không tải được phụ đề')
    })
    .catch(() => {
      if (my === token) toast('Không tải được phụ đề')
    })
}

/** The track to show by default: preferred language, else a translation into it. */
function preferredCaption(tracks: CaptionTrack[]): { track: CaptionTrack; translateTo: string | null } | null {
  if (!tracks.length) return null
  const s = settings()
  const language = s.captionLanguage
  if (language) {
    const exact =
      tracks.find((t) => t.languageCode === language && !t.isAutoGenerated) ??
      tracks.find((t) => t.languageCode.split('-')[0] === language.split('-')[0])
    if (exact) return { track: exact, translateTo: null }
  }
  const translateTo = s.captionTranslateTo ?? language
  if (translateTo) {
    const source = tracks.find((t) => t.isTranslatable && !t.isAutoGenerated) ?? tracks.find((t) => t.isTranslatable)
    if (source) return { track: source, translateTo }
  }
  return { track: tracks.find((t) => !t.isAutoGenerated) ?? tracks[0], translateTo: null }
}

function autoSelectCaptions(tracks: CaptionTrack[]): void {
  if (!settings().captionsEnabled) return
  const choice = preferredCaption(tracks)
  if (choice) setCaption(choice.track, choice.translateTo, false)
}

function toggleCaptions(): void {
  const s = get()
  if (s.captionTrack) return setCaption(null)
  const choice = preferredCaption(s.captionTracks)
  if (!choice) {
    toast('Video này không có phụ đề')
    return
  }
  setCaption(choice.track, choice.translateTo)
}

function setVolume(volume: number): void {
  const value = Math.min(1, Math.max(0, volume))
  if (remote()) return useCast.getState().control('volume', value)
  useSettings.getState().update({ volume: value, muted: value === 0 })
}

function toggleMute(): void {
  if (remote()) {
    const status = useCast.getState().status
    return useCast.getState().control('mute', status?.muted ? 0 : 1)
  }
  const s = settings()
  if (s.muted && s.volume === 0) useSettings.getState().update({ muted: false, volume: 0.5 })
  else useSettings.getState().update({ muted: !s.muted })
}

function setAudioOnly(on: boolean): void {
  const s = get()
  if (on === s.audioOnly) return
  if (webActive) {
    toast('Trình phát web không hỗ trợ chỉ phát âm thanh')
    return
  }
  set({ audioOnly: on })
  toast(on ? 'Chỉ phát âm thanh — không tải hình, tiết kiệm dữ liệu' : 'Đã bật lại hình')
  const e = engineInstance
  const info = s.info
  if (!s.current || !e?.source || e.source.kind === 'download' || !info || info.videoId !== s.current.id) return
  // HLS has no audio-only variant: the smallest picture keeps the data use low.
  if (e.source.kind === 'hls') {
    e.limitHeight(on ? 144 : prefs().maxHeight)
    return
  }
  const my = token
  const at = video().currentTime
  const wasPaused = video().paused
  sources = planSources(info, { audioOnly: on })
  void loadSource(my, 0, at).then(() => {
    if (wasPaused && my === token) video().pause()
  })
}

function setSleepTimer(minutes: number | null): void {
  fade = 1
  applyVolume()
  if (minutes == null) {
    set({ sleepEndsAt: null, sleepAtEnd: false })
    toast('Đã tắt hẹn giờ')
  } else if (minutes === 0) {
    set({ sleepEndsAt: null, sleepAtEnd: true })
    toast('Sẽ dừng khi hết video này')
  } else {
    set({ sleepEndsAt: Date.now() + minutes * 60_000, sleepAtEnd: false })
    toast(minutes >= 60 && minutes % 60 === 0 ? `Video sẽ dừng sau ${minutes / 60} giờ` : `Video sẽ dừng sau ${minutes} phút`)
  }
}

function retry(): void {
  const s = get()
  if (!s.current) return
  if (webActive) {
    const my = token
    void web()
      .load(s.current.id, s.currentTime, s.loop)
      .then(() => my === token && set({ status: 'loading', error: null, errorDetail: null }))
    return
  }
  void start(s.current, s.currentTime > 0 ? s.currentTime : null)
}

function toggleFullscreen(): void {
  const root = webActive ? webLayer() : getStage().root
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  else void root.requestFullscreen().catch(() => toast('Không mở được chế độ toàn màn hình'))
}

function togglePip(): void {
  const v = video()
  if (document.pictureInPictureElement) {
    void document.exitPictureInPicture().catch(() => {})
    return
  }
  // Without a native Picture-in-Picture window, the app window itself becomes the small
  // always-on-top player.
  const fallback = () => api.setWindowMode('mini').catch(() => toast('Không mở được chế độ hình trong hình'))
  if (!document.pictureInPictureEnabled || get().audioOnly || get().pictureless || webActive) {
    void fallback()
    return
  }
  v.requestPictureInPicture().catch(() => void fallback())
}

function skipSponsor(): void {
  const segment = get().sponsorPrompt
  if (!segment) return
  skippedSegments.add(segment.start)
  set({ sponsorPrompt: null })
  seek(segment.end)
}

function goLive(): void {
  engineInstance?.goToLive()
}

/** Diagnostics for "Thống kê chuyên sâu". */
export function engineStats() {
  return engineInstance?.source ? engineInstance.stats() : null
}

export function mainVideo(): HTMLVideoElement {
  return video()
}

const driver: PlayerDriver = {
  play,
  addToQueue,
  playNext,
  setMode,
  close,
  togglePlay,
  pause,
  resume,
  replay,
  seek,
  seekBy,
  frameStep,
  next,
  previous,
  playQueueItem,
  removeFromQueue,
  shuffleQueue,
  setLoopQueue,
  setLoop,
  setRate,
  setBoost,
  setQuality,
  setAudioTrack,
  setCaption: (track, translateTo) => setCaption(track, translateTo ?? null),
  toggleCaptions,
  setVolume,
  toggleMute,
  setAudioOnly,
  setSleepTimer,
  cancelUpNext,
  playUpNextNow,
  retry,
  toggleFullscreen,
  togglePip,
  skipSponsor,
  goLive,
}

let started = false

/** Registers the controller (idempotent); called when the player module is imported. */
export function startPlayerController(): void {
  if (started) return
  started = true
  registerPlayerDriver(driver)
  usePlayer.setState({ rate: settings().defaultSpeed || 1 })
  setInterval(tick, 250)
  window.addEventListener('beforeunload', () => saveProgress())
  useSettings.subscribe((state, previous) => {
    const s = state.settings
    const p = previous.settings
    if (s.volume !== p.volume || s.muted !== p.muted) applyVolume()
    if (s.equalizer !== p.equalizer || s.stableVolume !== p.stableVolume) applyAudio()
    if (s.defaultSpeed !== p.defaultSpeed) setRate(s.defaultSpeed)
    if ((s.defaultQuality !== p.defaultQuality || s.miniPlayerQuality !== p.miniPlayerQuality || s.preferredCodec !== p.preferredCodec) && engineInstance?.source) {
      engineInstance.configure(prefs())
    }
  })
}
