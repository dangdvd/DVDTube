// DeArrow on the TV: replacement titles / thumbnails for the cards being shown, asked in batches
// (the service caches them for an hour and limits concurrent requests). Rendering never waits:
// cards show the original first and switch when the answer arrives.

import type { DeArrowBranding, VideoItem } from '@shared/models'
import { api } from './api'
import { settings } from './state/settings'
import { createStore, useStore } from './store'

const cache = new Map<string, DeArrowBranding>()
const queued = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

export const brandingStore = createStore<{ version: number }>({ version: 0 })

function flush(): void {
  timer = null
  const ids = Array.from(queued).slice(0, 100)
  for (const id of ids) queued.delete(id)
  if (!ids.length) return
  api
    .dearrow(ids)
    .then((result) => {
      for (const id of ids) cache.set(id, result[id] ?? {})
      brandingStore.set({ version: brandingStore.get().version + 1 })
    })
    .catch(() => {
      for (const id of ids) cache.set(id, {})
    })
  if (queued.size) timer = setTimeout(flush, 150)
}

function request(id: string): void {
  if (cache.has(id) || queued.has(id)) return
  queued.add(id)
  if (!timer) timer = setTimeout(flush, 150)
}

export function branded(video: VideoItem): { title: string; thumbnail: string | null | undefined; originalTitle: string | null } {
  const s = settings()
  if (!s.dearrow) return { title: video.title, thumbnail: video.thumbnail, originalTitle: null }
  const b = cache.get(video.id)
  if (!b) {
    request(video.id)
    return { title: video.title, thumbnail: video.thumbnail, originalTitle: null }
  }
  const title = s.dearrowTitles && b.title ? b.title : video.title
  return {
    title,
    thumbnail: s.dearrowThumbnails && b.thumbnail ? b.thumbnail : video.thumbnail,
    originalTitle: title !== video.title ? video.title : null,
  }
}

/** Re-renders the component when new branding arrived. */
export function useBranding(video: VideoItem): ReturnType<typeof branded> {
  useStore(brandingStore, (s) => s.version)
  return branded(video)
}
