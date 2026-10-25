// Cards of the feeds: videos (16:9), Shorts (9:16), channels, playlists and music items. Focus
// scales the card and adds a white glow; long OK (or the red key) opens the video's options.

import type { ChannelItem, FeedItem, MusicItem, PlaylistItem, VideoItem } from '@shared/models'
import { metadataLine } from '@shared/models'
import { useBranding } from '../dearrow'
import { play } from '../player/controller'
import { library, libraryStore } from '../state/library'
import { nav, toast } from '../state/nav'
import { useStore } from '../store'
import { Avatar, LazyImg, useLongPress } from './base'
import { choose } from './dialogs'
import { Icon } from './icons'

function thumbFallback(video: VideoItem): string {
  return `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
}

// MARK: Video options ("⋮")

export async function videoOptions(video: VideoItem, extra: { label: string; run: () => void; icon?: string }[] = []): Promise<void> {
  const later = library.isWatchLater(video.id)
  const playlists = libraryStore.get().playlists
  const options = [
    ...extra.map((e) => ({ label: e.label, icon: e.icon, run: e.run })),
    { label: later ? 'Xóa khỏi Xem sau' : 'Lưu vào Xem sau', icon: 'later', run: () => toast(library.toggleWatchLater(video) ? 'Đã lưu vào Xem sau' : 'Đã xóa khỏi Xem sau') },
    { label: 'Lưu vào danh sách phát trên máy', icon: 'playlist', run: () => void saveToLocalPlaylist(video, playlists.length) },
    ...(video.channelId
      ? [{ label: `Mở kênh ${video.channelName ?? ''}`.trim(), icon: 'account', run: () => nav.open({ name: 'channel', channel: { id: video.channelId!, name: video.channelName ?? '' } }) }]
      : []),
    {
      label: 'Không quan tâm',
      icon: 'hide',
      run: () => {
        library.markNotInterested(video.id)
        toast('Đã ẩn video này')
      },
    },
  ]
  const chosen = await choose(video.title, options.map((o) => ({ label: o.label, icon: o.icon })), 820)
  if (chosen !== null) options[chosen].run()
}

async function saveToLocalPlaylist(video: VideoItem, count: number): Promise<void> {
  const playlists = libraryStore.get().playlists
  const chosen = await choose(
    'Lưu vào danh sách phát trên máy',
    [{ label: 'Danh sách phát mới', icon: 'add' }, ...playlists.map((p) => ({ label: p.name, value: `${p.videos.length} video`, selected: p.videos.some((v) => v.id === video.id) }))],
    760,
  )
  if (chosen === null) return
  if (chosen === 0) {
    const created = library.createPlaylist(`Danh sách ${count + 1}`, video)
    toast(`Đã tạo ${created.name}`)
    return
  }
  const playlist = playlists[chosen - 1]
  if (playlist.videos.some((v) => v.id === video.id)) {
    library.removeFromPlaylist(playlist.id, video.id)
    toast(`Đã xóa khỏi ${playlist.name}`)
  } else {
    library.addToPlaylist(playlist.id, video)
    toast(`Đã lưu vào ${playlist.name}`)
  }
}

// MARK: Cards

export function VideoCard(props: {
  video: VideoItem
  queue?: VideoItem[]
  onClick?: () => void
  progress?: number | null
  focusKey?: string
  autofocus?: boolean
  wide?: boolean
  small?: boolean
  onOptions?: () => void
}) {
  const { video } = props
  const { title, thumbnail } = useBranding(video)
  const key = props.focusKey ?? `v-${video.id}`
  const progress = useStore(libraryStore, (s) => {
    if (props.progress != null) return props.progress
    const p = s.progress[video.id]
    return p && p.duration > 0 ? Math.min(1, p.position / p.duration) : 0
  })
  const options = props.onOptions ?? (() => void videoOptions(video))
  const longPress = useLongPress(options)
  return (
    <div
      class={`card video-card${props.wide ? ' wide' : ''}${props.small ? ' small' : ''}`}
      data-f
      tabIndex={-1}
      role="button"
      data-key={key}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid="video-card"
      data-video-id={video.id}
      ref={longPress}
      onClick={() => (props.onClick ? props.onClick() : play(video, { queue: props.queue }))}
    >
      <div class="thumb">
        <LazyImg src={thumbnail || thumbFallback(video)} fallback={thumbFallback(video)} />
        {video.isLive ? <span class="badge live">TRỰC TIẾP</span> : video.durationText ? <span class="badge">{video.durationText}</span> : null}
        {progress > 0.01 && (
          <div class="progress">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div class="card-text">
        <div class="card-title">{title}</div>
        <div class="card-meta">{metadataLine(video)}</div>
      </div>
    </div>
  )
}

export function ShortCard(props: { video: VideoItem; list: VideoItem[]; focusKey?: string; autofocus?: boolean }) {
  const { video } = props
  const { title, thumbnail } = useBranding(video)
  return (
    <div
      class="card short-card"
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey ?? `s-${video.id}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid="short-card"
      data-video-id={video.id}
      onClick={() => nav.openShorts(props.list, video)}
    >
      <div class="thumb vertical">
        <LazyImg src={thumbnail || `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`} fallback={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} />
      </div>
      <div class="card-text">
        <div class="card-title two">{title}</div>
        {video.viewCountText && <div class="card-meta">{video.viewCountText}</div>}
      </div>
    </div>
  )
}

export function ChannelCard(props: { channel: ChannelItem; focusKey?: string; autofocus?: boolean; onClick?: () => void }) {
  const { channel } = props
  return (
    <div
      class="card channel-card"
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey ?? `c-${channel.id}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid="channel-card"
      onClick={() => (props.onClick ? props.onClick() : nav.open({ name: 'channel', channel }))}
    >
      <div class="channel-avatar">
        <Avatar src={channel.avatar} name={channel.name} size={168} />
      </div>
      <div class="card-text center">
        <div class="card-title one">{channel.name}</div>
        <div class="card-meta">{channel.subscriberText ?? channel.handle ?? ''}</div>
      </div>
    </div>
  )
}

export function PlaylistCard(props: { playlist: PlaylistItem; focusKey?: string; autofocus?: boolean; onClick?: () => void; subtitle?: string | null }) {
  const { playlist } = props
  return (
    <div
      class="card video-card playlist-card"
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey ?? `p-${playlist.id}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid="playlist-card"
      onClick={() => (props.onClick ? props.onClick() : nav.open({ name: 'playlist', playlist }))}
    >
      <div class="thumb">
        <LazyImg src={playlist.thumbnail} />
        <div class="playlist-overlay">
          <Icon name="playlist" size={40} />
          <span>{playlist.videoCountText ?? 'Danh sách phát'}</span>
        </div>
      </div>
      <div class="card-text">
        <div class="card-title">{playlist.title}</div>
        <div class="card-meta">{props.subtitle ?? playlist.channelName ?? ''}</div>
      </div>
    </div>
  )
}

/** One item of a feed page (videos, channels, playlists; a Shorts shelf is shown elsewhere). */
export function FeedCard(props: { item: FeedItem; queue: VideoItem[]; autofocus?: boolean; prefix?: string }) {
  const { item } = props
  const p = props.prefix ?? 'f'
  switch (item.type) {
    case 'video':
      return item.video.isShort ? (
        <ShortCard video={item.video} list={props.queue.filter((v) => v.isShort)} focusKey={`${p}-s-${item.video.id}`} autofocus={props.autofocus} />
      ) : (
        <VideoCard video={item.video} queue={props.queue} focusKey={`${p}-v-${item.video.id}`} autofocus={props.autofocus} />
      )
    case 'channel':
      return <ChannelCard channel={item.channel} focusKey={`${p}-c-${item.channel.id}`} autofocus={props.autofocus} />
    case 'playlist':
      return <PlaylistCard playlist={item.playlist} focusKey={`${p}-p-${item.playlist.id}`} autofocus={props.autofocus} />
    default:
      return null
  }
}

export function MusicCard(props: { item: MusicItem; onClick: () => void; focusKey?: string; autofocus?: boolean; square?: boolean }) {
  const { item } = props
  const round = item.type === 'artist'
  return (
    <div
      class={`card music-card${round ? ' artist' : ''}${item.type === 'video' ? ' video' : ''}`}
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey ?? `m-${item.type}-${item.id}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid="music-card"
      onClick={props.onClick}
    >
      <div class={`thumb ${item.type === 'video' ? '' : 'square'}${round ? ' round' : ''}`}>
        <LazyImg src={item.thumbnail} />
        {item.durationText && item.type === 'video' && <span class="badge">{item.durationText}</span>}
      </div>
      <div class="card-text">
        <div class="card-title two">{item.title}</div>
        <div class="card-meta">{item.subtitle ?? item.artists ?? ''}</div>
      </div>
    </div>
  )
}

/** A compact row for lists (music tracks, queue). */
export function TrackRow(props: { item: MusicItem; index?: number; onClick: () => void; focusKey?: string; autofocus?: boolean; playing?: boolean }) {
  const { item } = props
  return (
    <div
      class={`track${props.playing ? ' playing' : ''}`}
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey ?? `t-${item.id}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid="music-track"
      onClick={props.onClick}
    >
      {props.index !== undefined && <span class="track-index">{props.index + 1}</span>}
      <LazyImg src={item.thumbnail} class="track-art" />
      <div class="track-text">
        <div class="track-title">{item.title}</div>
        <div class="track-sub">{item.artists ?? item.subtitle ?? ''}</div>
      </div>
      {item.durationText && <span class="track-duration">{item.durationText}</span>}
    </div>
  )
}
