// The full-screen player (videos and music mode), like the Android TV player: the overlay with
// title / channel, the seek bar, ⏮ ⏯ ⏭, −10 / +10 s and the settings buttons, the "Tiếp theo" row
// on ↓, the autoplay countdown, captions, SponsorBlock, resume position, sleep timer, parental
// time limits, and the casting receiver's controls.

import type { CaptionCue, CaptionTrack, SponsorSegment, VideoItem, WatchInfo } from '@shared/models'
import { SPONSOR_CATEGORIES, feedVideos, formatTime } from '@shared/models'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type StreamInfo } from '../api'
import { branded, useBranding } from '../dearrow'
import { focusByKey, focusElement, focusFirst } from '../focus'
import { KEY, isBackKey } from '../platform'
import { useScreen, useScreenKeys } from '../screen'
import { accountStore } from '../state/account'
import { library, libraryStore } from '../state/library'
import { nav, toast } from '../state/nav'
import { parental, parentalStore } from '../state/parental'
import { CAPTION_SIZES, LANGUAGES, QUALITIES, SPEEDS, SLEEP_OPTIONS, qualityTitle, settings, sleepDurationTitle, speedTitle, updateSettings } from '../state/settings'
import { useStore } from '../store'
import { Avatar, IconButton, LazyImg, Loading } from '../ui/base'
import { VideoCard } from '../ui/cards'
import { alertDialog, choose, hasDialog, openDialog } from '../ui/dialogs'
import { Icon } from '../ui/icons'
import { LyricsPanel } from './Lyrics'
import { closePlayer, extendQueue, hasNext, hasPrevious, playIndex, playerStore, registerControls, resetPlayer, play } from './controller'
import { Playback } from './playback'
import { extendSleepTimer, setSleepTimer, sleepDue, sleepLabel, sleepStore } from './sleep'

type Status = 'loading' | 'waiting' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'
type Source = 'hls' | 'mp4' | 'audio' | 'mock'

const SEEK_STEP = 10
const HIDE_MS = 5000

function isBotCheck(message: string | null): boolean {
  return !!message && /robot|not a bot|xác nhận/i.test(message)
}

export function PlayerScreen() {
  const screen = useScreen()
  const player = useStore(playerStore)
  const video = player.video
  const videoRef = useRef<HTMLVideoElement>(null)
  const playback = useRef<Playback | null>(null)
  const [stream, setStream] = useState<StreamInfo | null>(null)
  const [watch, setWatch] = useState<WatchInfo | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [quality, setQuality] = useState(settings().defaultQuality)
  const [audioLang, setAudioLang] = useState<string | null>(settings().preferredAudioLanguage)
  const [speed, setSpeed] = useState(settings().defaultSpeed)
  const [caption, setCaption] = useState<CaptionTrack | null>(null)
  const [translate, setTranslate] = useState<string | null>(null)
  const [cues, setCues] = useState<CaptionCue[]>([])
  const [segments, setSegments] = useState<SponsorSegment[]>([])
  const [controls, setControls] = useState(true)
  const [related, setRelated] = useState(false)
  const [label, setLabel] = useState('')
  const [upNext, setUpNext] = useState<{ video: VideoItem; seconds: number } | null>(null)
  const [waitUntil, setWaitUntil] = useState(0)
  const [seekFlash, setSeekFlash] = useState(0)
  const [showLyrics, setShowLyrics] = useState(player.music)
  const sleep = useStore(sleepStore)
  const lock = useStore(parentalStore, (s) => s.lock)
  const signedIn = useStore(accountStore, (s) => s.state.signedIn)
  useStore(libraryStore, (s) => [s.liked.length, s.watchLater.length, s.subscriptions.length])

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const state = useRef({ skipped: new Set<string>(), lastRecord: 0, marked: false, startedAt: 0, session: -1, sourceTried: new Set<Source>() })
  const music = player.music

  // MARK: Loading a video

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const pb = new Playback(el, (event, detail) => onPlaybackRef.current(event, detail))
    playback.current = pb
    registerControls({
      toggle: () => pb.toggle(),
      play: () => pb.play(),
      pause: () => pb.pause(),
      seek: (s) => pb.seek(s),
      skip: (s) => pb.seek(pb.time + s),
      setVolume: (v) => (pb.volume = v),
      setMuted: (m) => (pb.muted = m),
      status: () => ({
        state: statusRef.current === 'waiting' ? 'loading' : statusRef.current,
        video: playerStore.get().video,
        position: pb.time,
        duration: pb.duration,
        volume: pb.volume,
        muted: pb.muted,
        queue: playerStore.get().queue,
        index: playerStore.get().index,
        error: errorRef.current,
      }),
    })
    return () => {
      recordProgress(true)
      registerControls(null)
      pb.destroy()
      playback.current = null
      resetPlayer()
    }
  }, [])

  const onPlaybackRef = useRef<(event: string, detail?: string) => void>(() => {})
  const statusRef = useRef<Status>('loading')
  statusRef.current = status
  const errorRef = useRef<string | null>(null)
  errorRef.current = error
  const streamRef = useRef<StreamInfo | null>(null)
  streamRef.current = stream
  const watchRef = useRef<WatchInfo | null>(null)
  watchRef.current = watch

  useEffect(() => {
    if (!video) return
    const session = player.session
    state.current = { skipped: new Set(), lastRecord: 0, marked: false, startedAt: Date.now(), session, sourceTried: new Set() }
    setStream(null)
    setWatch(null)
    setStatus('loading')
    setError(null)
    setSource(null)
    setTime(0)
    setDuration(video.durationSeconds ?? 0)
    setCues([])
    setCaption(null)
    setTranslate(null)
    setSegments([])
    setUpNext(null)
    setRelated(false)
    setShowLyrics(player.music)
    showControls(true)
    const current = () => playerStore.get().session === session
    api
      .watchInfo(video.id, player.playlistId)
      .then((info) => {
        if (!current()) return
        setWatch(info)
        // Autoplay continues with "Tiếp theo" when the queue ends.
        if (!player.music && settings().autoplayNext) extendQueue(feedVideos(info.related).slice(0, 12), true)
      })
      .catch(() => {})
    const s = settings()
    if (s.sponsorBlock && s.sponsorCategories.length && !player.music) {
      api.sponsorSegments(video.id, s.sponsorCategories).then((list) => current() && setSegments(list)).catch(() => {})
    }
    void startStream(session, quality, audioLang, null)
  }, [player.session])

  async function startStream(session: number, q: number, audio: string | null, at: number | null, fresh = false): Promise<void> {
    const v = playerStore.get().video
    if (!v) return
    let info: StreamInfo
    try {
      info = await api.stream(v.id, { quality: q, audioLanguage: audio, fresh })
    } catch (e) {
      if (playerStore.get().session !== session) return
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    if (playerStore.get().session !== session) return
    setStream(info)
    if (info.lengthSeconds) setDuration(info.lengthSeconds)
    else if (v.durationSeconds) setDuration(v.durationSeconds)
    // Server-side pre-roll wait ("Video sẽ bắt đầu sau N giây").
    const wait = info.availableAt - Date.now()
    if (wait > 1000) {
      setStatus('waiting')
      setWaitUntil(info.availableAt)
      await new Promise((r) => setTimeout(r, wait))
      if (playerStore.get().session !== session) return
    }
    const start = at ?? startPosition(v, info)
    const s = settings()
    const order: Source[] = playerStore.get().music && s.musicAudioOnly ? ['audio', 'hls', 'mp4'] : ['hls', 'mp4', 'audio']
    const chosen = order.find((src) => urlFor(info, src, q, audio) && !state.current.sourceTried.has(src))
    if (!chosen) {
      setStatus('error')
      setError('Không tìm thấy luồng phát cho video này.')
      return
    }
    loadSource(info, chosen, start, q, audio)
    if (s.captionsEnabled && info.captions.length && !playerStore.get().music) {
      const preferred = info.captions.find((c) => c.languageCode.split('-')[0] === s.captionLanguage && !c.isAutoGenerated) ??
        info.captions.find((c) => c.languageCode.split('-')[0] === s.captionLanguage) ??
        info.captions.find((c) => !c.isAutoGenerated) ??
        info.captions[0]
      void selectCaption(preferred, null)
    }
  }

  function urlFor(info: StreamInfo, src: Source, q: number, audio: string | null): string | null {
    if (src === 'hls') {
      if (!info.hlsBase) return null
      if (info.hlsBase.startsWith('mock:')) return info.hlsBase
      let url = info.hlsBase
      if (q > 0) url += `&q=${q}`
      if (audio) url += `&a=${encodeURIComponent(audio)}`
      return url
    }
    if (src === 'mp4') return info.mp4
    if (src === 'audio') return info.audio
    return null
  }

  function loadSource(info: StreamInfo, src: Source, start: number, q: number, audio: string | null): void {
    const url = urlFor(info, src, q, audio)
    const pb = playback.current
    if (!url || !pb) return
    state.current.sourceTried.add(src)
    setSource(url.startsWith('mock:') ? 'mock' : src)
    pb.load(url, start, info.lengthSeconds ?? playerStore.get().video?.durationSeconds ?? null, true)
    pb.rate = speed
  }

  function startPosition(v: VideoItem, info: StreamInfo): number {
    const explicit = playerStore.get().startAt
    if (explicit && explicit > 0) return explicit
    if (!settings().resumePlayback || info.isLive) return 0
    const p = library.progressFor(v.id)
    if (!p || p.duration <= 0) return 0
    const fraction = p.position / p.duration
    return fraction > 0.03 && fraction < 0.95 && p.position > 10 ? p.position : 0
  }

  // MARK: Playback events

  onPlaybackRef.current = onPlayback

  function onPlayback(event: string, detail?: string): void {
    const pb = playback.current
    if (!pb) return
    switch (event) {
      case 'loading':
        setStatus('loading')
        break
      case 'ready':
        if (pb.duration > 0) setDuration(pb.duration)
        break
      case 'playing':
        setStatus('playing')
        setError(null)
        scheduleHide()
        break
      case 'pause':
        if (statusRef.current !== 'ended') setStatus('paused')
        recordProgress(true)
        showControls(true)
        break
      case 'waiting':
        setStatus('buffering')
        break
      case 'time':
        onTime(pb.time, pb.duration)
        break
      case 'ended':
        setStatus('ended')
        recordProgress(true)
        onEnded()
        break
      case 'error':
        onMediaError(detail ?? '')
        break
    }
  }

  function onMediaError(detail: string): void {
    const info = streamRef.current
    const pb = playback.current
    if (!info || !pb) return
    const at = pb.time
    // HLS → muxed MP4 → audio only; finally ask the service for fresh URLs once.
    const order: Source[] = ['hls', 'mp4', 'audio']
    const next = order.find((src) => urlFor(info, src, quality, audioLang) && !state.current.sourceTried.has(src))
    if (next) {
      if (next === 'mp4') toast(`Đang dùng định dạng dự phòng${info.mp4Quality ? ` (${info.mp4Quality}p)` : ''}`)
      loadSource(info, next, at, quality, audioLang)
      return
    }
    if (!state.current.sourceTried.has('mock') && !pb.isMock) {
      state.current.sourceTried = new Set<Source>(['mock'])
      void api.log('warn', `player: every source failed (${detail}) for ${info.videoId} via ${info.client ?? '?'}`)
      setStatus('error')
      setError('Không phát được video')
      return
    }
    setStatus('error')
    setError('Không phát được video')
  }

  function onTime(t: number, d: number): void {
    setTime(t)
    if (d > 0 && Math.abs(d - duration) > 1) setDuration(d)
    // SponsorBlock: skip the segment once.
    for (const seg of segments) {
      const id = `${seg.start}-${seg.end}`
      if (t >= seg.start && t < seg.end - 0.5 && !state.current.skipped.has(id)) {
        state.current.skipped.add(id)
        playback.current?.seek(seg.end)
        const title = SPONSOR_CATEGORIES.find((c) => c.id === seg.category)?.title ?? 'Nhà tài trợ'
        toast(`Đã bỏ qua: ${title}`)
        break
      }
    }
    if (Date.now() - state.current.lastRecord > 5000) recordProgress(false)
    if (!state.current.marked && t > 30 && signedIn && !settings().incognito) {
      state.current.marked = true
      const v = playerStore.get().video
      if (v) api.markWatched(v.id, d).catch(() => {})
    }
  }

  function recordProgress(force: boolean): void {
    const pb = playback.current
    const v = playerStore.get().video
    if (!pb || !v || pb.isMock && !force && pb.time < 1) return
    const d = pb.duration || v.durationSeconds || 0
    if (pb.time < 1 && !force) return
    state.current.lastRecord = Date.now()
    if (pb.time > 0) library.recordWatch(v, Math.floor(pb.time), Math.floor(d))
  }

  function onEnded(): void {
    if (sleepStore.get().endOfVideo) {
      setSleepTimer(null)
      toast('Đã hết giờ hẹn, DVDTube đã dừng phát')
      closePlayer()
      return
    }
    const s = settings()
    if (hasNext() && (s.autoplayNext || playerStore.get().music || playerStore.get().playlistId)) {
      const next = playerStore.get().queue[playerStore.get().index + 1]
      if (playerStore.get().music) {
        playIndex(playerStore.get().index + 1)
        return
      }
      setUpNext({ video: next, seconds: 10 })
      showControls(false)
      return
    }
    showControls(true)
  }

  useEffect(() => {
    if (upNext && upNext.seconds === 10) setTimeout(() => focusByKey('up-now'), 60)
  }, [upNext])

  // Countdown of "Tiếp theo sau N giây".
  useEffect(() => {
    if (!upNext) return
    if (upNext.seconds <= 0) {
      setUpNext(null)
      playIndex(playerStore.get().index + 1)
      return
    }
    const timer = setTimeout(() => setUpNext((u) => (u ? { ...u, seconds: u.seconds - 1 } : u)), 1000)
    return () => clearTimeout(timer)
  }, [upNext])

  // Once a second: parental watch time, the sleep timer.
  useEffect(() => {
    const timer = setInterval(() => {
      const pb = playback.current
      if (!pb || pb.paused) return
      if (parental.tick()) {
        pb.pause()
      }
      if (sleepDue()) {
        pb.pause()
        toast('Đã hết giờ hẹn, DVDTube đã dừng phát')
        closePlayer()
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (lock) playback.current?.pause()
  }, [lock])

  // MARK: Controls visibility

  function scheduleHide(): void {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (playerStore.get().music) return
    hideTimer.current = setTimeout(() => {
      // Never while a dialog is open (try again later).
      if (hasDialog()) {
        scheduleHide()
        return
      }
      if (statusRef.current === 'playing') {
        setControls(false)
        setRelated(false)
      }
    }, HIDE_MS)
  }

  function showControls(focusPlay: boolean): void {
    setControls(true)
    scheduleHide()
    if (focusPlay) setTimeout(() => focusByKey('pl-play') || focusFirst(), 30)
  }

  function seekBy(delta: number): void {
    const pb = playback.current
    if (!pb || stream?.isLive && !pb.duration) return
    pb.seek(pb.time + delta)
    setSeekFlash(Date.now())
  }

  useEffect(() => {
    if (!seekFlash) return
    const timer = setTimeout(() => setSeekFlash(0), 1500)
    return () => clearTimeout(timer)
  }, [seekFlash])

  // MARK: Keys

  useScreenKeys((event) => {
    const code = event.keyCode
    const pb = playback.current
    if (lock) return false
    // Every key counts as activity: the controls stay while the user does something.
    if (controls) scheduleHide()
    if (hasDialog()) return false
    // Media keys work everywhere in the player.
    switch (code) {
      case KEY.PLAY:
        pb?.play()
        return true
      case KEY.PAUSE:
        pb?.pause()
        return true
      case KEY.PLAY_PAUSE:
      case KEY.SPACE:
        pb?.toggle()
        return true
      case KEY.STOP:
        closePlayer()
        return true
      case KEY.REWIND:
        seekBy(-SEEK_STEP)
        return true
      case KEY.FAST_FORWARD:
        seekBy(SEEK_STEP)
        return true
      case KEY.CHANNEL_UP:
        playNext()
        return true
      case KEY.CHANNEL_DOWN:
        playPrevious()
        return true
      case KEY.GREEN:
        if (video) toggleLater(video)
        return true
      case KEY.YELLOW:
        void captionsDialog()
        return true
      case KEY.BLUE:
        void qualityDialog()
        return true
      case KEY.RED:
        if (video) void toggleLike(video)
        return true
    }
    if (upNext) {
      if (isBackKey(event)) {
        setUpNext(null)
        showControls(true)
        return true
      }
      return false
    }
    if (isBackKey(event)) {
      if (related) {
        setRelated(false)
        showControls(true)
        return true
      }
      if (controls && !music && status === 'playing') {
        setControls(false)
        return true
      }
      closePlayer()
      return true
    }
    if (!controls) {
      if (code === KEY.LEFT) {
        seekBy(-SEEK_STEP)
        return true
      }
      if (code === KEY.RIGHT) {
        seekBy(SEEK_STEP)
        return true
      }
      if (code === KEY.DOWN) {
        setControls(true)
        setRelated(true)
        scheduleHide()
        setTimeout(() => focusByKey('rel-0') || focusByKey('pl-play'), 60)
        return true
      }
      if (code === KEY.ENTER || code === KEY.UP) {
        showControls(true)
        return true
      }
      return true
    }
    const active = document.activeElement as HTMLElement | null
    const inButtons = !!active?.closest('[data-player-buttons]')
    if (code === KEY.DOWN && inButtons && !related && !music) {
      setRelated(true)
      setTimeout(() => focusByKey('rel-0'), 60)
      return true
    }
    if (code === KEY.UP && active?.closest('[data-related]')) {
      setRelated(false)
      setTimeout(() => focusByKey('pl-play'), 30)
      return true
    }
    if (active?.getAttribute('data-key') === 'pl-seek') {
      if (code === KEY.LEFT) {
        seekBy(-SEEK_STEP)
        return true
      }
      if (code === KEY.RIGHT) {
        seekBy(SEEK_STEP)
        return true
      }
    }
    return false
  })

  // MARK: Actions

  function playNext(): void {
    if (hasNext()) playIndex(playerStore.get().index + 1)
    else {
      const rel = watch ? feedVideos(watch.related).filter((v) => !v.isShort) : []
      if (rel.length) play(rel[0], { queue: rel, music: playerStore.get().music })
    }
  }

  function playPrevious(): void {
    const pb = playback.current
    if (pb && pb.time > 5) {
      pb.seek(0)
      return
    }
    if (hasPrevious()) playIndex(playerStore.get().index - 1)
  }

  async function toggleLike(v: VideoItem): Promise<void> {
    const liked = library.isLiked(v.id) || watch?.likeStatus === 'LIKE'
    library.setLiked(v, !liked)
    toast(liked ? 'Đã xóa khỏi Video đã thích' : 'Đã thêm vào Video đã thích')
    if (signedIn) api.rate(v.id, liked ? 'remove' : 'like').catch(() => {})
    if (watch) setWatch({ ...watch, likeStatus: liked ? 'INDIFFERENT' : 'LIKE' })
  }

  function toggleLater(v: VideoItem): void {
    toast(library.toggleWatchLater(v) ? 'Đã lưu vào Xem sau' : 'Đã xóa khỏi Xem sau')
  }

  function toggleSubscribe(): void {
    const channel = watch?.channel
    if (!channel) return
    const subscribed = library.isSubscribed(channel.id) || watch?.isSubscribed === true
    if (subscribed) library.unsubscribe(channel.id)
    else library.subscribe(channel)
    if (signedIn) api.subscribe(channel.id, !subscribed).catch(() => {})
    setWatch(watch ? { ...watch, isSubscribed: !subscribed } : watch)
    toast(subscribed ? `Đã hủy đăng ký ${channel.name}` : `Đã đăng ký ${channel.name}`)
  }

  async function selectCaption(track: CaptionTrack | null, tl: string | null): Promise<void> {
    setCaption(track)
    setTranslate(tl)
    setCues([])
    if (!track) return
    try {
      const list = await api.captions(track, tl)
      if (playerStore.get().video?.id === stream?.videoId || !stream) setCues(list)
    } catch {
      toast('Không tải được phụ đề')
    }
  }

  async function captionsDialog(): Promise<void> {
    const tracks = stream?.captions ?? []
    if (!tracks.length) {
      toast('Video này không có phụ đề')
      return
    }
    const options = [{ label: 'Tắt', selected: !caption }, ...tracks.map((t) => ({ label: t.name, selected: caption === t && !translate }))]
    const canTranslate = tracks.some((t) => t.isTranslatable)
    if (canTranslate) options.push({ label: 'Tự động dịch', selected: !!translate })
    const chosen = await choose('Phụ đề', options.map((o) => ({ ...o, value: o.label === 'Tự động dịch' && translate ? LANGUAGES.find(([c]) => c === translate)?.[1] ?? translate : null })))
    if (chosen === null) return
    if (chosen === 0) {
      updateSettings({ captionsEnabled: false })
      return void selectCaption(null, null)
    }
    if (canTranslate && chosen === options.length - 1) {
      const lang = await choose('Tự động dịch phụ đề', LANGUAGES.map(([code, name]) => ({ label: name, selected: translate === code })))
      if (lang === null) return
      const source = (caption?.isTranslatable ? caption : null) ?? tracks.find((t) => t.isTranslatable && !t.isAutoGenerated) ?? tracks.find((t) => t.isTranslatable)
      if (source) void selectCaption(source, LANGUAGES[lang][0])
      return
    }
    const track = tracks[chosen - 1]
    updateSettings({ captionsEnabled: true, captionLanguage: track.languageCode.split('-')[0] })
    void selectCaption(track, null)
  }

  function reload(q: number, audio: string | null): void {
    const info = stream
    const pb = playback.current
    if (!info || !pb) return
    const at = pb.time
    state.current.sourceTried = new Set()
    const src: Source = source === 'audio' ? 'audio' : source === 'mp4' && !info.hlsBase ? 'mp4' : 'hls'
    loadSource(info, src, at, q, audio)
  }

  async function qualityDialog(): Promise<void> {
    if (source === 'mp4') {
      toast(`Định dạng dự phòng chỉ có ${stream?.mp4Quality ?? 360}p`)
      return
    }
    const available = stream?.qualities.length ? stream.qualities : QUALITIES.filter((q) => q.height > 0 && q.height <= 1080).map((q) => q.height)
    const list = [0, ...available]
    const chosen = await choose('Chất lượng', list.map((h) => ({ label: qualityTitle(h), selected: h === quality })))
    if (chosen === null) return
    setQuality(list[chosen])
    reload(list[chosen], audioLang)
  }

  async function speedDialog(): Promise<void> {
    const chosen = await choose('Tốc độ phát', SPEEDS.map((s) => ({ label: speedTitle(s), selected: s === speed })))
    if (chosen === null) return
    setSpeed(SPEEDS[chosen])
    if (playback.current) playback.current.rate = SPEEDS[chosen]
  }

  async function audioDialog(): Promise<void> {
    const tracks = stream?.audioTracks ?? []
    if (tracks.length < 2) return
    const chosen = await choose(
      'Bản âm thanh',
      tracks.map((t) => ({ label: t.name + (t.isDefault ? ' (gốc)' : ''), selected: audioLang ? t.id === audioLang : t.isDefault })),
    )
    if (chosen === null) return
    const lang = tracks[chosen].isDefault ? null : tracks[chosen].id
    setAudioLang(lang)
    updateSettings({ preferredAudioLanguage: lang })
    reload(quality, lang)
  }

  async function sleepDialog(): Promise<void> {
    const running = sleepLabel()
    const options: { label: string; value?: string | null; run: () => void; selected?: boolean }[] = []
    if (running) {
      options.push({ label: 'Tắt hẹn giờ', value: running, run: () => setSleepTimer(null) })
      if (!sleepStore.get().endOfVideo) options.push({ label: 'Thêm 15 phút', run: () => extendSleepTimer(15) })
    }
    for (const m of SLEEP_OPTIONS) options.push({ label: sleepDurationTitle(m), run: () => setSleepTimer(m) })
    options.push({ label: 'Khi hết video này', selected: sleepStore.get().endOfVideo, run: () => setSleepTimer(0) })
    const chosen = await choose('Hẹn giờ tắt', options.map((o) => ({ label: o.label, value: o.value, selected: o.selected })))
    if (chosen !== null) options[chosen].run()
  }

  async function infoDialog(): Promise<void> {
    const info = watch
    const numbers = [info?.viewCountText, info?.dateText, info?.likeCountText ? `${info.likeCountText} lượt thích` : null].filter(Boolean).join(' • ')
    await openDialog<boolean>(
      (close) => (
        <div class="dialog-body info-dialog">
          <div class="dialog-title">{info?.title ?? video?.title ?? 'Thông tin video'}</div>
          {numbers && <div class="dialog-message">{numbers}</div>}
          {info?.channel && (
            <div class="info-channel">
              <Avatar src={info.channel.avatar} name={info.channel.name} size={48} />
              <span>{[info.channel.name, info.channel.subscriberText].filter(Boolean).join(' • ')}</span>
            </div>
          )}
          {(info?.description ?? '').trim() ? (
            (info?.description ?? '')
              .trim()
              .split(/\n\s*\n/)
              .map((p, i) => (
                <div key={i} class="info-paragraph" data-f tabIndex={-1} data-key={`para-${i}`} data-autofocus={i === 0 ? '' : undefined} onClick={() => close(true)}>
                  {p.trim()}
                </div>
              ))
          ) : (
            <div class="dialog-message" data-f tabIndex={-1} data-autofocus>
              {info ? 'Video không có mô tả.' : 'Đang tải…'}
            </div>
          )}
        </div>
      ),
      900,
    )
  }

  // MARK: Render

  const channel = watch?.channel
  const shown = video ? branded({ ...video, title: video.title || watch?.title || '' }) : null
  const relatedVideos = watch ? feedVideos(watch.related).filter((v) => !v.isShort).slice(0, 20) : []
  const liked = video ? library.isLiked(video.id) || watch?.likeStatus === 'LIKE' : false
  const later = video ? library.isWatchLater(video.id) : false
  const subscribed = channel ? library.isSubscribed(channel.id) || watch?.isSubscribed === true : false
  const live = !!(stream?.isLive || video?.isLive)
  const progress = duration > 0 ? Math.min(1, time / duration) : 0
  const cue = cues.length ? cues.find((c) => time >= c.start && time < c.end) : null
  const captionScale = CAPTION_SIZES.find((c) => c.id === settings().captionSize)?.scale ?? 1
  void sleep

  useEffect(() => {
    if (!screen.active) return
    const timer = setTimeout(() => {
      if (!document.activeElement || !document.activeElement.closest('.player')) focusByKey('pl-play') || focusFirst()
    }, 80)
    return () => clearTimeout(timer)
  }, [screen.active, player.session])

  return (
    <div class={`player${music ? ' music' : ''}${controls ? ' controls' : ''}`} data-testid="player" data-status={status} data-source={source ?? ''}>
      <video ref={videoRef} class="player-video" preload="auto" style={music || source === 'audio' || source === 'mock' ? { visibility: 'hidden' } : undefined} />
      {(source === 'mock' || (status === 'loading' && !music)) && shown?.thumbnail && !music && <LazyImg src={shown.thumbnail} class="player-poster" eager />}
      {music && video && <MusicStage video={video} title={shown?.title ?? video.title} showLyrics={showLyrics} time={time} />}

      {cue && !music && (
        <div class={`captions${controls ? ' raised' : seekFlash ? ' flash' : ''}`} style={{ fontSize: `${Math.round(42 * captionScale)}px` }} data-testid="captions">
          {cue.text.split('\n').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      )}

      {(status === 'loading' || status === 'buffering') && <div class="player-spinner"><Loading /></div>}

      {status === 'waiting' && <WaitBanner until={waitUntil} />}

      {status === 'error' && (
        <div class="player-error" data-testid="player-error">
          <div class="player-error-title">Không phát được video</div>
          <div class="player-error-detail">{error}</div>
          <div class="message-actions">
            <button type="button" class="btn accent" data-f tabIndex={-1} data-key="pl-retry" data-autofocus onClick={() => {
              state.current.sourceTried = new Set()
              setError(null)
              void startStream(player.session, quality, audioLang, playback.current?.time ?? null, true)
            }}>
              <Icon name="refresh" size={30} />
              <span>Thử lại</span>
            </button>
            {channel && (
              <button type="button" class="btn" data-f tabIndex={-1} data-key="pl-open-channel" onClick={() => {
                closePlayer()
                nav.open({ name: 'channel', channel })
              }}>
                <span>{`Mở kênh ${channel.name}`}</span>
              </button>
            )}
          </div>
          {isBotCheck(error) && <div class="player-error-hint">Đăng nhập tài khoản YouTube (Tài khoản › Đăng nhập bằng điện thoại) để xem được video này.</div>}
        </div>
      )}

      {upNext && (
        <div class="upnext" data-testid="upnext">
          <div class="upnext-label">{`Tiếp theo sau ${upNext.seconds} giây`}</div>
          <div class="upnext-card">
            <LazyImg src={branded(upNext.video).thumbnail || `https://i.ytimg.com/vi/${upNext.video.id}/hqdefault.jpg`} eager />
            <div>
              <div class="upnext-title">{branded(upNext.video).title}</div>
              <div class="upnext-meta">{upNext.video.channelName ?? ''}</div>
            </div>
          </div>
          <div class="message-actions" data-scope>
            <button type="button" class="btn accent" data-f tabIndex={-1} data-key="up-now" data-autofocus onClick={() => {
              setUpNext(null)
              playIndex(playerStore.get().index + 1)
            }}>
              <Icon name="play" size={30} />
              <span>Phát ngay</span>
            </button>
            <button type="button" class="btn" data-f tabIndex={-1} data-key="up-cancel" onClick={() => {
              setUpNext(null)
              showControls(true)
            }}>
              <span>Hủy</span>
            </button>
          </div>
        </div>
      )}

      {seekFlash > 0 && !controls && !live && (
        <div class="seek-flash">
          <span>{`${formatTime(time)} / ${formatTime(duration)}`}</span>
          <div class="seekbar small">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}

      {player.sender && controls && <div class="cast-badge">{`Đang phát từ ${player.sender}`}</div>}

      {video && (controls || music) && !upNext && status !== 'error' && (
        <div class="overlay">
          {!music && (
            <div class="overlay-top">
              <div class="overlay-title" data-testid="player-title">{shown?.title}</div>
              <div class="overlay-channel">
                <Avatar src={channel?.avatar ?? video.channelAvatar} name={channel?.name ?? video.channelName} size={44} />
                <span>{[channel?.name ?? video.channelName, watch?.viewCountText ?? video.viewCountText, watch?.relativeDateText ?? video.publishedText].filter(Boolean).join(' • ')}</span>
              </div>
            </div>
          )}
          <div class="overlay-bottom">
            <div class="time-row">
              <span class="time">{`${formatTime(time)} / ${live ? 'TRỰC TIẾP' : formatTime(duration)}`}</span>
              {source && source !== 'hls' && source !== 'mock' && <span class="source-badge">{source === 'mp4' ? `MP4 ${stream?.mp4Quality ?? ''}p` : 'Chỉ âm thanh'}</span>}
              {sleepLabel() && <span class="source-badge">{`Hẹn giờ tắt: ${sleepLabel()}`}</span>}
            </div>
            {!live && (
              <div class="seekbar" data-f tabIndex={-1} data-key="pl-seek" data-testid="seekbar" onFocus={() => setLabel('◀ ▶ để tua')} onClick={() => playback.current?.toggle()}>
                {segments.map((s) => (
                  <b key={s.start} style={{ left: `${(s.start / Math.max(duration, 1)) * 100}%`, width: `${((s.end - s.start) / Math.max(duration, 1)) * 100}%` }} />
                ))}
                <i style={{ width: `${progress * 100}%` }} />
                <em style={{ left: `${progress * 100}%` }} />
              </div>
            )}
            <div class="focus-label">{label}</div>
            <div class="player-buttons" data-player-buttons data-group>
              <IconButton icon="previous" label="Video trước" focusKey="pl-prev" onFocusLabel={setLabel} onClick={playPrevious} />
              <IconButton icon={status === 'playing' ? 'pause' : 'play'} label={status === 'playing' ? 'Tạm dừng' : 'Phát'} focusKey="pl-play" big autofocus onFocusLabel={setLabel} onClick={() => playback.current?.toggle()} testid="play-pause" />
              <IconButton icon="next" label="Video tiếp theo" focusKey="pl-next" onFocusLabel={setLabel} onClick={playNext} />
              {!live && <IconButton icon="rewind" label="Lùi 10 giây" focusKey="pl-back10" onFocusLabel={setLabel} onClick={() => seekBy(-SEEK_STEP)} />}
              {!live && <IconButton icon="forward" label="Tới 10 giây" focusKey="pl-fwd10" onFocusLabel={setLabel} onClick={() => seekBy(SEEK_STEP)} />}
              <span class="buttons-gap" />
              {!music && (stream?.captions.length ?? 0) > 0 && (
                <IconButton icon="captions" label={`Phụ đề: ${caption ? caption.name : 'Tắt'}`} active={!!caption} focusKey="pl-cc" onFocusLabel={setLabel} onClick={() => void captionsDialog()} />
              )}
              {!music && <IconButton icon="quality" label={`Chất lượng: ${source === 'mp4' ? `${stream?.mp4Quality ?? 360}p` : qualityTitle(quality)}`} focusKey="pl-quality" onFocusLabel={setLabel} onClick={() => void qualityDialog()} />}
              {!live && <IconButton icon="speed" label={`Tốc độ: ${speedTitle(speed)}`} focusKey="pl-speed" onFocusLabel={setLabel} onClick={() => void speedDialog()} />}
              {(stream?.audioTracks.length ?? 0) > 1 && <IconButton icon="audio" label="Bản âm thanh" focusKey="pl-audio" onFocusLabel={setLabel} onClick={() => void audioDialog()} />}
              <IconButton icon="sleep" label={`Hẹn giờ tắt: ${sleepLabel() ?? 'Tắt'}`} active={!!sleepLabel()} focusKey="pl-sleep" onFocusLabel={setLabel} onClick={() => void sleepDialog()} />
              <IconButton icon="like" label={watch?.likeCountText ? `Thích (${watch.likeCountText})` : 'Thích'} active={liked} focusKey="pl-like" onFocusLabel={setLabel} onClick={() => void toggleLike(video)} />
              <IconButton icon="later" label={later ? 'Đã lưu vào Xem sau' : 'Xem sau'} active={later} focusKey="pl-later" onFocusLabel={setLabel} onClick={() => toggleLater(video)} />
              {channel && (
                <IconButton icon="subscribe" label={subscribed ? `Đã đăng ký ${channel.name}` : `Đăng ký ${channel.name}`} active={subscribed} focusKey="pl-sub" onFocusLabel={setLabel} onClick={toggleSubscribe} />
              )}
              {channel && (
                <IconButton
                  icon="account"
                  label={`Mở kênh ${channel.name}`}
                  focusKey="pl-channel"
                  testid="open-channel"
                  onFocusLabel={setLabel}
                  onClick={() => {
                    closePlayer()
                    nav.open({ name: 'channel', channel })
                  }}
                />
              )}
              {!live && (
                <IconButton
                  icon="lyrics"
                  label="Lời bài hát"
                  active={music && showLyrics}
                  focusKey="pl-lyrics"
                  onFocusLabel={setLabel}
                  onClick={() => (music ? setShowLyrics(!showLyrics) : void lyricsDialog(video))}
                />
              )}
              {music && <IconButton icon="radio" label="Radio từ bài này" focusKey="pl-radio" onFocusLabel={setLabel} onClick={() => void startRadio(video)} />}
              {!music && <IconButton icon="info" label="Thông tin video" focusKey="pl-info" onFocusLabel={setLabel} onClick={() => void infoDialog()} />}
            </div>
            {!music &&
              (related ? (
                <div class="related" data-related>
                  <div class="related-title">Tiếp theo</div>
                  {relatedVideos.length === 0 ? (
                    <div class="related-empty">Đang tải…</div>
                  ) : (
                    <div class="shelf-track" data-scroll="x" data-group>
                      <div class="shelf-inner">
                        {relatedVideos.map((v, i) => (
                          <VideoCard key={v.id} video={v} small focusKey={`rel-${i}`} onClick={() => play(v, { queue: relatedVideos })} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div class="related-hint">▼  Tiếp theo</div>
              ))}
          </div>
        </div>
      )}

      {lock && <div class="player-locked" />}
    </div>
  )
}

function WaitBanner({ until }: { until: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000))
  return <div class="wait-banner">{`Video sẽ bắt đầu sau ${seconds} giây`}</div>
}

function MusicStage({ video, title, showLyrics, time }: { video: VideoItem; title: string; showLyrics: boolean; time: number }) {
  const art = useBranding(video).thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
  return (
    <div class="music-stage" data-testid="now-playing">
      <div class="music-backdrop" style={{ backgroundImage: `url("${art}")` }} />
      <div class="music-main">
        <LazyImg src={art} class="music-art" eager />
        <div class="music-info">
          <div class="music-kicker">Đang phát</div>
          <div class="music-title">{title}</div>
          <div class="music-artist">{video.channelName ?? ''}</div>
        </div>
      </div>
      {showLyrics && (
        <div class="music-lyrics">
          <LyricsPanel videoId={video.id} time={time} />
        </div>
      )}
    </div>
  )
}

async function lyricsDialog(video: VideoItem): Promise<void> {
  await openDialog<boolean>(
    () => (
      <div class="dialog-body lyrics-dialog">
        <div class="dialog-title">{`Lời bài hát — ${video.title}`}</div>
        <LyricsPanel videoId={video.id} time={-1} focusable />
      </div>
    ),
    900,
  )
}

async function startRadio(video: VideoItem): Promise<void> {
  try {
    const videos = await api.playlistVideos(`RDAMVM${video.id}`, 50)
    const queue = videos.filter((v) => v.id !== video.id)
    if (!queue.length) {
      toast('Không tạo được radio cho bài này')
      return
    }
    extendQueue(queue)
    toast('Đã thêm radio từ bài này vào hàng đợi')
  } catch (error) {
    void alertDialog('Không tạo được radio', error instanceof Error ? error.message : String(error))
  }
}

export { focusElement }
