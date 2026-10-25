// Understands pasted links and `dvdtube://` URLs (youtube.com, youtu.be, music.youtube.com,
// /shorts/, /live/, /embed/, /playlist, /channel/, /@handle, /c/, /user/) and bare ids.
// @handles and custom URLs need YouTube's `navigation/resolve_url`; this module only says so.

import type { ResolvedLink } from '@shared/models'

export type ParsedLink = ResolvedLink | { type: 'resolve'; url: string }

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const PLAYLIST_ID = /^(PL|OLAK5uy_|RD|UU|FL|LL$|WL$)[A-Za-z0-9_-]*$/

/** "90", "90s", "1m30s", "1h2m3s", "1:30" → seconds. */
export function parseStartTime(value: string | null | undefined): number | null {
  if (!value) return null
  const text = value.trim().toLowerCase()
  if (/^\d+(\.\d+)?s?$/.test(text)) return Math.floor(parseFloat(text))
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(text)
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return (parseInt(hms[1] ?? '0', 10) * 3600) + (parseInt(hms[2] ?? '0', 10) * 60) + parseInt(hms[3] ?? '0', 10)
  }
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
    return text.split(':').reduce((total, part) => total * 60 + parseInt(part, 10), 0)
  }
  return null
}

/** A bare string that is almost certainly a video id and not an ordinary 11-letter word. */
export function looksLikeVideoId(text: string): boolean {
  if (!VIDEO_ID.test(text)) return false
  if (/[0-9_-]/.test(text)) return true
  const upper = (text.match(/[A-Z]/g) ?? []).length
  // Real ids mix cases at random; a capitalised word ("Lofihiphops") does not.
  return upper >= 2 || (upper === 1 && !/^[A-Z]/.test(text))
}

function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === 'youtu.be' ||
    h === 'youtube.com' ||
    h.endsWith('.youtube.com') ||
    h === 'youtube-nocookie.com' ||
    h.endsWith('.youtube-nocookie.com')
  )
}

export function parseLink(input: string): ParsedLink | null {
  let text = input.trim()
  if (!text) return null
  if (/^dvdtube:\/\//i.test(text)) {
    if (/^dvdtube:\/\/(tv-login|sync)\b/i.test(text)) return null
    const rest = text.replace(/^dvdtube:\/\//i, '')
    const query = rest.indexOf('?') >= 0 ? rest.slice(rest.indexOf('?') + 1) : ''
    const page = (query ? rest.slice(0, rest.indexOf('?')) : rest).replace(/\/+$/, '').toLowerCase()
    if (page === 'shorts') return { type: 'app', page: 'shorts' }
    if (page === 'music') return { type: 'app', page: 'music' }
    if (page === 'search') {
      const q = new URLSearchParams(query).get('q')?.trim()
      return q ? { type: 'search', query: q } : { type: 'app', page: 'search' }
    }
    text = 'https://www.youtube.com/' + rest
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(text)) {
    text = 'https://' + text
  }

  if (/^https?:\/\//i.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return { type: 'search', query: input.trim() }
    }
    if (!isYouTubeHost(url.hostname)) return { type: 'search', query: input.trim() }
    return parseYouTubeUrl(url)
  }

  if (/\s/.test(text)) return { type: 'search', query: text }
  if (text.startsWith('@') && text.length > 1) return { type: 'resolve', url: 'https://www.youtube.com/' + text }
  if (CHANNEL_ID.test(text)) return { type: 'channel', channelId: text }
  if (looksLikeVideoId(text)) return { type: 'video', videoId: text }
  if (PLAYLIST_ID.test(text) && text.length >= 13) return { type: 'playlist', playlistId: text }
  return { type: 'search', query: text }
}

function parseYouTubeUrl(url: URL): ParsedLink | null {
  const host = url.hostname.toLowerCase()
  const params = url.searchParams
  const parts = url.pathname.split('/').filter((p) => p.length > 0).map((p) => decodeURIComponent(p))
  const start = parseStartTime(params.get('t') ?? params.get('start') ?? params.get('time_continue') ?? hashTime(url.hash))
  const list = params.get('list')

  const video = (id: string | undefined): ParsedLink | null => {
    if (!id || !VIDEO_ID.test(id)) return null
    return { type: 'video', videoId: id, playlistId: list || null, startSeconds: start }
  }

  const v = params.get('v')
  if (v && VIDEO_ID.test(v)) return video(v)
  if (host === 'youtu.be') return video(parts[0])
  const first = parts[0]?.toLowerCase()
  if (first === 'shorts' && parts[1] && VIDEO_ID.test(parts[1])) return { type: 'shorts', videoId: parts[1] }
  if ((first === 'live' || first === 'embed' || first === 'v' || first === 'e') && parts[1]) return video(parts[1])
  if (first === 'watch' && !v && list) return { type: 'playlist', playlistId: list }
  if (first === 'playlist' && list) return { type: 'playlist', playlistId: list }
  if (first === 'channel' && parts[1] && CHANNEL_ID.test(parts[1])) return { type: 'channel', channelId: parts[1] }
  if (first === 'results') {
    const q = params.get('search_query') ?? params.get('q')
    if (q) return { type: 'search', query: q }
  }
  if (first === 'hashtag' && parts[1]) return { type: 'search', query: '#' + parts[1] }
  if (parts[0]?.startsWith('@') || first === 'c' || first === 'user') {
    const path = parts[0].startsWith('@') ? parts[0] : `${parts[0]}/${parts[1] ?? ''}`
    return { type: 'resolve', url: 'https://www.youtube.com/' + path }
  }
  if (first === 'browse' && parts[1]?.startsWith('VL')) return { type: 'playlist', playlistId: parts[1].slice(2) }
  if (parts.length === 0) return null
  // Anything else (old custom URLs "youtube.com/name", …): let YouTube resolve it.
  return { type: 'resolve', url: `https://www.youtube.com${url.pathname}${url.search}` }
}

function hashTime(hash: string): string | null {
  const match = /[#&]t=([^&]+)/.exec(hash)
  return match ? match[1] : null
}
