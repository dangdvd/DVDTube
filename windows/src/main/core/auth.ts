// The signed-in YouTube session (port of `AuthSession.kt`). The cookies themselves live in the
// `persist:yt` Chromium cookie jar (they are attached by the network stack); this module derives
// the `SAPISIDHASH` authorization headers from them, exactly like the website does.

import { createHash } from 'node:crypto'

export const ORIGIN = 'https://www.youtube.com'

/**
 * Which signed-in Google account (`authUser`, 0-based like `/u/1/`) and, for a brand account,
 * which channel (`pageId`) requests run as.
 */
export interface Identity {
  authUser: number
  pageId: string | null
}

export type CookieMap = Record<string, string>

export function sapisid(cookies: CookieMap): string | undefined {
  return cookies['SAPISID'] ?? cookies['__Secure-3PAPISID'] ?? cookies['__Secure-1PAPISID']
}

/**
 * The jar holds a session to sign requests with. (Android also wants LOGIN_INFO; the desktop
 * sign-in window can reach youtube.com before that cookie is set, and the API only needs the
 * SAPISID hash plus the SID cookies the jar sends anyway.)
 */
export function hasAuthCookies(cookies: CookieMap): boolean {
  return sapisid(cookies) !== undefined
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

/** `SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> <origin>")>` plus the 1P / 3P variants. */
export function authorization(cookies: CookieMap, origin: string, timestampSec: number): string | null {
  const timestamp = String(timestampSec)
  const schemes: [string, string | undefined][] = [
    ['SAPISIDHASH', cookies['SAPISID'] ?? cookies['__Secure-3PAPISID']],
    ['SAPISID1PHASH', cookies['__Secure-1PAPISID']],
    ['SAPISID3PHASH', cookies['__Secure-3PAPISID']],
  ]
  const parts = schemes
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([scheme, sid]) => `${scheme} ${timestamp}_${sha1(`${timestamp} ${sid} ${origin}`)}`)
  return parts.length > 0 ? parts.join(' ') : null
}

/**
 * Headers that make a request run as the signed-in account (null if signed out or the host is
 * not youtube.com). The Cookie header is not included: the jar attaches the cookies.
 */
export function authHeaders(
  url: string,
  cookies: CookieMap,
  identity: Identity,
  origin: string = ORIGIN,
  now: number = Date.now(),
): Record<string, string> | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null
  if (!hasAuthCookies(cookies)) return null
  const headers: Record<string, string> = {
    'X-Origin': origin,
    'X-Goog-AuthUser': String(identity.authUser),
    'X-Youtube-Bootstrap-Logged-In': 'true',
  }
  if (identity.pageId) headers['X-Goog-PageId'] = identity.pageId
  const auth = authorization(cookies, origin, Math.floor(now / 1000))
  if (auth) headers['Authorization'] = auth
  return headers
}

// MARK: Session state (filled in by the main process)

interface SessionSource {
  /** Current youtube.com cookies of the account jar (name → value). */
  cookies(): Promise<CookieMap>
  identity(): Identity
}

let source: SessionSource = { cookies: async () => ({}), identity: () => ({ authUser: 0, pageId: null }) }

export function setSessionSource(s: SessionSource): void {
  source = s
}

export const AuthSession = {
  async isAuthenticated(): Promise<boolean> {
    return hasAuthCookies(await source.cookies())
  },
  identity(): Identity {
    return source.identity()
  },
  async headers(url: string, origin: string = ORIGIN): Promise<Record<string, string> | null> {
    return authHeaders(url, await source.cookies(), source.identity(), origin)
  },
}

// MARK: Importing cookies

/** Accepts a Netscape `cookies.txt` export or a raw `Cookie:` header ("a=b; c=d"). */
export function parseCookieText(text: string): CookieMap {
  const result: CookieMap = {}
  const lines = text.split(/\r?\n/)
  const looksLikeNetscape = lines.some((line) => line.split('\t').length >= 7)
  if (looksLikeNetscape) {
    for (const raw of lines) {
      let line = raw.trim()
      if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length)
      if (line === '' || line.startsWith('#')) continue
      const columns = line.split('\t')
      if (columns.length < 7 || !columns[0].toLowerCase().endsWith('youtube.com')) continue
      result[columns[5]] = columns.slice(6).join('\t')
    }
  } else {
    let header = text.trim()
    if (header.toLowerCase().startsWith('cookie:')) header = header.slice(7)
    for (const pair of header.split(';')) {
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      if (name) result[name] = pair.slice(index + 1).trim()
    }
  }
  return result
}
