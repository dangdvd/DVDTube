// Navigation of the TV interface (like the Android TV app's TvNav): one section of the left rail
// plus a stack of screens opened on top of it. The Back key pops the stack; the focused element
// of each screen is remembered and restored when it comes back.

import type { ChannelItem, PlaylistItem, VideoItem } from '@shared/models'
import { createStore } from '../store'

export type Section = 'search' | 'home' | 'shorts' | 'music' | 'subscriptions' | 'library' | 'account' | 'settings' | 'support'

export const SECTIONS: { id: Section; title: string; icon: string }[] = [
  { id: 'search', title: 'Tìm kiếm', icon: 'search' },
  { id: 'home', title: 'Trang chủ', icon: 'home' },
  { id: 'shorts', title: 'Shorts', icon: 'shorts' },
  { id: 'music', title: 'Nghe nhạc', icon: 'music' },
  { id: 'subscriptions', title: 'Kênh đăng ký', icon: 'subscriptions' },
  { id: 'library', title: 'Thư viện', icon: 'library' },
  { id: 'account', title: 'Tài khoản', icon: 'account' },
  { id: 'settings', title: 'Cài đặt', icon: 'settings' },
  { id: 'support', title: 'Ủng hộ tác giả', icon: 'heart' },
]

export type RouteSpec =
  | { name: 'player' }
  | { name: 'channel'; channel: Pick<ChannelItem, 'id' | 'name'> & Partial<ChannelItem> }
  | { name: 'playlist'; playlist: Pick<PlaylistItem, 'id' | 'title'> & Partial<PlaylistItem> }
  | { name: 'localPlaylist'; id: string }
  | { name: 'localList'; list: 'history' | 'watchLater' | 'liked' }
  | { name: 'accountFeed'; kind: 'history' | 'watchLater' | 'liked' | 'playlists' | 'subscriptions'; title: string }
  | { name: 'searchResults'; query: string }
  | { name: 'pairing' }
  | { name: 'musicBrowse'; browseId: string; title: string }
  | { name: 'sync' }
  | { name: 'parental' }
  | { name: 'about' }

export type Route = RouteSpec & { key: string }

interface NavState {
  section: Section
  stack: Route[]
  /** Shorts opened from a card: the list and the one to start with. */
  pendingShorts: { items: VideoItem[]; startId: string } | null
  /** Search opened with a query (deep link / voice). */
  pendingSearch: string | null
}

let counter = 0

export const navStore = createStore<NavState>({ section: 'home', stack: [], pendingShorts: null, pendingSearch: null })

/** Focus keys remembered per screen (restored on Back). */
const focusMemory = new Map<string, string>()

export function screenKey(): string {
  const s = navStore.get()
  const top = s.stack[s.stack.length - 1]
  return top ? top.key : `section-${s.section}`
}

export function rememberFocus(key: string, focusKey: string): void {
  focusMemory.set(key, focusKey)
}

export function recalledFocus(key: string): string | undefined {
  return focusMemory.get(key)
}

const leaveListeners: ((route: Route) => void)[] = []

export function onLeaveRoute(listener: (route: Route) => void): void {
  leaveListeners.push(listener)
}

export const nav = {
  get: () => navStore.get(),

  select(section: Section): void {
    const s = navStore.get()
    for (const route of s.stack) {
      focusMemory.delete(route.key)
      for (const l of leaveListeners) l(route)
    }
    navStore.set({ section, stack: [] })
  },

  open(spec: RouteSpec): Route {
    const route = { ...spec, key: `r${++counter}` } as Route
    const s = navStore.get()
    // Only one player at a time: opening it again keeps the screen below.
    if (spec.name === 'player' && s.stack.some((r) => r.name === 'player')) {
      const stack = s.stack.filter((r) => r.name !== 'player')
      navStore.set({ stack: [...stack, route] })
      return route
    }
    navStore.set({ stack: [...s.stack, route] })
    return route
  },

  /** Pops the top screen; false when there is none. */
  back(): boolean {
    const s = navStore.get()
    const top = s.stack[s.stack.length - 1]
    if (!top) return false
    focusMemory.delete(top.key)
    navStore.set({ stack: s.stack.slice(0, -1) })
    for (const l of leaveListeners) l(top)
    return true
  },

  /** Removes every screen of this kind (e.g. closing the player). */
  close(name: RouteSpec['name']): void {
    const s = navStore.get()
    const removed = s.stack.filter((r) => r.name === name)
    if (!removed.length) return
    navStore.set({ stack: s.stack.filter((r) => r.name !== name) })
    for (const route of removed) for (const l of leaveListeners) l(route)
  },

  top(): Route | null {
    const s = navStore.get()
    return s.stack[s.stack.length - 1] ?? null
  },

  openShorts(items: VideoItem[], start: VideoItem): void {
    navStore.set({ pendingShorts: { items: items.map((v) => ({ ...v, isShort: true })), startId: start.id } })
    nav.select('shorts')
  },

  consumePendingShorts(): { items: VideoItem[]; startId: string } | null {
    const pending = navStore.get().pendingShorts
    if (pending) navStore.set({ pendingShorts: null })
    return pending
  },

  search(query: string): void {
    navStore.set({ pendingSearch: query })
    nav.select('search')
  },

  consumePendingSearch(): string | null {
    const q = navStore.get().pendingSearch
    if (q !== null) navStore.set({ pendingSearch: null })
    return q
  },
}

// MARK: Toasts

export const toastStore = createStore<{ message: string | null; id: number }>({ message: null, id: 0 })
let toastTimer: ReturnType<typeof setTimeout> | null = null

export function toast(message: string, ms = 3500): void {
  if (toastTimer) clearTimeout(toastTimer)
  toastStore.set({ message, id: toastStore.get().id + 1 })
  toastTimer = setTimeout(() => toastStore.set({ message: null }), ms)
}
