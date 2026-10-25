// The core's injectable `Fetcher` (windows/src/main/core/http.ts) on plain Node.js: `https`
// requests with gzip / deflate (and brotli where zlib has it), redirects, abort signals, and a
// minimal `Response` / `Headers` look-alike (Node 8 and 12 have no fetch).
//
// Cookies: `auth` requests carry the signed-in account's youtube.com cookies (kept in memory by
// session.ts, never logged), `anon` requests YouTube's visitor cookies only, `plain` none. Set-
// Cookie answers of youtube.com hosts update the jar they came for (cookie rotation).

import * as http from 'http'
import * as https from 'https'
import * as zlib from 'zlib'
import type { FetchInit, Fetcher, Transport } from '../../../windows/src/main/core/http'

// MARK: Headers / Response look-alikes

export class HeadersLike {
  private readonly map = new Map<string, string>()

  constructor(init?: Record<string, string | string[] | undefined> | [string, string][]) {
    if (Array.isArray(init)) for (const [k, v] of init) this.append(k, v)
    else if (init) for (const k of Object.keys(init)) {
      const v = init[k]
      if (v === undefined) continue
      this.set(k, Array.isArray(v) ? v.join(', ') : String(v))
    }
  }

  get(name: string): string | null {
    const v = this.map.get(name.toLowerCase())
    return v === undefined ? null : v
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase())
  }

  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), String(value))
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this.map.get(key)
    this.map.set(key, existing === undefined ? String(value) : `${existing}, ${value}`)
  }

  delete(name: string): void {
    this.map.delete(name.toLowerCase())
  }

  forEach(fn: (value: string, key: string) => void): void {
    this.map.forEach((v, k) => fn(v, k))
  }

  entries(): IterableIterator<[string, string]> {
    return this.map.entries()
  }

  keys(): IterableIterator<string> {
    return this.map.keys()
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.map.entries()
  }
}

export class ResponseLike {
  readonly ok: boolean
  private used = false

  constructor(
    private readonly body: Buffer,
    readonly status: number,
    readonly headers: HeadersLike,
    readonly url: string,
  ) {
    this.ok = status >= 200 && status <= 299
  }

  private take(): Buffer {
    if (this.used) throw new TypeError('Body has already been consumed.')
    this.used = true
    return this.body
  }

  async text(): Promise<string> {
    return this.take().toString('utf8')
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.take().toString('utf8'))
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const b = this.take()
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
}

// MARK: Cookies

export type CookieMap = Record<string, string>

function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'youtube.com' || h.endsWith('.youtube.com')
}

/** Parses one Set-Cookie header: name, value and whether it deletes the cookie. */
export function parseSetCookie(header: string, now = Date.now()): { name: string; value: string; remove: boolean; domain: string | null } | null {
  const parts = header.split(';')
  const first = parts.shift() ?? ''
  const eq = first.indexOf('=')
  if (eq <= 0) return null
  const name = first.slice(0, eq).trim()
  const value = first.slice(eq + 1).trim()
  let remove = false
  let domain: string | null = null
  for (const part of parts) {
    const i = part.indexOf('=')
    const key = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase()
    const v = i < 0 ? '' : part.slice(i + 1).trim()
    if (key === 'max-age' && /^-?\d+$/.test(v) && parseInt(v, 10) <= 0) remove = true
    if (key === 'expires') {
      const t = Date.parse(v)
      if (Number.isFinite(t) && t <= now) remove = true
    }
    if (key === 'domain') domain = v.replace(/^\./, '').toLowerCase()
  }
  if (!name) return null
  return { name, value, remove, domain }
}

/** A youtube.com cookie jar (name → value). */
export class CookieJar {
  private cookies: CookieMap = {}
  /** Called after Set-Cookie changed a value (debounced by the owner). */
  onChange: (() => void) | null = null

  constructor(initial?: CookieMap) {
    if (initial) this.replace(initial)
  }

  replace(map: CookieMap): void {
    this.cookies = {}
    for (const name of Object.keys(map)) {
      const value = map[name]
      if (typeof value === 'string' && name && !/[;\r\n]/.test(name + value)) this.cookies[name] = value
    }
  }

  snapshot(): CookieMap {
    return { ...this.cookies }
  }

  clear(): void {
    this.cookies = {}
  }

  get size(): number {
    return Object.keys(this.cookies).length
  }

  header(host: string): string | null {
    if (!isYouTubeHost(host)) return null
    const names = Object.keys(this.cookies)
    if (names.length === 0) return null
    return names.map((n) => `${n}=${this.cookies[n]}`).join('; ')
  }

  /** Applies the Set-Cookie headers of a response from `host` (youtube.com only). */
  absorb(host: string, setCookie: string[] | string | undefined): void {
    if (!setCookie || !isYouTubeHost(host)) return
    const list = Array.isArray(setCookie) ? setCookie : [setCookie]
    let changed = false
    for (const header of list) {
      const parsed = parseSetCookie(header)
      if (!parsed) continue
      if (parsed.domain && !isYouTubeHost(parsed.domain)) continue
      if (parsed.remove) {
        if (parsed.name in this.cookies) {
          delete this.cookies[parsed.name]
          changed = true
        }
      } else if (this.cookies[parsed.name] !== parsed.value) {
        this.cookies[parsed.name] = parsed.value
        changed = true
      }
    }
    if (changed && this.onChange) this.onChange()
  }
}

/** Visitor cookies only (VISITOR_INFO1_LIVE, YSC, …) for signed-out requests. */
export class VisitorJar extends CookieJar {
  absorb(host: string, setCookie: string[] | string | undefined): void {
    if (!setCookie) return
    const list = (Array.isArray(setCookie) ? setCookie : [setCookie]).filter((h) => {
      const name = h.split('=')[0].trim()
      return /^(VISITOR_INFO1_LIVE|VISITOR_PRIVACY_METADATA|YSC|PREF|GPS|__Secure-ROLLOUT_TOKEN|__Secure-YEC)$/.test(name)
    })
    super.absorb(host, list)
  }
}

// MARK: Requests

const agentOptions = { keepAlive: true, maxSockets: 8 }
const httpsAgent = new https.Agent(agentOptions)
const httpAgent = new http.Agent(agentOptions)

function decodeBody(encoding: string, raw: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, data: Buffer) => (error ? reject(error) : resolve(data))
    const z = zlib as unknown as { brotliDecompress?: (b: Buffer, cb: (e: Error | null, d: Buffer) => void) => void }
    if (encoding === 'gzip' || encoding === 'x-gzip') zlib.gunzip(raw, done)
    else if (encoding === 'deflate') {
      // Some servers send raw deflate without the zlib header.
      zlib.inflate(raw, (error, data) => (error ? zlib.inflateRaw(raw, done) : resolve(data)))
    } else if (encoding === 'br' && typeof z.brotliDecompress === 'function') z.brotliDecompress(raw, done)
    else resolve(raw)
  })
}

export interface NodeFetchOptions extends FetchInit {
  /** Cookie header for a host (the jar filters by host; redirects ask again). */
  cookieFor?: (host: string) => string | null
  /** Receives Set-Cookie headers (host, values) of every hop. */
  onSetCookie?: (host: string, values: string[] | undefined) => void
  maxRedirects?: number
}

function acceptedEncodings(): string {
  return typeof (zlib as unknown as { brotliDecompress?: unknown }).brotliDecompress === 'function' ? 'gzip, deflate, br' : 'gzip, deflate'
}

/** One request with Node's http / https modules; resolves with the whole (decoded) body. */
export function nodeFetch(target: string, init: NodeFetchOptions = {}): Promise<ResponseLike> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const run = (href: string, method: string, body: Buffer | null, redirectsLeft: number) => {
      let parsed: URL
      try {
        parsed = new URL(href)
      } catch {
        fail(new TypeError(`Invalid URL: ${href.slice(0, 80)}`))
        return
      }
      const isHttps = parsed.protocol === 'https:'
      if (!isHttps && parsed.protocol !== 'http:') {
        fail(new TypeError('Unsupported protocol'))
        return
      }
      const headers: Record<string, string> = { 'Accept-Encoding': acceptedEncodings() }
      for (const key of Object.keys(init.headers ?? {})) headers[key] = (init.headers as Record<string, string>)[key]
      const cookie = init.cookieFor ? init.cookieFor(parsed.hostname) : null
      if (cookie) headers['Cookie'] = cookie
      if (body) headers['Content-Length'] = String(body.length)
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) headers['User-Agent'] = 'Mozilla/5.0'
      const options: https.RequestOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        agent: isHttps ? httpsAgent : httpAgent,
      }
      const transport = isHttps ? https : http
      const req = transport.request(options, (res) => {
        const status = res.statusCode ?? 502
        const setCookie = res.headers['set-cookie']
        init.onSetCookie?.(parsed.hostname, setCookie)
        const location = res.headers.location
        if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
          res.resume()
          let next: string
          try {
            next = new URL(location, href).toString()
          } catch {
            fail(new TypeError('Bad redirect'))
            return
          }
          const keepBody = status === 307 || status === 308
          run(next, keepBody ? method : method === 'HEAD' ? 'HEAD' : 'GET', keepBody ? body : null, redirectsLeft - 1)
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('error', (error) => fail(error))
        res.on('end', () => {
          const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim()
          decodeBody(encoding, Buffer.concat(chunks)).then(
            (data) => {
              if (settled) return
              settled = true
              const out = new HeadersLike()
              for (const key of Object.keys(res.headers)) {
                const value = res.headers[key]
                if (value == null || key === 'content-encoding' || key === 'content-length') continue
                out.set(key, Array.isArray(value) ? value.join(', ') : String(value))
              }
              resolve(new ResponseLike(data, status, out, href))
            },
            (error) => fail(error),
          )
        })
      })
      req.on('error', (error) => fail(error))
      const signal = init.signal as (AbortSignal & { addEventListener?: AbortSignal['addEventListener'] }) | undefined
      if (signal) {
        if (signal.aborted) {
          req.destroy(new Error('aborted'))
          fail(new Error('aborted'))
          return
        }
        signal.addEventListener('abort', () => {
          req.destroy(new Error('aborted'))
          fail(new Error('aborted'))
        }, { once: true })
      }
      if (body) req.write(body)
      req.end()
    }
    const body = init.body == null ? null : typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : Buffer.from(init.body)
    run(target, init.method ?? 'GET', body, init.maxRedirects ?? 5)
  })
}

export interface Jars {
  auth: CookieJar
  anon: VisitorJar
}

/** The `Fetcher` given to the core (`setFetcher`). */
export function createFetcher(jars: Jars): Fetcher {
  return ((transport: Transport, url: string, init: FetchInit) => {
    const jar = transport === 'auth' ? jars.auth : transport === 'anon' ? jars.anon : null
    return nodeFetch(url, {
      ...init,
      cookieFor: jar ? (host) => jar.header(host) : undefined,
      onSetCookie: jar ? (h, values) => jar.absorb(h, values) : undefined,
    }) as unknown as Promise<Response>
  }) as Fetcher
}
