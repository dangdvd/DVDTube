// YouTube Music (WEB_REMIX) responses: lyrics, search shelves (musicShelfRenderer →
// musicResponsiveListItemRenderer), album / artist / playlist pages (shelves and carousels).

import { parseDuration, type LyricLine, type Lyrics, type MusicBrowsePage, type MusicItem, type MusicSearchKind, type MusicShelf, type VideoItem } from '@shared/models'
import { JNode, youtubeImage } from '../json'

// MARK: Lyrics

/** The browse id of the "Lời bài hát" tab of the `next` response (MPLYt…), if any. */
export function lyricsBrowseId(next: JNode): string | null {
  for (const tab of next.findAll('tabRenderer')) {
    const id = tab.at('endpoint', 'browseEndpoint', 'browseId').string
    if (id && id.startsWith('MPLYt')) return id
  }
  return null
}

/** Any `lines[*]` with `lyricLine` + `cueRange.startTimeMilliseconds` (timed lyrics). */
export function timedLines(json: JNode): LyricLine[] | null {
  for (const lines of json.findAll('lines')) {
    const parsed: LyricLine[] = []
    for (const line of lines.array) {
      const text = line.get('lyricLine').text ?? line.get('lyricLine').string
      const start = line.at('cueRange', 'startTimeMilliseconds').double
      if (text === null || start === null) continue
      parsed.push({ startMs: start, endMs: line.at('cueRange', 'endTimeMilliseconds').double, text })
    }
    if (parsed.length > 0) return parsed.sort((a, b) => a.startMs - b.startMs)
  }
  return null
}

export function parseLyrics(browse: JNode, videoId: string): Lyrics | null {
  let text: string | null = null
  let source: string | null = null
  for (const section of browse.at('contents', 'sectionListRenderer', 'contents').array) {
    const shelf = section.get('musicDescriptionShelfRenderer')
    if (!shelf.exists) continue
    text = shelf.get('description').text
    source = shelf.get('footer').text
    if (text) break
  }
  if (!text) {
    const shelf = browse.findFirst('musicDescriptionShelfRenderer')
    text = shelf.get('description').text
    source = source ?? shelf.get('footer').text
  }
  const lines = timedLines(browse)
  if (!text && lines) text = lines.map((l) => l.text).join('\n')
  if (!text || !text.trim()) return null
  return { videoId, text: text.replace(/\r\n/g, '\n').trim(), source: source?.trim() || null, lines }
}

// MARK: Items

const TYPE_WORDS = new Set([
  'bài hát',
  'song',
  'video',
  'album',
  'đĩa đơn',
  'single',
  'ep',
  'nghệ sĩ',
  'artist',
  'danh sách phát',
  'playlist',
  'tập',
  'episode',
  'podcast',
])

/** Bigger square artwork (lh3 / yt3 URLs carry their size as `=w120-h120…`). */
export function artwork(url: string | null): string | null {
  if (!url) return null
  const full = youtubeImage(url)
  if (/googleusercontent\.com|ggpht\.com/.test(full)) return full.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544-l90-rj')
  return full
}

function pageTypeOf(endpoint: JNode): string {
  return endpoint.at('browseEndpoint', 'browseEndpointContextSupportedConfigs', 'browseEndpointContextMusicConfig', 'pageType').string ?? ''
}

function typeFromPage(pageType: string, browseId: string): MusicItem['type'] | null {
  if (pageType.includes('ARTIST') || browseId.startsWith('UC')) return 'artist'
  if (pageType.includes('ALBUM') || browseId.startsWith('MPRE')) return 'album'
  if (pageType.includes('PLAYLIST') || browseId.startsWith('VL')) return 'playlist'
  return null
}

function runsOf(node: JNode): JNode[] {
  return node.get('runs').array
}

function videoOf(item: MusicItem, artistId: string | null): VideoItem | null {
  if (item.type !== 'song' && item.type !== 'video') return null
  return {
    id: item.id,
    title: item.title,
    channelName: item.artists ?? null,
    channelId: artistId,
    thumbnail: item.thumbnail ?? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    durationText: item.durationText ?? null,
    durationSeconds: parseDuration(item.durationText),
  }
}

interface SubtitleParts {
  subtitle: string | null
  artists: string | null
  artistId: string | null
  album: string | null
  albumId: string | null
  duration: string | null
}

function subtitleParts(runs: JNode[]): SubtitleParts {
  const texts: string[] = []
  const artists: string[] = []
  let artistId: string | null = null
  let album: string | null = null
  let albumId: string | null = null
  let duration: string | null = null
  runs.forEach((run, index) => {
    const text = run.get('text').string ?? ''
    const endpoint = run.get('navigationEndpoint')
    const browseId = endpoint.at('browseEndpoint', 'browseId').string ?? ''
    const type = typeFromPage(pageTypeOf(endpoint), browseId)
    if (type === 'artist') {
      artists.push(text)
      artistId ??= browseId
    } else if (type === 'album') {
      album = text
      albumId = browseId
    } else if (/^\d+(:\d{2}){1,2}$/.test(text.trim())) {
      duration = text.trim()
    }
    // A leading "Bài hát" / "Video" type word (unfiltered results) is not part of the subtitle.
    if (index === 0 && !endpoint.exists && TYPE_WORDS.has(text.trim().toLowerCase())) return
    texts.push(text)
  })
  const subtitle = texts.join('').replace(/^\s*•\s*/, '').trim() || null
  // Unlinked artist names ("Various Artists") sit before the first "•".
  const unlinked = artists.length === 0 && subtitle ? subtitle.split(' • ')[0] : null
  return { subtitle, artists: artists.length ? artists.join(', ') : unlinked, artistId, album, albumId, duration }
}

/** One row of a music shelf. `kind` is the search tab the row came from (when known). */
export function listItem(r: JNode, kind?: MusicSearchKind | null, fallbackThumbnail?: string | null, fallbackArtist?: string | null): MusicItem | null {
  const columns = r.get('flexColumns').array.map((c) => c.at('musicResponsiveListItemFlexColumnRenderer', 'text'))
  const title = columns[0]?.text?.trim()
  if (!title) return null
  const titleRun = columns[0] ? runsOf(columns[0])[0] : undefined
  const watch = titleRun?.at('navigationEndpoint', 'watchEndpoint') ?? JNode.EMPTY
  const overlayWatch = r.at('overlay', 'musicItemThumbnailOverlayRenderer', 'content', 'musicPlayButtonRenderer', 'playNavigationEndpoint', 'watchEndpoint')
  const videoId = r.at('playlistItemData', 'videoId').string ?? watch.get('videoId').string ?? overlayWatch.get('videoId').string
  const endpoint = r.get('navigationEndpoint')
  const browseId = endpoint.at('browseEndpoint', 'browseId').string
  const parts = subtitleParts(columns.slice(1).flatMap((c) => runsOf(c).length ? [...runsOf(c), new JNode({ text: ' • ' })] : []).slice(0, -1))
  const fixed = r.get('fixedColumns').array.map((c) => c.at('musicResponsiveListItemFixedColumnRenderer', 'text').text?.trim()).find((t) => t && /^\d+(:\d{2}){1,2}$/.test(t))
  const thumbnail = artwork(r.at('thumbnail', 'musicThumbnailRenderer', 'thumbnail').bestImageUrl) ?? fallbackThumbnail ?? null
  const musicVideoType = (watch.exists ? watch : overlayWatch).at('watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType').string ?? ''

  let type: MusicItem['type']
  let id: string
  if (videoId && (!browseId || kind === 'songs' || kind === 'videos')) {
    type = kind === 'videos' || /OMV|UGC|OFFICIAL_SOURCE_MUSIC/.test(musicVideoType) ? 'video' : 'song'
    id = videoId
  } else if (browseId) {
    type = typeFromPage(pageTypeOf(endpoint), browseId) ?? (kind === 'artists' ? 'artist' : kind === 'albums' ? 'album' : 'playlist')
    id = browseId
  } else {
    return null
  }
  const item: MusicItem = {
    type,
    id,
    title,
    subtitle: parts.subtitle,
    artists: parts.artists ?? fallbackArtist ?? null,
    album: parts.album,
    durationText: fixed ?? parts.duration,
    thumbnail,
    playlistId: watch.get('playlistId').string ?? overlayWatch.get('playlistId').string ?? null,
  }
  item.video = videoOf(item, parts.artistId)
  return item
}

/** A tile of a carousel (albums, singles, videos, related artists…). */
export function twoRowItem(r: JNode): MusicItem | null {
  const title = r.get('title').text?.trim()
  if (!title) return null
  const endpoint = r.get('navigationEndpoint')
  const browseId = endpoint.at('browseEndpoint', 'browseId').string
  const watch = endpoint.get('watchEndpoint')
  const parts = subtitleParts(runsOf(r.get('subtitle')))
  const thumbnail = artwork(r.at('thumbnailRenderer', 'musicThumbnailRenderer', 'thumbnail').bestImageUrl)
  let item: MusicItem
  if (watch.get('videoId').string) {
    item = { type: 'video', id: watch.get('videoId').string!, title, subtitle: parts.subtitle, artists: parts.artists, thumbnail, playlistId: watch.get('playlistId').string }
  } else if (browseId) {
    item = { type: typeFromPage(pageTypeOf(endpoint), browseId) ?? 'playlist', id: browseId, title, subtitle: parts.subtitle, artists: parts.artists, thumbnail }
  } else {
    return null
  }
  item.video = videoOf(item, parts.artistId)
  return item
}

function shelfItems(contents: JNode[], kind?: MusicSearchKind | null, fallbackThumbnail?: string | null, fallbackArtist?: string | null): MusicItem[] {
  const items: MusicItem[] = []
  for (const entry of contents) {
    const row = entry.get('musicResponsiveListItemRenderer')
    const tile = entry.get('musicTwoRowItemRenderer')
    const item = row.exists ? listItem(row, kind, fallbackThumbnail, fallbackArtist) : tile.exists ? twoRowItem(tile) : null
    if (item) items.push(item)
  }
  return items
}

// MARK: Search

export function parseMusicSearch(json: JNode, kind: MusicSearchKind): { items: MusicItem[]; continuation: string | null } {
  const shelves = [...json.findAll('musicShelfRenderer'), ...json.findAll('musicShelfContinuation')]
  const items: MusicItem[] = []
  const seen = new Set<string>()
  for (const shelf of shelves) {
    for (const item of shelfItems(shelf.get('contents').array, kind)) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }
  const continuation =
    json.findFirst('nextContinuationData').get('continuation').string ??
    json.findFirst('continuationCommand').get('token').string ??
    null
  return { items, continuation }
}

// MARK: Browse (album, artist, playlist)

function headerOf(json: JNode): JNode {
  for (const key of ['musicResponsiveHeaderRenderer', 'musicDetailHeaderRenderer', 'musicImmersiveHeaderRenderer', 'musicVisualHeaderRenderer', 'musicEditablePlaylistDetailHeaderRenderer']) {
    const found = json.findFirst(key)
    if (found.exists) return found
  }
  return JNode.EMPTY
}

export function parseMusicBrowse(json: JNode, browseId: string): MusicBrowsePage {
  const header = headerOf(json)
  const title = header.get('title').text ?? json.at('header', 'title').text ?? ''
  const subtitleRuns = [...runsOf(header.get('subtitle')), ...(header.get('straplineTextOne').exists ? [new JNode({ text: ' • ' }), ...runsOf(header.get('straplineTextOne'))] : [])]
  const subtitle = subtitleRuns.map((r) => r.get('text').string ?? '').join('').replace(/^\s*•\s*/, '').trim() || null
  const artist = header.get('straplineTextOne').text ?? subtitleParts(runsOf(header.get('subtitle'))).artists
  const description = header.at('description', 'musicDescriptionShelfRenderer', 'description').text ?? header.get('description').text ?? null
  const thumbnail =
    artwork(header.at('thumbnail', 'musicThumbnailRenderer', 'thumbnail').bestImageUrl) ??
    artwork(header.at('thumbnail', 'croppedSquareThumbnailRenderer', 'thumbnail').bestImageUrl) ??
    artwork(header.findFirst('musicThumbnailRenderer').get('thumbnail').bestImageUrl)
  const kind: MusicBrowsePage['kind'] = browseId.startsWith('MPRE') ? 'album' : browseId.startsWith('UC') ? 'artist' : browseId.startsWith('VL') ? 'playlist' : 'other'

  const shelves: MusicShelf[] = []
  for (const list of json.findAll('sectionListRenderer')) {
    for (const section of list.get('contents').array) {
      const shelf = section.get('musicShelfRenderer').exists
        ? section.get('musicShelfRenderer')
        : section.get('musicPlaylistShelfRenderer').exists
          ? section.get('musicPlaylistShelfRenderer')
          : section.get('musicCarouselShelfRenderer')
      if (!shelf.exists) continue
      const shelfTitle =
        shelf.get('title').text ??
        shelf.at('header', 'musicCarouselShelfBasicHeaderRenderer', 'title').text ??
        (kind === 'album' ? 'Danh sách bài hát' : kind === 'playlist' ? 'Bài hát' : '')
      const items = shelfItems(shelf.get('contents').array, kind === 'album' || kind === 'playlist' ? 'songs' : null, kind === 'album' ? thumbnail : null, kind === 'album' ? artist : null)
      if (items.length) shelves.push({ title: shelfTitle, items })
    }
  }
  const playlistId =
    header.findFirst('watchPlaylistEndpoint').get('playlistId').string ??
    shelves.flatMap((s) => s.items).find((i) => i.playlistId)?.playlistId ??
    (browseId.startsWith('VL') ? browseId.slice(2) : null)
  return { kind, title, subtitle, description, thumbnail, playlistId, shelves }
}
