// Node.js 8.12 (webOS TV 5.0) lacks several APIs the shared core (windows/src/main/core) uses.
// This file is injected at the very top of service.js (esbuild `inject` + first import of
// main.ts) and only fills in what is missing, so newer webOS versions (Node 12+) keep their
// native implementations.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'events'
import * as url from 'url'
import * as util from 'util'

const g = global as any
// A CommonJS require: the module object is patched in place (ES namespaces are read-only).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto') as typeof import('crypto') & { randomUUID?: () => string }

if (typeof g.globalThis === 'undefined') g.globalThis = g

// MARK: WHATWG URL (global since Node 10)

if (typeof g.URL === 'undefined' && (url as any).URL) g.URL = (url as any).URL
if (typeof g.URLSearchParams === 'undefined' && (url as any).URLSearchParams) g.URLSearchParams = (url as any).URLSearchParams

// MARK: TextEncoder / TextDecoder (util since 8.3, global since 11)

if (typeof g.TextEncoder === 'undefined' && (util as any).TextEncoder) g.TextEncoder = (util as any).TextEncoder
if (typeof g.TextDecoder === 'undefined' && (util as any).TextDecoder) g.TextDecoder = (util as any).TextDecoder

// MARK: queueMicrotask (Node 11)

if (typeof g.queueMicrotask !== 'function') {
  g.queueMicrotask = (fn: () => void) => {
    Promise.resolve()
      .then(fn)
      .catch((error) =>
        setTimeout(() => {
          throw error
        }, 0),
      )
  }
}

// MARK: Promise.prototype.finally (Node 10), Promise.allSettled (Node 12.9)

if (typeof (Promise.prototype as any).finally !== 'function') {
  Object.defineProperty(Promise.prototype, 'finally', {
    configurable: true,
    writable: true,
    value: function finallyPolyfill(this: Promise<unknown>, onFinally?: () => unknown) {
      const run = () => (typeof onFinally === 'function' ? onFinally() : undefined)
      return this.then(
        (value) => Promise.resolve(run()).then(() => value),
        (reason) =>
          Promise.resolve(run()).then(() => {
            throw reason
          }),
      )
    },
  })
}

if (typeof (Promise as any).allSettled !== 'function') {
  ;(Promise as any).allSettled = (items: Iterable<unknown>) =>
    Promise.all(
      Array.from(items, (item) =>
        Promise.resolve(item).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
      ),
    )
}

// MARK: Arrays and objects (Node 11 / 12)

function define(target: object, name: string, value: unknown): void {
  if (!(name in target)) Object.defineProperty(target, name, { configurable: true, writable: true, value })
}

define(Array.prototype, 'flat', function flat(this: unknown[], depth = 1): unknown[] {
  const out: unknown[] = []
  const walk = (list: unknown[], d: number) => {
    for (const item of list) {
      if (Array.isArray(item) && d > 0) walk(item, d - 1)
      else out.push(item)
    }
  }
  walk(this, Math.floor(Number(depth)) || 0)
  return out
})

define(Array.prototype, 'flatMap', function flatMap(this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, thisArg?: unknown): unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < this.length; i++) {
    const value = fn.call(thisArg, this[i], i, this)
    if (Array.isArray(value)) out.push(...value)
    else out.push(value)
  }
  return out
})

define(Object, 'fromEntries', function fromEntries(entries: Iterable<[PropertyKey, unknown]>): Record<PropertyKey, unknown> {
  const out: Record<PropertyKey, unknown> = {}
  for (const [key, value] of entries as Iterable<[PropertyKey, unknown]>) out[key as string] = value
  return out
})

define(String.prototype, 'trimStart', function trimStart(this: string) {
  return this.replace(/^\s+/, '')
})
define(String.prototype, 'trimEnd', function trimEnd(this: string) {
  return this.replace(/\s+$/, '')
})

// MARK: EventEmitter.prototype.off (Node 10)

define(EventEmitter.prototype, 'off', EventEmitter.prototype.removeListener)

// MARK: crypto.randomUUID (Node 14.17)

if (typeof (crypto as any).randomUUID !== 'function') {
  const randomUUID = (): string => {
    const b = crypto.randomBytes(16)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = b.toString('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  // The bundle reads `require("crypto").randomUUID` at call time: patch the cached module.
  ;(crypto as any).randomUUID = randomUUID
}

// MARK: Buffer 'base64url' (Node 15.7 / 14.18)

if (!Buffer.isEncoding('base64url')) {
  const originalFrom = Buffer.from as unknown as (...args: unknown[]) => Buffer
  const patchedFrom = function from(this: unknown, value: unknown, encodingOrOffset?: unknown): Buffer {
    if (typeof value === 'string' && encodingOrOffset === 'base64url') {
      return originalFrom.call(Buffer, value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    }
    // eslint-disable-next-line prefer-rest-params
    return (originalFrom as any).apply(Buffer, arguments)
  }
  ;(Buffer as any).from = patchedFrom
  const originalToString = Buffer.prototype.toString
  Buffer.prototype.toString = function toString(this: Buffer, encoding?: string, start?: number, end?: number): string {
    if (encoding === 'base64url') {
      return originalToString.call(this, 'base64', start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }
    // eslint-disable-next-line prefer-rest-params
    return (originalToString as any).apply(this, arguments)
  } as typeof Buffer.prototype.toString
  const originalIsEncoding = Buffer.isEncoding
  ;(Buffer as any).isEncoding = (encoding: string) => encoding === 'base64url' || originalIsEncoding.call(Buffer, encoding)
}

// MARK: AbortController / AbortSignal (Node 15)

if (typeof g.AbortController === 'undefined') {
  class AbortSignalPolyfill {
    aborted = false
    reason: unknown = undefined
    onabort: ((event: { type: string }) => void) | null = null
    private listeners: { fn: (event: { type: string }) => void; once: boolean }[] = []

    addEventListener(type: string, fn: (event: { type: string }) => void, options?: boolean | { once?: boolean }): void {
      if (type !== 'abort' || typeof fn !== 'function') return
      if (this.listeners.some((l) => l.fn === fn)) return
      this.listeners.push({ fn, once: typeof options === 'object' && !!options && !!options.once })
    }

    removeEventListener(type: string, fn: (event: { type: string }) => void): void {
      if (type !== 'abort') return
      this.listeners = this.listeners.filter((l) => l.fn !== fn)
    }

    dispatchEvent(event: { type: string }): boolean {
      if (event.type !== 'abort') return true
      const list = this.listeners.slice()
      this.listeners = this.listeners.filter((l) => !l.once)
      if (typeof this.onabort === 'function') this.onabort(event)
      for (const l of list) {
        try {
          l.fn.call(this, event)
        } catch (error) {
          setTimeout(() => {
            throw error
          }, 0)
        }
      }
      return true
    }

    throwIfAborted(): void {
      if (this.aborted) throw this.reason
    }
  }

  class AbortControllerPolyfill {
    readonly signal = new AbortSignalPolyfill()

    abort(reason?: unknown): void {
      if (this.signal.aborted) return
      this.signal.aborted = true
      this.signal.reason = reason === undefined ? new Error('This operation was aborted') : reason
      this.signal.dispatchEvent({ type: 'abort' })
    }
  }

  g.AbortController = AbortControllerPolyfill
  g.AbortSignal = AbortSignalPolyfill
}

// MARK: Intl (Node 8 has no RelativeTimeFormat; small-icu builds of Node 8 / 12 know only English)

const intl = g.Intl as any

function knowsVietnamese(ctor: any): boolean {
  try {
    return typeof ctor === 'function' && ctor.supportedLocalesOf(['vi']).length > 0
  } catch {
    return false
  }
}

if (intl && !knowsVietnamese(intl.RelativeTimeFormat)) {
  const Native = typeof intl.RelativeTimeFormat === 'function' ? intl.RelativeTimeFormat : null
  const VI: Record<string, string> = { year: 'năm', month: 'tháng', week: 'tuần', day: 'ngày', hour: 'giờ', minute: 'phút', second: 'giây' }
  class RelativeTimeFormatPolyfill {
    readonly vi: boolean
    constructor(locale?: string | string[]) {
      const tag = (Array.isArray(locale) ? locale[0] : locale) || 'en'
      this.vi = String(tag).toLowerCase().startsWith('vi')
    }
    format(value: number, unit: string): string {
      const u = String(unit).replace(/s$/, '')
      const n = Math.abs(value)
      if (this.vi) {
        const word = VI[u] ?? u
        if (value === 0) return `${word} này`
        return value < 0 ? `${n} ${word} trước` : `sau ${n} ${word} nữa`
      }
      const word = n === 1 ? u : `${u}s`
      if (value === 0) return `this ${u}`
      return value < 0 ? `${n} ${word} ago` : `in ${n} ${word}`
    }
    resolvedOptions() {
      return { locale: this.vi ? 'vi' : 'en', style: 'long', numeric: 'always' }
    }
  }
  // Vietnamese from the table above; any other language from the native formatter if there is one.
  const Wrapped = function RelativeTimeFormat(locale?: string | string[], options?: unknown) {
    const own = new RelativeTimeFormatPolyfill(locale)
    if (!Native || own.vi) return own
    return new Native(locale, options)
  } as any
  Wrapped.supportedLocalesOf = (locales: unknown) => (Native ? Native.supportedLocalesOf(locales) : [])
  intl.RelativeTimeFormat = Wrapped
}

// small-icu falls back to English separators ("1.5 Tr"); Vietnamese uses "1,5 Tr".
if (intl && typeof intl.NumberFormat === 'function') {
  if (!knowsVietnamese(intl.NumberFormat)) {
    const Native = intl.NumberFormat
    const Wrapped = function NumberFormat(this: unknown, locale?: string | string[], options?: unknown) {
      const tag = String((Array.isArray(locale) ? locale[0] : locale) || '')
      const inner = new Native('en-US', options)
      if (!tag.toLowerCase().startsWith('vi')) return inner
      return {
        format: (value: number) =>
          String(inner.format(value)).replace(/[.,]/g, (c: string) => (c === '.' ? ',' : '.')),
        resolvedOptions: () => inner.resolvedOptions(),
        formatToParts: (value: number) => (inner.formatToParts ? inner.formatToParts(value) : []),
      }
    } as any
    Wrapped.supportedLocalesOf = (locales: unknown) => Native.supportedLocalesOf(locales)
    intl.NumberFormat = Wrapped
  }
}

export {}
