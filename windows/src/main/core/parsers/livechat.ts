// Live chat (port of `LiveChatParser.kt`).

import type { LiveChatInfo, LiveChatMessage } from '@shared/models'
import { JNode } from '../json'

export interface LiveChatChunk {
  messages: LiveChatMessage[]
  removedIds: string[]
  continuation: string | null
  seekContinuation: string | null
  timeoutMs: number | null
  sendParams: string | null
  restrictedMessage: string | null
}

/**
 * `conversationBar.liveChatRenderer` of the `next` response. Only its main reload token is
 * usable: the per-view tokens in that response's menu are a short form the chat endpoints
 * reject; the chat page itself lists usable ones (`modes`).
 */
export function liveChatInfo(watch: JNode): LiveChatInfo | null {
  const renderer = watch.at('conversationBar', 'liveChatRenderer')
  if (!renderer.exists) return null
  let token: string | null = null
  for (const entry of renderer.get('continuations').array) {
    token = entry.at('reloadContinuationData', 'continuation').string
    if (token) break
  }
  if (!token) return null
  const items = renderer.findFirst('subMenuItems').array
  const selected = items.find((item) => item.get('selected').bool === true) ?? items[0]
  const title = selected?.get('title').text ?? 'Trò chuyện'
  return { modes: [{ title, continuation: token }], isReplay: renderer.get('isReplay').bool ?? false }
}

/** "Top chat" / "Live chat" (or their replays) from the chat page's header. */
export function liveChatModes(json: JNode): { title: string; continuation: string }[] {
  const result: { title: string; continuation: string }[] = []
  for (const item of json.findFirst('subMenuItems').array) {
    const token = item.at('continuation', 'reloadContinuationData', 'continuation').string
    if (token) result.push({ title: item.get('title').text ?? 'Trò chuyện', continuation: token })
  }
  return result
}

export function parseLiveChat(json: JNode): LiveChatChunk {
  // API responses use continuationContents; the chat frame's ytInitialData uses contents.
  let content = json.at('continuationContents', 'liveChatContinuation')
  if (!content.exists) content = json.at('contents', 'liveChatRenderer')
  const messages: LiveChatMessage[] = []
  const removed: string[] = []
  for (const action of content.get('actions').array) collect(action, null, messages, removed)
  // The answer to send_message carries the posted message the same way.
  if (!content.exists) for (const action of json.get('actions').array) collect(action, null, messages, removed)

  let continuation: string | null = null
  let timeout: number | null = null
  let seek: string | null = null
  for (const entry of content.get('continuations').array) {
    for (const key of ['invalidationContinuationData', 'timedContinuationData', 'reloadContinuationData', 'liveChatReplayContinuationData']) {
      if (continuation === null) {
        const token = entry.at(key, 'continuation').string
        if (token) {
          continuation = token
          timeout = entry.at(key, 'timeoutMs').int
        }
      }
    }
    const seekToken = entry.at('playerSeekContinuationData', 'continuation').string
    if (seekToken) seek = seekToken
  }
  return {
    messages,
    removedIds: removed,
    continuation,
    seekContinuation: seek,
    timeoutMs: timeout,
    sendParams: json.findFirst('sendLiveChatMessageEndpoint').get('params').string,
    restrictedMessage: json.findFirst('liveChatRestrictedParticipationRenderer').get('message').text,
  }
}

function collect(action: JNode, offset: number | null, messages: LiveChatMessage[], removed: string[]): void {
  const replay = action.get('replayChatItemAction')
  if (replay.exists) {
    const replayOffset = replay.get('videoOffsetTimeMsec').long
    for (const inner of replay.get('actions').array) collect(inner, replayOffset, messages, removed)
    return
  }
  const removedId =
    action.at('markChatItemAsDeletedAction', 'targetItemId').string ?? action.at('removeChatItemAction', 'targetItemId').string
  if (removedId) {
    removed.push(removedId)
    return
  }
  const item = action.at('addChatItemAction', 'item')
  if (!item.exists) return
  const parsed = message(item)
  if (parsed) messages.push({ ...parsed, offsetMs: offset })
}

const kinds = [
  'liveChatTextMessageRenderer', 'liveChatPaidMessageRenderer', 'liveChatPaidStickerRenderer',
  'liveChatMembershipItemRenderer', 'liveChatViewerEngagementMessageRenderer',
  'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer', 'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer',
]

function message(item: JNode): LiveChatMessage | null {
  const key = kinds.find((k) => item.get(k).exists)
  if (!key) return null
  const renderer = item.get(key)
  const id = renderer.get('id').string
  if (!id) return null
  let isOwner = false
  let isModerator = false
  let isMember = false
  for (const badge of renderer.get('authorBadges').array) {
    const badgeRenderer = badge.get('liveChatAuthorBadgeRenderer')
    const icon = badgeRenderer.at('icon', 'iconType').string
    if (icon === 'OWNER') isOwner = true
    else if (icon === 'MODERATOR') isModerator = true
    else if (icon !== 'VERIFIED' && badgeRenderer.get('customThumbnail').exists) isMember = true
  }
  let author = renderer.get('authorName').text ?? ''
  let photo = renderer.get('authorPhoto').bestImageUrl
  let text = chatText(renderer.get('message'))
  let amount: string | null = null
  switch (key) {
    case 'liveChatPaidMessageRenderer':
    case 'liveChatPaidStickerRenderer':
      amount = renderer.get('purchaseAmountText').text ?? ''
      break
    case 'liveChatMembershipItemRenderer': {
      const header = renderer.get('headerPrimaryText').text ?? renderer.get('headerSubtext').text ?? 'Hội viên mới'
      text = text ? `${header}: ${text}` : header
      break
    }
    case 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer':
    case 'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer': {
      const header = renderer.findFirst('liveChatSponsorshipsHeaderRenderer')
      if (!author) author = header.get('authorName').text ?? ''
      if (!photo) photo = header.get('authorPhoto').bestImageUrl
      text = header.get('primaryText').text ?? text
      break
    }
  }
  if (!text && key === 'liveChatTextMessageRenderer') return null
  return { id, author, authorPhoto: photo, message: text, amount, isOwner, isModerator, isMember }
}

/** Message runs: text plus emoji (Unicode emoji as is, channel emotes as `:shortcut:`). */
export function chatText(node: JNode): string {
  const simple = node.get('simpleText').string
  if (simple !== null) return simple
  return node
    .get('runs')
    .array.map((run) => {
      const text = run.get('text').string
      if (text !== null) return text
      const emoji = run.get('emoji')
      if (emoji.get('isCustomEmoji').bool === true) {
        return emoji.get('shortcuts').get(0).string ?? emoji.at('image', 'accessibility', 'accessibilityData', 'label').string ?? ''
      }
      return emoji.get('emojiId').string ?? emoji.get('shortcuts').get(0).string ?? ''
    })
    .join('')
}
