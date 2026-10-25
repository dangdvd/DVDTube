// The local library on the TV (localStorage `dvd.library`): watch history with resume
// positions, Xem sau, video đã thích, local playlists, local subscriptions, search history and
// hidden videos / channels. Same data shape as the desktop app's library store, and the shared
// sync format / merge rules (windows/src/shared/library.ts) for "Đồng bộ thư viện".

import { makeLibraryExport, mergeLibraries, mergeSummaryText, type LibraryContent, type LibraryExport } from '@shared/library'
import type { ChannelItem, HistoryEntry, LocalPlaylist, VideoItem } from '@shared/models'
import { cleanChannelItem, cleanVideoItem } from '@shared/models'
import { createStore, loadJson, saveSoon } from '../store'
import { blockedByKeywords } from './parental'
import { settings } from './settings'

export interface Progress {
  position: number
  duration: number
  updatedAt: number
}

export interface LibraryData {
  history: HistoryEntry[]
  progress: Record<string, Progress>
  watchLater: VideoItem[]
  liked: VideoItem[]
  playlists: LocalPlaylist[]
  subscriptions: ChannelItem[]
  searchHistory: string[]
  notInterested: string[]
  blockedChannels: string[]
  blockedChannelNames: Record<string, string>
}

const EMPTY: LibraryData = {
  history: [],
  progress: {},
  watchLater: [],
  liked: [],
  playlists: [],
  subscriptions: [],
  searchHistory: [],
  notInterested: [],
  blockedChannels: [],
  blockedChannelNames: {},
}

/** The TV keeps less history than the desktop (localStorage is small on older TVs). */
export const MAX_HISTORY = 1000
const MAX_SEARCHES = 50

function arr<T>(value: unknown, clean: (v: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(clean).filter((v): v is T => v !== null) : []
}

function load(): LibraryData {
  const raw = loadJson<Partial<LibraryData>>('library') ?? {}
  const history: HistoryEntry[] = []
  for (const entry of Array.isArray(raw.history) ? raw.history : []) {
    const video = cleanVideoItem(entry?.video)
    if (!video) continue
    history.push({ video, watchedAt: Number(entry.watchedAt) || 0, position: Number(entry.position) || 0, duration: Number(entry.duration) || 0 })
  }
  const playlists: LocalPlaylist[] = []
  for (const p of Array.isArray(raw.playlists) ? raw.playlists : []) {
    if (!p || typeof p.id !== 'string') continue
    playlists.push({ id: p.id, name: typeof p.name === 'string' ? p.name : 'Danh sách phát', videos: arr(p.videos, cleanVideoItem), createdAt: Number(p.createdAt) || Date.now() })
  }
  return {
    history,
    progress: raw.progress && typeof raw.progress === 'object' ? raw.progress : {},
    watchLater: arr(raw.watchLater, cleanVideoItem),
    liked: arr(raw.liked, cleanVideoItem),
    playlists,
    subscriptions: arr(raw.subscriptions, cleanChannelItem),
    searchHistory: Array.isArray(raw.searchHistory) ? raw.searchHistory.filter((q): q is string => typeof q === 'string') : [],
    notInterested: Array.isArray(raw.notInterested) ? raw.notInterested.filter((q): q is string => typeof q === 'string') : [],
    blockedChannels: Array.isArray(raw.blockedChannels) ? raw.blockedChannels.filter((q): q is string => typeof q === 'string') : [],
    blockedChannelNames: raw.blockedChannelNames && typeof raw.blockedChannelNames === 'object' ? raw.blockedChannelNames : {},
  }
}

export const libraryStore = createStore<LibraryData>({ ...EMPTY, ...load() })

function change(patch: Partial<LibraryData>): void {
  libraryStore.set(patch)
  saveSoon('library', () => libraryStore.get(), 600)
}

function newId(): string {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

/** Only the fields worth keeping (no huge data URLs from the mock beyond the limit). */
function slim(video: VideoItem): VideoItem {
  const clean = cleanVideoItem(video)
  if (!clean) return video
  // Keep the artwork as it was (the cleaner shortens very long data: URLs of the sample data).
  return { ...clean, thumbnail: video.thumbnail ?? null, channelAvatar: video.channelAvatar ?? null }
}

export const library = {
  get: () => libraryStore.get(),

  recordWatch(video: VideoItem, position: number, duration: number): void {
    const s = settings()
    if (s.incognito) return
    const now = Date.now()
    const progress = { ...libraryStore.get().progress, [video.id]: { position, duration, updatedAt: now } }
    // Keep the progress table bounded too.
    const keys = Object.keys(progress)
    if (keys.length > MAX_HISTORY + 200) {
      keys.sort((a, b) => progress[a].updatedAt - progress[b].updatedAt)
      for (const key of keys.slice(0, keys.length - MAX_HISTORY)) delete progress[key]
    }
    if (s.pauseWatchHistory) {
      change({ progress })
      return
    }
    const rest = libraryStore.get().history.filter((h) => h.video.id !== video.id)
    const history = [{ video: slim(video), watchedAt: now, position, duration }, ...rest].slice(0, MAX_HISTORY)
    change({ history, progress })
  },
  progressFor(videoId: string): Progress | undefined {
    return libraryStore.get().progress[videoId]
  },
  removeHistory(videoId: string): void {
    const progress = { ...libraryStore.get().progress }
    delete progress[videoId]
    change({ history: libraryStore.get().history.filter((h) => h.video.id !== videoId), progress })
  },
  clearHistory(): void {
    change({ history: [], progress: {} })
  },

  isWatchLater(videoId: string): boolean {
    return libraryStore.get().watchLater.some((v) => v.id === videoId)
  },
  toggleWatchLater(video: VideoItem): boolean {
    const exists = library.isWatchLater(video.id)
    const list = libraryStore.get().watchLater
    change({ watchLater: exists ? list.filter((v) => v.id !== video.id) : [slim(video), ...list] })
    return !exists
  },
  isLiked(videoId: string): boolean {
    return libraryStore.get().liked.some((v) => v.id === videoId)
  },
  setLiked(video: VideoItem, liked: boolean): void {
    const rest = libraryStore.get().liked.filter((v) => v.id !== video.id)
    change({ liked: liked ? [slim(video), ...rest] : rest })
  },

  addSearch(query: string): void {
    const s = settings()
    const q = query.trim()
    if (!q || s.incognito || s.pauseSearchHistory) return
    change({ searchHistory: [q, ...libraryStore.get().searchHistory.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_SEARCHES) })
  },
  removeSearch(query: string): void {
    change({ searchHistory: libraryStore.get().searchHistory.filter((x) => x !== query) })
  },
  clearSearchHistory(): void {
    change({ searchHistory: [] })
  },

  isSubscribed(channelId: string): boolean {
    return libraryStore.get().subscriptions.some((c) => c.id === channelId)
  },
  subscribe(channel: ChannelItem): void {
    if (library.isSubscribed(channel.id)) return
    change({ subscriptions: [...libraryStore.get().subscriptions, channel].sort((a, b) => a.name.localeCompare(b.name, 'vi')) })
  },
  unsubscribe(channelId: string): void {
    change({ subscriptions: libraryStore.get().subscriptions.filter((c) => c.id !== channelId) })
  },

  createPlaylist(name: string, video?: VideoItem): LocalPlaylist {
    const playlist: LocalPlaylist = { id: newId(), name: name.trim() || 'Danh sách phát', videos: video ? [slim(video)] : [], createdAt: Date.now() }
    change({ playlists: [playlist, ...libraryStore.get().playlists] })
    return playlist
  },
  deletePlaylist(id: string): void {
    change({ playlists: libraryStore.get().playlists.filter((p) => p.id !== id) })
  },
  addToPlaylist(id: string, video: VideoItem): void {
    change({
      playlists: libraryStore.get().playlists.map((p) => (p.id === id && !p.videos.some((v) => v.id === video.id) ? { ...p, videos: [...p.videos, slim(video)] } : p)),
    })
  },
  removeFromPlaylist(id: string, videoId: string): void {
    change({ playlists: libraryStore.get().playlists.map((p) => (p.id === id ? { ...p, videos: p.videos.filter((v) => v.id !== videoId) } : p)) })
  },

  markNotInterested(videoId: string): void {
    if (!libraryStore.get().notInterested.includes(videoId)) change({ notInterested: [...libraryStore.get().notInterested, videoId].slice(-2000) })
  },
  blockChannel(channelId: string, name?: string): void {
    const s = libraryStore.get()
    const names = name ? { ...s.blockedChannelNames, [channelId]: name } : s.blockedChannelNames
    if (!s.blockedChannels.includes(channelId)) change({ blockedChannels: [...s.blockedChannels, channelId], blockedChannelNames: names })
  },
  unblockAll(): void {
    change({ blockedChannels: [], blockedChannelNames: {} })
  },

  /** Hidden: "Không quan tâm", blocked channels, parental keywords. */
  isHidden(video: VideoItem): boolean {
    const s = libraryStore.get()
    if (s.notInterested.includes(video.id)) return true
    if (video.channelId && s.blockedChannels.includes(video.channelId)) return true
    return blockedByKeywords(video)
  },

  // MARK: Sync

  content(): LibraryContent {
    const s = libraryStore.get()
    return { subscriptions: s.subscriptions, history: s.history, watchLater: s.watchLater, liked: s.liked, playlists: s.playlists, searchHistory: s.searchHistory }
  },

  exportLibrary(device: string): LibraryExport {
    return makeLibraryExport(library.content(), device, 'tv')
  },

  /** Merges a library from another device; returns the merged export and the summary. */
  mergeFrom(remote: LibraryExport, device: string): { merged: LibraryExport; summary: string } {
    const result = mergeLibraries(library.content(), remote, MAX_HISTORY)
    const progress = { ...libraryStore.get().progress }
    for (const p of result.progress) {
      const existing = progress[p.videoId]
      if (!existing || existing.updatedAt < p.updatedAt) progress[p.videoId] = { position: p.position, duration: p.duration, updatedAt: p.updatedAt }
    }
    change({ ...result.library, progress })
    return { merged: makeLibraryExport(result.library, device, 'tv'), summary: mergeSummaryText(result.added) }
  },
}
