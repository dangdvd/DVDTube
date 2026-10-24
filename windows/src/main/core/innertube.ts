// Low level access to YouTube's internal "InnerTube" API (port of `InnerTube.kt`, with the
// iOS BotCheck and `ytInitialData` extraction).

import { randomUUID } from 'node:crypto'
import type { PlayerInfo } from '@shared/models'
import { AuthSession } from './auth'
import { APIConfig, resolvedUserAgent, type ClientProfile } from './clients'
import { coreState, debug } from './config'
import { CoreError, Errors, describeError } from './errors'
import { requestText, type Transport } from './http'
import { JNode } from './json'
import { parsePlayer } from './parsers/player'

/**
 * - `none`: anonymous (visitor cookies only).
 * - `auto`: as the signed-in account unless incognito (browsing, search, watch page).
 * - `account`: as the signed-in account even in incognito (account pages and actions).
 */
export type AuthMode = 'none' | 'auto' | 'account'

interface PostOptions {
  query?: Record<string, string>
  host?: string
  visitorData?: string | null
  auth?: AuthMode
  retry?: boolean
}

/** When the anonymous player request last met YouTube's bot check (iOS `BotCheck`). */
const BotCheck = {
  lastSeen: 0,
  note(): void {
    this.lastSeen = Date.now()
  },
  get isRecent(): boolean {
    return Date.now() - this.lastSeen < 10 * 60_000
  },
}

const visitors = new Map<string, { value: string; at: number }>()

function cachedVisitor(client: string): string | null {
  const entry = visitors.get(client)
  return entry && Date.now() - entry.at < 3_600_000 ? entry.value : null
}

function storeVisitor(client: string, value: string): void {
  visitors.set(client, { value, at: Date.now() })
}

export function randomToken(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function utcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset() || 0
}

function context(profile: ClientProfile, visitorData: string | null | undefined): Record<string, unknown> {
  const client: Record<string, unknown> = {
    clientName: profile.name,
    clientVersion: profile.version,
    hl: APIConfig.hl,
    gl: APIConfig.gl,
    utcOffsetMinutes: utcOffsetMinutes(),
  }
  if (profile.clientScreen) client.clientScreen = profile.clientScreen
  if (profile.platform) client.platform = profile.platform
  if (profile.deviceMake) client.deviceMake = profile.deviceMake
  if (profile.deviceModel) client.deviceModel = profile.deviceModel
  if (profile.osName) client.osName = profile.osName
  if (profile.osVersion) client.osVersion = profile.osVersion
  if (profile.androidSdkVersion) client.androidSdkVersion = profile.androidSdkVersion
  if (profile.name === 'WEB') client.originalUrl = 'https://www.youtube.com'
  if (visitorData) client.visitorData = visitorData
  return {
    client,
    request: { internalExperimentFlags: [], useSsl: true },
    user: { lockedSafetyMode: false },
  }
}

async function authFor(mode: AuthMode, url: string): Promise<Record<string, string> | null> {
  if (mode === 'none') return null
  if (mode === 'auto' && coreState.incognito) return null
  return AuthSession.headers(url)
}

export async function post(
  endpoint: string,
  profile: ClientProfile,
  body: Record<string, unknown>,
  opts: PostOptions = {},
): Promise<JNode> {
  const url = new URL(`https://${opts.host ?? profile.host}/youtubei/v1/${endpoint}`)
  url.searchParams.set('prettyPrint', 'false')
  for (const key of Object.keys(opts.query ?? {}).sort()) url.searchParams.set(key, opts.query![key])
  const href = url.toString()

  const payload = { ...body, context: context(profile, opts.visitorData) }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': `${APIConfig.hl},en;q=0.9`,
  }
  const userAgent = resolvedUserAgent(profile, APIConfig.gl)
  if (userAgent) headers['User-Agent'] = userAgent
  if (profile.sendClientHeaders) {
    headers['X-YouTube-Client-Name'] = String(profile.id)
    headers['X-YouTube-Client-Version'] = profile.version
    if (!profile.extraHeaders?.['Origin']) headers['Origin'] = 'https://www.youtube.com'
  }
  if (opts.visitorData) headers['X-Goog-Visitor-Id'] = opts.visitorData
  for (const [key, value] of Object.entries(profile.extraHeaders ?? {})) headers[key] = value
  const auth = await authFor(opts.auth ?? 'none', href)
  if (auth) Object.assign(headers, auth)
  const transport: Transport = auth ? 'auth' : 'anon'

  const response = await requestText(href, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    transport,
    retry: opts.retry,
  })
  debug(`${profile.name} ${endpoint} -> HTTP ${response.status}, ${response.text.length} chars${auth ? ' (signed in)' : ''}`)
  if (response.status < 200 || response.status > 299) {
    try {
      const message = JNode.parse(response.text).at('error', 'message').string
      if (message) debug(`${endpoint} error: ${message}`)
    } catch {
      // not JSON
    }
    throw Errors.http(response.status)
  }
  try {
    return JNode.parse(response.text)
  } catch {
    throw Errors.invalidResponse()
  }
}

/**
 * WEB client request used for search, browse and the watch page. Runs as the signed-in account
 * when there is one (personalised results, account pages).
 */
export async function web(endpoint: string, body: Record<string, unknown>, auth: AuthMode = 'auto', retry = true): Promise<JNode> {
  const profile = APIConfig.webProfile
  const visitor = cachedVisitor(profile.name)
  const json = await post(endpoint, profile, body, { visitorData: visitor, auth, retry })
  if (visitor === null) {
    const fresh = json.at('responseContext', 'visitorData').string
    if (fresh) storeVisitor(profile.name, fresh)
  }
  return json
}

/** Player requests from the visionOS client must carry a visitor id that YouTube issued. */
export async function visitorData(profile: ClientProfile, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cached = cachedVisitor(profile.name)
    if (cached) return cached
  }
  const json = await post('visitor_id', profile, {}, { host: 'www.youtube.com' })
  const visitor = json.at('responseContext', 'visitorData').string
  if (!visitor) throw Errors.invalidResponse()
  storeVisitor(profile.name, visitor)
  return visitor
}

// MARK: Player

export async function player(videoId: string): Promise<PlayerInfo> {
  const signedIn = await AuthSession.isAuthenticated()
  // Right after a bot check, go straight to the signed-in request (the anonymous one would only
  // fail again and cost a round trip per video).
  let triedSignedIn = false
  if (signedIn && BotCheck.isRecent) {
    triedSignedIn = true
    try {
      return await signedInPlayer(videoId)
    } catch (error) {
      debug(`player(${videoId}) via signed-in WEB failed: ${describeError(error)}`)
    }
  }
  let lastError: unknown = Errors.noStreams()
  const anonymous = async (profiles: ClientProfile[]): Promise<PlayerInfo | null> => {
    for (const profile of profiles) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const visitor = await visitorData(profile, attempt > 0)
          const json = await post(
            'player',
            profile,
            { videoId, cpn: randomToken(16), contentCheckOk: true, racyCheckOk: true },
            { query: { t: randomToken(12), id: videoId }, visitorData: visitor },
          )
          return parsePlayer(json, videoId, profile.name)
        } catch (error) {
          debug(`player(${videoId}) via ${profile.name} failed: ${describeError(error)}`)
          // Keep the first client's reason (e.g. the bot check) for the error shown to the user.
          if (lastError instanceof CoreError && lastError.kind === 'noStreams') lastError = error
          // A bad visitor id shows up as an unplayable response; retry once with a fresh one.
          // Never retry a bot check: hammering the endpoint makes it stick.
          if (error instanceof CoreError && error.kind === 'unplayable' && attempt === 0) continue
          break
        }
      }
    }
    return null
  }
  const first = await anonymous(APIConfig.playerProfiles)
  if (first) return first
  if (lastError instanceof CoreError && lastError.kind === 'loginRequired') BotCheck.note()
  // "Sign in to confirm you're not a bot" (or a video that needs an account): ask as the
  // signed-in account through the web client, whose HLS stream needs no PO token.
  if (signedIn && !triedSignedIn) {
    try {
      return await signedInPlayer(videoId)
    } catch (error) {
      debug(`player(${videoId}) via signed-in WEB failed: ${describeError(error)}`)
    }
  }
  const fallback = await anonymous(APIConfig.fallbackPlayerProfiles)
  if (fallback) return fallback
  throw lastError
}

/**
 * The player endpoint as the signed-in account (WEB client with Safari's user agent, which is
 * what makes YouTube include an HLS manifest).
 */
async function signedInPlayer(videoId: string): Promise<PlayerInfo> {
  const json = await web(
    'player',
    {
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
    },
    'account',
  )
  const info = parsePlayer(json, videoId, APIConfig.webProfile.name + ' (signed in)')
  debug(`player(${videoId}) via signed-in WEB: hls=${info.hlsUrl != null} adaptive=${info.adaptiveFormats.length}`)
  return info
}

// MARK: Browse, search, watch

export function search(query: string, params: string | null): Promise<JNode> {
  const body: Record<string, unknown> = { query }
  if (params) body.params = params
  return web('search', body)
}

export function browse(browseId: string, params: string | null = null, auth: AuthMode = 'auto'): Promise<JNode> {
  const body: Record<string, unknown> = { browseId }
  if (params) body.params = params
  return web('browse', body, auth)
}

export function browseContinuation(token: string, auth: AuthMode = 'auto'): Promise<JNode> {
  return web('browse', { continuation: token }, auth)
}

/** A channel's own search (browse with the search tab's params and a query). */
export function browseSearch(browseId: string, params: string, query: string): Promise<JNode> {
  return web('browse', { browseId, params, query })
}

export function searchContinuation(token: string): Promise<JNode> {
  return web('search', { continuation: token })
}

/**
 * The watch page. With a playlist id it is a watch page inside that playlist; for mixes
 * ("Danh sách kết hợp") this is the only way to get their videos (they have no playlist page).
 */
export function next(videoId: string | null, playlistId: string | null = null): Promise<JNode> {
  const body: Record<string, unknown> = { contentCheckOk: true, racyCheckOk: true }
  if (videoId) body.videoId = videoId
  if (playlistId) body.playlistId = playlistId
  return web('next', body)
}

export function nextContinuation(token: string): Promise<JNode> {
  return web('next', { continuation: token })
}

export function resolveUrl(url: string): Promise<JNode> {
  return web('navigation/resolve_url', { url })
}

export function charts(type: string): Promise<JNode> {
  return post(
    'browse',
    APIConfig.chartsProfile,
    {
      browseId: 'FEmusic_analytics_charts_home',
      query: `perspective=CHART_DETAILS&chart_params_country_code=${APIConfig.gl}&chart_params_chart_type=${type}`,
    },
    { query: { alt: 'json' } },
  )
}

/** Search-as-you-type suggestions. */
export async function suggestions(query: string): Promise<string[]> {
  const url = new URL('https://suggestqueries-clients6.youtube.com/complete/search')
  url.searchParams.set('client', 'youtube')
  url.searchParams.set('ds', 'yt')
  url.searchParams.set('hl', APIConfig.hl)
  url.searchParams.set('gl', APIConfig.gl.toLowerCase())
  url.searchParams.set('oe', 'utf-8')
  url.searchParams.set('q', query)
  try {
    const response = await requestText(url.toString(), { transport: 'anon', timeoutMs: 8000 })
    let text = response.text
    // The response is JSONP: window.google.ac.h([...])
    const start = text.indexOf('(')
    const end = text.lastIndexOf(')')
    if (start >= 0 && start < end) text = text.slice(start + 1, end)
    return JNode.parse(text)
      .get(1)
      .array.map((entry) => entry.string ?? entry.get(0).string)
      .filter((s): s is string => s !== null)
  } catch {
    return []
  }
}

// MARK: Account (signed in only)

export function accountMenu(): Promise<JNode> {
  return web('account/account_menu', {}, 'account')
}

/** The website's "Switch account" list (all signed-in Google accounts and channels). */
export async function accountSwitcher(): Promise<JNode> {
  const url = 'https://www.youtube.com/getAccountSwitcherEndpoint'
  const headers: Record<string, string> = {}
  const userAgent = resolvedUserAgent(APIConfig.webProfile, APIConfig.gl)
  if (userAgent) headers['User-Agent'] = userAgent
  const auth = await AuthSession.headers(url)
  if (auth) Object.assign(headers, auth)
  const response = await requestText(url, { headers, transport: auth ? 'auth' : 'anon' })
  debug(`account switcher -> HTTP ${response.status}, ${response.text.length} chars`)
  if (response.status < 200 || response.status > 299) throw Errors.http(response.status)
  // The body starts with an anti-JSON-hijacking prefix: )]}'
  const start = response.text.indexOf('{')
  if (start < 0) throw Errors.invalidResponse()
  try {
    return JNode.parse(response.text.slice(start))
  } catch {
    throw Errors.invalidResponse()
  }
}

export function accountsList(): Promise<JNode> {
  return web('account/accounts_list', {}, 'account')
}

export async function like(videoId: string, action: 'like' | 'dislike' | 'removelike'): Promise<void> {
  await web(`like/${action}`, { target: { videoId } }, 'account')
}

export async function subscription(channelId: string, subscribe: boolean): Promise<void> {
  await web(
    subscribe ? 'subscription/subscribe' : 'subscription/unsubscribe',
    { channelIds: [channelId], params: subscribe ? 'EgIIAhgA' : 'CgIIAhgA' },
    'account',
  )
}

export function addToPlaylistOptions(videoId: string): Promise<JNode> {
  return web('playlist/get_add_to_playlist', { videoIds: [videoId] }, 'account')
}

export function createPlaylist(title: string, videoId: string | null): Promise<JNode> {
  const body: Record<string, unknown> = { title, privacyStatus: 'PRIVATE' }
  if (videoId) body.videoIds = [videoId]
  return web('playlist/create', body, 'account', false)
}

export async function editPlaylist(playlistId: string, add: string | null, remove: string | null): Promise<void> {
  const actions: Record<string, unknown>[] = []
  if (add) actions.push({ action: 'ACTION_ADD_VIDEO', addedVideoId: add })
  if (remove) actions.push({ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: remove })
  await web('browse/edit_playlist', { playlistId, actions }, 'account')
}

export function notificationMenu(): Promise<JNode> {
  return web('notification/get_notification_menu', { notificationsMenuRequestType: 'NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX' }, 'account')
}

export async function unseenNotificationCount(): Promise<number> {
  const json = await web('notification/get_unseen_count', {}, 'account')
  return json.get('unseenCount').int ?? json.findFirst('unseenCount').int ?? 0
}

export function createComment(text: string, params: string): Promise<JNode> {
  return web('comment/create_comment', { commentText: text, createCommentParams: params }, 'account', false)
}

/** Like / unlike / dislike a comment with the token from its toolbar. */
export function performCommentAction(action: string): Promise<JNode> {
  return web('comment/perform_comment_action', { actions: [action] }, 'account')
}

export function createReply(text: string, params: string): Promise<JNode> {
  return web('comment/create_comment_reply', { commentText: text, createReplyParams: params }, 'account', false)
}

/**
 * Adds a video to the account's YouTube watch history: fetch the signed-in web player response
 * just for its tracking URLs and ping them, the way the website does.
 */
export async function markWatched(videoId: string, duration: number): Promise<void> {
  if (!(await AuthSession.isAuthenticated())) return
  let json: JNode
  try {
    json = await web('player', { videoId, contentCheckOk: true, racyCheckOk: true }, 'account')
  } catch {
    return
  }
  const cpn = randomToken(16)
  const length = String(Math.max((json.at('videoDetails', 'lengthSeconds').double ?? duration) - 1, 1))
  const keys = ['videostatsPlaybackUrl', 'videostatsWatchtimeUrl']
  for (let index = 0; index < keys.length; index++) {
    const base = json.at('playbackTracking', keys[index], 'baseUrl').string
    if (!base) continue
    let url: URL
    try {
      url = new URL(base)
    } catch {
      continue
    }
    for (const name of ['ver', 'cpn', 'cmt', 'el', 'st', 'et']) url.searchParams.delete(name)
    url.searchParams.append('ver', '2')
    url.searchParams.append('cpn', cpn)
    url.searchParams.append('cmt', length)
    url.searchParams.append('el', 'detailpage')
    if (index === 1) {
      url.searchParams.append('st', '0')
      url.searchParams.append('et', length)
    }
    const href = url.toString()
    const auth = await AuthSession.headers(href)
    let status = 0
    try {
      status = (await requestText(href, { headers: auth ?? {}, transport: auth ? 'auth' : 'anon' })).status
    } catch {
      status = 0
    }
    debug(`mark watched ${videoId} ${keys[index]} -> HTTP ${status}`)
  }
}

// MARK: Live chat

export function liveChat(continuation: string): Promise<JNode> {
  return web('live_chat/get_live_chat', { continuation })
}

export function liveChatReplay(continuation: string, offsetMs: number): Promise<JNode> {
  return web('live_chat/get_live_chat_replay', {
    continuation,
    currentPlayerState: { playerOffsetMs: String(Math.max(Math.round(offsetMs), 0)) },
  })
}

export function sendLiveChatMessage(text: string, params: string): Promise<JNode> {
  return web(
    'live_chat/send_message',
    { params, clientMessageId: randomUUID(), richMessage: { textSegments: [{ text }] } },
    'account',
    false,
  )
}

/**
 * The first page of a chat is YouTube's own chat frame (`/live_chat?continuation=`): its
 * `ytInitialData` holds the first messages and the token to keep polling with.
 */
export async function liveChatPage(continuation: string, replay: boolean): Promise<JNode> {
  // Tokens are already URL-encoded ("…%3D"); youtube.com puts them into the URL as is.
  const token = continuation.replace(/[&+# ]/g, (c) => encodeURIComponent(c))
  const path = replay ? 'live_chat_replay' : 'live_chat'
  const url = `https://www.youtube.com/${path}?continuation=${token}&hl=${APIConfig.hl}&gl=${APIConfig.gl}`
  const headers: Record<string, string> = { 'Accept-Language': `${APIConfig.hl},en;q=0.9` }
  const userAgent = resolvedUserAgent(APIConfig.webProfile, APIConfig.gl)
  if (userAgent) headers['User-Agent'] = userAgent
  const auth = await authFor('auto', url)
  if (auth) Object.assign(headers, auth)
  const response = await requestText(url, { headers, transport: auth ? 'auth' : 'anon' })
  debug(`${path} page -> HTTP ${response.status}, ${response.text.length} chars`)
  if (response.status < 200 || response.status > 299) throw Errors.http(response.status)
  const json = initialData(response.text)
  if (!json) throw Errors.invalidResponse()
  return json
}

/**
 * Cuts the `ytInitialData` object out of a YouTube HTML page. It is either a plain object
 * (`ytInitialData = {...}`) or a JS string literal (`ytInitialData = '\x7b...'`).
 */
export function initialData(html: string): JNode | null {
  const marker = 'ytInitialData'
  let searchFrom = 0
  for (;;) {
    const found = html.indexOf(marker, searchFrom)
    if (found < 0) return null
    searchFrom = found + marker.length
    const window = html.slice(searchFrom, searchFrom + 24)
    const brace = window.indexOf('{')
    const quote = window.indexOf("'")
    const open = brace < 0 ? quote : quote < 0 ? brace : Math.min(brace, quote)
    if (open < 0) continue
    const start = searchFrom + open
    if (html[start] === '{') {
      const end = matchingBrace(html, start)
      if (end === null) continue
      try {
        return JNode.parse(html.slice(start, end + 1))
      } catch {
        continue
      }
    } else {
      const text = jsStringLiteral(html, start)
      if (text === null) continue
      try {
        return JNode.parse(text)
      } catch {
        continue
      }
    }
  }
}

function matchingBrace(text: string, start: number): number | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const c = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return index
    }
  }
  return null
}

/** Decodes a single-quoted JS string literal starting at `start` (\xHH, \uHHHH, \n, …). */
function jsStringLiteral(text: string, start: number): string | null {
  let out = ''
  let index = start + 1
  while (index < text.length) {
    const c = text[index++]
    if (c === "'") return out
    if (c !== '\\' || index >= text.length) {
      out += c
      continue
    }
    const escape = text[index++]
    if (escape === 'x' || escape === 'u') {
      const count = escape === 'x' ? 2 : 4
      const hex = text.slice(index, index + count)
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== count) return null
      out += String.fromCharCode(parseInt(hex, 16))
      index += count
    } else if (escape === 'n') out += '\n'
    else if (escape === 't') out += '\t'
    else if (escape === 'r') out += '\r'
    else out += escape
  }
  return null
}
