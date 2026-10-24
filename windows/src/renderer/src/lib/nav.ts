// URLs of the app's pages (hash router). Opening a video = navigating to its watch URL;
// the watch page then starts playback. Pass the VideoItem as router state so the title and
// thumbnail show immediately.

import type { VideoItem } from '@shared/models'

export interface WatchState {
  video?: VideoItem
  /** Play inside this list (e.g. "play all" of a local playlist or the history). */
  queue?: VideoItem[]
  index?: number
}

export function watchPath(videoId: string, options?: { list?: string | null; t?: number | null; index?: number | null }): string {
  const params = new URLSearchParams({ v: videoId })
  if (options?.list) params.set('list', options.list)
  if (options?.index != null) params.set('index', String(options.index))
  if (options?.t) params.set('t', String(Math.floor(options.t)))
  return '/watch?' + params.toString()
}

export const paths = {
  home: '/',
  search: (q: string) => '/results?' + new URLSearchParams({ q }).toString(),
  shorts: (id?: string) => (id ? `/shorts/${id}` : '/shorts'),
  channel: (id: string, tab?: string) => `/channel/${id}` + (tab ? `/${tab}` : ''),
  playlist: (id: string) => '/playlist?' + new URLSearchParams({ list: id }).toString(),
  /** A playlist stored on this PC. */
  localPlaylist: (id: string) => `/local-playlist/${id}`,
  subscriptions: '/feed/subscriptions',
  library: '/feed/library',
  history: '/feed/history',
  watchLater: '/feed/watch-later',
  liked: '/feed/liked',
  downloads: '/downloads',
  notifications: '/notifications',
  settings: '/settings',
  account: '/account',
}
