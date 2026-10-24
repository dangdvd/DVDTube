// System integration of the main player: Media Session (Windows media keys and the volume
// flyout), taskbar thumbnail buttons, keeping the PC awake while playing, and pausing when
// the window is hidden (unless background playback is on).

import { displayThumbnail, type VideoItem } from '@shared/models'
import { api, onEvent } from '@/lib/api'
import { usePlayer } from '@/state/player'
import { settings } from '@/state/settings'
import { nextVideo } from './controller'

let lastThumbar = ''
let preventingSleep = false
let lastPosition = 0

function setMetadata(video: VideoItem | null): void {
  if (!('mediaSession' in navigator)) return
  if (!video) {
    navigator.mediaSession.metadata = null
    return
  }
  const artwork = displayThumbnail(video)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: video.title || 'DVDTube',
    artist: video.channelName ?? '',
    album: 'DVDTube',
    artwork: [{ src: artwork, sizes: '480x360', type: artwork.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/jpeg' }],
  })
}

function setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // Action not supported by this Chromium.
  }
}

function updateThumbar(): void {
  const s = usePlayer.getState()
  const state = {
    playing: s.playing,
    hasPrevious: !!s.current && (s.queueIndex > 0 || s.currentTime > 5),
    hasNext: !!s.current && !!nextVideo(),
  }
  const title = s.current?.title || null
  const key = JSON.stringify([state, title])
  if (key === lastThumbar) return
  lastThumbar = key
  api.setThumbar(state, title).catch(() => {})
}

function updatePreventSleep(): void {
  const s = usePlayer.getState()
  const want = s.playing && !s.audioOnly && !!s.current
  if (want === preventingSleep) return
  preventingSleep = want
  api.setPreventSleep(want).catch(() => {})
}

function updatePosition(): void {
  const s = usePlayer.getState()
  if (!('mediaSession' in navigator) || !s.current || s.live) return
  if (!(s.duration > 0) || Math.abs(s.currentTime - lastPosition) < 1) return
  lastPosition = s.currentTime
  try {
    navigator.mediaSession.setPositionState({
      duration: s.duration,
      position: Math.min(Math.max(0, s.currentTime), s.duration),
      playbackRate: s.boosted ? 2 : s.rate,
    })
  } catch {
    // Invalid state while the duration changes.
  }
}

function pauseWhenHidden(): void {
  const s = usePlayer.getState()
  if (s.playing && !settings().backgroundPlayback && !s.pip) s.pause()
}

let started = false

export function startPlayerSession(): void {
  if (started) return
  started = true
  const player = () => usePlayer.getState()

  if ('mediaSession' in navigator) {
    setHandler('play', () => player().resume())
    setHandler('pause', () => player().pause())
    setHandler('previoustrack', () => player().previous())
    setHandler('nexttrack', () => player().next())
    setHandler('seekbackward', (details) => player().seekBy(-(details.seekOffset || settings().seekStep)))
    setHandler('seekforward', (details) => player().seekBy(details.seekOffset || settings().seekStep))
    setHandler('seekto', (details) => {
      if (details.seekTime != null) player().seek(details.seekTime)
    })
    setHandler('stop', () => player().close())
  }

  usePlayer.subscribe((s, previous) => {
    if (s.current !== previous.current) {
      setMetadata(s.current)
      lastPosition = -1
    }
    if (s.playing !== previous.playing && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = s.current ? (s.playing ? 'playing' : 'paused') : 'none'
    }
    updateThumbar()
    updatePreventSleep()
    updatePosition()
  })

  onEvent('mediaCommand', (command) => {
    const p = player()
    if (!p.current) return
    switch (command) {
      case 'play':
        return p.resume()
      case 'pause':
        return p.pause()
      case 'playPause':
        return p.togglePlay()
      case 'next':
        return p.next()
      case 'previous':
        return p.previous()
      case 'stop':
        return p.pause()
    }
  })
  onEvent('visibility', (visible) => {
    if (!visible) pauseWhenHidden()
  })
  onEvent('windowMode', (mode) => usePlayer.setState({ windowMini: mode === 'mini' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseWhenHidden()
  })
}
