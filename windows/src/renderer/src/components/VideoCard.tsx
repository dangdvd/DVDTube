// Video thumbnail + title + metadata, with the ⋮ menu (Xem sau, Thêm vào hàng đợi, Lưu vào danh
// sách phát, Tải xuống, Chia sẻ, Không quan tâm…). The player module uses it for the related
// list and the queue, so the props below stay compatible (new ones are optional).

import { memo, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type { VideoItem } from '@shared/models'
import { paths, watchPath } from '@/lib/nav'
import { addToQueue, copyVideoLink, dontRecommendChannel, downloadVideo, notInterested, playNext, toggleWatchLater } from '@/lib/actions'
import { useBranding, useSeen } from '@/lib/dearrow'
import { useDownloads } from '@/lib/downloads'
import { useCast } from '@/state/cast'
import { useLibrary } from '@/state/library'
import { useSettings } from '@/state/settings'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { MenuButton, type MenuEntry } from './Menu'
import { SaveToPlaylistDialog } from './SaveToPlaylistDialog'
import { Thumbnail } from './Thumbnail'

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
  /** Shows a ✕ button (e.g. "Xóa khỏi nhật ký"). */
  onRemove?: (video: VideoItem) => void
  removeLabel?: string
  /** Router state passed when opening the video (e.g. a queue). Defaults to `{ video }`. */
  linkState?: unknown
  /** Overrides the watch URL (e.g. inside a playlist). */
  to?: string
  /** Hides the ⋮ menu. */
  noMenu?: boolean
  /** Hides the channel name (channel pages). */
  hideChannel?: boolean
}

/** Entries of a video's ⋮ menu. `onSave` opens the "Lưu vào danh sách phát" dialog. */
export function videoMenuEntries(video: VideoItem, onSave: () => void, extra?: { label: string; onSelect: () => void }[]): MenuEntry[] {
  const library = useLibrary.getState()
  const downloaded = useDownloads.getState().isDownloaded(video.id)
  const quality = useSettings.getState().settings.downloadQuality
  const entries: MenuEntry[] = []
  if (extra?.length) {
    entries.push(...extra.map((e) => ({ label: e.label, onSelect: e.onSelect })), 'divider')
  }
  entries.push(
    { label: 'Thêm vào hàng đợi', icon: 'addQueue', onSelect: () => addToQueue(video), testId: 'menu-queue' },
    { label: 'Phát tiếp theo', icon: 'playNext', onSelect: () => playNext(video) },
    'divider',
    {
      label: library.isWatchLater(video.id) ? 'Xóa khỏi Xem sau' : 'Lưu vào Xem sau',
      icon: 'watchLater',
      onSelect: () => toggleWatchLater(video),
      testId: 'menu-watch-later',
    },
    { label: 'Lưu vào danh sách phát', icon: 'playlistAdd', onSelect: onSave, testId: 'menu-save' },
    downloaded
      ? { label: 'Đã tải xuống', icon: 'downloadDone', onSelect: () => (location.hash = '#' + paths.downloads) }
      : {
          label: 'Tải xuống',
          icon: 'download',
          disabled: !!video.isLive,
          submenu: {
            title: 'Tải xuống',
            items: [
              { label: 'Video', detail: `${quality}p`, icon: 'monitor', onSelect: () => void downloadVideo(video, false) },
              { label: 'Chỉ âm thanh', detail: 'm4a', icon: 'headphones', onSelect: () => void downloadVideo(video, true) },
            ],
          },
        },
    { label: 'Chia sẻ', icon: 'share', onSelect: () => void copyVideoLink(video) },
    ...castMenuEntries(video),
    'divider',
    { label: 'Không quan tâm', icon: 'block', onSelect: () => notInterested(video) },
  )
  if (video.channelId) entries.push({ label: 'Không đề xuất kênh này', icon: 'minusCircle', onSelect: () => dontRecommendChannel(video) })
  return entries
}

/** "Truyền tới TV" / "Thêm vào hàng đợi trên TV" (straight to the connected receiver, if any). */
export function castMenuEntries(video: VideoItem): MenuEntry[] {
  if (video.isLive && !video.id) return []
  const cast = useCast.getState()
  const device = cast.connected
  if (device) {
    return [
      { label: `Phát trên ${device.name}`, icon: 'cast', onSelect: () => void cast.send(video), testId: 'menu-cast' },
      { label: `Thêm vào hàng đợi trên ${device.name}`, icon: 'tv', onSelect: () => void cast.queue(video, false) },
    ]
  }
  return [
    { label: 'Truyền tới TV', icon: 'cast', onSelect: () => cast.openPicker(video, 'play'), testId: 'menu-cast' },
    { label: 'Thêm vào hàng đợi trên TV', icon: 'tv', onSelect: () => cast.openPicker(video, 'queue') },
  ]
}

function statsLine(video: VideoItem): string {
  return [video.viewCountText, video.publishedText].filter(Boolean).join(' • ')
}

export const VideoCard = memo(function VideoCard({
  video,
  layout = 'grid',
  onClick,
  extraMenu,
  active,
  index,
  onRemove,
  removeLabel = 'Xóa',
  linkState,
  to,
  noMenu,
  hideChannel,
}: VideoCardProps) {
  const [saving, setSaving] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const seen = useSeen(root)
  const branding = useBranding(video, seen)
  const tooltip = branding.originalTitle ? `${branding.title}\nTiêu đề gốc: ${branding.originalTitle}` : video.title
  const href = to ?? (video.isShort && !onClick ? paths.shorts(video.id) : watchPath(video.id))
  const state = linkState ?? { video }
  const handle = (e: MouseEvent) => {
    if (onClick) {
      e.preventDefault()
      onClick(video)
    }
  }
  const channelHref = video.channelId ? paths.channel(video.channelId) : null
  const stats = statsLine(video)

  const menu = !noMenu && (
    <div className="vcard-menu">
      <MenuButton items={() => videoMenuEntries(video, () => setSaving(true), extraMenu)} size={layout === 'compact' ? 36 : 40} testId="video-menu" />
    </div>
  )
  const remove = onRemove && (
    <button
      className="icon-btn vcard-remove"
      aria-label={removeLabel}
      title={removeLabel}
      onClick={(e) => {
        e.preventDefault()
        onRemove(video)
      }}
    >
      <Icon name="close" />
    </button>
  )
  const channel =
    !hideChannel && video.channelName ? (
      channelHref ? (
        <Link to={channelHref} className="vcard-channel" title={video.channelName} onClick={(e) => e.stopPropagation()}>
          {video.channelName}
        </Link>
      ) : (
        <span className="vcard-channel">{video.channelName}</span>
      )
    ) : null

  const thumbnail = (
    <Link to={href} state={state} className="vcard-thumb" onClick={handle} data-testid="video-link" tabIndex={-1} aria-hidden>
      <Thumbnail video={video} replacement={branding.thumbnail} />
    </Link>
  )
  const title = (
    <Link to={href} state={state} className="vcard-title" title={tooltip} onClick={handle}>
      {branding.title}
    </Link>
  )

  let body
  if (layout === 'grid') {
    body = (
      <>
        {thumbnail}
        <div className="vcard-details">
          {!hideChannel &&
            (channelHref ? (
              <Link to={channelHref} className="vcard-avatar" tabIndex={-1} aria-hidden>
                <Avatar src={video.channelAvatar} name={video.channelName} size={36} />
              </Link>
            ) : (
              <span className="vcard-avatar">
                <Avatar src={video.channelAvatar} name={video.channelName} size={36} />
              </span>
            ))}
          <div className="vcard-text">
            {title}
            {channel && <div className="vcard-meta">{channel}</div>}
            {stats && <div className="vcard-meta">{stats}</div>}
          </div>
          {menu}
        </div>
      </>
    )
  } else if (layout === 'list') {
    body = (
      <>
        {index !== undefined && <span className="vcard-index">{index}</span>}
        {thumbnail}
        <div className="vcard-text">
          <div className="vcard-title-row">
            {title}
            {remove}
            {menu}
          </div>
          {stats && <div className="vcard-meta">{stats}</div>}
          {channel && (
            <div className="vcard-channel-row">
              <Avatar src={video.channelAvatar} name={video.channelName} size={24} />
              {channel}
            </div>
          )}
          {video.isLive && <span className="vcard-live-chip">TRỰC TIẾP</span>}
        </div>
      </>
    )
  } else {
    body = (
      <>
        {index !== undefined && <span className="vcard-index">{active ? <Icon name="play" size={12} /> : index}</span>}
        {thumbnail}
        <div className="vcard-text">
          {title}
          {channel && <div className="vcard-meta">{channel}</div>}
          {stats && <div className="vcard-meta">{stats}</div>}
        </div>
        {remove}
        {menu}
      </>
    )
  }

  return (
    <div ref={root} className={`vcard vcard--${layout}` + (active ? ' is-active' : '')} data-testid="video-card" data-video-id={video.id} data-layout={layout}>
      {body}
      {saving && <SaveToPlaylistDialog video={video} onClose={() => setSaving(false)} />}
    </div>
  )
})

/** Grey placeholder with the same shape as a card while a feed loads. */
export function VideoCardSkeleton({ layout = 'grid' }: { layout?: 'grid' | 'list' | 'compact' }) {
  return (
    <div className={`vcard vcard--${layout} vcard--skeleton`} aria-hidden>
      <div className="vcard-thumb">
        <div className="thumb skeleton" />
      </div>
      {layout === 'grid' ? (
        <div className="vcard-details">
          <span className="vcard-avatar">
            <span className="skeleton skeleton-circle" style={{ width: 36, height: 36 }} />
          </span>
          <div className="vcard-text">
            <div className="skeleton skeleton-line" style={{ width: '92%' }} />
            <div className="skeleton skeleton-line" style={{ width: '60%' }} />
          </div>
        </div>
      ) : (
        <div className="vcard-text">
          <div className="skeleton skeleton-line" style={{ width: '90%', height: layout === 'list' ? 20 : 14 }} />
          <div className="skeleton skeleton-line" style={{ width: '50%' }} />
          {layout === 'list' && <div className="skeleton skeleton-line" style={{ width: '35%' }} />}
        </div>
      )}
    </div>
  )
}

export function SkeletonGrid({ count = 12, layout = 'grid' }: { count?: number; layout?: 'grid' | 'list' | 'compact' }) {
  return (
    <div className={layout === 'grid' ? 'feed-grid' : 'feed-list'} data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <VideoCardSkeleton key={i} layout={layout} />
      ))}
    </div>
  )
}
