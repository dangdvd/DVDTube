// Everything drawn on top of the main video, rendered into the stage through a portal so it
// moves together with the <video> (watch page ⇄ mini player ⇄ fullscreen).

import { useEffect, useRef, useState } from 'react'
import { displayThumbnail } from '@shared/models'
import { useCast } from '@/state/cast'
import { usePlayer } from '@/state/player'
import { Controls } from './Controls'
import { showFeedback } from './feedback'
import { PIcon } from './icons'
import {
  AudioOnlyBackdrop,
  BoostBadge,
  CaptionOverlay,
  EndScreen,
  ErrorOverlay,
  FeedbackBubble,
  Spinner,
  SponsorSkipButton,
  StatsOverlay,
  UpNextCard,
  WaitOverlay,
} from './Overlays'

const HIDE_AFTER_MS = 2500

export function togglePlayWithFeedback(): void {
  const p = usePlayer.getState()
  const willPlay = !p.playing || p.status === 'ended'
  p.togglePlay()
  showFeedback({ place: 'center', icon: willPlay ? 'play' : 'pause' })
}

function MiniControls({ visible, onExpand }: { visible: boolean; onExpand: () => void }) {
  const p = usePlayer()
  return (
    <div
      className={'dp-mini-controls' + (visible ? ' dp-mini-controls--visible' : '')}
      onClick={(e) => {
        e.stopPropagation()
        if (!(e.target as HTMLElement).closest('button')) onExpand()
      }}
    >
      <button type="button" className="dp-mini-btn dp-mini-expand" aria-label="Mở rộng" title="Mở rộng (i)" onClick={onExpand}>
        <PIcon name="expand" size={20} />
      </button>
      <button type="button" className="dp-mini-btn dp-mini-close" aria-label="Đóng" title="Đóng" onClick={() => p.close()}>
        <PIcon name="close" size={22} />
      </button>
      <div className="dp-mini-center">
        <button type="button" className="dp-mini-btn" aria-label="Trước" disabled={p.queueIndex === 0 && p.currentTime < 5} onClick={() => p.previous()}>
          <PIcon name="previous" size={28} />
        </button>
        <button type="button" className="dp-mini-btn dp-mini-play" aria-label={p.playing ? 'Tạm dừng' : 'Phát'} onClick={togglePlayWithFeedback}>
          <PIcon name={p.status === 'ended' ? 'replay' : p.playing ? 'pause' : 'play'} size={40} />
        </button>
        <button type="button" className="dp-mini-btn" aria-label="Tiếp theo" onClick={() => p.next()}>
          <PIcon name="next" size={28} />
        </button>
      </div>
    </div>
  )
}

/** While a DVDTube receiver plays: what plays there, over the (idle) local player. */
function CastingOverlay() {
  const device = useCast((s) => s.connected)
  const video = usePlayer((s) => s.current)
  if (!device) return null
  return (
    <div className="dp-casting" data-testid="player-casting" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {video ? <img className="dp-casting-bg" src={displayThumbnail(video)} alt="" /> : null}
      <div className="dp-casting-text">
        <PIcon name="castConnected" size={40} />
        <div>Đang phát trên {device.name}</div>
        <button type="button" className="dp-btn" onClick={() => void useCast.getState().disconnect(true)}>
          Tiếp tục trên thiết bị này
        </button>
      </div>
    </div>
  )
}

/** Restored from the last session: the thumbnail and "Tiếp tục phát…" until play is pressed. */
function RestoredPoster({ compact }: { compact: boolean }) {
  const restored = usePlayer((s) => s.restored)
  const video = usePlayer((s) => s.current)
  if (!restored || !video) return null
  return (
    <div className="dp-restored" data-testid="player-restored">
      <img src={displayThumbnail(video)} alt="" />
      {!compact ? (
        <button
          type="button"
          className="dp-restored-play"
          onClick={(e) => {
            e.stopPropagation()
            usePlayer.getState().resume()
          }}
        >
          <PIcon name="play" size={28} /> Tiếp tục phát…
        </button>
      ) : null}
    </div>
  )
}

function WebPlayerBadge() {
  const web = usePlayer((s) => s.source === 'web')
  if (!web) return null
  return (
    <div className="dp-web-badge" title="Luồng gốc bị từ chối — đang phát bằng trình phát nhúng của YouTube" data-testid="web-player-badge">
      <PIcon name="web" size={14} /> Trình phát web
    </div>
  )
}

export function PlayerOverlay({ variant, onExpand, onMiniPlayer }: { variant: 'page' | 'mini'; onExpand: () => void; onMiniPlayer: () => void }) {
  const status = usePlayer((s) => s.status)
  const playing = usePlayer((s) => s.playing)
  const hasError = usePlayer((s) => !!s.error)
  const waiting = usePlayer((s) => s.waitSeconds > 0)
  const stats = usePlayer((s) => s.stats)
  const fullscreen = usePlayer((s) => s.fullscreen)
  const title = usePlayer((s) => s.current?.title ?? '')
  const channel = usePlayer((s) => s.current?.channelName ?? '')
  const [active, setActive] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [overBar, setOverBar] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poke = () => {
    setActive(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setActive(false), HIDE_AFTER_MS)
  }
  useEffect(() => {
    poke()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
  useEffect(() => {
    if (variant === 'mini') setMenuOpen(false)
  }, [variant])

  const visible = active || !playing || menuOpen || scrubbing || overBar
  const loading = (status === 'loading' || status === 'buffering') && !hasError && !waiting

  return (
    <div
      className={`dp-overlay dp-overlay--${variant}` + (visible ? '' : ' dp-overlay--idle') + (fullscreen ? ' dp-overlay--fullscreen' : '')}
      onMouseMove={poke}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current)
        setActive(false)
      }}
      onClick={() => {
        if (menuOpen) {
          setMenuOpen(false)
          return
        }
        if (variant === 'mini') onExpand()
        else togglePlayWithFeedback()
      }}
      onDoubleClick={() => {
        if (variant !== 'page') return
        usePlayer.getState().toggleFullscreen()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <AudioOnlyBackdrop compact={variant === 'mini'} />
      <RestoredPoster compact={variant === 'mini'} />
      <WebPlayerBadge />
      <CaptionOverlay raised={visible && variant === 'page'} />
      {loading ? <Spinner /> : null}
      <WaitOverlay />
      <ErrorOverlay />
      <SponsorSkipButton />
      <EndScreen />
      <UpNextCard compact={variant === 'mini'} />
      <FeedbackBubble />
      <BoostBadge />
      {stats && variant === 'page' ? <StatsOverlay /> : null}
      {variant === 'page' && fullscreen ? (
        <div className={'dp-top' + (visible ? ' dp-top--visible' : '')}>
          <div className="dp-top-title">{title}</div>
          <div className="dp-top-channel">{channel}</div>
        </div>
      ) : null}
      <CastingOverlay />
      {variant === 'page' ? (
        <Controls visible={visible} menuOpen={menuOpen} setMenuOpen={setMenuOpen} onScrub={setScrubbing} onBarHover={setOverBar} onMiniPlayer={onMiniPlayer} />
      ) : (
        <MiniControls visible={visible} onExpand={onExpand} />
      )}
    </div>
  )
}
