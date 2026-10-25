// The local stream relay of the TV app. The TV's native <video> plays HLS, but googlevideo wants
// the User-Agent of the InnerTube client the stream was issued to (VISIONOS…), which a <video>
// element cannot set. So every playlist is fetched here and every URI in it is rewritten to
// `http://127.0.0.1:<port>/hls/…?u=<base64url(upstream)>&k=<token>`; segments are streamed
// through with the right headers (the same idea as the iOS Chromecast relay, CastProxy.swift).
//
// - Master playlists: variants filtered to H.264 (+ AAC) when there are any (every LG TV decodes
//   them) and to ≤ the chosen quality ("Tự động" = all of them); in each audio group only the
//   chosen language's rendition is kept (else the default one), I-frame playlists are dropped.
// - Media playlists: segment, #EXT-X-MAP and #EXT-X-KEY URIs point at the relay.
// - Progressive files (the muxed MP4 fallback, itag 18, and audio-only M4A for music) are served
//   with Range support, fetched from googlevideo in bounded `range=` chunks (full speed).

import * as http from 'http'
import * as https from 'https'
import { APIConfig, resolvedUserAgent } from '../../../windows/src/main/core/clients'
import { debug } from '../../../windows/src/main/core/config'
import { nodeFetch } from './fetcher'

// MARK: Proxy URLs

export interface RelayContext {
  /** Port of the local server (127.0.0.1). */
  port: number
  /** Random token of this service run; required on every request. */
  token: string
  /** Upstream hosts the relay may fetch (googlevideo / youtube.com; tests add 127.0.0.1). */
  allowHost?: (host: string, protocol: string) => boolean
}

export type RelayKind = 'master' | 'playlist' | 'segment' | 'media'

export function encodeTarget(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeTarget(value: string | null | undefined): string | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null
  try {
    const text = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return /^https?:\/\//i.test(text) ? text : null
  } catch {
    return null
  }
}

const PATHS: Record<RelayKind, string> = {
  master: '/hls/master.m3u8',
  playlist: '/hls/playlist.m3u8',
  segment: '/hls/segment',
  media: '/media',
}

export function relayUrl(ctx: RelayContext, kind: RelayKind, target: string, extra: Record<string, string | number | null | undefined> = {}): string {
  let query = `k=${encodeURIComponent(ctx.token)}&u=${encodeTarget(target)}`
  for (const key of Object.keys(extra)) {
    const value = extra[key]
    if (value === null || value === undefined || value === '') continue
    query += `&${key}=${encodeURIComponent(String(value))}`
  }
  return `http://127.0.0.1:${ctx.port}${PATHS[kind]}?${query}`
}

export function defaultAllowHost(host: string, protocol: string): boolean {
  if (protocol !== 'https:') return false
  const h = host.toLowerCase()
  return h.endsWith('.googlevideo.com') || h === 'youtube.com' || h.endsWith('.youtube.com')
}

// MARK: Playlist parsing

/** `KEY=VALUE,KEY="quoted, value"` of an #EXT-X tag. */
export function parseAttributes(line: string): Record<string, string> {
  const colon = line.indexOf(':')
  const text = colon >= 0 ? line.slice(colon + 1) : ''
  const out: Record<string, string> = {}
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const raw = match[2]
    out[match[1]] = raw.startsWith('"') ? raw.slice(1, -1) : raw
  }
  return out
}

function setAttribute(line: string, name: string, value: string, quoted: boolean): string {
  const formatted = quoted ? `"${value}"` : value
  const re = new RegExp(`([:,])${name}=("[^"]*"|[^,]*)`)
  if (re.test(line)) return line.replace(re, `$1${name}=${formatted}`)
  return `${line},${name}=${formatted}`
}

export interface Variant {
  /** Index of the #EXT-X-STREAM-INF line. */
  index: number
  uri: string
  bandwidth: number
  codecs: string
  width: number | null
  height: number | null
  /** The shorter side (quality label: 1080 for 1920×1080 and 1080×1920). */
  quality: number | null
  fps: number | null
  audioGroup: string | null
}

export interface AudioRendition {
  index: number
  groupId: string
  name: string
  language: string | null
  isDefault: boolean
  uri: string | null
}

export interface MasterInfo {
  isMaster: boolean
  variants: Variant[]
  audio: AudioRendition[]
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function resolveUri(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString()
  } catch {
    return uri
  }
}

export function analyzeMaster(text: string, base: string): MasterInfo {
  const list = lines(text)
  const variants: Variant[] = []
  const audio: AudioRendition[] = []
  for (let i = 0; i < list.length; i++) {
    const line = list[i]
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const a = parseAttributes(line)
      let uri = ''
      for (let j = i + 1; j < list.length; j++) {
        if (!list[j].startsWith('#')) {
          uri = resolveUri(list[j], base)
          break
        }
        if (list[j].startsWith('#EXT-X-STREAM-INF')) break
      }
      const res = /^(\d+)x(\d+)$/.exec(a['RESOLUTION'] ?? '')
      const width = res ? parseInt(res[1], 10) : null
      const height = res ? parseInt(res[2], 10) : null
      variants.push({
        index: i,
        uri,
        bandwidth: parseInt(a['BANDWIDTH'] ?? a['AVERAGE-BANDWIDTH'] ?? '0', 10) || 0,
        codecs: a['CODECS'] ?? '',
        width,
        height,
        quality: width !== null && height !== null ? Math.min(width, height) : null,
        fps: a['FRAME-RATE'] ? Math.round(parseFloat(a['FRAME-RATE'])) : null,
        audioGroup: a['AUDIO'] ?? null,
      })
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttributes(line)
      if (a['TYPE'] !== 'AUDIO') continue
      audio.push({
        index: i,
        groupId: a['GROUP-ID'] ?? '',
        name: a['NAME'] ?? a['LANGUAGE'] ?? 'Âm thanh',
        language: a['LANGUAGE'] ?? null,
        isDefault: a['DEFAULT'] === 'YES',
        uri: a['URI'] ? resolveUri(a['URI'], base) : null,
      })
    }
  }
  return { isMaster: variants.length > 0, variants, audio }
}

const AVC = /avc1|avc3/i
const OTHER_VIDEO = /vp09|vp9|vp8|av01|hvc1|hev1|dvh1|dvhe/i

function isAvc(v: Variant): boolean {
  return AVC.test(v.codecs) && !OTHER_VIDEO.test(v.codecs)
}

function isAvcAac(v: Variant): boolean {
  // No audio codec listed: the sound is in an EXT-X-MEDIA group (or muxed AAC).
  return isAvc(v) && (/mp4a/i.test(v.codecs) || !v.codecs.includes(','))
}

/** The variants every LG TV decodes: H.264 with AAC, else H.264, else everything. */
export function playableVariants(info: MasterInfo): Variant[] {
  const avcAac = info.variants.filter(isAvcAac)
  if (avcAac.length > 0) return avcAac
  const avc = info.variants.filter(isAvc)
  return avc.length > 0 ? avc : info.variants
}

/** Variants at or below `maxQuality` (0 = all); never empty when there are variants. */
export function variantsUpTo(variants: Variant[], maxQuality: number): Variant[] {
  if (!maxQuality || maxQuality <= 0) return variants
  const fitting = variants.filter((v) => v.quality === null || v.quality <= maxQuality)
  if (fitting.length > 0) return fitting
  const lowest = Math.min(...variants.map((v) => v.quality ?? Number.MAX_SAFE_INTEGER))
  return variants.filter((v) => (v.quality ?? Number.MAX_SAFE_INTEGER) === lowest)
}

/** Distinct qualities (shorter side, highest first) the TV can choose from. */
export function qualitiesOf(info: MasterInfo): number[] {
  const set = new Set<number>()
  for (const v of playableVariants(info)) if (v.quality) set.add(v.quality)
  return Array.from(set).sort((a, b) => b - a)
}

export interface AudioTrackOption {
  /** Language code (or the rendition name when there is none). */
  id: string
  name: string
  language: string | null
  isDefault: boolean
}

/** The audio languages of a master playlist (one entry per language). */
export function audioTracksOf(info: MasterInfo): AudioTrackOption[] {
  const out: AudioTrackOption[] = []
  for (const r of info.audio) {
    const id = r.language || r.name
    const existing = out.find((t) => t.id === id)
    if (existing) {
      existing.isDefault = existing.isDefault || r.isDefault
      continue
    }
    out.push({ id, name: r.name, language: r.language, isDefault: r.isDefault })
  }
  return out
}

function languageMatches(rendition: AudioRendition, wanted: string): boolean {
  const lang = (rendition.language ?? '').toLowerCase()
  const w = wanted.toLowerCase()
  if (!lang) return rendition.name.toLowerCase() === w
  return lang === w || lang.split('-')[0] === w.split('-')[0]
}

/** The rendition kept in each audio group. */
export function chooseAudio(info: MasterInfo, language: string | null | undefined): Map<string, AudioRendition> {
  const chosen = new Map<string, AudioRendition>()
  const groups = new Map<string, AudioRendition[]>()
  for (const r of info.audio) groups.set(r.groupId, [...(groups.get(r.groupId) ?? []), r])
  groups.forEach((list, group) => {
    const wanted = language ? list.find((r) => languageMatches(r, language)) : undefined
    chosen.set(group, wanted ?? list.find((r) => r.isDefault) ?? list[0])
  })
  return chosen
}

export interface MasterOptions {
  /** Highest quality (shorter side); 0 = "Tự động". */
  maxQuality: number
  /** Preferred audio language ("Bản âm thanh"); null = the default track. */
  audioLanguage: string | null
}

export type UriMapper = (absolute: string, kind: 'playlist' | 'segment') => string

/** Rewrites a master playlist for the TV (see the file comment). */
export function rewriteMaster(text: string, base: string, options: MasterOptions, map: UriMapper): string {
  const info = analyzeMaster(text, base)
  if (!info.isMaster) return rewriteMedia(text, base, map)
  const keep = new Set(variantsUpTo(playableVariants(info), options.maxQuality).map((v) => v.index))
  const audio = chooseAudio(info, options.audioLanguage)
  const keptAudio = new Set(Array.from(audio.values()).map((r) => r.index))
  const list = lines(text)
  const out: string[] = []
  let skipUri = false
  for (let i = 0; i < list.length; i++) {
    let line = list[i]
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) continue
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        if (!keep.has(i)) {
          skipUri = true
          continue
        }
        skipUri = false
        out.push(line)
        continue
      }
      if (line.startsWith('#EXT-X-MEDIA:') && parseAttributes(line)['TYPE'] === 'AUDIO') {
        if (!keptAudio.has(i)) continue
        line = setAttribute(setAttribute(line, 'DEFAULT', 'YES', false), 'AUTOSELECT', 'YES', false)
      }
      out.push(rewriteUriAttribute(line, base, line.startsWith('#EXT-X-MEDIA:') ? 'playlist' : 'segment', map))
      continue
    }
    if (skipUri) {
      skipUri = false
      continue
    }
    out.push(map(resolveUri(line, base), 'playlist'))
  }
  return out.join('\n') + '\n'
}

function rewriteUriAttribute(line: string, base: string, kind: 'playlist' | 'segment', map: UriMapper): string {
  return line.replace(/URI="([^"]*)"/, (_whole, uri: string) => `URI="${map(resolveUri(uri, base), kind)}"`)
}

/** Points the segments (and #EXT-X-MAP / #EXT-X-KEY) of a media playlist at the relay. */
export function rewriteMedia(text: string, base: string, map: UriMapper): string {
  const out: string[] = []
  for (const line of lines(text)) {
    if (line.startsWith('#')) {
      if (line.startsWith('#EXT-X-MAP') || line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-PART') || line.startsWith('#EXT-X-PRELOAD-HINT')) {
        out.push(rewriteUriAttribute(line, base, 'segment', map))
      } else {
        out.push(line)
      }
    } else {
      out.push(map(resolveUri(line, base), 'segment'))
    }
  }
  return out.join('\n') + '\n'
}

// MARK: Headers for googlevideo

/** The user agent of the client a googlevideo URL was issued to (`c=VISIONOS`, `/c/VISIONOS/`). */
export function streamUserAgent(url: string): string | null {
  try {
    const parsed = new URL(url)
    const client = parsed.searchParams.get('c') ?? (/\/c\/([A-Za-z_]+)(?:\/|$)/.exec(parsed.pathname) ?? [])[1]
    if (!client) return null
    const profile = APIConfig.allProfiles().find((p) => p.name.toUpperCase() === client.toUpperCase())
    return profile ? resolvedUserAgent(profile, APIConfig.gl) : null
  } catch {
    return null
  }
}

export function upstreamHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: '*/*', 'Accept-Language': `${APIConfig.hl},en;q=0.8` }
  const ua = streamUserAgent(url)
  headers['User-Agent'] = ua ?? 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36'
  // Browser clients (WEB) want the website as origin; app clients send none.
  if (!ua || ua.startsWith('Mozilla/')) {
    headers['Origin'] = 'https://www.youtube.com'
    headers['Referer'] = 'https://www.youtube.com/'
  }
  return headers
}

// MARK: Serving

const PLAYLIST_TYPE = 'application/vnd.apple.mpegurl'

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
  }
}

function sendStatus(res: http.ServerResponse, status: number, message = ''): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const body = Buffer.from(message, 'utf8')
  res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
  res.end(body)
}

/** A short-lived cache of master playlists (stream() reads it once to list qualities). */
const masterCache = new Map<string, { at: number; text: string; finalUrl: string }>()

export async function fetchPlaylist(url: string): Promise<{ status: number; text: string; finalUrl: string }> {
  const cached = masterCache.get(url)
  if (cached && Date.now() - cached.at < 20_000) return { status: 200, text: cached.text, finalUrl: cached.finalUrl }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await nodeFetch(url, { headers: upstreamHeaders(url), maxRedirects: 4 })
      const text = await response.text()
      if (response.status >= 500 && attempt === 0) continue
      if (response.status === 200 && text.includes('#EXTM3U') && text.includes('#EXT-X-STREAM-INF')) {
        if (masterCache.size > 20) masterCache.clear()
        masterCache.set(url, { at: Date.now(), text, finalUrl: response.url })
      }
      return { status: response.status, text, finalUrl: response.url }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('playlist failed')
}

function allowed(ctx: RelayContext, target: string): boolean {
  try {
    const u = new URL(target)
    return (ctx.allowHost ?? defaultAllowHost)(u.hostname, u.protocol)
  } catch {
    return false
  }
}

let servedSegments = 0

/** `GET /hls/master.m3u8`, `/hls/playlist.m3u8`, `/hls/segment`, `/media` (query already parsed). */
export async function serveRelay(ctx: RelayContext, kind: RelayKind, query: URLSearchParams, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const target = decodeTarget(query.get('u'))
  if (!target) return sendStatus(res, 400, 'bad target')
  if (!allowed(ctx, target)) return sendStatus(res, 403, 'host not allowed')
  if (kind === 'master' || kind === 'playlist') {
    let upstream: { status: number; text: string; finalUrl: string }
    try {
      upstream = await fetchPlaylist(target)
    } catch (error) {
      debug(`relay: playlist upstream failed (${error instanceof Error ? error.message : String(error)})`)
      return sendStatus(res, 502, 'upstream failed')
    }
    if (upstream.status !== 200) {
      debug(`relay: playlist upstream -> HTTP ${upstream.status}`)
      return sendStatus(res, upstream.status >= 400 ? upstream.status : 502, 'upstream status')
    }
    const map: UriMapper = (absolute, childKind) => relayUrl(ctx, childKind, absolute)
    const base = upstream.finalUrl || target
    const body =
      kind === 'master'
        ? rewriteMaster(upstream.text, base, { maxQuality: parseInt(query.get('q') ?? '0', 10) || 0, audioLanguage: query.get('a') || null }, map)
        : rewriteMedia(upstream.text, base, map)
    const bytes = Buffer.from(body, 'utf8')
    res.writeHead(200, { ...corsHeaders(), 'Content-Type': PLAYLIST_TYPE, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : bytes)
    return
  }
  const total = parseInt(query.get('len') ?? '', 10)
  if (kind === 'media' && Number.isFinite(total) && total > 0) {
    return serveChunked(target, total, query.get('t') || 'video/mp4', req, res)
  }
  return pipeUpstream(target, req, res, query.get('t'))
}

// MARK: Streaming upstream

interface UpstreamResponse {
  status: number
  headers: http.IncomingHttpHeaders
  stream: http.IncomingMessage
  request: http.ClientRequest
}

const agent = new https.Agent({ keepAlive: true, maxSockets: 12 })
const plainAgent = new http.Agent({ keepAlive: true, maxSockets: 12 })

/** Opens an upstream GET (following redirects); resolves once the headers arrived. */
export function openUpstream(target: string, headers: Record<string, string>, redirects = 4): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      reject(new Error('bad url'))
      return
    }
    const isHttps = parsed.protocol === 'https:'
    const request = (isHttps ? https : http).request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { ...headers, 'Accept-Encoding': 'identity' },
        agent: isHttps ? agent : plainAgent,
      },
      (response) => {
        const status = response.statusCode ?? 502
        const location = response.headers.location
        if (status >= 300 && status < 400 && location && redirects > 0) {
          response.resume()
          let next: string
          try {
            next = new URL(location, target).toString()
          } catch {
            reject(new Error('bad redirect'))
            return
          }
          openUpstream(next, headers, redirects - 1).then(resolve, reject)
          return
        }
        resolve({ status, headers: response.headers, stream: response, request })
      },
    )
    request.setTimeout(20_000, () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.end()
  })
}

function mediaType(head: Buffer): string | null {
  if (head.length < 8) return null
  if (head[0] === 0x47) return 'video/mp2t'
  if (head[0] === 0xff && (head[1] & 0xf0) === 0xf0) return 'audio/aac'
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return 'audio/aac'
  const box = head.toString('latin1', 4, 8)
  if (['ftyp', 'styp', 'moof', 'sidx', 'moov'].indexOf(box) >= 0) return 'video/mp4'
  return null
}

/** Streams one upstream resource to the TV (one retry before anything was sent). */
async function pipeUpstream(target: string, req: http.IncomingMessage, res: http.ServerResponse, type: string | null): Promise<void> {
  const headers = upstreamHeaders(target)
  const range = req.headers.range
  if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) headers['Range'] = range
  let closed = false
  req.on('close', () => {
    closed = true
  })
  let upstream: UpstreamResponse | null = null
  for (let attempt = 0; attempt < 2 && !closed; attempt++) {
    try {
      upstream = await openUpstream(target, headers)
      if (upstream.status >= 500 && attempt === 0) {
        upstream.stream.resume()
        upstream = null
        continue
      }
      break
    } catch (error) {
      if (attempt === 1) debug(`relay: segment upstream failed (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  if (closed) {
    upstream?.request.destroy()
    return
  }
  if (!upstream) return sendStatus(res, 502, 'upstream failed')
  const { status, stream } = upstream
  servedSegments++
  if (status >= 400 || servedSegments <= 3) debug(`relay: segment -> HTTP ${status}`)
  if (status >= 400) {
    stream.resume()
    return sendStatus(res, status, 'upstream status')
  }
  const out: Record<string, string> = { ...corsHeaders(), 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' }
  const length = upstream.headers['content-length']
  if (length) out['Content-Length'] = String(length)
  const contentRange = upstream.headers['content-range']
  if (contentRange) out['Content-Range'] = String(contentRange)
  const upstreamType = upstream.headers['content-type']
  const finish = (contentType: string, first: Buffer | null) => {
    out['Content-Type'] = contentType
    res.writeHead(status, out)
    if (req.method === 'HEAD') {
      stream.resume()
      upstream?.request.destroy()
      res.end()
      return
    }
    if (first) res.write(first)
    stream.pipe(res)
  }
  // googlevideo answers "application/octet-stream" for HLS segments; the TV's player is happier
  // with the real container type, sniffed from the first bytes.
  if (type) return finish(type, null)
  if (upstreamType && !/octet-stream/i.test(String(upstreamType))) return finish(String(upstreamType), null)
  stream.once('data', (chunk: Buffer) => {
    stream.pause()
    finish(mediaType(chunk) ?? 'video/mp2t', chunk)
    stream.resume()
  })
  stream.once('end', () => {
    if (!res.headersSent) finish('application/octet-stream', null)
  })
  stream.on('error', () => res.destroy())
  res.on('close', () => upstream?.request.destroy())
}

export const CHUNK_BYTES = 4 * 1024 * 1024
let chunkBytes = CHUNK_BYTES

/** Tests: smaller `range=` chunks. */
export function setChunkBytes(bytes: number): void {
  chunkBytes = bytes > 0 ? bytes : CHUNK_BYTES
}

/** `bytes=a-b` / `bytes=a-` / `bytes=-n` within a file of `total` bytes. */
export function parseRange(header: string | undefined, total: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  let start: number
  let end: number
  if (m[1] === '') {
    const suffix = parseInt(m[2], 10)
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = parseInt(m[1], 10)
    end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1)
  }
  if (start >= total || end < start) return 'invalid'
  return { start, end }
}

export function withRangeParam(url: string, start: number, end: number): string {
  const u = new URL(url)
  u.searchParams.delete('range')
  u.searchParams.set('range', `${start}-${end}`)
  return u.toString()
}

/** A progressive file of known size, answered with Range support from `range=` chunks. */
async function serveChunked(target: string, total: number, type: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, total)
  if (range === 'invalid') {
    res.writeHead(416, { ...corsHeaders(), 'Content-Range': `bytes */${total}` })
    res.end()
    return
  }
  const start = range ? range.start : 0
  const end = range ? range.end : total - 1
  const headers: Record<string, string> = {
    ...corsHeaders(),
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'no-store',
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${total}`
  if (req.method === 'HEAD') {
    res.writeHead(range ? 206 : 200, headers)
    res.end()
    return
  }
  let closed = false
  let current: UpstreamResponse | null = null
  res.on('close', () => {
    closed = true
    current?.request.destroy()
  })
  let position = start
  let headSent = false
  let failures = 0
  while (position <= end && !closed) {
    const chunkEnd = Math.min(position + chunkBytes - 1, end)
    let opened: UpstreamResponse | null = null
    for (let attempt = 0; attempt < 3 && !closed && !opened; attempt++) {
      try {
        const candidate = await openUpstream(withRangeParam(target, position, chunkEnd), upstreamHeaders(target))
        if (candidate.status === 200 || candidate.status === 206) opened = candidate
        else {
          debug(`relay: media chunk -> HTTP ${candidate.status}`)
          candidate.stream.resume()
          if (candidate.status === 403 || candidate.status === 404 || candidate.status === 410) break
        }
      } catch (error) {
        debug(`relay: media chunk failed (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    if (closed) return
    if (!opened) {
      if (!headSent) sendStatus(res, 502, 'upstream failed')
      else res.destroy()
      return
    }
    if (!headSent) {
      res.writeHead(range ? 206 : 200, headers)
      headSent = true
    }
    current = opened
    const expected = chunkEnd - position + 1
    const received = await new Promise<number>((resolve) => {
      const upstream = opened!
      const stream = upstream.stream
      let count = 0
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve(count)
      }
      stream.on('data', (chunk: Buffer) => {
        if (done) return
        let piece = chunk
        if (count + piece.length > expected) piece = piece.subarray(0, expected - count)
        count += piece.length
        if (piece.length && !res.write(piece)) {
          stream.pause()
          res.once('drain', () => stream.resume())
        }
        // An upstream that ignored `range=` sends more than asked for: stop at the chunk's end.
        if (count >= expected) {
          upstream.request.destroy()
          finish()
        }
      })
      stream.on('end', finish)
      stream.on('error', finish)
      stream.on('aborted', finish)
      stream.on('close', finish)
    })
    position += received
    if (received < expected) {
      failures++
      if (failures > 3) {
        res.destroy()
        return
      }
    }
  }
  if (!closed) res.end()
}
