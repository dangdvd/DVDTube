// Small app preferences that are not part of AppSettings (they only drive a system call and
// the main process has no getter for them), saved in the 'prefs' store.

import { create } from 'zustand'
import { load, saveSoon } from './persist'

interface Prefs {
  startWithWindows: boolean
  /** Last automatic update check (at most once a day). */
  lastUpdateCheck: number
}

interface PrefsStore extends Prefs {
  loaded: boolean
  set(patch: Partial<Prefs>): void
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  startWithWindows: false,
  lastUpdateCheck: 0,
  loaded: false,
  set(patch) {
    set(patch)
    const { startWithWindows, lastUpdateCheck } = { ...get(), ...patch }
    saveSoon('prefs', { startWithWindows, lastUpdateCheck })
  },
}))

let loading: Promise<void> | null = null

export function loadPrefs(): Promise<void> {
  loading ??= load<Partial<Prefs>>('prefs').then((saved) => usePrefs.setState({ ...(saved ?? {}), loaded: true }))
  return loading
}
