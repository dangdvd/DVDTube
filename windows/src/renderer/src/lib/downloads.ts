// Downloads as the renderer sees them: the finished ones (`api.downloads()`) plus the ones in
// progress, tracked from `download` events. The main process does not report its queue, so
// videos started from this window are remembered here (needed for the title and for retry).

import { create } from 'zustand'
import type { DownloadState, DownloadedVideo, VideoItem } from '@shared/models'
import { api, errorMessage, onEvent } from './api'

export interface ActiveDownload {
  video: VideoItem
  audioOnly: boolean
  status: DownloadState
  startedAt: number
}

interface DownloadsStore {
  active: Record<string, ActiveDownload>
  finished: DownloadedVideo[]
  loaded: boolean
  error: string | null
  refresh(): Promise<void>
  start(video: VideoItem, audioOnly: boolean): Promise<void>
  cancel(videoId: string): Promise<void>
  retry(videoId: string): Promise<void>
  dismiss(videoId: string): void
  remove(videoId: string): Promise<void>
  isDownloaded(videoId: string): boolean
}

export const useDownloads = create<DownloadsStore>((set, get) => ({
  active: {},
  finished: [],
  loaded: false,
  error: null,

  async refresh() {
    try {
      const finished = await api.downloads()
      set({ finished: [...finished].sort((a, b) => b.downloadedAt - a.downloadedAt), loaded: true, error: null })
    } catch (error) {
      set({ loaded: true, error: errorMessage(error) })
    }
  },
  async start(video, audioOnly) {
    set({ active: { ...get().active, [video.id]: { video, audioOnly, status: { state: 'queued' }, startedAt: Date.now() } } })
    try {
      await api.download(video, { audioOnly })
    } catch (error) {
      setStatus(video.id, { state: 'failed', message: errorMessage(error) })
      throw error
    }
  },
  async cancel(videoId) {
    await api.cancelDownload(videoId).catch(() => {})
    const active = { ...get().active }
    delete active[videoId]
    set({ active })
  },
  async retry(videoId) {
    const item = get().active[videoId]
    if (item)
      await get()
        .start(item.video, item.audioOnly)
        .catch(() => {})
  },
  dismiss(videoId) {
    const active = { ...get().active }
    delete active[videoId]
    set({ active })
  },
  async remove(videoId) {
    await api.deleteDownload(videoId)
    set({ finished: get().finished.filter((d) => d.video.id !== videoId) })
  },
  isDownloaded(videoId) {
    return get().finished.some((d) => d.video.id === videoId)
  },
}))

function setStatus(videoId: string, status: DownloadState, eventVideo?: VideoItem | null) {
  const { active, finished } = useDownloads.getState()
  if (status.state === 'done') {
    const rest = { ...active }
    delete rest[videoId]
    useDownloads.setState({ active: rest, finished: [status.entry, ...finished.filter((d) => d.video.id !== videoId)] })
    return
  }
  if (status.state === 'cancelled') {
    const rest = { ...active }
    delete rest[videoId]
    useDownloads.setState({ active: rest })
    return
  }
  const known = active[videoId]
  const video: VideoItem = known?.video ?? eventVideo ?? { id: videoId, title: 'Video ' + videoId }
  useDownloads.setState({
    active: { ...active, [videoId]: { video, audioOnly: known?.audioOnly ?? false, status, startedAt: known?.startedAt ?? Date.now() } },
  })
}

let started = false

export function startDownloadSync(): void {
  if (started) return
  started = true
  onEvent('download', (event) => setStatus(event.videoId, event.status, event.video))
  void useDownloads.getState().refresh()
}

/** "1,2 GB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value >= 100 || unit < 2 ? 0 : 1
  return value.toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }) + ' ' + units[unit]
}
