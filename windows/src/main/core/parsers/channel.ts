// Channel pages, their "Posts" tab and "About" panel (port of `ChannelParser`, `PostsParser`,
// `AboutParser`).

import type {
  ChannelAbout,
  ChannelLink,
  ChannelPage,
  ChannelTab,
  CommunityPost,
  PostAttachment,
  PostsPage,
} from '@shared/models'
import { CHANNEL_TABS } from '@shared/models'
import { JNode } from '../json'
import * as ItemParser from './items'

/** The tab's URL endings on youtube.com (`/posts` used to be `/community`). */
function urlSuffixes(tab: ChannelTab): string[] {
  return tab === 'posts' ? ['posts', 'community'] : [tab]
}

export function parseChannel(json: JNode, channelId: string, tab: ChannelTab, signedIn = false): ChannelPage {
  const header = json.get('header')
  const pageHeader = header.at('pageHeaderRenderer', 'content', 'pageHeaderViewModel')
  const legacy = header.get('c4TabbedHeaderRenderer')
  const metadata = json.at('metadata', 'channelMetadataRenderer')

  const name =
    pageHeader.at('title', 'dynamicTextViewModel', 'text', 'content').string ??
    header.at('pageHeaderRenderer', 'pageTitle').string ??
    legacy.get('title').text ??
    metadata.get('title').string ??
    ''
  const avatar =
    pageHeader.at('image', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image').bestImageUrl ??
    legacy.get('avatar').bestImageUrl ??
    metadata.get('avatar').bestImageUrl
  const banner = pageHeader.at('banner', 'imageBannerViewModel', 'image').bestImageUrl ?? legacy.get('banner').bestImageUrl

  const parts = pageHeader
    .at('metadata', 'contentMetadataViewModel', 'metadataRows')
    .array.flatMap((row) => row.get('metadataParts').array.map((part) => part.get('text').text))
    .filter((text): text is string => text !== null)
  const handle = parts.find((p) => p.startsWith('@')) ?? legacy.get('channelHandleText').text
  const counts = parts.filter((p) => !p.startsWith('@'))
  const subscribers = counts[0] ?? legacy.get('subscriberCountText').text
  const videos = counts[1] ?? legacy.get('videosCountText').text

  const tabParams: Partial<Record<ChannelTab, string>> = {}
  let selectedContent = JNode.EMPTY
  for (const entry of json.at('contents', 'twoColumnBrowseResultsRenderer', 'tabs').array) {
    const renderer = entry.get('tabRenderer')
    if (!renderer.exists) continue
    const url = renderer.findFirst('webCommandMetadata').get('url').string ?? ''
    const params = renderer.at('endpoint', 'browseEndpoint', 'params').string
    for (const candidate of CHANNEL_TABS) {
      if (params && urlSuffixes(candidate.tab).some((suffix) => url.endsWith('/' + suffix))) tabParams[candidate.tab] = params
    }
    if (renderer.get('selected').bool === true) selectedContent = renderer.get('content')
  }

  const subscribed =
    json.findFirst('subscriptionStateEntity').get('subscribed').bool ??
    header.findFirst('subscribeButtonRenderer').get('subscribed').bool

  return {
    channel: {
      id: metadata.get('externalId').string ?? channelId,
      name,
      avatar,
      handle,
      subscriberText: subscribers,
      videoCountText: videos,
    },
    banner,
    description:
      pageHeader.at('description', 'descriptionPreviewViewModel', 'description', 'content').string ??
      metadata.get('description').string,
    tabParams,
    initialTab: tab,
    initialPage: ItemParser.page(selectedContent),
    aboutToken: aboutToken(header),
    isSubscribed: signedIn ? subscribed : null,
  }
}

/** The description in the header opens the "About" panel through a continuation. */
export function aboutToken(header: JNode): string | null {
  for (const endpoint of header.findAll('showEngagementPanelEndpoint')) {
    const token = endpoint.findFirst('continuationCommand').get('token').string
    if (token) return token
  }
  return null
}

// MARK: Posts

export function parsePosts(json: JNode): PostsPage {
  const seen = new Set<string>()
  const posts: CommunityPost[] = []
  for (const renderer of json.findAll('backstagePostRenderer')) {
    const p = post(renderer)
    if (p && !seen.has(p.id)) {
      seen.add(p.id)
      posts.push(p)
    }
  }
  return { posts, continuation: ItemParser.continuation(json) }
}

function post(r: JNode): CommunityPost | null {
  const id = r.get('postId').string
  if (!id) return null
  const attachment = r.get('backstageAttachment')
  let parsed: PostAttachment | null = null
  if (attachment.get('backstageImageRenderer').exists) {
    const url = attachment.at('backstageImageRenderer', 'image').bestImageUrl
    if (url) parsed = { type: 'images', urls: [url] }
  } else if (attachment.get('postMultiImageRenderer').exists) {
    const urls = attachment
      .at('postMultiImageRenderer', 'images')
      .array.map((image) => image.at('backstageImageRenderer', 'image').bestImageUrl)
      .filter((url): url is string => !!url)
    if (urls.length > 0) parsed = { type: 'images', urls }
  } else if (attachment.get('videoRenderer').exists) {
    const video = ItemParser.video(attachment.get('videoRenderer'))
    if (video) parsed = { type: 'video', video }
  } else if (attachment.get('pollRenderer').exists) {
    const poll = attachment.get('pollRenderer')
    parsed = {
      type: 'poll',
      choices: poll
        .get('choices')
        .array.map((c) => c.get('text').text)
        .filter((t): t is string => t !== null),
      totalVotes: poll.get('totalVotes').text,
    }
  }
  return {
    id,
    authorName: r.get('authorText').text ?? '',
    authorAvatar: r.get('authorThumbnail').bestImageUrl,
    text: r.get('contentText').text ?? '',
    publishedText: r.get('publishedTimeText').text,
    likeCountText: r.get('voteCount').text?.trim() || null,
    commentCountText:
      r.at('actionButtons', 'commentActionButtonsRenderer', 'replyButton', 'buttonRenderer', 'text').text?.trim() || null,
    attachment: parsed,
  }
}

// MARK: About

export function parseAbout(json: JNode): ChannelAbout | null {
  const about = json.findFirst('aboutChannelViewModel')
  if (!about.exists) return null
  const links: ChannelLink[] = []
  for (const entry of about.get('links').array) {
    const link = entry.get('channelExternalLinkViewModel')
    const title = link.get('title').text
    if (title === null) continue
    const display = link.get('link').text
    const target =
      link.at('link', 'commandRuns').get(0).at('onTap', 'innertubeCommand', 'urlEndpoint', 'url').string ??
      (display !== null ? (display.startsWith('http') ? display : 'https://' + display) : null)
    if (target === null) continue
    links.push({ title, displayUrl: display, url: redirectTarget(target) })
  }
  return {
    description: about.get('description').text,
    country: about.get('country').text,
    subscriberCountText: about.get('subscriberCountText').text,
    viewCountText: about.get('viewCountText').text,
    videoCountText: about.get('videoCountText').text,
    joinedDateText: about.get('joinedDateText').text,
    channelUrl: about.get('canonicalChannelUrl').text,
    links,
  }
}

/** `youtube.com/redirect?q=<target>` → the target itself. */
export function redirectTarget(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('youtube.com') && parsed.pathname === '/redirect') {
      const q = parsed.searchParams.get('q')
      if (q) return q
    }
  } catch {
    // not a URL: keep as is
  }
  return url
}
