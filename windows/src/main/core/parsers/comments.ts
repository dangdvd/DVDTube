// Comments (port of `CommentsParser`): `commentViewModel`s whose data lives in the response's
// entity mutations.

import type { Comment, CommentSortOption, CommentsPage } from '@shared/models'
import { JNode, youtubeImage } from '../json'

interface Entities {
  payloads: Map<string, JNode>
  toolbarStates: Map<string, JNode>
  toolbarSurfaces: Map<string, JNode>
}

function entities(json: JNode): Entities {
  const result: Entities = { payloads: new Map(), toolbarStates: new Map(), toolbarSurfaces: new Map() }
  for (const mutation of json.at('frameworkUpdates', 'entityBatchUpdate', 'mutations').array) {
    const key = mutation.get('entityKey').string
    if (!key) continue
    const payload = mutation.get('payload')
    if (payload.get('commentEntityPayload').exists) result.payloads.set(key, payload.get('commentEntityPayload'))
    else if (payload.get('engagementToolbarStateEntityPayload').exists)
      result.toolbarStates.set(key, payload.get('engagementToolbarStateEntityPayload'))
    else if (payload.get('engagementToolbarSurfaceEntityPayload').exists)
      result.toolbarSurfaces.set(key, payload.get('engagementToolbarSurfaceEntityPayload'))
  }
  return result
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed !== '0' ? trimmed : null
}

function build(e: Entities, viewModel: JNode, repliesToken: string | null): Comment | null {
  const key = viewModel.get('commentKey').string
  if (!key) return null
  const payload = e.payloads.get(key)
  if (!payload) return null
  const properties = payload.get('properties')
  const author = payload.get('author')
  const toolbar = payload.get('toolbar')
  const stateKey = viewModel.get('toolbarStateKey').string
  const state = stateKey ? e.toolbarStates.get(stateKey) : undefined
  const heartState = state?.get('heartState').string
  const surfaceKey = viewModel.get('toolbarSurfaceKey').string
  const surface = surfaceKey ? e.toolbarSurfaces.get(surfaceKey) : undefined
  const action = (command: string): string | null =>
    surface?.get(command).findFirst('performCommentActionEndpoint').get('action').string ?? null
  const likeState = state?.get('likeState').string
  const avatar = author.get('avatarThumbnailUrl').string
  return {
    id: properties.get('commentId').string ?? viewModel.get('commentId').string ?? key,
    authorName: author.get('displayName').string ?? '',
    authorAvatar: avatar ? youtubeImage(avatar) : null,
    authorChannelId: author.get('channelId').string,
    text: properties.at('content', 'content').string ?? '',
    publishedText: properties.get('publishedTime').string,
    likeCountText: nonEmpty(toolbar.get('likeCountNotliked').string),
    replyCountText: nonEmpty(toolbar.get('replyCount').string),
    repliesToken,
    isPinned: viewModel.get('pinnedText').exists,
    isCreator: author.get('isCreator').bool ?? false,
    isHearted: heartState === 'TOOLBAR_HEART_STATE_HEARTED',
    replyParams: surface?.findFirst('createReplyParams').string ?? null,
    likeToken: action('likeCommand'),
    unlikeToken: action('unlikeCommand'),
    dislikeToken: action('dislikeCommand'),
    undislikeToken: action('undislikeCommand'),
    likeState: likeState === 'TOOLBAR_LIKE_STATE_LIKED' ? 'LIKED' : likeState === 'TOOLBAR_LIKE_STATE_DISLIKED' ? 'DISLIKED' : 'INDIFFERENT',
    likeCountLikedText: nonEmpty(toolbar.get('likeCountLiked').string),
  }
}

export function parseComments(json: JNode): { page: CommentsPage; sortOptions: CommentSortOption[] } {
  const e = entities(json)
  const items: JNode[] = []
  for (const endpoint of json.get('onResponseReceivedEndpoints').array) {
    for (const key of endpoint.keys.sort()) items.push(...endpoint.get(key).get('continuationItems').array)
  }

  const comments: Comment[] = []
  let continuation: string | null = null
  let countText: string | null = null
  const sortOptions: CommentSortOption[] = []
  for (const item of items) {
    if (item.get('commentsHeaderRenderer').exists) {
      const header = item.get('commentsHeaderRenderer')
      countText = header.get('countText').text ?? header.get('commentsCount').text
      for (const option of header.findAll('subMenuItems')[0]?.array ?? []) {
        const title = option.get('title').string
        const token = option.findFirst('continuationCommand').get('token').string
        if (title && token) sortOptions.push({ title, token })
      }
    } else if (item.get('commentThreadRenderer').exists) {
      const thread = item.get('commentThreadRenderer')
      const repliesToken =
        thread.at('replies', 'commentRepliesRenderer').findFirst('continuationCommand').get('token').string
      const comment = build(e, thread.at('commentViewModel', 'commentViewModel'), repliesToken)
      if (comment) comments.push(comment)
    } else if (item.get('commentViewModel').exists) {
      const comment = build(e, item.get('commentViewModel'), null)
      if (comment) comments.push(comment)
    } else if (item.get('continuationItemRenderer').exists) {
      continuation = item.get('continuationItemRenderer').findFirst('continuationCommand').get('token').string
    }
  }
  return {
    page: { comments, continuation, countText, createParams: json.findFirst('createCommentParams').string },
    sortOptions,
  }
}

/** The comment returned by `create_comment` / `create_comment_reply`, when it can be read. */
export function parseCreatedComment(json: JNode): Comment | null {
  const e = entities(json)
  for (const candidate of json.findAll('commentViewModel')) {
    const viewModel = candidate.get('commentViewModel').exists ? candidate.get('commentViewModel') : candidate
    const comment = build(e, viewModel, null)
    if (comment) return comment
  }
  return null
}
