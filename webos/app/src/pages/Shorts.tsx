// Shorts: a vertical player in the middle of the screen; ↑ / ↓ change the Short, OK pauses, the
// buttons beside it like / open the channel (like the Android TV Shorts screen).

import type { VideoItem } from '@shared/models'
import { feedVideos } from '@shared/models'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../api'
import { useBranding } from '../dearrow'
import { KEY } from '../platform'
import { closePlayer } from '../player/controller'
import { Playback } from '../player/playback'
import { useInitialFocus, useScreen, useScreenKeys } from '../screen'
import { accountStore } from '../state/account'
import { library, libraryStore } from '../state/library'
import { nav, toast } from '../state/nav'
import { hidesShorts, parental } from '../state/parental'
import { useStore } from '../store'
import { Button, IconButton, LazyImg, Loading, Message } from '../ui/base'

async function loadShorts(seed: string | null): Promise<VideoItem[]> {
  const page = await api.search(seed ? `${seed} #shorts` : '#shorts', { type: 'shorts' })
  return feedVideos(page).map((v) => ({ ...v, isShort: true }))
}

export function ShortsScreen() {
  const screen = useScreen()
  const [items, setItems] = useState<VideoItem[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'loading' | 'playing' | 'paused' | 'error'>('loading')
  const videoRef = useRef<HTMLVideoElement>(null)
  const playback = useRef<Playback | null>(null)
  const signedIn = useStore(accountStore, (s) => s.state.signedIn)
  useStore(libraryStore, (s) => s.liked.length)

  const load = (more = false) => {
    setLoading(true)
    loadShorts(more ? items[items.length - 1]?.channelName ?? null : null)
      .then((list) => {
        const known = new Set(items.map((v) => v.id))
        const fresh = list.filter((v) => !known.has(v.id) && !library.isHidden(v))
        setItems(more ? [...items, ...fresh] : fresh)
        setError(null)
        setLoading(false)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }

  useEffect(() => {
    const pending = nav.consumePendingShorts()
    if (pending) {
      setItems(pending.items)
      setIndex(Math.max(0, pending.items.findIndex((v) => v.id === pending.startId)))
      setLoading(false)
    } else load()
  }, [])

  useEffect(() => {
    // A Short opened from a card while this screen already existed.
    const pending = nav.consumePendingShorts()
    if (pending && screen.active) {
      setItems(pending.items)
      setIndex(Math.max(0, pending.items.findIndex((v) => v.id === pending.startId)))
    }
  }, [screen.active])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const pb = new Playback(el, (event) => {
      if (event === 'playing') setStatus('playing')
      else if (event === 'pause') setStatus('paused')
      else if (event === 'error') setStatus('error')
      else if (event === 'ended') {
        pb.seek(0)
        pb.play()
      }
    })
    playback.current = pb
    return () => {
      pb.destroy()
      playback.current = null
    }
  }, [])

  const current = items[index] ?? null

  useEffect(() => {
    if (!current || !screen.active) {
      playback.current?.pause()
      return
    }
    // The main player and Shorts never play together.
    closePlayer()
    let alive = true
    setStatus('loading')
    api
      .stream(current.id, { quality: 720 })
      .then((info) => {
        if (!alive) return
        const src = info.hls ?? info.mp4
        if (!src) {
          setStatus('error')
          return
        }
        playback.current?.load(src, 0, info.lengthSeconds ?? current.durationSeconds ?? 30, true)
      })
      .catch(() => alive && setStatus('error'))
    if (index >= items.length - 3 && !loading) load(true)
    return () => {
      alive = false
    }
  }, [current?.id, screen.active])

  // Parental watch time counts Shorts too.
  useEffect(() => {
    const timer = setInterval(() => {
      const pb = playback.current
      if (pb && !pb.paused && screen.active && parental.tick()) pb.pause()
    }, 1000)
    return () => clearInterval(timer)
  }, [screen.active])

  useInitialFocus(!!current || !!error)

  useScreenKeys((event) => {
    if (!current) return false
    const active = document.activeElement as HTMLElement | null
    const onStage = !active || !active.closest('.shorts-actions') || active.getAttribute('data-key') === 'sh-stage'
    if (event.keyCode === KEY.DOWN && onStage) {
      if (index < items.length - 1) setIndex(index + 1)
      return true
    }
    if (event.keyCode === KEY.UP && onStage) {
      if (index > 0) setIndex(index - 1)
      return true
    }
    if (event.keyCode === KEY.PLAY) {
      playback.current?.play()
      return true
    }
    if (event.keyCode === KEY.PAUSE) {
      playback.current?.pause()
      return true
    }
    if (event.keyCode === KEY.CHANNEL_DOWN && index < items.length - 1) {
      setIndex(index + 1)
      return true
    }
    if (event.keyCode === KEY.CHANNEL_UP && index > 0) {
      setIndex(index - 1)
      return true
    }
    return false
  })

  if (hidesShorts()) {
    return (
      <div class="page">
        <Message title="Shorts đã bị tắt" detail="Phụ huynh đã ẩn Shorts." icon="lock" />
      </div>
    )
  }

  const liked = current ? library.isLiked(current.id) : false

  return (
    <div class="shorts" data-testid="shorts-page">
      {!current && loading && <Loading />}
      {!current && error && (
        <Message title="Không tải được Shorts" detail={error}>
          <Button label="Thử lại" icon="refresh" onClick={() => load()} autofocus />
        </Message>
      )}
      <div class="shorts-stage" style={current ? undefined : { display: 'none' }}>
        <div
          class="shorts-frame"
          data-f
          tabIndex={-1}
          data-key="sh-stage"
          data-autofocus
          data-testid="shorts-stage"
          onClick={() => playback.current?.toggle()}
          onWheel={(e) => {
            if (e.deltaY > 0 && index < items.length - 1) setIndex(index + 1)
            else if (e.deltaY < 0 && index > 0) setIndex(index - 1)
          }}
        >
          <video ref={videoRef} class="shorts-video" playsInline />
          {current && (status !== 'playing' || playback.current?.isMock) && <ShortPoster video={current} />}
          {status === 'paused' && <div class="shorts-paused">❚❚</div>}
          {status === 'loading' && <div class="player-spinner"><Loading /></div>}
          {status === 'error' && <div class="shorts-error">Short này chỉ phát được bằng trình phát chính</div>}
        </div>
        {current && (
          <div class="shorts-side">
            <ShortInfo video={current} />
            <div class="shorts-actions" data-group>
              <IconButton icon="previous" label="Short trước" focusKey="sh-prev" onClick={() => index > 0 && setIndex(index - 1)} />
              <IconButton icon={status === 'playing' ? 'pause' : 'play'} label="Phát" focusKey="sh-play" onClick={() => playback.current?.toggle()} />
              <IconButton icon="next" label="Short tiếp theo" focusKey="sh-next" onClick={() => index < items.length - 1 && setIndex(index + 1)} />
              <IconButton
                icon="like"
                label="Thích"
                active={liked}
                focusKey="sh-like"
                onClick={() => {
                  library.setLiked(current, !liked)
                  if (signedIn) api.rate(current.id, liked ? 'remove' : 'like').catch(() => {})
                  toast(liked ? 'Đã xóa khỏi Video đã thích' : 'Đã thêm vào Video đã thích')
                }}
              />
              {current.channelId && (
                <IconButton
                  icon="account"
                  label="Mở kênh"
                  focusKey="sh-channel"
                  onClick={() => {
                    playback.current?.pause()
                    nav.open({ name: 'channel', channel: { id: current.channelId!, name: current.channelName ?? '' } })
                  }}
                />
              )}
            </div>
            <div class="shorts-hint">▲ ▼ để chuyển Short</div>
            <div class="shorts-counter">{`${index + 1} / ${items.length}`}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ShortPoster({ video }: { video: VideoItem }) {
  const { thumbnail } = useBranding(video)
  return <LazyImg src={thumbnail || `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`} class="shorts-poster" eager fallback={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} />
}

function ShortInfo({ video }: { video: VideoItem }) {
  const { title } = useBranding(video)
  return (
    <div class="shorts-info">
      <div class="shorts-title">{title}</div>
      <div class="shorts-channel">{[video.channelName, video.viewCountText].filter(Boolean).join(' • ')}</div>
    </div>
  )
}
