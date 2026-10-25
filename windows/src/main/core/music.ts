// "Nghe nhạc" and "Lời bài hát" through YouTube Music's InnerTube client (WEB_REMIX, id 67) on
// music.youtube.com: same hl / gl, visitor id and signed-in headers as the web client, with the
// SAPISIDHASH computed for https://music.youtube.com.

import type { Lyrics, MusicBrowsePage, MusicSearchKind, MusicSearchPage } from '@shared/models'
import { APIConfig, MUSIC_ORIGIN } from './clients'
import { debug } from './config'
import { describeError } from './errors'
import { cachedVisitor, post, storeVisitor, type AuthMode } from './innertube'
import type { JNode } from './json'
import { lyricsBrowseId, parseLyrics, parseMusicBrowse, parseMusicSearch } from './parsers/music'

export const MUSIC_SEARCH_PARAMS: Record<MusicSearchKind, string> = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D',
  playlists: 'EgeKAQQoAEABagoQAxAEEAoQCRAF',
}

export async function music(endpoint: string, body: Record<string, unknown>, options: { auth?: AuthMode; query?: Record<string, string> } = {}): Promise<JNode> {
  const profile = APIConfig.musicProfile
  const visitor = cachedVisitor(profile.name) ?? cachedVisitor(APIConfig.webProfile.name)
  const json = await post(endpoint, profile, body, { visitorData: visitor, auth: options.auth ?? 'auto', origin: MUSIC_ORIGIN, query: options.query })
  if (!cachedVisitor(profile.name)) {
    const fresh = json.at('responseContext', 'visitorData').string
    if (fresh) storeVisitor(profile.name, fresh)
  }
  return json
}

const lyricsCache = new Map<string, { at: number; value: Lyrics | null }>()

/** Lyrics of a song (null = YouTube Music has none). Cached per video. */
export async function lyrics(videoId: string): Promise<Lyrics | null> {
  const cached = lyricsCache.get(videoId)
  if (cached && (cached.value || Date.now() - cached.at < 30 * 60_000)) return cached.value
  const next = await music('next', { videoId, isAudioOnly: true })
  const browseId = lyricsBrowseId(next)
  let value: Lyrics | null = null
  if (browseId) {
    try {
      value = parseLyrics(await music('browse', { browseId }), videoId)
    } catch (error) {
      debug(`lyrics browse failed: ${describeError(error)}`)
      throw error
    }
  }
  if (lyricsCache.size > 300) lyricsCache.clear()
  lyricsCache.set(videoId, { at: Date.now(), value })
  return value
}

export async function musicSearch(query: string, kind: MusicSearchKind, continuation?: string | null): Promise<MusicSearchPage> {
  if (continuation) {
    const json = await music('search', {}, { query: { ctoken: continuation, continuation, type: 'next' } })
    return parseMusicSearch(json, kind)
  }
  const json = await music('search', { query, params: MUSIC_SEARCH_PARAMS[kind] })
  return parseMusicSearch(json, kind)
}

export async function musicBrowse(browseId: string): Promise<MusicBrowsePage> {
  return parseMusicBrowse(await music('browse', { browseId }), browseId)
}
