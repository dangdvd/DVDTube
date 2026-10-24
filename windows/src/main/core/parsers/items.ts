// Turns arbitrary InnerTube trees (search, browse, related, continuations) into feed items (port
// of `ItemParser.kt`). Rather than hard-coding the nesting of every page type, the parser walks
// the whole tree and recognises the renderers that represent videos, channels, playlists and Shorts.

import {
  feedItemKey,
  formatDuration,
  parseDuration,
  type ChannelItem,
  type ContinuationKind,
  type FeedItem,
  type FeedPage,
  type PlaylistItem,
  type VideoItem,
} from '@shared/models'
import { JNode } from '../json'

const skippedKeys = new Set([
  'responseContext', 'header', 'topbar', 'microformat', 'frameworkUpdates', 'playerOverlays',
  'menu', 'thumbnailOverlays', 'trackingParams', 'loggingDirectives', 'accessibility',
  'engagementPanels', 'commandMetadata', 'metadata',
  'richThumbnail', 'channelThumbnailSupportedRenderers', 'endScreen', 'cards',
  'searchPyvRenderer', 'adSlotRenderer', 'promotedSparklesWebRenderer', 'statementBannerRenderer',
])

const videoKeys = new Set([
  'videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer', 'playlistVideoRenderer',
  'playlistPanelVideoRenderer', 'videoWithContextRenderer', 'endScreenVideoRenderer',
])

const shelfKeys = new Set([
  'reelShelfRenderer', 'gridShelfViewModel', 'richShelfRenderer', 'shelfRenderer',
  'horizontalCardListRenderer', 'expandedShelfContentsRenderer',
])

const playlistKeys = new Set([
  'playlistRenderer', 'gridPlaylistRenderer', 'compactPlaylistRenderer', 'radioRenderer', 'compactRadioRenderer',
])

export function page(node: JNode, kind: ContinuationKind = 'browse'): FeedPage {
  const list = items(node)
  return { items: list, continuation: continuation(node), kind, message: list.length === 0 ? emptyMessage(node) : null }
}

/** Text of the notice YouTube shows instead of a feed. */
export function emptyMessage(node: JNode): string | null {
  for (const key of ['feedNudgeRenderer', 'backgroundPromoRenderer', 'messageRenderer', 'emptyStateViewModel']) {
    const renderer = node.findFirst(key)
    if (!renderer.exists) continue
    const parts = [renderer.get('title'), renderer.get('subtitle'), renderer.get('text'), renderer.get('bodyText')]
      .map((part) => part.text?.trim() || null)
      .filter((part): part is string => !!part)
    if (parts.length > 0) return parts.join('\n')
  }
  return null
}

export function items(node: JNode): FeedItem[] {
  const result: FeedItem[] = []
  walk(node.raw, result)
  const seen = new Set<string>()
  // The same video sometimes appears twice (e.g. in a shelf and in the list).
  return result.filter((item) => {
    const key = feedItemKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function continuation(node: JNode): string | null {
  const renderers = node.findAll('continuationItemRenderer')
  for (let i = renderers.length - 1; i >= 0; i--) {
    const token = renderers[i].findFirst('continuationCommand').get('token').string
    if (token) return token
  }
  return null
}

function videoOf(item: FeedItem): VideoItem | null {
  return item.type === 'video' ? item.video : null
}

function walk(value: unknown, result: FeedItem[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, result)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const dict = value as Record<string, unknown>
  for (const key of Object.keys(dict).sort()) {
    if (skippedKeys.has(key)) continue
    const child = new JNode(dict[key])
    if (videoKeys.has(key)) {
      const v = video(child)
      if (v) result.push({ type: 'video', video: v })
      continue
    }
    if (key === 'lockupViewModel') {
      const item = lockup(child)
      if (item) result.push(item)
      continue
    }
    if (key === 'shortsLockupViewModel') {
      const v = shortFromLockup(child)
      if (v) result.push({ type: 'video', video: v })
      continue
    }
    if (key === 'reelItemRenderer') {
      const v = shortFromReel(child)
      if (v) result.push({ type: 'video', video: v })
      continue
    }
    if (key === 'channelRenderer' || key === 'gridChannelRenderer') {
      const c = channel(child)
      if (c) result.push({ type: 'channel', channel: c })
      continue
    }
    if (playlistKeys.has(key)) {
      const p = playlist(child)
      if (p) result.push({ type: 'playlist', playlist: p })
      continue
    }
    if (shelfKeys.has(key)) {
      const inner: FeedItem[] = []
      walk(child.raw, inner)
      const shorts = inner.map(videoOf).filter((v): v is VideoItem => !!v && !!v.isShort)
      if (shorts.length > 0 && shorts.length === inner.length) result.push({ type: 'shorts', items: shorts })
      else result.push(...inner)
      continue
    }
    walk(child.raw, result)
  }
}

// MARK: Renderers

function browseIdOf(run: JNode): string | null {
  return run.at('navigationEndpoint', 'browseEndpoint', 'browseId').string
}

export function video(r: JNode): VideoItem | null {
  const id = r.get('videoId').string
  if (!id) return null
  const owner = [r.get('ownerText'), r.get('longBylineText'), r.get('shortBylineText')].find((n) => n.text !== null)
  let channelId: string | null = null
  for (const run of owner?.get('runs').array ?? []) {
    channelId = browseIdOf(run)
    if (channelId) break
  }

  let durationText = r.get('lengthText').text
  let isLive = false
  let isShort = r.at('navigationEndpoint', 'reelWatchEndpoint').exists
  for (const overlay of r.get('thumbnailOverlays').array) {
    const status = overlay.get('thumbnailOverlayTimeStatusRenderer')
    if (!status.exists) continue
    const style = status.get('style').string
    if (style === 'LIVE') isLive = true
    else if (style === 'SHORTS') isShort = true
    else if (durationText === null) durationText = status.get('text').text
  }
  for (const badge of r.get('badges').array) {
    if (badge.at('metadataBadgeRenderer', 'style').string === 'BADGE_STYLE_TYPE_LIVE_NOW') isLive = true
  }

  const avatar =
    r.at('channelThumbnailSupportedRenderers', 'channelThumbnailWithLinkRenderer', 'thumbnail').bestImageUrl ??
    r.get('channelThumbnail').bestImageUrl

  let views = r.get('shortViewCountText').text ?? r.get('viewCountText').text
  let published = r.get('publishedTimeText').text
  if (views === null) {
    // playlistVideoRenderer: "1,2 Tr lượt xem • 2 năm trước" split into runs.
    const parts = r
      .get('videoInfo')
      .get('runs')
      .array.map((run) => run.get('text').string)
      .filter((text): text is string => text !== null && text.trim().length > 1)
    views = parts[0] ?? null
    if (published === null && parts.length > 1) published = parts[1]
  }

  return {
    id,
    title: r.get('title').text ?? r.get('headline').text ?? '',
    channelName: owner?.text ?? null,
    channelId,
    channelAvatar: avatar,
    thumbnail: r.get('thumbnail').bestImageUrl,
    durationText: isLive ? null : durationText,
    durationSeconds: r.get('lengthSeconds').int ?? parseDuration(durationText),
    viewCountText: views,
    publishedText: published,
    isLive,
    isShort,
  }
}

const durationPattern = /^\d+(:\d{2})+$/

export function lockup(r: JNode): FeedItem | null {
  const id = r.get('contentId').string
  if (!id) return null
  const type = r.get('contentType').string ?? ''
  const meta = r.at('metadata', 'lockupMetadataViewModel')
  const title = meta.get('title').text ?? ''
  const rows = meta
    .at('metadata', 'contentMetadataViewModel', 'metadataRows')
    .array.map((row) =>
      row
        .get('metadataParts')
        .array.map((part) => part.get('text').text?.trim() || null)
        .filter((text): text is string => !!text),
    )
    .filter((row) => row.length > 0)

  const avatarNode = meta.at('image', 'decoratedAvatarViewModel')
  const avatar = avatarNode.at('avatar', 'avatarViewModel', 'image').bestImageUrl
  const channelId = avatarNode.findFirst('browseEndpoint').get('browseId').string

  const image = r.get('contentImage')
  const thumbnail =
    image.findFirst('thumbnailViewModel').get('image').bestImageUrl ??
    image.findFirst('primaryThumbnail').findFirst('image').bestImageUrl
  const badges = image.findAll('thumbnailBadgeViewModel')
  const badgeTexts = badges.map((b) => b.get('text').string).filter((t): t is string => t !== null)

  if (type.includes('PLAYLIST') || type.includes('ALBUM') || type.includes('PODCAST')) {
    return {
      type: 'playlist',
      playlist: {
        id,
        title,
        thumbnail,
        channelName: rows[0]?.[0] ?? null,
        videoCountText: badgeTexts.find((text) => /\d/.test(text)) ?? null,
      },
    }
  }
  if (type !== '' && !type.includes('VIDEO')) return null

  let channelName: string | null
  let parts: string[]
  if (rows.length >= 2) {
    channelName = rows[0].join(' • ')
    parts = rows[1]
  } else {
    channelName = null
    parts = rows[0] ?? []
  }
  const duration = badgeTexts.find((text) => durationPattern.test(text)) ?? null
  const isLive = badges.some((b) => (b.get('badgeStyle').string ?? '').includes('LIVE'))

  return {
    type: 'video',
    video: {
      id,
      title,
      channelName,
      channelId,
      channelAvatar: avatar,
      thumbnail,
      durationText: duration,
      durationSeconds: parseDuration(duration),
      viewCountText: parts[0] ?? null,
      publishedText: parts[1] ?? null,
      isLive,
      isShort: false,
    },
  }
}

export function shortFromLockup(r: JNode): VideoItem | null {
  const endpoint = r.findFirst('reelWatchEndpoint')
  let id = endpoint.get('videoId').string
  if (!id) {
    const entity = r.get('entityId').string
    if (entity && entity.includes('shorts-shelf-item-')) id = entity.slice(entity.indexOf('shorts-shelf-item-') + 18)
  }
  if (!id) return null
  const image = r.at('thumbnailViewModel', 'thumbnailViewModel', 'image').exists
    ? r.at('thumbnailViewModel', 'thumbnailViewModel', 'image')
    : r.at('thumbnailViewModel', 'image')
  let title = r.at('overlayMetadata', 'primaryText').text
  if (title === null) {
    const accessibility = r.get('accessibilityText').string
    if (accessibility !== null) title = accessibility.split(', ').slice(0, -1).join(', ')
  }
  return {
    id,
    title: title ?? '',
    thumbnail: image.bestImageUrl ?? endpoint.get('thumbnail').bestImageUrl,
    viewCountText: r.at('overlayMetadata', 'secondaryText').text,
    isShort: true,
  }
}

export function shortFromReel(r: JNode): VideoItem | null {
  const id = r.get('videoId').string
  if (!id) return null
  return {
    id,
    title: r.get('headline').text ?? '',
    thumbnail: r.get('thumbnail').bestImageUrl,
    viewCountText: r.get('viewCountText').text,
    isShort: true,
  }
}

export function channel(r: JNode): ChannelItem | null {
  const id = r.get('channelId').string
  if (!id) return null
  const subscriberCount = r.get('subscriberCountText').text
  const videoCount = r.get('videoCountText').text
  // Newer layouts put the @handle in `subscriberCountText` and the count in `videoCountText`.
  const isHandle = subscriberCount?.startsWith('@') === true
  return {
    id,
    name: r.get('title').text ?? '',
    avatar: r.get('thumbnail').bestImageUrl,
    handle: isHandle ? subscriberCount : null,
    subscriberText: isHandle ? videoCount : subscriberCount,
    videoCountText: isHandle ? null : videoCount,
  }
}

export function playlist(r: JNode): PlaylistItem | null {
  const id = r.get('playlistId').string
  if (!id) return null
  const thumbnail =
    r.get('thumbnails').get(0).bestImageUrl ??
    r.get('thumbnail').bestImageUrl ??
    r.get('thumbnailRenderer').findFirst('thumbnail').bestImageUrl
  let count = r.get('videoCountText').text ?? r.get('videoCountShortText').text
  if (count === null) {
    const n = r.get('videoCount').string
    if (n !== null) count = `${n} video`
  }
  return {
    id,
    title: r.get('title').text ?? '',
    thumbnail,
    channelName: r.get('shortBylineText').text ?? r.get('longBylineText').text,
    videoCountText: count,
  }
}

/** Items of the YouTube Charts endpoint (`videoViews`). */
export function chartVideos(node: JNode): VideoItem[] {
  const list = node.findAll('videoViews').find((n) => n.array.length > 0)
  if (!list) return []
  const result: VideoItem[] = []
  for (const v of list.array) {
    const id = v.get('id').string
    if (!id) continue
    if (v.get('isAvailable').bool === false) continue
    const artists = v
      .get('artists')
      .array.map((a) => a.get('name').string)
      .filter((n): n is string => n !== null)
      .join(', ')
    const seconds = v.get('videoDuration').int
    const position = v.at('chartEntryMetadata', 'currentPosition').int
    result.push({
      id,
      title: v.get('title').string ?? '',
      channelName: artists || v.get('channelName').string,
      channelId: v.get('externalChannelId').string,
      thumbnail: v.get('thumbnail').bestImageUrl,
      durationText: seconds !== null ? formatDuration(seconds) : null,
      durationSeconds: seconds,
      viewCountText: position !== null ? `#${position} thịnh hành` : null,
    })
  }
  return result
}
