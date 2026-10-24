// Playback state shared by the whole UI. OWNED BY THE PLAYER MODULE (src/player/**): it may add
// fields and actions, but must keep everything below working because the pages use it.
//
// The watch page (route /watch) calls `play()`; leaving the watch page while something plays
// switches `mode` to 'mini' (floating mini player); `close()` stops everything.

import { create } from 'zustand'
import type { VideoItem } from '@shared/models'

export type PlayerMode = 'page' | 'mini' | 'hidden'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

export interface PlayOptions {
  queue?: VideoItem[]
  index?: number
  playlistId?: string | null
  startAt?: number | null
}

export interface PlayerStore {
  current: VideoItem | null
  queue: VideoItem[]
  queueIndex: number
  playlistId: string | null
  mode: PlayerMode
  playing: boolean
  status: PlaybackStatus
  /** User-facing message when status is 'error'. */
  error: string | null
  currentTime: number
  duration: number

  play(video: VideoItem, options?: PlayOptions): void
  /** Appends to the queue (starts playing when nothing plays). */
  addToQueue(video: VideoItem): void
  /** Inserts right after the current video. */
  playNext(video: VideoItem): void
  setMode(mode: PlayerMode): void
  close(): void
}

export const usePlayer = create<PlayerStore>((set, get) => ({
  current: null,
  queue: [],
  queueIndex: 0,
  playlistId: null,
  mode: 'hidden',
  playing: false,
  status: 'idle',
  error: null,
  currentTime: 0,
  duration: 0,

  play(video, options) {
    const queue = options?.queue?.length ? options.queue : [video]
    const index = options?.index ?? Math.max(0, queue.findIndex((v) => v.id === video.id))
    set({ current: video, queue, queueIndex: index, playlistId: options?.playlistId ?? null, mode: 'page' })
  },
  addToQueue(video) {
    if (!get().current) return get().play(video)
    set({ queue: [...get().queue, video] })
  },
  playNext(video) {
    if (!get().current) return get().play(video)
    const queue = [...get().queue]
    queue.splice(get().queueIndex + 1, 0, video)
    set({ queue })
  },
  setMode(mode) {
    set({ mode })
  },
  close() {
    set({ current: null, queue: [], queueIndex: 0, playlistId: null, mode: 'hidden', playing: false, status: 'idle', error: null, currentTime: 0, duration: 0 })
  },
}))
