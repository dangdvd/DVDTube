// "Kiểm soát của phụ huynh" on the TV (a port of the desktop parental store; localStorage
// `dvd.parental` = { config, usage }, same shape): a 4-digit PIN (salted SHA-256), restricted
// mode (sent to the service: `lockedSafetyMode` on every InnerTube request), a daily watch-time
// limit and an allowed time window (both lock the app with "Đã hết thời gian xem hôm nay" until
// the PIN grants +15 / +30 min or the rest of the day), blocked keywords (title or channel,
// case- and diacritic-insensitive), and toggles to hide Shorts and turn search off.

import type { VideoItem } from '@shared/models'
import { createStore, loadJson, saveSoon } from '../store'
import { sha256Hex } from '../sha256'

export interface ParentalConfig {
  enabled: boolean
  pinHash: string | null
  pinSalt: string | null
  restricted: boolean
  dailyLimitMinutes: number
  windowEnabled: boolean
  windowFrom: string
  windowTo: string
  keywords: string
  hideComments: boolean
  hideShorts: boolean
  disableSearch: boolean
}

export interface ParentalUsage {
  day: string
  seconds: number
  bonusSeconds: number
  unlimitedDay: string | null
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

const emptyUsage = (): ParentalUsage => ({ day: localDay(), seconds: 0, bonusSeconds: 0, unlimitedDay: null, windowUntil: 0 })

/** Lower case without diacritics ("Đà Lạt" → "da lat"). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

export function keywordList(text: string): string[] {
  return Array.from(new Set(text.split(/[,\n;]/).map((k) => foldText(k.trim())).filter((k) => k.length > 0)))
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

function randomSalt(): string {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return Math.random().toString(16).slice(2) + Date.now().toString(16)
  }
}

interface ParentalState {
  config: ParentalConfig
  usage: ParentalUsage
  unlockedUntil: number
  lock: ParentalLockReason | null
}

function loadState(): ParentalState {
  const saved = loadJson<{ config?: Partial<ParentalConfig>; usage?: Partial<ParentalUsage> }>('parental')
  const usage: ParentalUsage = { ...emptyUsage(), ...(saved?.usage ?? {}) }
  if (usage.day !== localDay()) Object.assign(usage, emptyUsage())
  return { config: { ...DEFAULT_PARENTAL, ...(saved?.config ?? {}) }, usage, unlockedUntil: 0, lock: null }
}

export const parentalStore = createStore<ParentalState>(loadState())

function save(delay = 300): void {
  saveSoon('parental', () => ({ config: parentalStore.get().config, usage: parentalStore.get().usage }), delay)
}

const restrictedListeners: (() => void)[] = []

export function onRestrictedChange(listener: () => void): void {
  restrictedListeners.push(listener)
}

function restrictedChanged(): void {
  for (const l of restrictedListeners) l()
}

export const parental = {
  get: () => parentalStore.get(),

  verifyPin(pin: string): boolean {
    const { pinHash, pinSalt } = parentalStore.get().config
    if (!pinHash || !pinSalt) return false
    return sha256Hex(`${pinSalt}:${pin}`) === pinHash
  },
  enable(pin: string): void {
    const salt = randomSalt()
    const config = { ...DEFAULT_PARENTAL, ...parentalStore.get().config, enabled: true, pinSalt: salt, pinHash: sha256Hex(`${salt}:${pin}`) }
    parentalStore.set({ config, unlockedUntil: Date.now() + 5 * 60_000 })
    save()
    restrictedChanged()
  },
  changePin(pin: string): void {
    const salt = randomSalt()
    parentalStore.set({ config: { ...parentalStore.get().config, pinSalt: salt, pinHash: sha256Hex(`${salt}:${pin}`) } })
    save()
  },
  update(patch: Partial<ParentalConfig>): void {
    const before = parentalStore.get().config
    const config = { ...before, ...patch }
    parentalStore.set({ config })
    save()
    if (before.restricted !== config.restricted || before.enabled !== config.enabled) restrictedChanged()
    evaluate()
  },
  resetAll(): void {
    parentalStore.set({ config: DEFAULT_PARENTAL, usage: emptyUsage(), unlockedUntil: 0, lock: null })
    save(0)
    restrictedChanged()
  },
  markUnlocked(): void {
    parentalStore.set({ unlockedUntil: Date.now() + 5 * 60_000 })
  },
  isUnlocked(): boolean {
    const s = parentalStore.get()
    return !s.config.enabled || s.unlockedUntil > Date.now()
  },
  grant(choice: 15 | 30 | 'day'): void {
    const usage = { ...parentalStore.get().usage }
    const today = localDay()
    if (choice === 'day') usage.unlimitedDay = today
    else {
      usage.bonusSeconds += choice * 60
      usage.windowUntil = Math.max(usage.windowUntil, Date.now()) + choice * 60_000
      const limit = parentalStore.get().config.dailyLimitMinutes * 60
      if (limit > 0 && usage.seconds > limit + usage.bonusSeconds - choice * 60) usage.bonusSeconds = usage.seconds - limit + choice * 60
    }
    parentalStore.set({ usage, lock: null })
    save(0)
  },
  /** Counts one second of playback; returns the lock reason when watching must stop. */
  tick(): ParentalLockReason | null {
    const s = parentalStore.get()
    if (!s.config.enabled) return null
    const today = localDay()
    const usage = s.usage.day === today ? { ...s.usage } : emptyUsage()
    usage.seconds += 1
    parentalStore.set({ usage })
    if (usage.seconds % 15 === 0) save(0)
    return evaluate()
  },
}

export function restrictedMode(): boolean {
  const c = parentalStore.get().config
  return c.enabled && c.restricted
}

export function hidesShorts(): boolean {
  const c = parentalStore.get().config
  return c.enabled && c.hideShorts
}

export function searchDisabled(): boolean {
  const c = parentalStore.get().config
  return c.enabled && c.disableSearch
}

let keywordCache: { text: string; list: string[] } = { text: '', list: [] }

export function blockedByKeywords(video: Pick<VideoItem, 'title' | 'channelName'>): boolean {
  const c = parentalStore.get().config
  if (!c.enabled || !c.keywords.trim()) return false
  if (keywordCache.text !== c.keywords) keywordCache = { text: c.keywords, list: keywordList(c.keywords) }
  if (!keywordCache.list.length) return false
  const haystack = foldText(`${video.title ?? ''} \u0001 ${video.channelName ?? ''}`)
  return keywordCache.list.some((k) => haystack.includes(k))
}

export function lockReason(config: ParentalConfig, usage: ParentalUsage, now = new Date()): ParentalLockReason | null {
  if (!config.enabled || usage.unlimitedDay === localDay(now)) return null
  if (config.dailyLimitMinutes > 0 && usage.seconds >= config.dailyLimitMinutes * 60 + usage.bonusSeconds) return 'limit'
  if (config.windowEnabled && !insideWindow(config.windowFrom, config.windowTo, now) && now.getTime() >= usage.windowUntil) return 'window'
  return null
}

export function evaluate(): ParentalLockReason | null {
  const s = parentalStore.get()
  const reason = lockReason(s.config, s.usage)
  if (reason !== s.lock) parentalStore.set({ lock: reason })
  return reason
}

export function watchedTodayText(): string {
  const minutes = Math.floor(parentalStore.get().usage.seconds / 60)
  if (minutes < 60) return `${minutes} phút`
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`
}
