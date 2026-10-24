// Channel, playlist and Shorts cards, plus the Shorts shelf and generic horizontal shelves.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ChannelItem, PlaylistItem, VideoItem } from '@shared/models'
import { isMix } from '@shared/models'
import { paths, watchPath } from '@/lib/nav'
import { Avatar } from './Avatar'
import { HScroll } from './Chips'
import { Icon } from './Icon'
import { MenuButton } from './Menu'
import { SubscribeButton } from './SubscribeButton'
import { Thumbnail } from './Thumbnail'
import { SaveToPlaylistDialog } from './SaveToPlaylistDialog'
import { videoMenuEntries } from './VideoCard'

export function ChannelCard({ channel, layout = 'grid' }: { channel: ChannelItem; layout?: 'grid' | 'list' }) {
  const href = paths.channel(channel.id)
  const meta = [channel.handle, channel.subscriberText].filter(Boolean).join(' • ')
  if (layout === 'list') {
    return (
      <div className="ccard ccard--list" data-testid="channel-card">
        <Link to={href} className="ccard-avatar-col">
          <Avatar src={channel.avatar} name={channel.name} size={136} />
        </Link>
        <Link to={href} className="ccard-text">
          <div className="ccard-name">{channel.name}</div>
          {meta && <div className="ccard-meta">{meta}</div>}
          {channel.videoCountText && <div className="ccard-meta">{channel.videoCountText}</div>}
        </Link>
        <SubscribeButton channel={channel} />
      </div>
    )
  }
  return (
    <div className="ccard ccard--grid" data-testid="channel-card">
      <Link to={href} className="ccard-link">
        <Avatar src={channel.avatar} name={channel.name} size={136} />
        <div className="ccard-name">{channel.name}</div>
        {meta && <div className="ccard-meta">{meta}</div>}
      </Link>
      <SubscribeButton channel={channel} size="small" />
    </div>
  )
}

/** Where a playlist card leads: mixes start playing at once, other playlists open their page. */
export function playlistHref(playlist: PlaylistItem): string {
  if (isMix(playlist.id) && playlist.id.length >= 13) return watchPath(playlist.id.slice(2, 13), { list: playlist.id })
  return paths.playlist(playlist.id)
}

export function PlaylistCard({ playlist, layout = 'grid', to }: { playlist: PlaylistItem; layout?: 'grid' | 'list'; to?: string }) {
  const href = to ?? playlistHref(playlist)
  const mix = isMix(playlist.id)
  const thumb = (
    <Link to={href} className="pcard-thumb">
      <div className="pcard-stack" aria-hidden />
      <div className="pcard-image">
        {playlist.thumbnail ? (
          <img src={playlist.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="thumb-placeholder">
            <Icon name="playlist" size={32} />
          </div>
        )}
        <span className="thumb-badge pcard-count">
          <Icon name={mix ? 'live' : 'playlist'} size={16} />
          {mix ? 'Danh sách kết hợp' : (playlist.videoCountText ?? 'Danh sách phát')}
        </span>
        <div className="pcard-hover">
          <Icon name="play" size={20} />
          Phát tất cả
        </div>
      </div>
    </Link>
  )
  return (
    <div className={`pcard pcard--${layout}`} data-testid="playlist-card">
      {thumb}
      <div className="pcard-text">
        <Link to={href} className="pcard-title" title={playlist.title}>
          {playlist.title}
        </Link>
        {playlist.channelName && <div className="vcard-meta">{playlist.channelName}</div>}
        <Link to={href} className="pcard-all">
          {mix ? 'Phát danh sách kết hợp' : 'Xem toàn bộ danh sách phát'}
        </Link>
      </div>
    </div>
  )
}

export function ShortsCard({ video, queue }: { video: VideoItem; queue?: VideoItem[] }) {
  const [saving, setSaving] = useState(false)
  return (
    <div className="scard" data-testid="shorts-card" data-video-id={video.id}>
      <Link to={paths.shorts(video.id)} state={{ video, queue }} className="scard-thumb">
        <Thumbnail video={video} vertical showProgress={false} />
      </Link>
      <div className="scard-details">
        <Link to={paths.shorts(video.id)} state={{ video, queue }} className="scard-title" title={video.title}>
          {video.title}
        </Link>
        <div className="scard-menu">
          <MenuButton items={() => videoMenuEntries(video, () => setSaving(true))} size={32} />
        </div>
      </div>
      {video.viewCountText && <div className="vcard-meta">{video.viewCountText}</div>}
      {saving && <SaveToPlaylistDialog video={video} onClose={() => setSaving(false)} />}
    </div>
  )
}

/** A titled horizontal row (Shorts shelf, "Tiếp tục xem", library sections). */
export function Shelf({
  title,
  icon,
  action,
  children,
  className,
  testId,
}: {
  title: ReactNode
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section className={'shelf' + (className ? ' ' + className : '')} data-testid={testId}>
      <div className="shelf-header">
        {icon}
        <h2 className="shelf-title">{title}</h2>
        <div className="shelf-action">{action}</div>
      </div>
      <HScroll className="shelf-scroll" arrowClass="shelf-arrow">
        {children}
      </HScroll>
    </section>
  )
}

export function ShortsShelf({ items, title = 'Shorts' }: { items: VideoItem[]; title?: string }) {
  if (!items.length) return null
  return (
    <Shelf title={title} icon={<Icon name="shorts" size={26} className="shelf-shorts-icon" />} className="shelf--shorts" testId="shorts-shelf">
      {items.map((v) => (
        <ShortsCard key={v.id} video={v} queue={items} />
      ))}
    </Shelf>
  )
}
