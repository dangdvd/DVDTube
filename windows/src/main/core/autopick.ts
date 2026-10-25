// What "Tự động tải video mới" downloads and removes (no Electron here, so it can be tested).

import { networkInterfaces } from 'node:os'
import type { DownloadedVideo, VideoItem } from '@shared/models'

/** On a PC "Chỉ khi dùng Wi-Fi" means: not only over a mobile / cellular connection. */
export function unmeteredNetwork(interfaces = networkInterfaces()): boolean {
  let any = false
  for (const [name, entries] of Object.entries(interfaces)) {
    const up = (entries ?? []).some((e) => !e.internal && (e.family === 'IPv4' ? !e.address.startsWith('169.254.') : !e.address.startsWith('fe80')))
    if (!up) continue
    if (/cellular|mobile broadband|wwan|rmnet|ppp|^usb\d|modem/i.test(name)) continue
    any = true
  }
  return any
}

/** The newest N regular uploads of a channel that still need downloading. */
export function candidates(videos: VideoItem[], channelId: string, keep: number, now = Date.now()): VideoItem[] {
  return videos
    .filter((v) => v.channelId === channelId && !v.isShort && !v.isLive && !(v.publishedDate && v.publishedDate > now))
    .sort((a, b) => (b.publishedDate ?? 0) - (a.publishedDate ?? 0))
    .slice(0, keep)
}

/** Automatic downloads of a channel beyond the newest `keep` (to delete). */
export function surplus(entries: DownloadedVideo[], channelId: string, keep: number): DownloadedVideo[] {
  return entries
    .filter((e) => e.isAuto && e.video.channelId === channelId)
    .sort((a, b) => (b.video.publishedDate ?? b.downloadedAt) - (a.video.publishedDate ?? a.downloadedAt))
    .slice(Math.max(0, keep))
}

