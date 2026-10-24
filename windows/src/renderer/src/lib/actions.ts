// Actions on a video used from several places (menus, watch page). OWNED BY THE UI PAGES
// MODULE (stub); the watch page uses these.
import type { VideoItem } from '@shared/models'
import { shareUrl } from '@shared/models'
import { api } from './api'
import { toast } from './toast'

/** Copies the video link (optionally at a time) to the clipboard. */
export async function copyVideoLink(video: VideoItem, atSeconds?: number): Promise<void> {
  const url = shareUrl(video) + (atSeconds && atSeconds > 0 ? `?t=${Math.floor(atSeconds)}` : '')
  await navigator.clipboard.writeText(url)
  toast('Đã sao chép đường liên kết')
}

/** Starts a download (video ≤ the download quality setting, or audio only). */
export async function downloadVideo(video: VideoItem, audioOnly: boolean): Promise<void> {
  await api.download(video, { audioOnly })
  toast(audioOnly ? 'Đang tải âm thanh…' : 'Đang tải xuống…')
}
