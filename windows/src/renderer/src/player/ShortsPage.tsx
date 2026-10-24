// Routes /shorts and /shorts/:id: a vertical feed of Shorts (like the mobile apps): one
// centered 9:16 player, wheel / ↑↓ / PageUp / PageDown to move, click to pause, loop,
// actions on the right (like, dislike, comments, share, channel, subscribe).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { VideoItem, WatchInfo } from '@shared/models'
import { DEFAULT_SEARCH_FILTERS, feedVideos, shortsThumbnail } from '@shared/models'
import { api, errorMessage } from '@/lib/api'
import { copyVideoLink, downloadVideo } from '@/lib/actions'
import { paths } from '@/lib/nav'
import { useLibrary } from '@/state/library'
import { usePlayer } from '@/state/player'
import { settings, useSettings } from '@/state/settings'
import { pauseShorts, playShort, prefetchShortInfo, preloadShort, shortsVideo, stopShorts } from './shorts/shortsPlayer'
import { volumeIcon } from './ui/Controls'
import { PIcon, type PlayerIconName } from './ui/icons'
import { MenuItem, Popover, useMenu } from './ui/Popover'
import { Spinner } from './ui/Overlays'
import { Comments } from './watch/Comments'
import { ChannelAvatar, useRating, useSubscription } from './watch/VideoInfo'

const QUERIES_VI = ['shorts', 'shorts việt nam', 'hài hước shorts', 'âm nhạc shorts', 'ẩm thực shorts', 'thể thao shorts']
const QUERIES_EN = ['shorts', 'funny shorts', 'music shorts', 'food shorts', 'sports shorts']

const watchInfos = new Map<string, Promise<WatchInfo>>()
function watchInfo(id: string): Promise<WatchInfo> {
  let promise = watchInfos.get(id)
  if (!promise) {
    promise = api.watchInfo(id)
    promise.catch(() => watchInfos.delete(id))
    watchInfos.set(id, promise)
    if (watchInfos.size > 40) watchInfos.delete(watchInfos.keys().next().value!)
  }
  return promise
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'))
}

function ShortAction({ icon, label, onClick, active }: { icon: PlayerIconName; label?: string | null; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; active?: boolean }) {
  return (
    <button type="button" className={'dp-short-action' + (active ? ' dp-short-action--on' : '')} onClick={onClick}>
      <span className="dp-short-action-circle">
        <PIcon name={icon} size={24} />
      </span>
      {label ? <span className="dp-short-action-label">{label}</span> : null}
    </button>
  )
}

function ShortsProgress() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      const v = shortsVideo()
      if (ref.current) ref.current.style.width = `${v.duration > 0 ? (v.currentTime / v.duration) * 100 : 0}%`
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      className="dp-short-progress"
      onClick={(e) => {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        const v = shortsVideo()
        if (v.duration > 0) v.currentTime = ((e.clientX - rect.left) / rect.width) * v.duration
      }}
    >
      <div ref={ref} />
    </div>
  )
}

function VideoHolder() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.append(shortsVideo())
  }, [])
  return <div ref={ref} className="dp-short-video-holder" />
}

function ShortSlide({
  video,
  active,
  status,
  error,
  paused,
  onToggle,
  onRetry,
  onComments,
}: {
  video: VideoItem
  active: boolean
  status: 'loading' | 'playing' | 'error'
  error: string | null
  paused: boolean
  onToggle: () => void
  onRetry: () => void
  onComments: (video: VideoItem) => void
}) {
  const [info, setInfo] = useState<WatchInfo | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    watchInfo(video.id)
      .then((value) => alive && setInfo(value))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [active, video.id])
  const channel = info?.channel ?? (video.channelId ? { id: video.channelId, name: video.channelName ?? '', avatar: video.channelAvatar } : null)
  const { subscribed, toggle } = useSubscription(channel, info?.isSubscribed)
  const { liked, disliked, rate } = useRating(video, info)
  const more = useMenu()
  const volume = useSettings((s) => s.settings.volume)
  const muted = useSettings((s) => s.settings.muted)

  return (
    <div className="dp-short-slide" data-testid={active ? 'short-active' : undefined}>
      <div className="dp-short-stage">
        <div className="dp-short-player" onClick={active ? onToggle : undefined}>
          <img className="dp-short-poster" src={shortsThumbnail(video)} alt="" onError={(e) => ((e.currentTarget.src = video.thumbnail ?? ''), undefined)} />
          {active ? <VideoHolder /> : null}
          {active && status === 'loading' ? <Spinner /> : null}
          {active && status === 'playing' && paused ? (
            <div className="dp-short-paused">
              <PIcon name="play" size={56} />
            </div>
          ) : null}
          {active && status === 'error' ? (
            <div className="dp-short-error" onClick={(e) => e.stopPropagation()}>
              <div>{error ?? 'Không phát được video'}</div>
              <button type="button" className="dp-btn dp-btn--light" onClick={onRetry}>
                Thử lại
              </button>
            </div>
          ) : null}
          <div className="dp-short-top" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="dp-short-icon" aria-label={paused ? 'Phát' : 'Tạm dừng'} onClick={onToggle}>
              <PIcon name={paused ? 'play' : 'pause'} size={22} />
            </button>
            <button
              type="button"
              className="dp-short-icon"
              aria-label="Âm lượng"
              onClick={() => useSettings.getState().update({ muted: !muted })}
            >
              <PIcon name={volumeIcon(volume, muted)} size={22} />
            </button>
          </div>
          <div className="dp-short-bottom" onClick={(e) => e.stopPropagation()}>
            {channel ? (
              <div className="dp-short-channel">
                <Link to={paths.channel(channel.id)} className="dp-short-channel-link">
                  <ChannelAvatar channel={channel} size={36} />
                  <span>{channel.handle ?? channel.name}</span>
                </Link>
                <button type="button" className={'dp-short-subscribe' + (subscribed ? ' dp-short-subscribe--on' : '')} onClick={() => void toggle()}>
                  {subscribed ? 'Đã đăng ký' : 'Đăng ký'}
                </button>
              </div>
            ) : null}
            <div className="dp-short-title">{info?.title || video.title}</div>
          </div>
          {active ? <ShortsProgress /> : null}
        </div>
        <div className="dp-short-actions">
          <ShortAction icon={liked ? 'like' : 'likeOutline'} label={info?.likeCountText ?? 'Thích'} active={liked} onClick={() => rate('like')} />
          <ShortAction icon={disliked ? 'dislike' : 'dislikeOutline'} label="Không thích" active={disliked} onClick={() => rate('dislike')} />
          <ShortAction icon="comment" label={info?.commentCountText ?? 'Bình luận'} onClick={() => onComments(video)} />
          <ShortAction icon="share" label="Chia sẻ" onClick={() => void copyVideoLink({ ...video, isShort: true })} />
          <ShortAction icon="moreVert" onClick={more.open} />
          {channel ? (
            <Link to={paths.channel(channel.id)} className="dp-short-avatar" aria-label={channel.name}>
              <ChannelAvatar channel={channel} size={40} />
            </Link>
          ) : null}
        </div>
      </div>
      {more.anchor ? (
        <Popover anchor={more.anchor} onClose={more.close} align="end">
          <MenuItem
            icon="download"
            label="Tải xuống"
            onSelect={() => {
              more.close()
              void downloadVideo(video, false)
            }}
          />
          <MenuItem
            icon="openExternal"
            label="Mở trên YouTube"
            onSelect={() => {
              more.close()
              api.openExternal(`https://www.youtube.com/shorts/${video.id}`).catch(() => {})
            }}
          />
        </Popover>
      ) : null}
    </div>
  )
}

export function ShortsPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<VideoItem[]>([])
  const [index, setIndex] = useState(0)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading')
  const [playError, setPlayError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [comments, setComments] = useState<WatchInfo | null>(null)
  const feed = useRef({ continuation: null as string | null, query: Math.floor(Math.random() * 6), loading: false })
  const lock = useRef(0)
  const wheel = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const loadMore = useCallback(async (reset: boolean) => {
    const state = feed.current
    if (state.loading) return
    state.loading = true
    setFeedError(null)
    try {
      const queries = settings().language === 'vi' ? QUERIES_VI : QUERIES_EN
      const page =
        state.continuation && !reset
          ? await api.more(state.continuation, 'search')
          : await api.search(queries[state.query++ % queries.length], { ...DEFAULT_SEARCH_FILTERS, type: 'shorts' })
      state.continuation = page.continuation ?? null
      const library = useLibrary.getState()
      const watched = new Set(library.history.slice(0, 300).filter((h) => h.video.isShort).map((h) => h.video.id))
      const existing = new Set(itemsRef.current.map((v) => v.id))
      const videos = feedVideos(page)
      let fresh = videos.filter((v) => v.isShort && !existing.has(v.id) && !watched.has(v.id) && !library.isHidden(v))
      if (!fresh.length) fresh = videos.filter((v) => !existing.has(v.id) && !v.isLive)
      setItems((list) => [...list, ...fresh.map((v) => ({ ...v, isShort: true }))])
      if (!fresh.length && !state.continuation) state.continuation = null
    } catch (error) {
      if (!itemsRef.current.length) setFeedError(errorMessage(error) || 'Không tải được Shorts.')
    } finally {
      state.loading = false
    }
  }, [])

  // Start with the opened Short (if any), then the endless feed.
  useEffect(() => {
    usePlayer.getState().pause()
    const opened = (location.state as { video?: VideoItem } | null)?.video
    if (id && !items.some((v) => v.id === id)) {
      setItems([{ ...(opened?.id === id ? opened : { id, title: '' }), isShort: true }])
      setIndex(0)
    }
    if (!itemsRef.current.length || !id) void loadMore(!itemsRef.current.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Opened another Short while the page was already shown (the first id is handled above).
  const firstId = useRef(id)
  useEffect(() => {
    if (!id || firstId.current === id) {
      firstId.current = undefined
      return
    }
    firstId.current = undefined
    const at = itemsRef.current.findIndex((v) => v.id === id)
    if (at >= 0) {
      if (at !== index) setIndex(at)
      return
    }
    const opened = (location.state as { video?: VideoItem } | null)?.video
    setItems((list) => {
      const next = [...list]
      next.splice(index + 1, 0, { ...(opened?.id === id ? opened : { id, title: '' }), isShort: true })
      return next
    })
    setIndex((i) => (itemsRef.current.length ? i + 1 : 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => () => void stopShorts(), [])

  const current = items[index]

  // Play the current Short; keep the URL on it; preload the next ones.
  useEffect(() => {
    if (!current) return
    let alive = true
    setStatus('loading')
    setPlayError(null)
    setPaused(false)
    setComments(null)
    usePlayer.getState().pause()
    if (current.id !== id) navigate(paths.shorts(current.id), { replace: true, state: { video: current } })
    void playShort(current).then((result) => {
      if (!alive) return
      if (result.ok) {
        setStatus('playing')
        const v = shortsVideo()
        useLibrary.getState().recordWatch(current, 0, current.durationSeconds ?? (Number.isFinite(v.duration) ? v.duration : 0))
        preloadShort(itemsRef.current[index + 1])
        prefetchShortInfo(itemsRef.current[index + 2])
      } else if (result.error) {
        setStatus('error')
        setPlayError(result.error)
      }
    })
    if (index >= items.length - 3) void loadMore(false)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    const v = shortsVideo()
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [])

  const move = useCallback((delta: number) => {
    const now = Date.now()
    if (now < lock.current) return
    lock.current = now + 450
    setIndex((i) => Math.min(Math.max(0, i + delta), Math.max(0, itemsRef.current.length - 1)))
  }, [])

  const toggle = useCallback(() => {
    const v = shortsVideo()
    if (v.paused) void v.play().catch(() => {})
    else pauseShorts()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || document.querySelector('[aria-modal="true"]')) return
      switch (event.key) {
        case 'ArrowDown':
        case 'PageDown':
          event.preventDefault()
          return move(1)
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault()
          return move(-1)
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault()
          return toggle()
        case 'm':
        case 'M':
          return useSettings.getState().update({ muted: !settings().muted })
        case 'ArrowLeft':
        case 'ArrowRight': {
          const v = shortsVideo()
          v.currentTime = Math.max(0, v.currentTime + (event.key === 'ArrowLeft' ? -5 : 5))
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, toggle])

  const onWheel = (event: ReactWheelEvent) => {
    if ((event.target as HTMLElement).closest('.dp-short-comments')) return
    wheel.current += event.deltaY
    if (Math.abs(wheel.current) > 40) {
      move(wheel.current > 0 ? 1 : -1)
      wheel.current = 0
    }
  }

  return (
    <div className={'dp-shorts' + (comments ? ' dp-shorts--comments' : '')} data-testid="shorts-page" onWheel={onWheel}>
      {!items.length && feedError ? (
        <div className="dp-shorts-empty">
          <div>{feedError}</div>
          <button type="button" className="dp-btn dp-btn--light" onClick={() => void loadMore(true)}>
            Thử lại
          </button>
        </div>
      ) : null}
      {!items.length && !feedError ? <Spinner /> : null}
      <div className="dp-shorts-track" style={{ transform: `translateY(${-index * 100}%)` }}>
        {items.map((video, i) =>
          Math.abs(i - index) <= 2 ? (
            <div key={video.id + '-' + i} className="dp-shorts-cell" style={{ top: `${i * 100}%` }}>
              <ShortSlide
                video={video}
                active={i === index}
                status={status}
                error={playError}
                paused={paused}
                onToggle={toggle}
                onRetry={() => {
                  setStatus('loading')
                  void playShort(video).then((r) => {
                    setStatus(r.ok ? 'playing' : 'error')
                    setPlayError(r.error ?? null)
                  })
                }}
                onComments={(v) => {
                  if (comments?.videoId === v.id) setComments(null)
                  else watchInfo(v.id).then(setComments).catch(() => setComments(null))
                }}
              />
            </div>
          ) : null,
        )}
      </div>
      <div className="dp-shorts-nav">
        <button type="button" className="dp-shorts-nav-btn" aria-label="Short trước" disabled={index === 0} onClick={() => move(-1)}>
          <PIcon name="chevronUp" size={28} />
        </button>
        <button type="button" className="dp-shorts-nav-btn" aria-label="Short tiếp theo" disabled={index >= items.length - 1} onClick={() => move(1)}>
          <PIcon name="chevronDown" size={28} />
        </button>
      </div>
      {comments ? (
        <aside className="dp-short-comments">
          <div className="dp-panel-head">
            <div className="dp-panel-title">Bình luận</div>
            <button type="button" className="dp-icon-button" aria-label="Đóng" onClick={() => setComments(null)}>
              <PIcon name="close" size={22} />
            </button>
          </div>
          <div className="dp-short-comments-body">
            {comments.commentsToken ? <Comments token={comments.commentsToken} countText={comments.commentCountText} /> : <div className="dp-empty">Bình luận đã bị tắt</div>}
          </div>
        </aside>
      ) : null}
    </div>
  )
}
