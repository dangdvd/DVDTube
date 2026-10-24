// Playlist pages and mixes (port of `PlaylistParser`).

import { feedVideos, type PlaylistPage } from '@shared/models'
import { JNode } from '../json'
import * as ItemParser from './items'

export function parsePlaylist(json: JNode, playlistId: string): PlaylistPage {
  const header = json.get('header')
  const title =
    header.at('pageHeaderRenderer', 'pageTitle').string ??
    header.at('playlistHeaderRenderer', 'title').text ??
    json.at('metadata', 'playlistMetadataRenderer', 'title').string ??
    'Danh sách phát'
  const owner =
    header.at('playlistHeaderRenderer', 'ownerText').text ??
    header
      .at('pageHeaderRenderer', 'content', 'pageHeaderViewModel', 'metadata')
      .findAll('text')
      .map((t) => t.text)
      .find((t): t is string => !!t) ??
    null
  const content = json.at('contents', 'twoColumnBrowseResultsRenderer', 'tabs').get(0).at('tabRenderer', 'content')
  const page = ItemParser.page(content.exists ? content : json.get('contents'))
  const thumbnail =
    json.at('microformat', 'microformatDataRenderer', 'thumbnail').bestImageUrl ?? feedVideos(page)[0]?.thumbnail ?? null
  const countText = header.at('playlistHeaderRenderer', 'numVideosText').text
  return { playlist: { id: playlistId, title, thumbnail, channelName: owner, videoCountText: countText }, page }
}

/** A mix from the watch page's playlist panel (`/next` with the playlist id). */
export function parseMix(json: JNode, playlistId: string): PlaylistPage {
  const panel = json.at('contents', 'twoColumnWatchNextResults', 'playlist', 'playlist')
  // Mixes never end; the panel's continuation is not a playlist page continuation.
  const parsed = ItemParser.page(panel.exists ? panel.get('contents') : json.findFirst('playlistPanelRenderer').get('contents'))
  const page = { ...parsed, continuation: null }
  const videos = feedVideos(page)
  const title = panel.get('title').string ?? panel.get('title').text ?? 'Danh sách kết hợp'
  const owner = panel.get('ownerName').text ?? panel.get('longBylineText').text
  const count = videos.length === 0 ? null : `${videos.length} video`
  return {
    playlist: { id: playlistId, title, thumbnail: videos[0]?.thumbnail ?? null, channelName: owner, videoCountText: count },
    page,
  }
}
