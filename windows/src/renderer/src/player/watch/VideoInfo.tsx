// Below the player: title, channel row with "Đăng ký", and the action buttons (like /
// dislike, share, download, save, audio only, ⋯).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ChannelItem, VideoItem, WatchInfo } from '@shared/models'
import { SaveToPlaylistDialog } from '@/components/SaveToPlaylistDialog'
import { api, errorMessage } from '@/lib/api'
import { copyVideoLink, downloadVideo } from '@/lib/actions'
import { paths } from '@/lib/nav'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { usePlayer } from '@/state/player'
import { settings, useSettings } from '@/state/settings'
import { PIcon } from '../ui/icons'
import { MenuItem, Popover, useMenu } from '../ui/Popover'
import { sleepLabel } from '../ui/SettingsMenu'
import { shortCount } from './RichText'

export function ChannelAvatar({ channel, size = 40 }: { channel: Pick<ChannelItem, 'name' | 'avatar'>; size?: number }) {
  return channel.avatar ? (
    <img className="dp-avatar" src={channel.avatar} alt="" width={size} height={size} />
  ) : (
    <span className="dp-avatar dp-avatar--letter" style={{ width: size, height: size }}>
      {channel.name.charAt(0).toUpperCase()}
    </span>
  )
}

/** Local subscription + the account's when signed in. */
export function useSubscription(channel: ChannelItem | null | undefined, accountState?: boolean | null) {
  const local = useLibrary((s) => (channel ? s.subscriptions.some((c) => c.id === channel.id) : false))
  const [override, setOverride] = useState<boolean | null>(null)
  useEffect(() => setOverride(null), [channel?.id])
  const subscribed = override ?? (local || !!accountState)
  const toggle = async () => {
    if (!channel) return
    const next = !subscribed
    setOverride(next)
    const library = useLibrary.getState()
    if (next) library.subscribe(channel)
    else library.unsubscribe(channel.id)
    toast(next ? `Đã đăng ký ${channel.name}` : `Đã hủy đăng ký ${channel.name}`)
    if (useAccount.getState().signedIn && !settings().incognito) {
      try {
        await api.subscribe(channel.id, next)
      } catch (error) {
        toast(errorMessage(error))
      }
    }
  }
  return { subscribed, toggle }
}

/** Like / dislike shared by the watch page and Shorts (local library + the account). */
export function useRating(video: VideoItem, watch: WatchInfo | null) {
  const localLiked = useLibrary((s) => s.liked.some((v) => v.id === video.id))
  const signedIn = useAccount((s) => s.signedIn)
  /** What the user clicked here; null = as YouTube / the library says. */
  const [rating, setRating] = useState<'like' | 'dislike' | 'none' | null>(null)
  useEffect(() => setRating(null), [video.id])
  const accountLike = watch?.videoId === video.id ? watch.likeStatus : null
  const liked = rating ? rating === 'like' : localLiked || accountLike === 'LIKE'
  const disliked = rating ? rating === 'dislike' : accountLike === 'DISLIKE'
  const rate = (action: 'like' | 'dislike') => {
    const active = action === 'like' ? liked : disliked
    const next = active ? 'none' : action
    setRating(next)
    useLibrary.getState().setLiked(video, next === 'like')
    if (next === 'like') toast('Đã thêm vào Video đã thích')
    if (signedIn && !settings().incognito) {
      api.rate(video.id, next === 'none' ? 'remove' : next).catch((error) => toast(errorMessage(error)))
    }
  }
  return { liked, disliked, rate }
}

function Dislikes({ videoId }: { videoId: string }) {
  const show = useSettings((s) => s.settings.showDislikes)
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    setCount(null)
    if (!show) return
    let alive = true
    api
      .dislikes(videoId)
      .then((n) => alive && setCount(n))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [videoId, show])
  return show && count != null ? <span className="dp-pill-count">{shortCount(count)}</span> : null
}

export function VideoInfo({ video, watch }: { video: VideoItem; watch: WatchInfo | null }) {
  const info = watch?.videoId === video.id ? watch : null
  const channel: ChannelItem | null = info?.channel ?? (video.channelId ? { id: video.channelId, name: video.channelName ?? '', avatar: video.channelAvatar } : null)
  const { subscribed, toggle } = useSubscription(channel, info?.isSubscribed)
  const { liked, disliked, rate } = useRating(video, info)
  const audioOnly = usePlayer((s) => s.audioOnly)
  const share = useMenu()
  const download = useMenu()
  const more = useMenu()
  const sleep = useMenu()
  const [saving, setSaving] = useState(false)
  const title = info?.title || video.title

  return (
    <div className="dp-info">
      <h1 className="dp-title" data-testid="watch-title">
        {title || 'Đang tải…'}
      </h1>
      <div className="dp-info-row">
        {channel ? (
          <div className="dp-channel">
            <Link to={paths.channel(channel.id)} className="dp-channel-link" data-testid="watch-channel">
              <ChannelAvatar channel={channel} />
              <span className="dp-channel-text">
                <span className="dp-channel-name">{channel.name}</span>
                {channel.subscriberText ? <span className="dp-channel-subs">{channel.subscriberText}</span> : null}
              </span>
            </Link>
            <button type="button" className={'dp-subscribe' + (subscribed ? ' dp-subscribe--on' : '')} onClick={() => void toggle()}>
              {subscribed ? (
                <>
                  <PIcon name="bell" size={20} /> Đã đăng ký
                </>
              ) : (
                'Đăng ký'
              )}
            </button>
          </div>
        ) : (
          <div />
        )}
        <div className="dp-actions">
          <div className="dp-pill-group">
            <button type="button" className={'dp-pill' + (liked ? ' dp-pill--on' : '')} onClick={() => rate('like')} aria-pressed={liked} title="Tôi thích video này">
              <PIcon name={liked ? 'like' : 'likeOutline'} size={22} />
              <span className="dp-pill-count">{info?.likeCountText || 'Thích'}</span>
            </button>
            <span className="dp-pill-divider" />
            <button type="button" className={'dp-pill' + (disliked ? ' dp-pill--on' : '')} onClick={() => rate('dislike')} aria-pressed={disliked} title="Tôi không thích video này">
              <PIcon name={disliked ? 'dislike' : 'dislikeOutline'} size={22} />
              <Dislikes videoId={video.id} />
            </button>
          </div>
          <button type="button" className="dp-pill" onClick={share.open}>
            <PIcon name="share" size={22} /> Chia sẻ
          </button>
          <button type="button" className="dp-pill" onClick={download.open} disabled={!!video.isLive}>
            <PIcon name="download" size={22} /> Tải xuống
          </button>
          <button type="button" className="dp-pill" onClick={() => setSaving(true)}>
            <PIcon name="save" size={22} /> Lưu
          </button>
          <button
            type="button"
            className={'dp-pill dp-pill--icon' + (audioOnly ? ' dp-pill--on' : '')}
            title={audioOnly ? 'Bật lại hình' : 'Chỉ âm thanh'}
            aria-pressed={audioOnly}
            onClick={() => usePlayer.getState().setAudioOnly(!audioOnly)}
          >
            <PIcon name="headphones" size={22} />
          </button>
          <button type="button" className="dp-pill dp-pill--icon" aria-label="Thêm" onClick={more.open}>
            <PIcon name="more" size={22} />
          </button>
        </div>
      </div>

      {share.anchor ? (
        <Popover anchor={share.anchor} onClose={share.close}>
          <MenuItem
            icon="link"
            label="Sao chép đường liên kết"
            onSelect={() => {
              share.close()
              void copyVideoLink(video)
            }}
          />
          <MenuItem
            icon="share"
            label={`Sao chép liên kết tại ${formatPosition()}`}
            onSelect={() => {
              share.close()
              void copyVideoLink(video, usePlayer.getState().currentTime)
            }}
          />
        </Popover>
      ) : null}
      {download.anchor ? (
        <Popover anchor={download.anchor} onClose={download.close}>
          <MenuItem
            icon="download"
            label="Video"
            detail={`≤ ${settings().downloadQuality}p`}
            onSelect={() => {
              download.close()
              void downloadVideo(video, false)
            }}
          />
          <MenuItem
            icon="headphones"
            label="Chỉ âm thanh (m4a)"
            onSelect={() => {
              download.close()
              void downloadVideo(video, true)
            }}
          />
        </Popover>
      ) : null}
      {more.anchor ? (
        <Popover anchor={more.anchor} onClose={more.close} align="end">
          <MenuItem
            icon="bedtime"
            label="Hẹn giờ tắt"
            onSelect={() => {
              const anchor = more.anchor
              more.close()
              if (anchor) sleep.open({ currentTarget: anchor })
            }}
          />
          <MenuItem
            icon="openExternal"
            label="Mở trên YouTube"
            onSelect={() => {
              more.close()
              api.openExternal(`https://www.youtube.com/watch?v=${video.id}`).catch(() => {})
            }}
          />
          <MenuItem
            icon="info"
            label="Thống kê chuyên sâu"
            onSelect={() => {
              more.close()
              usePlayer.getState().setStats(!usePlayer.getState().stats)
            }}
          />
          <MenuItem
            icon="window"
            label="Cửa sổ nhỏ luôn ở trên"
            onSelect={() => {
              more.close()
              api.setWindowMode('mini').catch(() => toast('Không đổi được chế độ cửa sổ'))
            }}
          />
        </Popover>
      ) : null}
      {sleep.anchor ? (
        <Popover anchor={sleep.anchor} onClose={sleep.close} align="end">
          <MenuItem
            label="Tắt"
            checked={!usePlayer.getState().sleepEndsAt && !usePlayer.getState().sleepAtEnd}
            onSelect={() => {
              sleep.close()
              usePlayer.getState().setSleepTimer(null)
            }}
          />
          {[5, 10, 15, 30, 45, 60, 90, 120].map((m) => (
            <MenuItem
              key={m}
              label={sleepLabel(m)}
              checked={false}
              onSelect={() => {
                sleep.close()
                usePlayer.getState().setSleepTimer(m)
              }}
            />
          ))}
          <MenuItem
            label="Hết video"
            checked={usePlayer.getState().sleepAtEnd}
            onSelect={() => {
              sleep.close()
              usePlayer.getState().setSleepTimer(0)
            }}
          />
        </Popover>
      ) : null}
      {saving ? <SaveToPlaylistDialog video={video} onClose={() => setSaving(false)} /> : null}
    </div>
  )
}

function formatPosition(): string {
  const t = Math.floor(usePlayer.getState().currentTime)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
