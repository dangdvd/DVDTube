// Local library: watch history with resume positions, Watch later, liked videos, local
// playlists, local subscriptions, search history and "not interested" choices.
// Works signed out; when signed in the account's own lists are shown in addition (via api).

import { create } from 'zustand'
import type { ChannelItem, HistoryEntry, LocalPlaylist, VideoItem } from '@shared/models'
import { load, saveSoon } from '@/lib/persist'
import { settings } from './settings'

export interface Progress {
  position: number
  duration: number
  updatedAt: number
}

interface LibraryData {
  history: HistoryEntry[]
  progress: Record<string, Progress>
  watchLater: VideoItem[]
  liked: VideoItem[]
  playlists: LocalPlaylist[]
  subscriptions: ChannelItem[]
  searchHistory: string[]
  notInterested: string[]
  blockedChannels: string[]
  /** Names of blocked channels (for the list in Settings), by channel id. */
  blockedChannelNames: Record<string, string>
}

interface LibraryStore extends LibraryData {
  loaded: boolean

  /** Called by the player every few seconds and when a video stops. */
  recordWatch(video: VideoItem, position: number, duration: number): void
  progressFor(videoId: string): Progress | undefined
  removeHistory(videoId: string): void
  /** Puts back an entry removed with `removeHistory` ("Hoàn tác"). */
  restoreHistory(entry: HistoryEntry): void
  clearHistory(): void

  isWatchLater(videoId: string): boolean
  toggleWatchLater(video: VideoItem): boolean
  isLiked(videoId: string): boolean
  setLiked(video: VideoItem, liked: boolean): void

  addSearch(query: string): void
  removeSearch(query: string): void
  clearSearchHistory(): void

  isSubscribed(channelId: string): boolean
  subscribe(channel: ChannelItem): void
  unsubscribe(channelId: string): void
  importSubscriptions(channels: ChannelItem[]): number

  createPlaylist(name: string, video?: VideoItem): LocalPlaylist
  /** Saves a copy of a list of videos (e.g. a YouTube playlist) as a new local playlist. */
  importPlaylist(name: string, videos: VideoItem[]): LocalPlaylist
  renamePlaylist(id: string, name: string): void
  deletePlaylist(id: string): void
  addToPlaylist(id: string, video: VideoItem): void
  removeFromPlaylist(id: string, videoId: string): void
  moveInPlaylist(id: string, from: number, to: number): void

  markNotInterested(videoId: string): void
  unmarkNotInterested(videoId: string): void
  clearNotInterested(): void
  blockChannel(channelId: string, name?: string): void
  unblockChannel(channelId: string): void
  /** Hides "not interested" videos and blocked channels from feeds. */
  isHidden(video: VideoItem): boolean
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

const MAX_HISTORY = 2000
const MAX_SEARCHES = 50

function data(state: LibraryStore): LibraryData {
  const {
    history,
    progress,
    watchLater,
    liked,
    playlists,
    subscriptions,
    searchHistory,
    notInterested,
    blockedChannels,
    blockedChannelNames,
  } = state
  return { history, progress, watchLater, liked, playlists, subscriptions, searchHistory, notInterested, blockedChannels, blockedChannelNames }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const useLibrary = create<LibraryStore>((set, get) => {
  /** Applies a change and saves the library. */
  const change = (patch: Partial<LibraryData>) => {
    set(patch)
    saveSoon('library', data(get()))
  }

  return {
    ...EMPTY,
    loaded: false,

    recordWatch(video, position, duration) {
      const s = settings()
      if (s.incognito) return
      const now = Date.now()
      const progress = { ...get().progress, [video.id]: { position, duration, updatedAt: now } }
      if (s.pauseWatchHistory) {
        change({ progress })
        return
      }
      const rest = get().history.filter((h) => h.video.id !== video.id)
      const history = [{ video, watchedAt: now, position, duration }, ...rest].slice(0, MAX_HISTORY)
      change({ history, progress })
    },
    progressFor(videoId) {
      return get().progress[videoId]
    },
    removeHistory(videoId) {
      const progress = { ...get().progress }
      delete progress[videoId]
      change({ history: get().history.filter((h) => h.video.id !== videoId), progress })
    },
    restoreHistory(entry) {
      const history = [...get().history.filter((h) => h.video.id !== entry.video.id), entry].sort((a, b) => b.watchedAt - a.watchedAt)
      const progress = { ...get().progress, [entry.video.id]: { position: entry.position, duration: entry.duration, updatedAt: entry.watchedAt } }
      change({ history, progress })
    },
    clearHistory() {
      change({ history: [], progress: {} })
    },

    isWatchLater(videoId) {
      return get().watchLater.some((v) => v.id === videoId)
    },
    toggleWatchLater(video) {
      const exists = get().isWatchLater(video.id)
      change({ watchLater: exists ? get().watchLater.filter((v) => v.id !== video.id) : [video, ...get().watchLater] })
      return !exists
    },
    isLiked(videoId) {
      return get().liked.some((v) => v.id === videoId)
    },
    setLiked(video, liked) {
      const rest = get().liked.filter((v) => v.id !== video.id)
      change({ liked: liked ? [video, ...rest] : rest })
    },

    addSearch(query) {
      const s = settings()
      const q = query.trim()
      if (!q || s.incognito || s.pauseSearchHistory) return
      change({ searchHistory: [q, ...get().searchHistory.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_SEARCHES) })
    },
    removeSearch(query) {
      change({ searchHistory: get().searchHistory.filter((x) => x !== query) })
    },
    clearSearchHistory() {
      change({ searchHistory: [] })
    },

    isSubscribed(channelId) {
      return get().subscriptions.some((c) => c.id === channelId)
    },
    subscribe(channel) {
      if (get().isSubscribed(channel.id)) return
      change({ subscriptions: [...get().subscriptions, channel].sort((a, b) => a.name.localeCompare(b.name, 'vi')) })
    },
    unsubscribe(channelId) {
      change({ subscriptions: get().subscriptions.filter((c) => c.id !== channelId) })
    },
    importSubscriptions(channels) {
      const known = new Set(get().subscriptions.map((c) => c.id))
      const added = channels.filter((c) => !known.has(c.id))
      if (added.length) {
        change({ subscriptions: [...get().subscriptions, ...added].sort((a, b) => a.name.localeCompare(b.name, 'vi')) })
      }
      return added.length
    },

    createPlaylist(name, video) {
      const playlist: LocalPlaylist = { id: newId(), name: name.trim() || 'Danh sách phát', videos: video ? [video] : [], createdAt: Date.now() }
      change({ playlists: [playlist, ...get().playlists] })
      return playlist
    },
    importPlaylist(name, videos) {
      const seen = new Set<string>()
      const unique = videos.filter((v) => !seen.has(v.id) && seen.add(v.id))
      const playlist: LocalPlaylist = { id: newId(), name: name.trim() || 'Danh sách phát', videos: unique, createdAt: Date.now() }
      change({ playlists: [playlist, ...get().playlists] })
      return playlist
    },
    renamePlaylist(id, name) {
      change({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, name } : p)) })
    },
    deletePlaylist(id) {
      change({ playlists: get().playlists.filter((p) => p.id !== id) })
    },
    addToPlaylist(id, video) {
      change({
        playlists: get().playlists.map((p) =>
          p.id === id && !p.videos.some((v) => v.id === video.id) ? { ...p, videos: [...p.videos, video] } : p,
        ),
      })
    },
    removeFromPlaylist(id, videoId) {
      change({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, videos: p.videos.filter((v) => v.id !== videoId) } : p)) })
    },
    moveInPlaylist(id, from, to) {
      change({
        playlists: get().playlists.map((p) => {
          if (p.id !== id) return p
          const videos = [...p.videos]
          const [item] = videos.splice(from, 1)
          if (item) videos.splice(to, 0, item)
          return { ...p, videos }
        }),
      })
    },

    markNotInterested(videoId) {
      if (!get().notInterested.includes(videoId)) change({ notInterested: [...get().notInterested, videoId] })
    },
    unmarkNotInterested(videoId) {
      change({ notInterested: get().notInterested.filter((id) => id !== videoId) })
    },
    clearNotInterested() {
      change({ notInterested: [] })
    },
    blockChannel(channelId, name) {
      const names = name ? { ...get().blockedChannelNames, [channelId]: name } : get().blockedChannelNames
      if (!get().blockedChannels.includes(channelId)) change({ blockedChannels: [...get().blockedChannels, channelId], blockedChannelNames: names })
      else if (name) change({ blockedChannelNames: names })
    },
    unblockChannel(channelId) {
      const names = { ...get().blockedChannelNames }
      delete names[channelId]
      change({ blockedChannels: get().blockedChannels.filter((id) => id !== channelId), blockedChannelNames: names })
    },
    isHidden(video) {
      const s = get()
      return s.notInterested.includes(video.id) || (!!video.channelId && s.blockedChannels.includes(video.channelId))
    },
  }
})

export async function loadLibrary(): Promise<void> {
  const saved = await load<Partial<LibraryData>>('library')
  useLibrary.setState({ ...EMPTY, ...(saved ?? {}), loaded: true })
}
