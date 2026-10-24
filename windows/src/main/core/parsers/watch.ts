// The watch page (`next` endpoint): everything below the player (port of `WatchParser`), plus
// the playlist panel when the video is opened inside a playlist or a mix.

import { parseDuration, type Chapter, type ChannelItem, type HeatMarker, type VideoItem, type WatchInfo } from '@shared/models'
import { JNode } from '../json'
import * as ItemParser from './items'
import { liveChatInfo } from './livechat'

export function parseWatch(json: JNode, videoId: string): WatchInfo {
  const watch = json.at('contents', 'twoColumnWatchNextResults')
  const results = watch.at('results', 'results', 'contents').array
  const primary = results.find((r) => r.get('videoPrimaryInfoRenderer').exists)?.get('videoPrimaryInfoRenderer') ?? JNode.EMPTY
  const secondary =
    results.find((r) => r.get('videoSecondaryInfoRenderer').exists)?.get('videoSecondaryInfoRenderer') ?? JNode.EMPTY

  const likeButton = primary.get('videoActions').findFirst('likeButtonViewModel')
  const likeCount =
    likeButton.at('toggleButtonViewModel', 'toggleButtonViewModel', 'defaultButtonViewModel', 'buttonViewModel', 'title').string ??
    likeButton.findFirst('buttonViewModel').get('title').string

  const owner = secondary.at('owner', 'videoOwnerRenderer')
  const channelId =
    owner.at('navigationEndpoint', 'browseEndpoint', 'browseId').string ??
    owner.get('title').get('runs').get(0).at('navigationEndpoint', 'browseEndpoint', 'browseId').string
  const channel: ChannelItem | null = channelId
    ? {
        id: channelId,
        name: owner.get('title').text ?? '',
        avatar: owner.get('thumbnail').bestImageUrl,
        subscriberText: owner.get('subscriberCountText').text,
      }
    : null

  const commentsSection = results.find(
    (r) => r.at('itemSectionRenderer', 'sectionIdentifier').string === 'comment-item-section',
  )
  const commentsToken = commentsSection?.findFirst('continuationCommand').get('token').string ?? null

  let commentCount: string | null = null
  let chapters: Chapter[] = []
  for (const panel of json.get('engagementPanels').array) {
    const section = panel.get('engagementPanelSectionListRenderer')
    const identifier = section.get('panelIdentifier').string ?? section.get('targetId').string ?? ''
    if (identifier.includes('comments')) {
      commentCount = section.at('header', 'engagementPanelTitleHeaderRenderer', 'contextualInfo').text
    } else if (identifier.includes('macro-markers') && chapters.length === 0) {
      const seen = new Set<number>()
      for (const marker of section.findAll('macroMarkersListItemRenderer')) {
        const title = marker.get('title').text
        const start = parseDuration(marker.get('timeDescription').text)
        if (title === null || start === null || seen.has(start)) continue
        seen.add(start)
        chapters.push({ title, startSeconds: start, thumbnail: marker.get('thumbnail').bestImageUrl })
      }
      chapters = chapters.sort((a, b) => a.startSeconds - b.startSeconds)
    }
  }

  // "Most replayed": an entity in the framework updates.
  const heatmap: HeatMarker[] = []
  const markersList = json
    .at('frameworkUpdates', 'entityBatchUpdate', 'mutations')
    .array.map((m) => m.at('payload', 'macroMarkersListEntity', 'markersList'))
    .find((list) => list.get('markerType').string === 'MARKER_TYPE_HEATMAP')
  for (const marker of markersList?.get('markers').array ?? []) {
    const start = marker.get('startMillis').double
    const length = marker.get('durationMillis').double
    if (start === null || length === null) continue
    heatmap.push({ start: start / 1000, duration: length / 1000, intensity: marker.get('intensityScoreNormalized').double ?? 0 })
  }
  heatmap.sort((a, b) => a.start - b.start)

  const related = ItemParser.page(watch.get('secondaryResults'), 'next')
  return {
    videoId,
    title: primary.get('title').text ?? '',
    viewCountText: primary.at('viewCount', 'videoViewCountRenderer', 'viewCount').text,
    shortViewCountText: primary.at('viewCount', 'videoViewCountRenderer', 'shortViewCount').text,
    dateText: primary.get('dateText').text,
    relativeDateText: primary.get('relativeDateText').text,
    likeCountText: likeCount,
    description: secondary.at('attributedDescription', 'content').string ?? secondary.get('description').text,
    channel,
    related: { ...related, items: related.items.filter((item) => !(item.type === 'video' && item.video.id === videoId)) },
    commentsToken,
    commentCountText: commentCount,
    chapters,
    likeStatus: primary.get('videoActions').findFirst('likeStatusEntity').get('likeStatus').string,
    isSubscribed: secondary.findFirst('subscribeButtonRenderer').get('subscribed').bool,
    liveChat: liveChatInfo(watch),
    heatmap,
    playlist: playlistPanel(json, videoId),
  }
}

/** The watch page's playlist panel: its videos and where the current one is. */
export function playlistPanel(json: JNode, videoId: string): WatchInfo['playlist'] {
  let panel = json.at('contents', 'twoColumnWatchNextResults', 'playlist', 'playlist')
  if (!panel.exists) panel = json.findFirst('playlistPanelRenderer')
  if (!panel.exists) return null
  const id = panel.get('playlistId').string
  if (!id) return null
  const contents = panel.get('contents')
  const videos: VideoItem[] = ItemParser.items(contents).flatMap((item) => (item.type === 'video' ? [item.video] : []))
  if (videos.length === 0) return null
  let currentIndex = -1
  const selectedIndex = contents.array.findIndex((c) => c.at('playlistPanelVideoRenderer', 'selected').bool === true)
  if (selectedIndex >= 0) {
    const selectedId = contents.get(selectedIndex).at('playlistPanelVideoRenderer', 'videoId').string
    currentIndex = videos.findIndex((v) => v.id === selectedId)
  }
  if (currentIndex < 0) currentIndex = videos.findIndex((v) => v.id === videoId)
  if (currentIndex < 0) {
    const reported = panel.get('currentIndex').int
    currentIndex = reported !== null && reported >= 0 && reported < videos.length ? reported : 0
  }
  const title = panel.get('title').string ?? panel.get('title').text ?? (id.startsWith('RD') ? 'Danh sách kết hợp' : 'Danh sách phát')
  return { id, title, videos, currentIndex }
}
