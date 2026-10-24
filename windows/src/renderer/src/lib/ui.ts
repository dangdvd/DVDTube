// App-shell state: sidebar / drawer, F5 reload signal, search box focus. Per-viewer layout
// preferences are kept in localStorage (they do not need to roam with the settings file).

import { create } from 'zustand'

const COLLAPSED_KEY = 'dvd-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

interface UiStore {
  /** Overlay drawer (narrow windows, watch page). */
  drawerOpen: boolean
  /** User folded the full sidebar into the mini rail (wide windows). */
  sidebarCollapsed: boolean
  /** Incremented by F5: pages reload their data. */
  reloadTick: number
  /** Incremented to ask the top bar to focus the search box. */
  focusSearchTick: number
  setDrawer(open: boolean): void
  toggleCollapsed(): void
  reload(): void
  focusSearch(): void
}

export const useUi = create<UiStore>((set, get) => ({
  drawerOpen: false,
  sidebarCollapsed: readCollapsed(),
  reloadTick: 0,
  focusSearchTick: 0,
  setDrawer(open) {
    set({ drawerOpen: open })
  },
  toggleCollapsed() {
    const sidebarCollapsed = !get().sidebarCollapsed
    set({ sidebarCollapsed })
    try {
      localStorage.setItem(COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // Not persisted (private storage); fine.
    }
  },
  reload() {
    set({ reloadTick: get().reloadTick + 1 })
  },
  focusSearch() {
    set({ focusSearchTick: get().focusSearchTick + 1 })
  },
}))
