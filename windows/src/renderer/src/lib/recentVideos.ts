// Recent unfinished videos for the taskbar Jump List (Windows) and the Dock menu (macOS).

import { useLibrary } from '@/state/library'
import { api } from './api'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false

function push(): void {
  timer = null
  const items = useLibrary
    .getState()
    .history.filter((h) => !h.video.isLive && h.position > 10 && (!h.duration || h.position < h.duration - 15))
    .slice(0, 5)
    .map((h) => ({ id: h.video.id, title: h.video.title || 'Video', position: h.position }))
  api.setRecentVideos(items).catch(() => {})
}

export function startRecentVideos(): void {
  if (started) return
  started = true
  useLibrary.subscribe((s, prev) => {
    if (s.history !== prev.history && !timer) timer = setTimeout(push, 3000)
  })
  push()
}
