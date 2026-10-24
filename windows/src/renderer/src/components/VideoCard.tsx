// Video thumbnail + title + metadata, with the ⋮ menu (Xem sau, Thêm vào hàng đợi, Lưu vào danh
// sách phát, Tải xuống, Chia sẻ, Không quan tâm…). OWNED BY THE UI PAGES MODULE (stub for now);
// the player module uses it for the related list and the queue, so keep these props.

import type { VideoItem } from '@shared/models'
import { useNavigate } from 'react-router-dom'
import { watchPath } from '@/lib/nav'

export interface VideoCardProps {
  video: VideoItem
  /** grid = home/search tiles, list = wide rows (search, playlists), compact = watch-page sidebar. */
  layout?: 'grid' | 'list' | 'compact'
  /** Replaces the default action (open the watch page). */
  onClick?: (video: VideoItem) => void
  /** Extra entries shown first in the ⋮ menu. */
  extraMenu?: { label: string; onSelect: () => void }[]
  /** Highlights the card (e.g. the video playing in a queue). */
  active?: boolean
  /** Position number shown on the left (playlists, queue). */
  index?: number
}

export function VideoCard({ video, onClick }: VideoCardProps) {
  const navigate = useNavigate()
  return (
    <div onClick={() => (onClick ? onClick(video) : navigate(watchPath(video.id), { state: { video } }))}>
      {video.title}
    </div>
  )
}
