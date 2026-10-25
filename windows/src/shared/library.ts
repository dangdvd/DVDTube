// "Đồng bộ thư viện": the library file / LAN sync format shared by every DVDTube app, and the
// merge rules (sync = union, deletions are not propagated):
//
//   { "format": "dvdtube-library", "version": 1, "exportedAt": <ms>, "device": "<name>",
//     "platform": "ios|android|tv|windows|mac|linux", "subscriptions": [<ChannelItem>],
//     "history": [{"video", "watchedAt", "position", "duration"}], "watchLater": [<VideoItem>],
//     "liked": [<VideoItem>], "playlists": [{"id", "name", "videos", "createdAt"}],
//     "searchHistory": ["…"] }
//
// Readers ignore unknown keys and accept missing arrays.

import { cleanChannelItem, cleanVideoItem, type ChannelItem, type HistoryEntry, type LocalPlaylist, type VideoItem } from './models'

export const LIBRARY_FORMAT = 'dvdtube-library'
export const LIBRARY_VERSION = 1
export const MAX_SEARCH_HISTORY = 50

export type LibraryPlatform = 'ios' | 'android' | 'tv' | 'windows' | 'mac' | 'linux'

/** The synced part of a library. */
export interface LibraryContent {
  subscriptions: ChannelItem[]
  history: HistoryEntry[]
  watchLater: VideoItem[]
  liked: VideoItem[]
  playlists: LocalPlaylist[]
  searchHistory: string[]
}

export interface LibraryExport extends LibraryContent {
  format: typeof LIBRARY_FORMAT
  version: number
  exportedAt: number
  device: string
  platform: LibraryPlatform | string
}

export function platformName(nodePlatform: string): LibraryPlatform {
  return nodePlatform === 'darwin' ? 'mac' : nodePlatform === 'linux' ? 'linux' : 'windows'
}

export function makeLibraryExport(content: LibraryContent, device: string, platform: LibraryPlatform, now = Date.now()): LibraryExport {
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exportedAt: now,
    device,
    platform,
    subscriptions: content.subscriptions,
    history: content.history.map((h) => ({ video: h.video, watchedAt: h.watchedAt, position: h.position, duration: h.duration })),
    watchLater: content.watchLater,
    liked: content.liked,
    playlists: content.playlists.map((p) => ({ id: p.id, name: p.name, videos: p.videos, createdAt: p.createdAt })),
    searchHistory: content.searchHistory,
  }
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function videos(value: unknown): VideoItem[] {
  const seen = new Set<string>()
  const out: VideoItem[] = []
  for (const item of list(value)) {
    const video = cleanVideoItem(item)
    if (video && !seen.has(video.id)) {
      seen.add(video.id)
      out.push(video)
    }
  }
  return out
}

/** Validates a parsed library file; null when it is not one. */
export function parseLibraryExport(json: unknown): LibraryExport | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const v = json as Record<string, unknown>
  if (v.format !== LIBRARY_FORMAT) return null
  const history: HistoryEntry[] = []
  for (const entry of list(v.history)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const video = cleanVideoItem(e.video)
    if (!video) continue
    history.push({ video, watchedAt: num(e.watchedAt), position: Math.max(0, num(e.position)), duration: Math.max(0, num(e.duration)) })
  }
  const playlists: LocalPlaylist[] = []
  for (const entry of list(v.playlists)) {
    if (typeof entry !== 'object' || entry === null) continue
    const p = entry as Record<string, unknown>
    const name = typeof p.name === 'string' ? p.name.slice(0, 200) : ''
    const id = typeof p.id === 'string' && p.id ? p.id.slice(0, 100) : ''
    if (!id && !name) continue
    playlists.push({ id: id || name, name: name || 'Danh sách phát', videos: videos(p.videos), createdAt: num(p.createdAt, Date.now()) })
  }
  const subscriptions: ChannelItem[] = []
  const seenChannels = new Set<string>()
  for (const entry of list(v.subscriptions)) {
    const channel = cleanChannelItem(entry)
    if (channel && !seenChannels.has(channel.id)) {
      seenChannels.add(channel.id)
      subscriptions.push(channel)
    }
  }
  return {
    format: LIBRARY_FORMAT,
    version: num(v.version, 1),
    exportedAt: num(v.exportedAt),
    device: typeof v.device === 'string' ? v.device.slice(0, 200) : '',
    platform: typeof v.platform === 'string' ? v.platform.slice(0, 20) : '',
    subscriptions,
    history,
    watchLater: videos(v.watchLater),
    liked: videos(v.liked),
    playlists,
    searchHistory: list(v.searchHistory)
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.slice(0, 500)),
  }
}

/** What a merge added to the local library (for the summary). */
export interface MergeSummary {
  channels: number
  history: number
  watchLater: number
  liked: number
  playlists: number
  playlistVideos: number
  searches: number
}

export interface MergeResult {
  library: LibraryContent
  added: MergeSummary
  /** Videos whose resume position should take the remote one (remote entry is newer). */
  progress: { videoId: string; position: number; duration: number; updatedAt: number }[]
}

function filledFields(channel: ChannelItem): number {
  return Object.values(channel).filter((v) => v !== null && v !== undefined && v !== '').length
}

/** Local items first in local order, then remote-only items in remote order. */
function unionVideos(local: VideoItem[], remote: VideoItem[]): { list: VideoItem[]; added: number } {
  const known = new Set(local.map((v) => v.id))
  const extra = remote.filter((v) => !known.has(v.id) && known.add(v.id))
  return { list: [...local, ...extra], added: extra.length }
}

function playlistKey(name: string): string {
  return name.trim().toLowerCase()
}

export function mergeLibraries(local: LibraryContent, remote: LibraryContent, historyLimit = 2000): MergeResult {
  const added: MergeSummary = { channels: 0, history: 0, watchLater: 0, liked: 0, playlists: 0, playlistVideos: 0, searches: 0 }

  // Subscriptions: union by channel id, keeping the entry with more non-null fields.
  const subscriptions = [...local.subscriptions]
  const byId = new Map(subscriptions.map((c, i) => [c.id, i]))
  for (const channel of remote.subscriptions) {
    const index = byId.get(channel.id)
    if (index === undefined) {
      byId.set(channel.id, subscriptions.length)
      subscriptions.push(channel)
      added.channels++
    } else if (filledFields(channel) > filledFields(subscriptions[index])) {
      subscriptions[index] = channel
    }
  }

  // History: per video the entry with the latest watchedAt; newest first; capped.
  const history = new Map<string, HistoryEntry>()
  for (const entry of local.history) {
    const existing = history.get(entry.video.id)
    if (!existing || entry.watchedAt > existing.watchedAt) history.set(entry.video.id, entry)
  }
  const localIds = new Set(history.keys())
  const progress: MergeResult['progress'] = []
  for (const entry of remote.history) {
    const existing = history.get(entry.video.id)
    if (!existing || entry.watchedAt > existing.watchedAt) {
      history.set(entry.video.id, entry)
      progress.push({ videoId: entry.video.id, position: entry.position, duration: entry.duration, updatedAt: entry.watchedAt })
    }
  }
  const mergedHistory = [...history.values()].sort((a, b) => b.watchedAt - a.watchedAt).slice(0, historyLimit)
  added.history = mergedHistory.filter((h) => !localIds.has(h.video.id)).length

  const watchLater = unionVideos(local.watchLater, remote.watchLater)
  added.watchLater = watchLater.added
  const liked = unionVideos(local.liked, remote.liked)
  added.liked = liked.added

  // Playlists: matched by id, else by name (case-insensitive, trimmed); videos unioned.
  const playlists = local.playlists.map((p) => ({ ...p, videos: [...p.videos] }))
  for (const remotePlaylist of remote.playlists) {
    const match =
      playlists.find((p) => p.id === remotePlaylist.id) ?? playlists.find((p) => playlistKey(p.name) === playlistKey(remotePlaylist.name))
    if (match) {
      const merged = unionVideos(match.videos, remotePlaylist.videos)
      match.videos = merged.list
      added.playlistVideos += merged.added
    } else {
      playlists.push({ ...remotePlaylist, videos: [...remotePlaylist.videos] })
      added.playlists++
    }
  }

  // Search history: local first, then remote-only; capped.
  const seenQueries = new Set(local.searchHistory.map((q) => q.trim().toLowerCase()))
  const extraQueries = remote.searchHistory.filter((q) => {
    const key = q.trim().toLowerCase()
    if (!key || seenQueries.has(key)) return false
    seenQueries.add(key)
    return true
  })
  const searchHistory = [...local.searchHistory, ...extraQueries].slice(0, MAX_SEARCH_HISTORY)
  added.searches = Math.max(0, searchHistory.length - Math.min(local.searchHistory.length, MAX_SEARCH_HISTORY))

  return {
    library: { subscriptions, history: mergedHistory, watchLater: watchLater.list, liked: liked.list, playlists, searchHistory },
    added,
    progress,
  }
}

/** "Đã thêm 12 kênh, 340 video, 2 danh sách phát" (or "Thư viện đã giống nhau"). */
export function mergeSummaryText(added: MergeSummary): string {
  const videos = added.history + added.watchLater + added.liked + added.playlistVideos
  const parts: string[] = []
  if (added.channels) parts.push(`${added.channels} kênh`)
  if (videos) parts.push(`${videos} video`)
  if (added.playlists) parts.push(`${added.playlists} danh sách phát`)
  if (added.searches) parts.push(`${added.searches} nội dung tìm kiếm`)
  return parts.length ? `Đã thêm ${parts.join(', ')}` : 'Thư viện đã giống nhau, không có gì mới'
}

/** `DVDTube-thu-vien-YYYYMMDD.json` */
export function libraryFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `DVDTube-thu-vien-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`
}
