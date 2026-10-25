// DeArrow in the UI: cards ask for the branding of the videos actually on screen (batched,
// the main process limits and caches the requests); the original title / thumbnail shows first
// and is swapped once a replacement is known and its image has loaded. The original title stays
// available as the tooltip "Tiêu đề gốc".

import { useEffect, useState, type RefObject } from 'react'
import { create } from 'zustand'
import type { DeArrowBranding, VideoItem } from '@shared/models'
import { useSettings } from '@/state/settings'
import { api } from './api'

const useBrandings = create<{ map: Record<string, DeArrowBranding> }>(() => ({ map: {} }))

const requested = new Set<string>()
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  timer = null
  const ids = [...queue].slice(0, 100)
  for (const id of ids) queue.delete(id)
  if (queue.size) timer = setTimeout(flush, 100)
  if (!ids.length) return
  api
    .dearrow(ids)
    .then((map) => useBrandings.setState({ map: { ...useBrandings.getState().map, ...map } }))
    .catch(() => ids.forEach((id) => requested.delete(id)))
}

function request(id: string): void {
  if (requested.has(id)) return
  requested.add(id)
  queue.add(id)
  if (!timer) timer = setTimeout(flush, 80)
}

/** True once the element has been (nearly) on screen. */
export function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, seen])
  return seen
}

export interface Branding {
  title: string
  /** Set when the title was replaced. */
  originalTitle: string | null
  thumbnail: string | null
}

/** The DeArrow title / thumbnail of a video (originals until known; `visible` gates the request). */
export function useBranding(video: Pick<VideoItem, 'id' | 'title'>, visible = true): Branding {
  const enabled = useSettings((s) => s.settings.dearrow)
  const titles = useSettings((s) => s.settings.dearrowTitles)
  const thumbnails = useSettings((s) => s.settings.dearrowThumbnails)
  const branding = useBrandings((s) => s.map[video.id])
  useEffect(() => {
    if (enabled && (titles || thumbnails) && visible && video.id) request(video.id)
  }, [enabled, titles, thumbnails, visible, video.id])
  const title = enabled && titles && branding?.title ? branding.title : null
  return {
    title: title ?? video.title,
    originalTitle: title && title !== video.title ? video.title : null,
    thumbnail: enabled && thumbnails ? (branding?.thumbnail ?? null) : null,
  }
}

const loadedImages = new Map<string, boolean>()

/** `url` once the image has loaded with real pixels (null before / on error). */
export function useLoadedImage(url: string | null): string | null {
  const [ready, setReady] = useState<string | null>(url && loadedImages.get(url) ? url : null)
  useEffect(() => {
    if (!url) {
      setReady(null)
      return
    }
    const known = loadedImages.get(url)
    if (known !== undefined) {
      setReady(known ? url : null)
      return
    }
    let alive = true
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => {
      const ok = image.naturalWidth > 1 && image.naturalHeight > 1
      loadedImages.set(url, ok)
      if (alive) setReady(ok ? url : null)
    }
    image.onerror = () => {
      loadedImages.set(url, false)
      if (alive) setReady(null)
    }
    image.src = url
    return () => {
      alive = false
    }
  }, [url])
  return ready
}
