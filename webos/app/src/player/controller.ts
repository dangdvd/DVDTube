// What is playing (independent of the player screen): the video, its queue, music mode, where
// to start, and the controls the player screen registers (used by casting senders and the
// remote's media keys).

import type { CastQueueEdit, CastStatus, VideoItem } from '@shared/models'
import { applyQueueEdit } from '@shared/models'
import { nav, toast } from '../state/nav'
import { evaluate, hidesShorts } from '../state/parental'
import { createStore } from '../store'

export interface PlayerState {
  video: VideoItem | null
  queue: VideoItem[]
  index: number
  playlistId: string | null
  /** "Nghe nhạc": artwork + lyrics, audio only by default. */
  music: boolean
  startAt: number | null
  /** "Đang phát từ <sender>" (cast). */
  sender: string | null
  /** Bumped by every play() (the screen reloads on change). */
  session: number
  /** Videos autoplay added from "Tiếp theo": what phones queue goes before them. */
  autoIds: string[]
}

export const playerStore = createStore<PlayerState>({
  video: null,
  queue: [],
  index: 0,
  playlistId: null,
  music: false,
  startAt: null,
  sender: null,
  session: 0,
  autoIds: [],
})

export interface PlayOptions {
  queue?: VideoItem[] | null
  startAt?: number | null
  music?: boolean
  playlistId?: string | null
  sender?: string | null
}

export function play(video: VideoItem, options: PlayOptions = {}): void {
  if (video.isShort && !options.music) {
    if (hidesShorts()) {
      toast('Shorts đã bị tắt trong Kiểm soát của phụ huynh')
      return
    }
    const shorts = (options.queue ?? []).filter((v) => v.isShort)
    nav.openShorts(shorts.length ? shorts : [video], video)
    return
  }
  if (evaluate()) {
    toast('Đã hết thời gian xem hôm nay')
    return
  }
  let queue = (options.queue ?? []).filter((v) => !v.isShort || options.music)
  let index = queue.findIndex((v) => v.id === video.id)
  if (index < 0) {
    queue = [video]
    index = 0
  }
  playerStore.set({
    video,
    queue,
    index,
    playlistId: options.playlistId ?? null,
    music: !!options.music,
    startAt: options.startAt ?? null,
    sender: options.sender ?? null,
    session: playerStore.get().session + 1,
    autoIds: [],
  })
  if (nav.top()?.name !== 'player') nav.open({ name: 'player' })
}

export function hasNext(): boolean {
  const s = playerStore.get()
  return s.index < s.queue.length - 1
}

export function hasPrevious(): boolean {
  return playerStore.get().index > 0
}

export function playIndex(index: number): boolean {
  const s = playerStore.get()
  const video = s.queue[index]
  if (!video) return false
  playerStore.set({ video, index, startAt: null, session: s.session + 1 })
  return true
}

export function playNextInQueue(): boolean {
  return playIndex(playerStore.get().index + 1)
}

export function playPreviousInQueue(): boolean {
  return playIndex(playerStore.get().index - 1)
}

/**
 * "Thêm vào hàng đợi" (cast `/api/queue`): next = play right after the current one, else after
 * what was queued before but ahead of the videos autoplay added.
 */
export function enqueue(video: VideoItem, next: boolean): void {
  const s = playerStore.get()
  if (!s.video) {
    play(video)
    return
  }
  const queue = s.queue.filter((v) => v.id !== video.id)
  const index = queue.findIndex((v) => v.id === s.video?.id)
  const autoIds = s.autoIds.filter((id) => id !== video.id)
  const firstAuto = queue.findIndex((v, i) => i > index && autoIds.includes(v.id))
  queue.splice(next ? index + 1 : firstAuto >= 0 ? firstAuto : queue.length, 0, video)
  playerStore.set({ queue, index: Math.max(0, queue.findIndex((v) => v.id === s.video?.id)), autoIds })
}

/** A phone edits the queue (cast `/api/queue/edit`). */
export function editQueue(edit: CastQueueEdit): void {
  const s = playerStore.get()
  const result = applyQueueEdit(s.queue, s.index, edit)
  if (!result) return
  const kept = new Set(result.queue.map((v) => v.id))
  playerStore.set({ queue: result.queue, index: result.index, autoIds: s.autoIds.filter((id) => kept.has(id)) })
  if (result.play !== null) playIndex(result.play)
}

/** Adds videos at the end of the queue (`auto`: autoplay from "Tiếp theo"). */
export function extendQueue(videos: VideoItem[], auto = false): void {
  const s = playerStore.get()
  const known = new Set(s.queue.map((v) => v.id))
  const extra = videos.filter((v) => !v.isShort && !known.has(v.id))
  if (extra.length) playerStore.set({ queue: [...s.queue, ...extra], autoIds: auto ? [...s.autoIds, ...extra.map((v) => v.id)] : s.autoIds })
}

/** Leaves the player (TV convention: nothing keeps playing behind the menus). */
export function closePlayer(): void {
  nav.close('player')
}

export function resetPlayer(): void {
  playerStore.set({ video: null, queue: [], index: 0, playlistId: null, music: false, startAt: null, sender: null, autoIds: [] })
}

// MARK: Controls registered by the player screen

export interface PlayerControls {
  toggle(): void
  play(): void
  pause(): void
  seek(seconds: number): void
  skip(seconds: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  status(): CastStatus
}

let controls: PlayerControls | null = null

export function registerControls(c: PlayerControls | null): void {
  controls = c
}

export function playerControls(): PlayerControls | null {
  return controls
}
