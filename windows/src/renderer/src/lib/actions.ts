// Actions on a video or channel used from several places (⋮ menus, watch page, channel page).
// Each one updates the local library first and mirrors it to the account when signed in.

import type { ChannelItem, VideoItem } from '@shared/models'
import { shareUrl } from '@shared/models'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { usePlayer } from '@/state/player'
import { api, errorMessage } from './api'
import { useDownloads } from './downloads'
import { toast } from './toast'

const signedIn = () => useAccount.getState().signedIn

/** Copies the video link (optionally at a time) to the clipboard. */
export async function copyVideoLink(video: VideoItem, atSeconds?: number): Promise<void> {
  const url = shareUrl(video) + (atSeconds && atSeconds > 0 ? `?t=${Math.floor(atSeconds)}` : '')
  await copyText(url)
  toast('Đã sao chép đường liên kết')
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API refused (no focus): fall back to a hidden textarea.
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

/** Starts a download (video ≤ the download quality setting, or audio only). */
export async function downloadVideo(video: VideoItem, audioOnly: boolean): Promise<void> {
  if (video.isLive) {
    toast('Không thể tải xuống video trực tiếp')
    return
  }
  try {
    await useDownloads.getState().start(video, audioOnly)
    toast(audioOnly ? 'Đang tải âm thanh…' : 'Đang tải xuống…', { action: { label: 'Xem', run: () => (location.hash = '#/downloads') } })
  } catch (error) {
    toast('Không tải xuống được: ' + errorMessage(error))
  }
}

/** Queues several downloads (playlist "Tải xuống tất cả"). */
export async function downloadAll(videos: VideoItem[], audioOnly = false): Promise<void> {
  const list = videos.filter((v) => !v.isLive && !useDownloads.getState().isDownloaded(v.id))
  if (!list.length) {
    toast('Tất cả video đã được tải xuống')
    return
  }
  for (const video of list)
    await useDownloads
      .getState()
      .start(video, audioOnly)
      .catch(() => {})
  toast(`Đã thêm ${list.length} video vào hàng chờ tải xuống`, { action: { label: 'Xem', run: () => (location.hash = '#/downloads') } })
}

export function addToQueue(video: VideoItem): void {
  const hadCurrent = !!usePlayer.getState().current
  usePlayer.getState().addToQueue(video)
  toast(hadCurrent ? 'Đã thêm vào hàng đợi' : 'Đang phát')
}

export function playNext(video: VideoItem): void {
  const hadCurrent = !!usePlayer.getState().current
  usePlayer.getState().playNext(video)
  toast(hadCurrent ? 'Video sẽ phát tiếp theo' : 'Đang phát')
}

export function toggleWatchLater(video: VideoItem): void {
  const added = useLibrary.getState().toggleWatchLater(video)
  if (signedIn()) api.editPlaylist('WL', added ? video.id : null, added ? null : video.id).catch(() => {})
  toast(added ? 'Đã lưu vào Xem sau' : 'Đã xóa khỏi Xem sau', {
    action: { label: 'Hoàn tác', run: () => toggleWatchLater(video) },
  })
}

export function notInterested(video: VideoItem): void {
  useLibrary.getState().markNotInterested(video.id)
  toast('Đã ẩn video. Bạn sẽ không thấy video này trong đề xuất nữa.', {
    action: { label: 'Hoàn tác', run: () => useLibrary.getState().unmarkNotInterested(video.id) },
  })
}

export function dontRecommendChannel(video: VideoItem): void {
  if (!video.channelId) return
  const id = video.channelId
  useLibrary.getState().blockChannel(id, video.channelName ?? undefined)
  toast(`Sẽ không đề xuất kênh ${video.channelName ?? 'này'} nữa`, {
    action: { label: 'Hoàn tác', run: () => useLibrary.getState().unblockChannel(id) },
  })
}

/** Subscribes / unsubscribes locally and on the account. Returns the new state. */
export async function setSubscribed(channel: ChannelItem, subscribe: boolean): Promise<boolean> {
  const library = useLibrary.getState()
  if (subscribe) library.subscribe(channel)
  else library.unsubscribe(channel.id)
  if (signedIn()) {
    try {
      await api.subscribe(channel.id, subscribe)
    } catch (error) {
      toast(errorMessage(error))
    }
  }
  toast(subscribe ? `Đã đăng ký ${channel.name}` : `Đã hủy đăng ký ${channel.name}`)
  return subscribe
}
