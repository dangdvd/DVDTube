// Settings of the TV app (localStorage `dvd.settings`). Names and defaults follow the desktop
// `AppSettings` where the setting exists there.

import { SPONSOR_CATEGORIES } from '@shared/models'
import { createStore, loadJson, saveSoon } from '../store'

export type CaptionSize = 'small' | 'normal' | 'large' | 'xlarge'

export interface TvSettings {
  language: string
  region: string
  /** Highest quality (shorter side); 0 = "Tự động". */
  defaultQuality: number
  autoplayNext: boolean
  resumePlayback: boolean
  defaultSpeed: number
  preferredAudioLanguage: string | null
  captionsEnabled: boolean
  captionLanguage: string | null
  captionSize: CaptionSize
  sponsorBlock: boolean
  sponsorCategories: string[]
  dearrow: boolean
  dearrowTitles: boolean
  dearrowThumbnails: boolean
  showDislikes: boolean
  musicAudioOnly: boolean
  castReceiver: boolean
  incognito: boolean
  pauseWatchHistory: boolean
  pauseSearchHistory: boolean
  checkUpdates: boolean
  /** The TV's name for casting / sync ("" = the name from the TV's settings). */
  deviceName: string
  remoteConfigUrl: string
}

export const DEFAULT_SETTINGS: TvSettings = {
  language: 'vi',
  region: 'VN',
  defaultQuality: 1080,
  autoplayNext: true,
  resumePlayback: true,
  defaultSpeed: 1,
  preferredAudioLanguage: null,
  captionsEnabled: false,
  captionLanguage: 'vi',
  captionSize: 'normal',
  sponsorBlock: true,
  sponsorCategories: ['sponsor', 'selfpromo', 'interaction'],
  dearrow: true,
  dearrowTitles: true,
  dearrowThumbnails: true,
  showDislikes: true,
  musicAudioOnly: true,
  castReceiver: true,
  incognito: false,
  pauseWatchHistory: false,
  pauseSearchHistory: false,
  checkUpdates: true,
  deviceName: '',
  remoteConfigUrl: '',
}

export const QUALITIES: { height: number; title: string }[] = [
  { height: 0, title: 'Tự động' },
  { height: 2160, title: '2160p (4K)' },
  { height: 1440, title: '1440p' },
  { height: 1080, title: '1080p' },
  { height: 720, title: '720p' },
  { height: 480, title: '480p' },
  { height: 360, title: '360p' },
  { height: 240, title: '240p' },
  { height: 144, title: '144p' },
]

export function qualityTitle(height: number): string {
  return height <= 0 ? 'Tự động' : `${height}p`
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export function speedTitle(speed: number): string {
  return speed === 1 ? 'Chuẩn' : `${String(speed).replace('.', ',')}x`
}

export const SLEEP_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120]

export function sleepDurationTitle(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`
  const rest = minutes % 60
  return rest === 0 ? `${minutes / 60} giờ` : `${Math.floor(minutes / 60)} giờ ${rest} phút`
}

export const CAPTION_SIZES: { id: CaptionSize; title: string; scale: number }[] = [
  { id: 'small', title: 'Nhỏ', scale: 0.8 },
  { id: 'normal', title: 'Bình thường', scale: 1 },
  { id: 'large', title: 'Lớn', scale: 1.3 },
  { id: 'xlarge', title: 'Rất lớn', scale: 1.6 },
]

export const REGIONS: [string, string][] = [
  ['VN', 'Việt Nam'],
  ['US', 'Hoa Kỳ'],
  ['JP', 'Nhật Bản'],
  ['KR', 'Hàn Quốc'],
  ['GB', 'Vương quốc Anh'],
  ['FR', 'Pháp'],
  ['DE', 'Đức'],
  ['TH', 'Thái Lan'],
  ['SG', 'Singapore'],
  ['AU', 'Úc'],
  ['CA', 'Canada'],
  ['IN', 'Ấn Độ'],
]

export const LANGUAGES: [string, string][] = [
  ['vi', 'Tiếng Việt'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['th', 'ไทย'],
  ['zh-Hans', '中文'],
]

export function languageName(code: string | null | undefined): string {
  if (!code) return 'Mặc định của video'
  return LANGUAGES.find(([c]) => c === code)?.[1] ?? code
}

export { SPONSOR_CATEGORIES }

function sanitize(value: Partial<TvSettings> | null): TvSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) }
  if (!Array.isArray(merged.sponsorCategories)) merged.sponsorCategories = DEFAULT_SETTINGS.sponsorCategories
  if (typeof merged.defaultQuality !== 'number') merged.defaultQuality = DEFAULT_SETTINGS.defaultQuality
  if (!CAPTION_SIZES.some((s) => s.id === merged.captionSize)) merged.captionSize = 'normal'
  if (!SPEEDS.includes(merged.defaultSpeed)) merged.defaultSpeed = 1
  return merged
}

export const settingsStore = createStore<TvSettings>(sanitize(loadJson<Partial<TvSettings>>('settings')))

export function settings(): TvSettings {
  return settingsStore.get()
}

const listeners: ((s: TvSettings, changed: (keyof TvSettings)[]) => void)[] = []

export function onSettingsChange(listener: (s: TvSettings, changed: (keyof TvSettings)[]) => void): void {
  listeners.push(listener)
}

export function updateSettings(patch: Partial<TvSettings>): void {
  const changed = (Object.keys(patch) as (keyof TvSettings)[]).filter((k) => patch[k] !== settingsStore.get()[k])
  if (changed.length === 0) return
  settingsStore.set(patch)
  saveSoon('settings', () => settingsStore.get(), 200)
  for (const l of listeners) l(settingsStore.get(), changed)
}

export function resetSettings(): void {
  settingsStore.replace({ ...DEFAULT_SETTINGS })
  saveSoon('settings', () => settingsStore.get(), 0)
  for (const l of listeners) l(settingsStore.get(), Object.keys(DEFAULT_SETTINGS) as (keyof TvSettings)[])
}
