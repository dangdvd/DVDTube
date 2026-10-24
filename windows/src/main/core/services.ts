// High level API used by the DvdApi implementation (port of `YouTubeService.kt`).

import {
  CHANNEL_SEARCH_PARAMS,
  CHANNEL_TABS,
  DEFAULT_SEARCH_FILTERS,
  feedVideos,
  isMix,
  type AccountIdentity,
  type AccountNotification,
  type AccountPlaylistOption,
  type AccountProfile,
  type ChannelAbout,
  type ChannelItem,
  type ChannelPage,
  type ChannelTab,
  type CommentSortOption,
  type CommentsPage,
  type ContinuationKind,
  type FeedPage,
  type HomeCategory,
  type PlaylistPage,
  type PostsPage,
  type ResolvedLink,
  type SearchFilters,
  type VideoItem,
  type WatchInfo,
} from '@shared/models'
import { AuthSession } from './auth'
import { relativeDate, rssVideos } from './extras'
import { debug, isVietnamese } from './config'
import { describeError, Errors } from './errors'
import { RECENT_VIDEOS_PARAMS, VIDEOS_PARAMS, searchParams } from './filters'
import * as api from './innertube'
import type { AuthMode } from './innertube'
import { JNode } from './json'
import { parseLink } from './links'
import { parseIdentities, parseNotifications, parsePlaylistOptions, parseProfile } from './parsers/account'
import { aboutToken, parseAbout, parseChannel, parsePosts } from './parsers/channel'
import { parseComments } from './parsers/comments'
import * as ItemParser from './parsers/items'
import { parseMix, parsePlaylist } from './parsers/playlist'
import { parseWatch } from './parsers/watch'

function defaultParams(tab: ChannelTab): string {
  return CHANNEL_TABS.find((t) => t.tab === tab)?.defaultParams ?? CHANNEL_TABS[0].defaultParams
}

/** Continuations of account pages must keep running as the account (also in incognito). */
const accountTokens = new Set<string>()

function rememberAccountToken(page: FeedPage): FeedPage {
  if (page.continuation) {
    if (accountTokens.size > 500) accountTokens.clear()
    accountTokens.add(page.continuation)
  }
  return page
}

// MARK: Search

export async function search(query: string, filters: SearchFilters = DEFAULT_SEARCH_FILTERS): Promise<FeedPage> {
  return ItemParser.page(await api.search(query, searchParams(filters)), 'search')
}

async function searchWith(query: string, params: string | null): Promise<FeedPage> {
  return ItemParser.page(await api.search(query, params), 'search')
}

/** Next page of any feed, using the endpoint the token came from. */
export async function more(token: string, kind: ContinuationKind): Promise<FeedPage> {
  switch (kind) {
    case 'search':
      return ItemParser.page(await api.searchContinuation(token), 'search')
    case 'next':
      return ItemParser.page(await api.nextContinuation(token), 'next')
    default:
      return browseMore(token)
  }
}

export async function browseMore(token: string): Promise<FeedPage> {
  const auth: AuthMode = accountTokens.has(token) ? 'account' : 'auto'
  const page = ItemParser.page(await api.browseContinuation(token, auth))
  return auth === 'account' ? rememberAccountToken(page) : page
}

export const suggestions = api.suggestions

// MARK: Home

async function charts(type: string): Promise<VideoItem[]> {
  return ItemParser.chartVideos(await api.charts(type))
}

function videosPage(videos: VideoItem[]): FeedPage {
  return { items: videos.map((video) => ({ type: 'video' as const, video })), continuation: null, kind: 'browse' }
}

export async function category(category: HomeCategory): Promise<FeedPage> {
  const vi = isVietnamese()
  switch (category) {
    case 'all':
      return searchWith(vi ? 'thịnh hành' : 'trending', VIDEOS_PARAMS)
    case 'music': {
      const music = await charts('TRENDING_VIDEOS').catch(() => [])
      return music.length > 0 ? videosPage(music) : searchWith(vi ? 'nhạc mới' : 'new music', VIDEOS_PARAMS)
    }
    // The "Gaming" destination channel has a trending tab.
    case 'gaming':
      return ItemParser.page(await api.browse('UCOpNcN46UbXVtpKMrmU4Abg', 'Egh0cmVuZGluZw%3D%3D'))
    // The "Live" destination channel.
    case 'live':
      return ItemParser.page(await api.browse('UC4R8DWoMoI7CAwX8_LjQHig', 'EgdsaXZldGFikgEDCKEK'))
    case 'podcasts':
      return ItemParser.page(await api.browse('FEpodcasts_destination', 'qgcCCAM%3D'))
    case 'news':
      return searchWith(vi ? 'tin tức' : 'news', RECENT_VIDEOS_PARAMS)
    case 'sports':
      return searchWith(vi ? 'thể thao' : 'sports highlights', RECENT_VIDEOS_PARAMS)
    case 'learning':
      return searchWith(vi ? 'kiến thức thú vị' : 'learn something new', VIDEOS_PARAMS)
    case 'movies': {
      const trailers = await charts('TRENDING_MOVIES').catch(() => [])
      return trailers.length > 0 ? videosPage(trailers) : searchWith(vi ? 'trailer phim' : 'movie trailer', RECENT_VIDEOS_PARAMS)
    }
  }
}

/** "Tất cả" is the personalised home when signed in (not in incognito), else the signed-out feed. */
export async function home(cat: HomeCategory, incognito: boolean): Promise<FeedPage> {
  if (cat === 'all' && !incognito && (await AuthSession.isAuthenticated())) {
    try {
      const page = rememberAccountToken(ItemParser.page(await api.browse('FEwhat_to_watch', null, 'account')))
      if (page.items.length > 0) return page
      debug(`personalised home empty${page.message ? `: ${page.message}` : ''}`)
    } catch (error) {
      debug(`personalised home failed: ${describeError(error)}`)
    }
  }
  return category(cat)
}

// MARK: Watch

export const player = api.player

export async function watchInfo(videoId: string, playlistId?: string | null): Promise<WatchInfo> {
  return parseWatch(await api.next(videoId, playlistId || null), videoId)
}

export async function comments(token: string): Promise<{ page: CommentsPage; sortOptions: CommentSortOption[] }> {
  return parseComments(await api.nextContinuation(token))
}

// MARK: Channels & playlists

export async function channel(id: string, tab: ChannelTab = 'videos'): Promise<ChannelPage> {
  const browseId = await resolveChannelId(id)
  const signedIn = await AuthSession.isAuthenticated()
  return parseChannel(await api.browse(browseId, defaultParams(tab)), browseId, tab, signedIn)
}

export async function channelTab(id: string, tab: ChannelTab, params?: string | null): Promise<FeedPage> {
  const browseId = await resolveChannelId(id)
  return parseChannel(await api.browse(browseId, params || defaultParams(tab)), browseId, tab).initialPage
}

/** The "Posts" (community) tab. */
export async function channelPosts(id: string, params?: string | null): Promise<PostsPage> {
  const browseId = await resolveChannelId(id)
  return parsePosts(await api.browse(browseId, params || defaultParams('posts')))
}

export async function channelPostsMore(token: string): Promise<PostsPage> {
  return parsePosts(await api.browseContinuation(token))
}

/** The "About" panel: from the header's continuation, else from the about tab. */
export async function channelAbout(id: string, token?: string | null, params?: string | null): Promise<ChannelAbout | null> {
  if (token) {
    try {
      const about = parseAbout(await api.browseContinuation(token))
      if (about) return about
    } catch (error) {
      debug(`channel about via token failed: ${describeError(error)}`)
    }
  }
  const browseId = await resolveChannelId(id)
  const json = await api.browse(browseId, params || defaultParams('about'))
  const about = parseAbout(json)
  if (about) return about
  const headerToken = aboutToken(json.get('header'))
  return headerToken ? parseAbout(await api.browseContinuation(headerToken)) : null
}

/** Videos of one channel matching `query`. */
export async function channelSearch(id: string, query: string): Promise<FeedPage> {
  const browseId = await resolveChannelId(id)
  return ItemParser.page(await api.browseSearch(browseId, CHANNEL_SEARCH_PARAMS, query))
}

/** Account lists that need the signed-in account. */
function isAccountPlaylist(id: string): boolean {
  return id === 'WL' || id === 'LL' || id === 'LM'
}

export async function playlist(id: string): Promise<PlaylistPage> {
  const plainId = id.startsWith('VL') ? id.slice(2) : id
  if (isMix(plainId)) return mix(plainId)
  const auth: AuthMode = isAccountPlaylist(plainId) ? 'account' : 'auto'
  const result = parsePlaylist(await api.browse('VL' + plainId, null, auth), plainId)
  if (auth === 'account') rememberAccountToken(result.page)
  // Some generated lists have no playlist page either: read them like a mix.
  if (feedVideos(result.page).length === 0 && plainId.startsWith('RD')) {
    try {
      const fromMix = await mix(plainId)
      if (feedVideos(fromMix.page).length > 0) return fromMix
    } catch {
      // keep the playlist page
    }
  }
  return result
}

/** Every video of a playlist (all pages, at most `limit`). */
export async function playlistVideos(id: string, limit = 200): Promise<VideoItem[]> {
  let page = (await playlist(id)).page
  const videos = [...feedVideos(page)]
  const seen = new Set(videos.map((v) => v.id))
  let pages = 0
  while (videos.length < limit && pages < 20) {
    const token = page.continuation
    if (!token) break
    page = await browseMore(token)
    const fresh = feedVideos(page)
    if (fresh.length === 0) break
    for (const video of fresh) {
      if (!seen.has(video.id)) {
        seen.add(video.id)
        videos.push(video)
      }
    }
    pages++
  }
  return videos.slice(0, limit)
}

async function mix(id: string): Promise<PlaylistPage> {
  // `RD<video id>` and `RDAMVM<video id>` mixes start from that video.
  const seed = id.length === 13 ? id.slice(2) : id.startsWith('RDAMVM') && id.length === 17 ? id.slice(6) : null
  return parseMix(await api.next(seed, id), id)
}

/** Accepts a `UC…` id, an `@handle` or a channel URL. */
export async function resolveChannelId(value: string): Promise<string> {
  if (value.startsWith('UC') && value.length === 24) return value
  const url = value.startsWith('http') ? value : 'https://www.youtube.com/' + (value.startsWith('@') ? value : '@' + value)
  return (await api.resolveUrl(url)).at('endpoint', 'browseEndpoint', 'browseId').string ?? value
}

// MARK: Links

/** What a resolved `navigation/resolve_url` endpoint points to. */
function endpointLink(json: JNode): ResolvedLink | null {
  const endpoint = json.get('endpoint')
  const watch = endpoint.get('watchEndpoint')
  const videoId = watch.get('videoId').string
  if (videoId) return { type: 'video', videoId, playlistId: watch.get('playlistId').string, startSeconds: watch.get('startTimeSeconds').int }
  const reel = endpoint.at('reelWatchEndpoint', 'videoId').string
  if (reel) return { type: 'shorts', videoId: reel }
  const browseId = endpoint.at('browseEndpoint', 'browseId').string
  if (browseId?.startsWith('UC')) return { type: 'channel', channelId: browseId }
  if (browseId?.startsWith('VL')) return { type: 'playlist', playlistId: browseId.slice(2) }
  const playlistId = endpoint.at('watchPlaylistEndpoint', 'playlistId').string
  if (playlistId) return { type: 'playlist', playlistId }
  return null
}

export async function resolveLink(text: string): Promise<ResolvedLink | null> {
  const parsed = parseLink(text)
  if (!parsed) return null
  if (parsed.type !== 'resolve') return parsed
  try {
    const link = endpointLink(await api.resolveUrl(parsed.url))
    if (link) return link
  } catch (error) {
    debug(`resolve_url failed: ${describeError(error)}`)
    throw error
  }
  return { type: 'search', query: text.trim() }
}

// MARK: Subscriptions feed (signed out)

const rssCache = new Map<string, { at: number; videos: VideoItem[] }>()

/** Latest uploads of one channel: RSS, else the channel's videos tab. */
async function channelLatest(channelId: string): Promise<VideoItem[]> {
  const cached = rssCache.get(channelId)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.videos
  let videos: VideoItem[] = []
  try {
    videos = await rssVideos(channelId)
  } catch (error) {
    debug(`rss ${channelId} failed: ${describeError(error)}`)
  }
  if (videos.length === 0) {
    try {
      const now = Date.now()
      videos = feedVideos(await channelTab(channelId, 'videos', null)).map((v) => ({
        ...v,
        channelId: v.channelId ?? channelId,
        publishedDate: relativeDate(v.publishedText, now),
      }))
    } catch {
      videos = []
    }
  }
  if (videos.length > 0) rssCache.set(channelId, { at: Date.now(), videos })
  return videos
}

/** Newest uploads of these channels, merged, newest first (6 channels at a time). */
export async function latestVideos(channelIds: string[]): Promise<VideoItem[]> {
  const ids = [...new Set(channelIds.filter((id) => typeof id === 'string' && id.length > 0))]
  const results: VideoItem[][] = new Array(ids.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < ids.length) {
      const index = nextIndex++
      results[index] = await channelLatest(ids[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker))
  const seen = new Set<string>()
  return results
    .flat()
    .filter((video) => {
      if (!video || seen.has(video.id)) return false
      seen.add(video.id)
      return true
    })
    .sort((a, b) => (b.publishedDate ?? 0) - (a.publishedDate ?? 0))
}

// MARK: Account (signed in)

export async function accountProfile(): Promise<AccountProfile | null> {
  return parseProfile(await api.accountMenu())
}

/** Signed-in Google accounts and their brand channels. */
export async function accountIdentities(): Promise<AccountIdentity[]> {
  let firstError: unknown = null
  try {
    const identities = parseIdentities(await api.accountSwitcher())
    debug(`account switcher: ${identities.length} identities`)
    if (identities.length > 0) return identities
  } catch (error) {
    firstError = error
  }
  try {
    const identities = parseIdentities(await api.accountsList())
    debug(`accounts list: ${identities.length} identities`)
    return identities
  } catch (error) {
    throw firstError ?? error
  }
}

/**
 * Any account page by browse id: FEwhat_to_watch (home), FEsubscriptions, FEchannels,
 * FEhistory, FEplaylist_aggregation, VLWL (watch later), VLLL (liked videos).
 */
export async function accountFeed(browseId: string): Promise<FeedPage> {
  if (!(await AuthSession.isAuthenticated())) throw Errors.signedOut()
  const page = rememberAccountToken(ItemParser.page(await api.browse(browseId, null, 'account')))
  debug(`account ${browseId}: ${page.items.length} items, more=${page.continuation !== null}`)
  return page
}

export async function accountPlaylistOptions(videoId: string): Promise<AccountPlaylistOption[]> {
  return parsePlaylistOptions(await api.addToPlaylistOptions(videoId))
}

export async function accountNotifications(): Promise<AccountNotification[]> {
  const items = parseNotifications(await api.notificationMenu())
  debug(`notifications: ${items.length}`)
  return items
}

/** Every channel the account is subscribed to. */
export async function accountSubscriptions(): Promise<ChannelItem[]> {
  let page = await accountFeed('FEchannels')
  const channels = page.items.flatMap((item) => (item.type === 'channel' ? [item.channel] : []))
  let pages = 0
  while (pages < 10) {
    const token = page.continuation
    if (!token) break
    page = await browseMore(token)
    channels.push(...page.items.flatMap((item) => (item.type === 'channel' ? [item.channel] : [])))
    pages++
  }
  return channels
}
