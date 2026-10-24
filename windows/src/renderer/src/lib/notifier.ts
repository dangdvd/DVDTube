// "Video mới từ kênh đăng ký": about once an hour, fetch the newest uploads of the local
// subscriptions and show a system notification for the ones not seen before. The first run
// only records what exists, so installing the app does not flood the user.

import type { VideoItem } from '@shared/models'
import { useLibrary } from '@/state/library'
import { settings } from '@/state/settings'
import { api } from './api'
import { APP_ROUTE_PREFIX } from './links'
import { load, saveSoon } from './persist'

interface NotifierData {
  seen: string[]
  initialized: boolean
}

const INTERVAL_MS = 60 * 60_000
const FIRST_CHECK_MS = 90_000
const MAX_SEEN = 1000
const MAX_AGE_MS = 3 * 86_400_000

let timer: ReturnType<typeof setTimeout> | null = null

async function check(): Promise<void> {
  const s = settings()
  const channels = useLibrary.getState().subscriptions
  if (!s.notifyNewVideos || !channels.length) return
  const data = (await load<NotifierData>('notifier')) ?? { seen: [], initialized: false }
  let videos: VideoItem[]
  try {
    videos = await api.latestVideos(channels.map((c) => c.id))
  } catch {
    return
  }
  const seen = new Set(data.seen)
  const now = Date.now()
  const fresh = videos.filter((v) => !seen.has(v.id) && !v.isShort && (!v.publishedDate || now - v.publishedDate < MAX_AGE_MS))
  if (data.initialized && fresh.length) {
    for (const video of fresh.slice(0, 3)) {
      await api
        .notify(video.channelName ?? 'Video mới', video.title, 'https://www.youtube.com/watch?v=' + video.id, video.thumbnail ?? null)
        .catch(() => {})
    }
    if (fresh.length > 3) {
      await api.notify('Video mới từ kênh đăng ký', `Và ${fresh.length - 3} video mới khác`, APP_ROUTE_PREFIX + 'feed/subscriptions').catch(() => {})
    }
  }
  const ids = [...videos.map((v) => v.id), ...data.seen.filter((id) => !videos.some((v) => v.id === id))].slice(0, MAX_SEEN)
  saveSoon('notifier', { seen: ids, initialized: true } satisfies NotifierData, 0)
}

export function startNotifier(): () => void {
  const loop = (delay: number) => {
    timer = setTimeout(async () => {
      await check().catch(() => {})
      loop(INTERVAL_MS)
    }, delay)
  }
  if (!timer) loop(FIRST_CHECK_MS)
  return () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
}
