// Opening pasted / external links: YouTube URLs, youtu.be, dvdtube://, @handles → app routes.

import type { NavigateFunction } from 'react-router-dom'
import type { ResolvedLink } from '@shared/models'
import { isMix } from '@shared/models'
import { api, errorMessage } from './api'
import { paths, watchPath } from './nav'
import { toast } from './toast'
import { useUi } from './ui'

/** `dvdtube://app/<route>` opens a page of the app directly (used by our own notifications). */
export const APP_ROUTE_PREFIX = 'dvdtube://app/'

/** Text that should be resolved as a link instead of searched. */
export function looksLikeLink(text: string): boolean {
  const t = text.trim()
  if (!t || /\s/.test(t)) return false
  return /^(https?:\/\/|www\.|m\.youtube\.|music\.youtube\.|youtube\.com\/|youtu\.be\/|dvdtube:\/\/)/i.test(t) || /^@[\w.-]{3,}$/.test(t)
}

export function routeFor(link: ResolvedLink): string {
  switch (link.type) {
    case 'video':
      return watchPath(link.videoId, { list: link.playlistId, t: link.startSeconds })
    case 'shorts':
      return paths.shorts(link.videoId)
    case 'channel':
      return paths.channel(link.channelId)
    case 'playlist':
      return isMix(link.playlistId) && link.playlistId.length >= 13
        ? watchPath(link.playlistId.slice(2, 13), { list: link.playlistId })
        : paths.playlist(link.playlistId)
    case 'search':
      return paths.search(link.query)
    case 'app':
      return link.page === 'shorts' ? paths.shorts() : link.page === 'music' ? paths.music : paths.home
  }
}

/** Resolves a link through the main process and opens the matching page. */
export async function openLink(text: string, navigate: NavigateFunction, options?: { replace?: boolean; quiet?: boolean }): Promise<boolean> {
  if (text.startsWith(APP_ROUTE_PREFIX)) {
    navigate('/' + text.slice(APP_ROUTE_PREFIX.length), { replace: options?.replace })
    return true
  }
  try {
    const link = await api.resolveLink(text.trim())
    if (!link) {
      if (!options?.quiet) toast('Không mở được liên kết')
      return false
    }
    // "Tìm kiếm" (Jump List / Dock menu): the search box of the current page.
    if (link.type === 'app' && link.page === 'search') {
      useUi.getState().focusSearch()
      return true
    }
    navigate(routeFor(link), { replace: options?.replace })
    return true
  } catch (error) {
    if (!options?.quiet) toast('Không mở được liên kết: ' + errorMessage(error))
    return false
  }
}
