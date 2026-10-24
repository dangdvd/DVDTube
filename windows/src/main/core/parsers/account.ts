// Account pages (port of `AccountParser`): profile, account switcher, playlists, notifications.

import { randomUUID } from 'node:crypto'
import type { AccountIdentity, AccountNotification, AccountPlaylistOption, AccountProfile } from '@shared/models'
import { JNode } from '../json'

/** `account/account_menu` → the active account's name, handle and avatar. */
export function parseProfile(json: JNode): AccountProfile | null {
  const header = json.findFirst('activeAccountHeaderRenderer')
  const name = header.get('accountName').text
  if (name === null) return null
  // "Your channel" in the menu links to the account's channel.
  const channelId =
    json
      .findAll('browseEndpoint')
      .map((e) => e.get('browseId').string)
      .find((id): id is string => !!id && id.startsWith('UC')) ?? null
  return {
    name,
    handle: header.get('channelHandle').text,
    email: header.get('email').text,
    avatar: header.get('accountPhoto').bestImageUrl,
    channelId,
  }
}

export function identityId(authUser: number, pageId: string | null | undefined): string {
  return `${authUser}|${pageId ?? ''}`
}

/**
 * Account switcher: every signed-in Google account and its brand channels.
 * `authuser` / `pageid` come from each item's sign-in URL or page id token.
 */
export function parseIdentities(json: JNode): AccountIdentity[] {
  const result: AccountIdentity[] = []
  const seen = new Set<string>()
  json.findAll('accountSectionListRenderer').forEach((section, index) => {
    const header = section.findFirst('googleAccountHeaderRenderer')
    const email = header.get('email').text
    const items = [...section.findAll('accountItem'), ...section.findAll('accountItemRenderer')]
    for (const item of items) {
      const name = item.get('accountName').text
      if (name === null) continue
      let authUser: number | null = null
      let pageId: string | null = null
      for (const token of item.findAll('supportedTokens').flatMap((t) => t.array)) {
        const page = token.at('pageIdToken', 'pageId').string
        if (page) pageId = page
        const signin = token.at('accountSigninToken', 'signinUrl').string
        if (signin) {
          try {
            const url = new URL(signin.startsWith('/') ? 'https://www.youtube.com' + signin : signin)
            const user = url.searchParams.get('authuser')
            if (user !== null && /^\d+$/.test(user)) authUser = parseInt(user, 10)
            const pid = url.searchParams.get('pageid')
            if (pid && pageId === null) pageId = pid
          } catch {
            // ignore malformed sign-in URLs
          }
        }
      }
      const user = authUser ?? index
      const identity: AccountIdentity = {
        id: identityId(user, pageId),
        authUser: user,
        pageId,
        name,
        byline: item.get('channelHandle').text ?? item.get('accountByline').text,
        email: email ?? (pageId === null ? item.get('accountByline').text : null),
        avatar: item.get('accountPhoto').bestImageUrl,
        isSelected: item.get('isSelected').bool ?? false,
        hasChannel: item.get('hasChannel').bool ?? true,
      }
      if (!seen.has(identity.id)) {
        seen.add(identity.id)
        result.push(identity)
      }
    }
  })
  return result
}

export function parsePlaylistOptions(json: JNode): AccountPlaylistOption[] {
  const result: AccountPlaylistOption[] = []
  for (const option of json.findAll('playlistAddToOptionRenderer')) {
    const id = option.get('playlistId').string
    if (!id) continue
    result.push({ id, title: option.get('title').text ?? id, containsVideo: option.get('containsSelectedVideos').string === 'ALL' })
  }
  return result
}

export function parseNotifications(json: JNode): AccountNotification[] {
  const result: AccountNotification[] = []
  for (const item of json.findAll('notificationRenderer')) {
    const message = item.get('shortMessage').text
    if (message === null) continue
    result.push({
      id: item.get('notificationId').string ?? randomUUID(),
      message,
      timeText: item.get('sentTimeText').text,
      avatar: item.get('thumbnail').bestImageUrl,
      thumbnail: item.get('videoThumbnail').bestImageUrl,
      videoId: item.findFirst('watchEndpoint').get('videoId').string,
      isRead: item.get('read').bool ?? true,
    })
  }
  return result
}
