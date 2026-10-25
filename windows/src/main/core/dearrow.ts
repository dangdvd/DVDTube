// DeArrow (https://dearrow.ajay.app): crowd-sourced replacements for clickbait titles and
// thumbnails. Privacy-preserving hash-prefix API: only the first 4 hex digits of sha256(videoId)
// are sent and the answer holds every video with that prefix. Results are cached for an hour
// (memory + a small disk cache); at most 4 requests run at a time.

import { createHash } from 'node:crypto'
import type { DeArrowBranding } from '@shared/models'
import { requestText } from './http'

const API = 'https://sponsor.ajay.app/api/branding/'
const THUMBNAILS = 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail'
const TTL_MS = 60 * 60_000
const MAX_CONCURRENT = 4
const MAX_CACHE = 3000

export function hashPrefix(videoId: string): string {
  return createHash('sha256').update(videoId).digest('hex').slice(0, 4)
}

export function thumbnailUrl(videoId: string, timestamp: number): string {
  return `${THUMBNAILS}?videoID=${encodeURIComponent(videoId)}&time=${timestamp}`
}

function accepted(entry: Record<string, unknown>): boolean {
  if (entry.original !== false) return false
  const votes = typeof entry.votes === 'number' ? entry.votes : 0
  return votes >= 0 || entry.locked === true
}

/** The branding of one video from the API's answer (an object keyed by video id). */
export function parseBranding(json: unknown, videoId: string): DeArrowBranding {
  if (typeof json !== 'object' || json === null) return {}
  const entry = (json as Record<string, unknown>)[videoId]
  if (typeof entry !== 'object' || entry === null) return {}
  const e = entry as { titles?: unknown; thumbnails?: unknown }
  const result: DeArrowBranding = {}
  for (const title of Array.isArray(e.titles) ? e.titles : []) {
    if (typeof title !== 'object' || title === null) continue
    const t = title as Record<string, unknown>
    if (!accepted(t) || typeof t.title !== 'string') continue
    const text = t.title.replace(/^>\s*/, '').trim()
    if (text) {
      result.title = text
      break
    }
  }
  for (const thumbnail of Array.isArray(e.thumbnails) ? e.thumbnails : []) {
    if (typeof thumbnail !== 'object' || thumbnail === null) continue
    const t = thumbnail as Record<string, unknown>
    if (!accepted(t) || typeof t.timestamp !== 'number' || !Number.isFinite(t.timestamp)) continue
    result.thumbnail = thumbnailUrl(videoId, t.timestamp)
    break
  }
  return result
}

export interface DeArrowPersistence {
  load(): string | null
  save(text: string): void
}

interface CacheEntry {
  at: number
  value: DeArrowBranding
}

export class DeArrow {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<unknown | null>>()
  private running = 0
  private readonly waiting: (() => void)[] = []
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly persistence: DeArrowPersistence = { load: () => null, save: () => {} },
    private readonly fetchJson: (url: string) => Promise<unknown | null> = defaultFetch,
  ) {
    try {
      const text = persistence.load()
      const saved = text ? (JSON.parse(text) as Record<string, CacheEntry>) : {}
      const now = Date.now()
      for (const [id, entry] of Object.entries(saved)) {
        if (entry && typeof entry.at === 'number' && now - entry.at < TTL_MS && typeof entry.value === 'object') this.cache.set(id, entry)
      }
    } catch {
      // A broken cache file is simply ignored.
    }
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running++
    try {
      return await work()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  private prefixJson(prefix: string): Promise<unknown | null> {
    let request = this.inflight.get(prefix)
    if (!request) {
      request = this.limited(() => this.fetchJson(API + prefix)).finally(() => this.inflight.delete(prefix))
      this.inflight.set(prefix, request)
    }
    return request
  }

  async branding(videoIds: string[]): Promise<Record<string, DeArrowBranding>> {
    const now = Date.now()
    const result: Record<string, DeArrowBranding> = {}
    const missing = new Map<string, string[]>()
    for (const id of new Set(videoIds)) {
      const cached = this.cache.get(id)
      if (cached && now - cached.at < TTL_MS) {
        result[id] = cached.value
        continue
      }
      const prefix = hashPrefix(id)
      missing.set(prefix, [...(missing.get(prefix) ?? []), id])
    }
    await Promise.all(
      [...missing].map(async ([prefix, ids]) => {
        const json = await this.prefixJson(prefix).catch(() => null)
        for (const id of ids) {
          const value = json === null ? {} : parseBranding(json, id)
          result[id] = value
          // Network failures are not cached (try again on the next screen).
          if (json !== null) this.remember(id, value)
        }
      }),
    )
    return result
  }

  private remember(id: string, value: DeArrowBranding): void {
    this.cache.delete(id)
    this.cache.set(id, { at: Date.now(), value })
    while (this.cache.size > MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string)
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.persistence.save(JSON.stringify(Object.fromEntries(this.cache)))
    }, 10_000)
    this.saveTimer.unref?.()
  }
}

async function defaultFetch(url: string): Promise<unknown | null> {
  const response = await requestText(url, { transport: 'plain', timeoutMs: 8000, headers: { Accept: 'application/json' } })
  // 404 = no submission for any video with this prefix.
  if (response.status === 404) return {}
  if (response.status !== 200) return null
  try {
    return JSON.parse(response.text)
  } catch {
    return null
  }
}
