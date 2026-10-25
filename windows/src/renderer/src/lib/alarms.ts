// "Hẹn giờ phát": alarms that start playing at a time while the app runs (also hidden in the
// tray), with a 30 s volume fade-in and an audio-only option; the window comes to the front when
// "Hiện cửa sổ khi đến giờ" is on.

import type { NavigateFunction } from 'react-router-dom'
import { create } from 'zustand'
import type { VideoItem } from '@shared/models'
import { useLibrary } from '@/state/library'
import { useMusic } from '@/state/music'
import { usePlayer } from '@/state/player'
import { settings } from '@/state/settings'
import { api, errorMessage } from './api'
import { watchPath } from './nav'
import { load, saveSoon } from './persist'
import { toast } from './toast'

export type AlarmRepeat = 'once' | 'daily' | 'weekdays' | 'weekends'

export type AlarmContent =
  | { type: 'playlist'; playlistId: string; name?: string }
  | { type: 'watchLater' }
  | { type: 'liked' }
  | { type: 'radio' }
  | { type: 'link'; url: string }

export interface Alarm {
  id: string
  enabled: boolean
  /** "HH:MM", local time. */
  time: string
  repeat: AlarmRepeat
  content: AlarmContent
  fadeIn: boolean
  audioOnly: boolean
  /** When it last went off (epoch ms). */
  lastFired?: number | null
  /** Created at (a "once" alarm only fires after this). */
  createdAt: number
}

export const REPEAT_TITLES: Record<AlarmRepeat, string> = {
  once: 'Một lần',
  daily: 'Hằng ngày',
  weekdays: 'Ngày thường',
  weekends: 'Cuối tuần',
}

export function contentTitle(content: AlarmContent): string {
  switch (content.type) {
    case 'playlist': {
      const playlist = useLibrary.getState().playlists.find((p) => p.id === content.playlistId)
      return `Danh sách phát: ${playlist?.name ?? content.name ?? 'đã xóa'}`
    }
    case 'watchLater':
      return 'Xem sau'
    case 'liked':
      return 'Video đã thích'
    case 'radio':
      return 'Radio từ bài nghe gần nhất'
    case 'link':
      return `Liên kết: ${content.url}`
  }
}

function dayAllowed(repeat: AlarmRepeat, date: Date): boolean {
  const day = date.getDay()
  if (repeat === 'weekdays') return day >= 1 && day <= 5
  if (repeat === 'weekends') return day === 0 || day === 6
  return true
}

function atTime(time: string, base: Date): Date {
  const [h, m] = time.split(':').map((p) => parseInt(p, 10))
  const d = new Date(base)
  d.setHours(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 0, 0, 0)
  return d
}

/** The occurrence that is due now (within the last 3 minutes), if any. */
export function dueOccurrence(alarm: Alarm, now = new Date()): number | null {
  if (!alarm.enabled) return null
  const today = atTime(alarm.time, now)
  const at = today.getTime()
  if (at > now.getTime() || now.getTime() - at > 3 * 60_000) return null
  if (!dayAllowed(alarm.repeat, today)) return null
  if (alarm.repeat === 'once' && alarm.createdAt > at) return null
  if (alarm.lastFired && alarm.lastFired >= at) return null
  return at
}

/** Next time the alarm goes off (for the list), or null. */
export function nextOccurrence(alarm: Alarm, now = new Date()): Date | null {
  if (!alarm.enabled) return null
  for (let i = 0; i < 8; i++) {
    const day = new Date(now)
    day.setDate(now.getDate() + i)
    const at = atTime(alarm.time, day)
    if (at.getTime() <= now.getTime()) continue
    if (!dayAllowed(alarm.repeat, at)) continue
    return at
  }
  return null
}

interface AlarmStore {
  alarms: Alarm[]
  loaded: boolean
  save(alarm: Alarm): void
  remove(id: string): void
}

export const useAlarms = create<AlarmStore>((set, get) => ({
  alarms: [],
  loaded: false,
  save(alarm) {
    const exists = get().alarms.some((a) => a.id === alarm.id)
    const alarms = exists ? get().alarms.map((a) => (a.id === alarm.id ? alarm : a)) : [...get().alarms, alarm]
    alarms.sort((a, b) => a.time.localeCompare(b.time))
    set({ alarms })
    saveSoon('alarms', alarms)
  },
  remove(id) {
    const alarms = get().alarms.filter((a) => a.id !== id)
    set({ alarms })
    saveSoon('alarms', alarms)
  },
}))

export function newAlarm(): Alarm {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
    enabled: true,
    time: '07:00',
    repeat: 'daily',
    content: { type: 'watchLater' },
    fadeIn: true,
    audioOnly: false,
    createdAt: Date.now(),
  }
}

/** The videos an alarm plays (and the playlist id for a radio / YouTube playlist). */
async function resolveContent(content: AlarmContent): Promise<{ videos: VideoItem[]; playlistId: string | null } | null> {
  const library = useLibrary.getState()
  switch (content.type) {
    case 'playlist':
      return { videos: library.playlists.find((p) => p.id === content.playlistId)?.videos ?? [], playlistId: null }
    case 'watchLater':
      return { videos: library.watchLater, playlistId: null }
    case 'liked':
      return { videos: library.liked, playlistId: null }
    case 'radio': {
      const last = useMusic.getState().recent[0] ?? library.history[0]?.video
      return last ? { videos: [last], playlistId: 'RDAMVM' + last.id } : null
    }
    case 'link': {
      const link = await api.resolveLink(content.url)
      if (!link) return null
      if (link.type === 'video' || link.type === 'shorts') return { videos: [{ id: link.videoId, title: '' }], playlistId: link.type === 'video' ? (link.playlistId ?? null) : null }
      if (link.type === 'playlist') return { videos: await api.playlistVideos(link.playlistId, 200), playlistId: link.playlistId }
      return null
    }
  }
}

export async function fireAlarm(alarm: Alarm, navigate: NavigateFunction): Promise<void> {
  try {
    const content = await resolveContent(alarm.content)
    const videos = content?.videos.filter((v) => !v.isLive || alarm.content.type === 'link') ?? []
    if (!content || !videos.length) {
      toast(`Hẹn giờ phát ${alarm.time}: không có gì để phát (${contentTitle(alarm.content)})`)
      return
    }
    if (settings().alarmShowWindow) api.showWindow().catch(() => {})
    const player = usePlayer.getState()
    if (alarm.audioOnly !== player.audioOnly) player.setAudioOnly(alarm.audioOnly)
    const first = videos[0]
    const radio = alarm.content.type === 'radio'
    player.play(first, {
      queue: videos.length > 1 ? videos : undefined,
      index: 0,
      playlistId: content.playlistId,
      startAt: 0,
      fadeIn: alarm.fadeIn ? 30 : 0,
      music: radio,
    })
    navigate(watchPath(first.id, { list: content.playlistId }), { state: { video: first, queue: videos.length > 1 ? videos : undefined, index: 0 } })
    toast(`Hẹn giờ phát ${alarm.time}: ${contentTitle(alarm.content)}`)
  } catch (error) {
    toast(`Hẹn giờ phát không chạy được: ${errorMessage(error)}`)
  }
}

let started = false

export async function startAlarms(navigate: NavigateFunction): Promise<void> {
  if (started) return
  started = true
  const saved = await load<Alarm[]>('alarms')
  useAlarms.setState({ alarms: Array.isArray(saved) ? saved : [], loaded: true })
  const check = () => {
    const now = new Date()
    for (const alarm of useAlarms.getState().alarms) {
      const at = dueOccurrence(alarm, now)
      if (at === null) continue
      useAlarms.getState().save({ ...alarm, lastFired: at, enabled: alarm.repeat === 'once' ? false : alarm.enabled })
      void fireAlarm(alarm, navigate)
    }
  }
  setInterval(check, 15_000)
  check()
}
