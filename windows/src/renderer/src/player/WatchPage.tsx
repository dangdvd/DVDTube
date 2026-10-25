// Route /watch?v=ID[&list=PL…][&index=N][&t=SEC]: the player (the shared stage is shown in
// this page's slot), video details, comments, and the right column (chapters, live chat,
// queue / playlist, related videos). Theater mode puts the player full width on top.

import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { VideoItem } from '@shared/models'
import type { WatchState } from '@/lib/nav'
import { watchPath } from '@/lib/nav'
import { useBranding } from '@/lib/dearrow'
import { useParentalFlags } from '@/state/parental'
import { usePlayer } from '@/state/player'
import { useSettings } from '@/state/settings'
import { mainVideo } from './controller'
import { LyricsPanel } from './music/LyricsPanel'
import { PlayerSlot } from './ui/PlayerSlot'
import { Comments } from './watch/Comments'
import { Description, seekAndShow } from './watch/Description'
import { LiveChat } from './watch/LiveChat'
import { ChaptersPanel, QueuePanel, RelatedList } from './watch/Panels'
import { VideoInfo } from './watch/VideoInfo'

/** "90", "1m30s", "1h2m3s" → seconds. */
function parseStart(value: string | null): number | null {
  if (!value) return null
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value)
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!match || !match[0]) return null
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

/** Ambient mode: the video's colours glow softly around the player (dark theme only). */
function AmbientGlow() {
  const enabled = useSettings((s) => s.settings.ambientMode)
  const audioOnly = usePlayer((s) => s.audioOnly || s.pictureless)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !enabled || audioOnly) return
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return
    let first = true
    const draw = () => {
      const video = mainVideo()
      const dark = getComputedStyle(document.documentElement).colorScheme !== 'light'
      canvas.style.opacity = dark ? '' : '0'
      if (!dark || video.readyState < 2 || (video.paused && !first)) return
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        first = false
        canvas.classList.add('dp-ambient--on')
      } catch {
        // Frame not decodable yet.
      }
    }
    const timer = setInterval(draw, 1200)
    draw()
    return () => clearInterval(timer)
  }, [enabled, audioOnly])
  if (!enabled || audioOnly) return null
  return <canvas ref={ref} className="dp-ambient" width={48} height={27} aria-hidden="true" />
}

function RelatedSkeleton() {
  return (
    <div className="dp-related">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="dp-skeleton-row">
          <div className="dp-skeleton dp-skeleton-thumb" />
          <div className="dp-skeleton-lines">
            <div className="dp-skeleton dp-skeleton-line" />
            <div className="dp-skeleton dp-skeleton-line dp-skeleton-line--short" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function WatchPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state ?? null) as WatchState | null
  const v = params.get('v')
  const list = params.get('list')
  const t = params.get('t')
  const current = usePlayer((s) => s.current)
  const watch = usePlayer((s) => (s.watch && s.watch.videoId === s.current?.id ? s.watch : null))
  const watchError = usePlayer((s) => s.watchError)
  const live = usePlayer((s) => s.live)
  const theater = useSettings((s) => s.settings.theaterMode)
  const commentsSetting = useSettings((s) => s.settings.showComments)
  const parentalHidesComments = useParentalFlags().hideComments
  const showComments = commentsSetting && !parentalHidesComments
  const lyricsOpen = usePlayer((s) => s.lyricsOpen)
  const lastStart = useRef<number | null>(null)

  // Start (or keep) playing what the URL says. A new `t` on the same video seeks (timestamp
  // links in the description / comments); a new `list` attaches the playlist.
  useEffect(() => {
    if (!v) return
    const p = usePlayer.getState()
    if (p.current?.id === v && p.status !== 'error') {
      if (list && list !== p.playlistId) p.play(p.current, { playlistId: list })
      const start = parseStart(t)
      if (start != null && start !== lastStart.current) p.seek(start)
      lastStart.current = start
      return
    }
    lastStart.current = parseStart(t)
    const video: VideoItem = state?.video?.id === v ? state.video : (state?.queue?.find((x) => x.id === v) ?? { id: v, title: '' })
    p.play(video, { queue: state?.queue, index: state?.index, playlistId: list, startAt: lastStart.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, t, list])

  // The player moved on by itself (autoplay, queue): the URL follows. Not on mount (the
  // effect above has just started the URL's video) and always with the store's fresh state,
  // never the render-time `current`, or opening another video while the mini player plays
  // would bounce back to the old one.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const s = usePlayer.getState()
    const playing = s.current
    if (!playing || !v || playing.id === v || s.mode !== 'page') return
    navigate(watchPath(playing.id, { list: s.playlistId, index: s.playlistId ? s.queueIndex : null }), { state: { video: playing } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  const branded = useBranding(current ?? { id: '', title: '' }, !!current).title
  useEffect(() => {
    const title = current ? branded : null
    document.title = title ? `${title} - DVDTube` : 'DVDTube'
  }, [current, branded])
  useEffect(() => () => void (document.title = 'DVDTube'), [])

  return (
    <div className={'dp-watch' + (theater ? ' dp-watch--theater' : '')} data-testid="watch-page">
      {theater ? (
        <div className="dp-theater">
          <PlayerSlot key="theater" className="dp-player-slot dp-player-slot--theater" />
        </div>
      ) : null}
      <div className="dp-columns">
        <div className="dp-main">
          {!theater ? (
            <div className="dp-player-wrap">
              <AmbientGlow />
              <PlayerSlot key="default" className="dp-player-slot" />
            </div>
          ) : null}
          {current ? <VideoInfo video={current} watch={watch} /> : null}
          {watch ? <Description watch={watch} /> : null}
          {watchError && !watch ? (
            <div className="dp-error-line">
              {watchError}
              <button
                type="button"
                className="dp-text-button"
                onClick={() => {
                  const p = usePlayer.getState()
                  if (p.current) p.retry()
                }}
              >
                Thử lại
              </button>
            </div>
          ) : null}
        </div>
        <aside className="dp-side">
          {lyricsOpen && current ? (
            <div className="dp-lyrics-card">
              <div className="dp-lyrics-head">
                <span>Lời bài hát</span>
                <button type="button" className="dp-text-button" onClick={() => usePlayer.getState().setLyricsOpen(false)}>
                  Đóng
                </button>
              </div>
              <LyricsPanel videoId={current.id} compact />
            </div>
          ) : null}
          <ChaptersPanel />
          {watch?.liveChat ? <LiveChat info={watch.liveChat} videoId={watch.videoId} /> : null}
          <QueuePanel />
          {watch ? <RelatedList page={watch.related} videoId={watch.videoId} /> : <RelatedSkeleton />}
        </aside>
        <div className="dp-below">
          {showComments && watch?.commentsToken && !live ? <Comments token={watch.commentsToken} countText={watch.commentCountText} onSeek={seekAndShow} /> : null}
          {showComments && watch && !watch.commentsToken && !live ? <div className="dp-empty dp-comments-off">Bình luận đã bị tắt</div> : null}
        </div>
      </div>
    </div>
  )
}
