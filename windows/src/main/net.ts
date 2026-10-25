// Chromium's network stack for every YouTube / Google request: dedicated sessions and
// `ses.fetch` (Chrome TLS fingerprint, HTTP/2, system proxy).
//
// - `persist:yt`: the signed-in account's cookie jar. The sign-in and Studio windows use the same
//   partition, so cookies land there and Set-Cookie rotations are absorbed automatically.
// - `yt-anon`: in-memory; signed-out requests (visitor cookies only) and cookie-less requests.
//
// An explicit `Origin` header would switch `ses.fetch` into CORS mode (and drop the cookies), so
// Origin / Referer travel as private `X-Dvd-*` headers and are restored by a webRequest hook.

import { Agent, request as httpsRequest } from 'node:https'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'
import { app, session, type Session } from 'electron'
import { resolvedUserAgent, APIConfig } from './core/clients'
import type { CookieMap } from './core/auth'
import { chromeUserAgent, setFetcher, type Fetcher, type FetchInit } from './core/http'

export const YT_PARTITION = 'persist:yt'
export const ANON_PARTITION = 'yt-anon'

const INJECTED = ['origin', 'referer']

let userAgent = ''

export function chromeUA(): string {
  if (!userAgent) userAgent = chromeUserAgent(process.versions.chrome ?? '140', process.platform)
  return userAgent
}

export function ytSession(): Session {
  return session.fromPartition(YT_PARTITION)
}

export function anonSession(): Session {
  return session.fromPartition(ANON_PARTITION)
}

/** Call before `app.whenReady()`: no "Electron" token in any user agent. */
export function setUserAgentFallback(): void {
  app.userAgentFallback = chromeUA()
}

function restoreInjectedHeaders(ses: Session): void {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    let changed = false
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (!lower.startsWith('x-dvd-')) continue
      const name = lower.slice(6)
      if (INJECTED.includes(name)) headers[name === 'origin' ? 'Origin' : 'Referer'] = headers[key]
      delete headers[key]
      changed = true
    }
    callback(changed ? { requestHeaders: headers } : {})
  })
}

// MARK: App clients

const appAgent = new Agent({ keepAlive: true, maxSockets: 6 })

/**
 * Requests made as one of YouTube's apps (VISIONOS…, i.e. a non-browser user agent) go out like the
 * phone apps send them: plain HTTPS with exactly the client's headers. Chromium would add browser
 * headers (sec-fetch-*, client hints) that contradict the app's user agent, and YouTube answers
 * such player requests with its bot check.
 */
function isAppRequest(init: FetchInit): boolean {
  const ua = Object.entries(init.headers ?? {}).find(([key]) => key.toLowerCase() === 'user-agent')?.[1]
  return !!ua && !ua.startsWith('Mozilla/')
}

function decode(encoding: string, raw: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, data: Buffer) => (error ? reject(error) : resolve(data))
    if (encoding === 'gzip') gunzip(raw, done)
    else if (encoding === 'deflate') inflate(raw, done)
    else if (encoding === 'br') brotliDecompress(raw, done)
    else resolve(raw)
  })
}

function nodeFetch(url: string, init: FetchInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = init.body == null ? null : Buffer.from(init.body)
    const headers: Record<string, string> = { 'Accept-Encoding': 'gzip', ...init.headers }
    if (body) headers['Content-Length'] = String(body.length)
    const req = httpsRequest(url, { method: init.method ?? 'GET', headers, agent: appAgent }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase()
        decode(encoding, Buffer.concat(chunks)).then((data) => {
          const out = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (value == null || key === 'content-encoding' || key === 'content-length') continue
            out.set(key, Array.isArray(value) ? value.join(', ') : String(value))
          }
          const status = res.statusCode ?? 502
          const noBody = status === 204 || status === 205 || status === 304
          resolve(new Response(noBody ? null : new Uint8Array(data), { status, headers: out }))
        }, reject)
      })
    })
    req.on('error', reject)
    init.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    if (body) req.write(body)
    req.end()
  })
}

const fetcher: Fetcher = (transport, url, init) => {
  if (transport !== 'auth' && isAppRequest(init)) return nodeFetch(url, init)
  const ses = transport === 'auth' ? ytSession() : anonSession()
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    headers[INJECTED.includes(key.toLowerCase()) ? `X-Dvd-${key}` : key] = value
  }
  return ses.fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body as RequestInit['body'],
    signal: init.signal,
    credentials: transport === 'plain' ? 'omit' : 'include',
    redirect: 'follow',
  })
}

// MARK: Account cookies

let cookieCache: CookieMap | null = null
let cookieGeneration = 0
const cookieListeners: (() => void)[] = []

/** Current cookies sent to www.youtube.com from the account jar (name → value). */
export async function youtubeCookies(): Promise<CookieMap> {
  if (cookieCache) return cookieCache
  const generation = cookieGeneration
  const list = await ytSession().cookies.get({ url: 'https://www.youtube.com' })
  const map: CookieMap = {}
  for (const cookie of list) map[cookie.name] = cookie.value
  if (generation === cookieGeneration) cookieCache = map
  return map
}

export function onYouTubeCookiesChanged(listener: () => void): void {
  cookieListeners.push(listener)
}

// MARK: googlevideo playback in the renderer

/** The user agent of the client a googlevideo URL was issued to (`c=VISIONOS`, `c=WEB`, …). */
function streamUserAgent(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Progressive URLs use `?c=`; HLS manifests and segments put parameters in the path.
    const client = parsed.searchParams.get('c') ?? /\/c\/([A-Za-z_]+)(?:\/|$)/.exec(parsed.pathname)?.[1]
    if (!client) return null
    const profile = APIConfig.allProfiles().find((p) => p.name.toUpperCase() === client.toUpperCase())
    return profile ? resolvedUserAgent(profile, APIConfig.gl) : null
  } catch {
    return null
  }
}

/** Headers for fetching a googlevideo URL from the main process (downloads). */
export function streamHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/' }
  const ua = streamUserAgent(url)
  if (ua) headers['User-Agent'] = ua
  return headers
}

const CORS_URLS = [
  '*://*.googlevideo.com/*',
  '*://*.youtube.com/api/timedtext*',
  '*://i.ytimg.com/*',
  '*://*.ytimg.com/*',
  '*://yt3.ggpht.com/*',
  '*://*.ggpht.com/*',
  '*://*.googleusercontent.com/*',
]

function setupRendererSession(): void {
  const ses = session.defaultSession
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.googlevideo.com/*'] }, (details, callback) => {
    const headers = details.requestHeaders
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'origin' || lower === 'referer') delete headers[key]
    }
    headers['Origin'] = 'https://www.youtube.com'
    headers['Referer'] = 'https://www.youtube.com/'
    const ua = streamUserAgent(details.url)
    if (ua) {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'user-agent') delete headers[key]
      headers['User-Agent'] = ua
    }
    callback({ requestHeaders: headers })
  })
  ses.webRequest.onHeadersReceived({ urls: CORS_URLS }, (details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'access-control-allow-origin' || lower === 'access-control-expose-headers' || lower === 'access-control-allow-credentials') {
        delete headers[key]
      }
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Expose-Headers'] = ['*']
    callback({ responseHeaders: headers })
  })
}

/** Ad servers the web player's embed would call (never used by the app itself). */
const AD_URLS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://www.youtube.com/pagead/*',
  '*://www.youtube-nocookie.com/pagead/*',
  '*://www.youtube.com/api/stats/ads*',
  '*://www.youtube-nocookie.com/api/stats/ads*',
]

/** Call once the app is ready. */
export function setupNetwork(): void {
  const ua = chromeUA()
  for (const ses of [ytSession(), anonSession()]) {
    ses.setUserAgent(ua)
    restoreInjectedHeaders(ses)
    ses.webRequest.onBeforeRequest({ urls: AD_URLS }, (_details, callback) => callback({ cancel: true }))
  }
  ytSession().cookies.on('changed', (_event, cookie) => {
    if (!cookie.domain || !/(^|\.)(youtube|google)\.com$/.test(cookie.domain.replace(/^\./, ''))) return
    cookieGeneration++
    cookieCache = null
    for (const listener of cookieListeners) listener()
  })
  setupRendererSession()
  setFetcher(fetcher)
}
