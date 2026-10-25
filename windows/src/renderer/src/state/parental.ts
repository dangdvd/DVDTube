// "Kiểm soát của phụ huynh": a 4-digit PIN (salted SHA-256), restricted mode (sent to the main
// process: `lockedSafetyMode` on every InnerTube request), a daily watch-time limit and an
// allowed time window (both lock the app with a full-screen "Đã hết thời gian xem hôm nay"
// that the PIN unlocks for +15 / +30 min or the rest of the day), blocked keywords (title or
// channel, case- and diacritic-insensitive), and toggles to hide comments / Shorts and turn
// search off. Stored apart from the settings ('parental'), so "Khôi phục cài đặt gốc" cannot
// switch it off.

import { create } from 'zustand'
import { load, saveSoon } from '@/lib/persist'
import type { VideoItem } from '@shared/models'
import { pushCoreConfig, setRestrictedModeSource } from './settings'

export interface ParentalConfig {
  enabled: boolean
  pinHash: string | null
  pinSalt: string | null
  /** "Chế độ hạn chế". */
  restricted: boolean
  /** "Giới hạn thời gian xem mỗi ngày" in minutes; 0 = off. */
  dailyLimitMinutes: number
  /** "Khung giờ được xem". */
  windowEnabled: boolean
  windowFrom: string
  windowTo: string
  /** "Chặn từ khóa": comma / line separated. */
  keywords: string
  hideComments: boolean
  hideShorts: boolean
  disableSearch: boolean
}

export interface ParentalUsage {
  /** Local day (YYYY-MM-DD) the counters belong to. */
  day: string
  /** Seconds of playback today. */
  seconds: number
  /** Extra playback granted today with the PIN. */
  bonusSeconds: number
  /** "Hết hôm nay": no limits on this day. */
  unlimitedDay: string | null
  /** Watching allowed outside the time window until this moment (epoch ms). */
  windowUntil: number
}

export type ParentalLockReason = 'limit' | 'window'

export const DEFAULT_PARENTAL: ParentalConfig = {
  enabled: false,
  pinHash: null,
  pinSalt: null,
  restricted: true,
  dailyLimitMinutes: 0,
  windowEnabled: false,
  windowFrom: '07:00',
  windowTo: '21:00',
  keywords: '',
  hideComments: false,
  hideShorts: false,
  disableSearch: false,
}

export const DAILY_LIMITS = [0, 15, 30, 45, 60, 90, 120, 180, 240]

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const EMPTY_USAGE = (): ParentalUsage => ({ day: localDay(), seconds: 0, bonusSeconds: 0, unlimitedDay: null, windowUntil: 0 })

/** Lower case without diacritics ("Đà Lạt" → "da lat"). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

export function keywordList(text: string): string[] {
  return [...new Set(text.split(/[,\n;]/).map((k) => foldText(k.trim())).filter((k) => k.length > 0))]
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map((p) => parseInt(p, 10))
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** Inside "Khung giờ được xem" (windows over midnight, e.g. 20:00–06:00, work too). */
export function insideWindow(from: string, to: string, date = new Date()): boolean {
  const now = date.getHours() * 60 + date.getMinutes()
  const a = minutesOf(from)
  const b = minutesOf(to)
  if (a === b) return true
  return a < b ? now >= a && now < b : now >= a || now < b
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface ParentalStore {
  config: ParentalConfig
  usage: ParentalUsage
  loaded: boolean
  /** The settings section stays unlocked a few minutes after entering the PIN. */
  unlockedUntil: number
  lock: ParentalLockReason | null

  verifyPin(pin: string): Promise<boolean>
  /** Turns parental controls on with a new PIN. */
  enable(pin: string): Promise<void>
  changePin(pin: string): Promise<void>
  update(patch: Partial<ParentalConfig>): void
  /** Off, or "Quên mã PIN": every parental setting back to default. */
  resetAll(): void
  markUnlocked(): void
  /** After the PIN on the lock screen: more time today. */
  grant(choice: 15 | 30 | 'day'): void
}

function save(state: Pick<ParentalStore, 'config' | 'usage'>, delay = 300): void {
  saveSoon('parental', { config: state.config, usage: state.usage }, delay)
}

export const useParental = create<ParentalStore>((set, get) => ({
  config: DEFAULT_PARENTAL,
  usage: EMPTY_USAGE(),
  loaded: false,
  unlockedUntil: 0,
  lock: null,

  async verifyPin(pin) {
    const { pinHash, pinSalt } = get().config
    if (!pinHash || !pinSalt) return false
    return (await sha256(`${pinSalt}:${pin}`)) === pinHash
  },
  async enable(pin) {
    const salt = randomSalt()
    const config = { ...DEFAULT_PARENTAL, ...get().config, enabled: true, pinSalt: salt, pinHash: await sha256(`${salt}:${pin}`) }
    set({ config, unlockedUntil: Date.now() + 5 * 60_000 })
    save(get())
    void pushCoreConfig()
  },
  async changePin(pin) {
    const salt = randomSalt()
    set({ config: { ...get().config, pinSalt: salt, pinHash: await sha256(`${salt}:${pin}`) } })
    save(get())
  },
  update(patch) {
    const before = get().config
    const config = { ...before, ...patch }
    set({ config })
    save(get())
    if (before.restricted !== config.restricted || before.enabled !== config.enabled) void pushCoreConfig()
    evaluate()
  },
  resetAll() {
    set({ config: DEFAULT_PARENTAL, usage: EMPTY_USAGE(), unlockedUntil: 0, lock: null })
    save(get(), 0)
    void pushCoreConfig()
  },
  markUnlocked() {
    set({ unlockedUntil: Date.now() + 5 * 60_000 })
  },
  grant(choice) {
    const usage = { ...get().usage }
    const today = localDay()
    if (choice === 'day') usage.unlimitedDay = today
    else {
      usage.bonusSeconds += choice * 60
      // Outside the time window, the same minutes of wall-clock time.
      usage.windowUntil = Math.max(usage.windowUntil, Date.now()) + choice * 60_000
      // Extra watching starts from what was watched so far, not from the old limit.
      const limit = get().config.dailyLimitMinutes * 60
      if (limit > 0 && usage.seconds > limit + usage.bonusSeconds - choice * 60) usage.bonusSeconds = usage.seconds - limit + choice * 60
    }
    set({ usage, lock: null })
    save(get(), 0)
  },
}))

setRestrictedModeSource(() => {
  const c = useParental.getState().config
  return c.enabled && c.restricted
})

// MARK: Queries used across the app

export function parentalActive(): boolean {
  return useParental.getState().config.enabled
}

let keywordCache: { text: string; list: string[] } = { text: '', list: [] }

/** Videos whose title or channel contains a blocked keyword. */
export function blockedByKeywords(video: Pick<VideoItem, 'title' | 'channelName'>): boolean {
  const c = useParental.getState().config
  if (!c.enabled || !c.keywords.trim()) return false
  if (keywordCache.text !== c.keywords) keywordCache = { text: c.keywords, list: keywordList(c.keywords) }
  if (!keywordCache.list.length) return false
  const haystack = foldText(`${video.title ?? ''} \u0001 ${video.channelName ?? ''}`)
  return keywordCache.list.some((k) => haystack.includes(k))
}

export function useParentalFlags(): { hideShorts: boolean; hideComments: boolean; disableSearch: boolean } {
  const hideShorts = useParental((s) => s.config.enabled && s.config.hideShorts)
  const hideComments = useParental((s) => s.config.enabled && s.config.hideComments)
  const disableSearch = useParental((s) => s.config.enabled && s.config.disableSearch)
  return { hideShorts, hideComments, disableSearch }
}

// MARK: Watch time and locks

/** Why the app should be locked right now (null = watching allowed). */
export function lockReason(config: ParentalConfig, usage: ParentalUsage, now = new Date()): ParentalLockReason | null {
  if (!config.enabled || usage.unlimitedDay === localDay(now)) return null
  if (config.dailyLimitMinutes > 0 && usage.seconds >= config.dailyLimitMinutes * 60 + usage.bonusSeconds) return 'limit'
  if (config.windowEnabled && !insideWindow(config.windowFrom, config.windowTo, now) && now.getTime() >= usage.windowUntil) return 'window'
  return null
}

function evaluate(): ParentalLockReason | null {
  const s = useParental.getState()
  const reason = s.loaded ? lockReason(s.config, s.usage) : null
  if (reason !== s.lock) useParental.setState({ lock: reason })
  return reason
}

export async function loadParental(): Promise<void> {
  const saved = await load<{ config?: Partial<ParentalConfig>; usage?: Partial<ParentalUsage> }>('parental')
  const usage: ParentalUsage = { ...EMPTY_USAGE(), ...(saved?.usage ?? {}) }
  if (usage.day !== localDay()) Object.assign(usage, EMPTY_USAGE())
  useParental.setState({ config: { ...DEFAULT_PARENTAL, ...(saved?.config ?? {}) }, usage, loaded: true })
}

let started = false

/**
 * Counts playback time once a second (any playing video: the main player, music, Shorts, the
 * web player) and locks / pauses when the limit or the time window says so.
 */
export function startParentalWatch(isPlaying: () => boolean, stopPlayback: () => void): void {
  if (started) return
  started = true
  let ticks = 0
  setInterval(() => {
    const s = useParental.getState()
    if (!s.loaded || !s.config.enabled) {
      if (s.lock) useParental.setState({ lock: null })
      return
    }
    const today = localDay()
    if (s.usage.day !== today) useParental.setState({ usage: { ...EMPTY_USAGE(), day: today } })
    if (isPlaying()) {
      const usage = { ...useParental.getState().usage, seconds: useParental.getState().usage.seconds + 1 }
      useParental.setState({ usage })
      if (++ticks % 15 === 0) save(useParental.getState(), 0)
    }
    if (evaluate()) stopPlayback()
  }, 1000)
}
