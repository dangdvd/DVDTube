// Chromium's network stack for every YouTube / Google request: dedicated sessions and
// `ses.fetch` (Chrome TLS fingerprint, HTTP/2, system proxy).
//
// - `persist:yt`: the signed-in account's cookie jar. The sign-in and Studio windows use the same
//   partition, so cookies land there and Set-Cookie rotations are absorbed automatically.
// - `yt-anon`: in-memory; signed-out requests (visitor cookies only) and cookie-less requests.
//
// An explicit `Origin` header would switch `ses.fetch` into CORS mode (and drop the cookies), so
// Origin / Referer travel as private `X-Dvd-*` headers and are restored by a webRequest hook.

import { app, session, type Session } from 'electron'
import { resolvedUserAgent, APIConfig } from './core/clients'
import type { CookieMap } from './core/auth'
import { chromeUserAgent, setFetcher, type Fetcher } from './core/http'

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

const fetcher: Fetcher = (transport, url, init) => {
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

/** Call once the app is ready. */
export function setupNetwork(): void {
  const ua = chromeUA()
  for (const ses of [ytSession(), anonSession()]) {
    ses.setUserAgent(ua)
    restoreInjectedHeaders(ses)
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
