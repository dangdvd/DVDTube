// "Nhớ hàng đợi": the current video, position, queue, index and playlist id are saved
// (debounced, on every change and when the app quits) and restored PAUSED into the mini player
// at the next launch ("Tiếp tục phát…") — nothing plays by itself.

import type { VideoItem } from '@shared/models'
import { usePlayer } from '@/state/player'
import { settings } from '@/state/settings'
import { onEvent } from './api'
import { flushSaves, load, saveSoon } from './persist'

interface SavedSession {
  video: VideoItem
  position: number
  duration: number
  queue: VideoItem[]
  index: number
  playlistId: string | null
  musicMode?: boolean
  savedAt: number
}

const NAME = 'player-session'

function snapshot(): SavedSession | null {
  const s = usePlayer.getState()
  if (!s.current || s.current.isLive) return null
  const queue = s.queue.length ? s.queue : [s.current]
  // Keep the queue reasonable around the current item.
  const start = Math.max(0, s.queueIndex - 100)
  return {
    video: s.current,
    position: s.status === 'ended' ? 0 : Math.max(0, s.currentTime || 0),
    duration: s.duration || 0,
    queue: queue.slice(start, start + 300),
    index: Math.min(s.queueIndex - start, Math.max(0, queue.length - 1)),
    playlistId: s.playlistId,
    musicMode: s.musicMode,
    savedAt: Date.now(),
  }
}

export async function restorePlayerSession(): Promise<void> {
  const saved = await load<SavedSession | { cleared: true }>(NAME)
  if (!saved || 'cleared' in saved || !saved.video?.id) return
  if (usePlayer.getState().current) return
  const queue = Array.isArray(saved.queue) && saved.queue.length ? saved.queue : [saved.video]
  usePlayer.setState({
    current: saved.video,
    queue,
    queueIndex: Math.min(Math.max(0, saved.index ?? 0), queue.length - 1),
    playlistId: saved.playlistId ?? null,
    currentTime: saved.position ?? 0,
    duration: saved.duration ?? saved.video.durationSeconds ?? 0,
    status: 'paused',
    playing: false,
    restored: true,
    // Music mode comes back too (audio only per its setting); the controller restores the
    // previous "Chỉ âm thanh" when something else is played.
    ...(saved.musicMode ? { musicMode: true, audioOnly: settings().musicAudioOnly } : {}),
  })
}

let started = false

export function startPlayerSessionSaving(): void {
  if (started) return
  started = true
  let lastPosition = 0
  usePlayer.subscribe((s, prev) => {
    if (s.restored) return
    const structural = s.current !== prev.current || s.queue !== prev.queue || s.queueIndex !== prev.queueIndex || s.playlistId !== prev.playlistId
    const moved = Math.abs(s.currentTime - lastPosition) >= 5
    if (!structural && !moved && s.status === prev.status) return
    lastPosition = s.currentTime
    const data = snapshot()
    saveSoon(NAME, data ?? { cleared: true }, structural ? 800 : 2000)
  })
  onEvent('beforeQuit', () => {
    const s = usePlayer.getState()
    if (!s.restored) saveSoon(NAME, snapshot() ?? { cleared: true }, 0)
    flushSaves()
  })
}
