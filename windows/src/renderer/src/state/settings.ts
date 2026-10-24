// App settings (see `@shared/settings`). Loaded once at startup (`loadSettings()` in main.tsx),
// saved on every change, and the core part is pushed to the main process.

import { create } from 'zustand'
import { DEFAULT_SETTINGS, coreConfig, type AppSettings } from '@shared/settings'
import { api } from '@/lib/api'
import { load, saveSoon } from '@/lib/persist'

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
  update(patch: Partial<AppSettings>): void
  reset(): void
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update(patch) {
    const before = get().settings
    const settings = { ...before, ...patch }
    set({ settings })
    saveSoon('settings', settings)
    const changedCore = JSON.stringify(coreConfig(before)) !== JSON.stringify(coreConfig(settings))
    if (changedCore) api.configure(coreConfig(settings)).catch(() => {})
  },
  reset() {
    set({ settings: DEFAULT_SETTINGS })
    saveSoon('settings', DEFAULT_SETTINGS)
    api.configure(coreConfig(DEFAULT_SETTINGS)).catch(() => {})
  },
}))

/** Current settings outside React. */
export function settings(): AppSettings {
  return useSettings.getState().settings
}

export async function loadSettings(): Promise<void> {
  const saved = await load<Partial<AppSettings>>('settings')
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(saved ?? {}),
    equalizer: { ...DEFAULT_SETTINGS.equalizer, ...(saved?.equalizer ?? {}) },
  }
  useSettings.setState({ settings: merged, loaded: true })
  await api.configure(coreConfig(merged)).catch(() => {})
}
