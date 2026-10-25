// App settings (see `@shared/settings`). Loaded once at startup (`loadSettings()` in main.tsx),
// saved on every change, and the core part is pushed to the main process.

import { create } from 'zustand'
import { DEFAULT_SETTINGS, coreConfig, type AppSettings } from '@shared/settings'
import { api } from '@/lib/api'
import { load, saveSoon } from '@/lib/persist'

/** Parental controls' restricted mode (stored apart from the settings, see state/parental.ts). */
let restrictedMode: () => boolean = () => false

export function setRestrictedModeSource(source: () => boolean): void {
  restrictedMode = source
}

function core(s: AppSettings) {
  return coreConfig(s, restrictedMode())
}

/** Sends the core configuration again (e.g. the parental controls changed). */
export function pushCoreConfig(): Promise<void> {
  return api.configure(core(useSettings.getState().settings)).catch(() => {})
}

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
    const changedCore = JSON.stringify(core(before)) !== JSON.stringify(core(settings))
    if (changedCore) api.configure(core(settings)).catch(() => {})
  },
  reset() {
    set({ settings: DEFAULT_SETTINGS })
    saveSoon('settings', DEFAULT_SETTINGS)
    api.configure(core(DEFAULT_SETTINGS)).catch(() => {})
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
    autoDownload: { ...DEFAULT_SETTINGS.autoDownload, ...(saved?.autoDownload ?? {}) },
  }
  useSettings.setState({ settings: merged, loaded: true })
  await api.configure(core(merged)).catch(() => {})
}
