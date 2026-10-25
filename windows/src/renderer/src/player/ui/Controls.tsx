// Bottom control bar of the watch-page player (YouTube desktop layout).

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatTime } from '@shared/models'
import { useCast } from '@/state/cast'
import { usePlayer } from '@/state/player'
import { useSettings } from '@/state/settings'
import { nextVideo } from '../controller'
import { showFeedback } from './feedback'
import { PIcon, type PlayerIconName } from './icons'
import { ProgressBar } from './ProgressBar'
import { SettingsMenu, useSleepRemaining } from './SettingsMenu'

export function volumeIcon(volume: number, muted: boolean): PlayerIconName {
  if (muted || volume === 0) return 'volumeOff'
  return volume < 0.5 ? 'volumeLow' : 'volumeHigh'
}

function ControlButton({
  icon,
  tip,
  onClick,
  active,
  disabled,
  testId,
  size = 26,
}: {
  icon: PlayerIconName
  tip: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  testId?: string
  size?: number
}) {
  return (
    <button
      type="button"
      className={'dp-cbtn' + (active ? ' dp-cbtn--active' : '')}
      data-tip={tip}
      aria-label={tip}
      disabled={disabled}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <PIcon name={icon} size={size} />
    </button>
  )
}

function TimeDisplay() {
  const current = usePlayer((s) => Math.floor(s.currentTime))
  const duration = usePlayer((s) => s.duration)
  const live = usePlayer((s) => s.live)
  const seekStart = usePlayer((s) => s.seekStart)
  if (live) {
    const atEdge = duration - current < 15
    return (
      <button
        type="button"
        className={'dp-live' + (atEdge ? ' dp-live--edge' : '')}
        onClick={(e) => {
          e.stopPropagation()
          usePlayer.getState().goLive()
        }}
        data-tip={atEdge ? 'Đang phát trực tiếp' : 'Chuyển tới trực tiếp'}
      >
        <span className="dp-live-dot" />
        TRỰC TIẾP
        {!atEdge && duration - seekStart > 60 ? <span className="dp-live-behind">-{formatTime(duration - current)}</span> : null}
      </button>
    )
  }
  return (
    <span className="dp-time" data-testid="player-time">
      {formatTime(current)} <span className="dp-time-sep">/</span> {formatTime(duration)}
    </span>
  )
}

function ChapterButton() {
  const chapters = usePlayer((s) => (s.watch && s.watch.videoId === s.current?.id ? s.watch.chapters : null))
  const second = usePlayer((s) => Math.floor(s.currentTime))
  if (!chapters?.length) return null
  const chapter = [...chapters].reverse().find((c) => c.startSeconds <= second) ?? chapters[0]
  return (
    <button
      type="button"
      className="dp-chapter"
      onClick={(e) => {
        e.stopPropagation()
        usePlayer.getState().setChaptersOpen(true)
      }}
      data-tip="Xem chương"
    >
      <span className="dp-chapter-dot">•</span>
      <span className="dp-chapter-title">{chapter.title}</span>
      <PIcon name="chevronRight" size={20} />
    </button>
  )
}

function Volume() {
  const volume = useSettings((s) => s.settings.volume)
  const muted = useSettings((s) => s.settings.muted)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const s = useSettings.getState().settings
      const base = s.muted ? 0 : s.volume
      const next = Math.min(1, Math.max(0, base + (event.deltaY < 0 ? 0.05 : -0.05)))
      usePlayer.getState().setVolume(next)
      showFeedback({ place: 'top', icon: volumeIcon(next, next === 0), text: `${Math.round(next * 100)}%` })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const shown = muted ? 0 : volume
  return (
    <div className="dp-volume" ref={ref}>
      <ControlButton icon={volumeIcon(volume, muted)} tip={muted || volume === 0 ? 'Bật tiếng (m)' : 'Tắt tiếng (m)'} onClick={() => usePlayer.getState().toggleMute()} />
      <div className="dp-volume-slider" onClick={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={shown}
          aria-label="Âm lượng"
          style={{ '--v': shown } as CSSProperties}
          onChange={(e) => usePlayer.getState().setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

function AutoplaySwitch() {
  const on = useSettings((s) => s.settings.autoplayNext)
  return (
    <button
      type="button"
      className={'dp-autoplay' + (on ? ' dp-autoplay--on' : '')}
      role="switch"
      aria-checked={on}
      data-tip={on ? 'Tự động phát đang bật' : 'Tự động phát đang tắt'}
      aria-label="Tự động phát"
      onClick={(e) => {
        e.stopPropagation()
        useSettings.getState().update({ autoplayNext: !on })
      }}
    >
      <span className="dp-autoplay-track">
        <span className="dp-autoplay-knob">
          <PIcon name={on ? 'play' : 'pause'} size={12} />
        </span>
      </span>
    </button>
  )
}

export function Controls({
  visible,
  menuOpen,
  setMenuOpen,
  onScrub,
  onBarHover,
  onMiniPlayer,
}: {
  visible: boolean
  menuOpen: boolean
  setMenuOpen: (open: boolean) => void
  onScrub: (scrubbing: boolean) => void
  onBarHover: (over: boolean) => void
  onMiniPlayer: () => void
}) {
  const p = usePlayer()
  const castDevice = useCast((s) => s.connected)
  const theater = useSettings((s) => s.settings.theaterMode)
  const sleep = useSleepRemaining()
  const [, setTick] = useState(0)
  const playingIcon: PlayerIconName = p.status === 'ended' ? 'replay' : p.playing ? 'pause' : 'play'
  const hasPrevious = p.queueIndex > 0
  const next = nextVideo()
  useEffect(() => {
    // Re-evaluate "has next" when related videos arrive.
    setTick((t) => t + 1)
  }, [p.watch])

  return (
    <div
      className={'dp-controls' + (visible ? ' dp-controls--visible' : '')}
      onMouseEnter={() => onBarHover(true)}
      onMouseLeave={() => onBarHover(false)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      data-testid="player-controls"
    >
      {menuOpen ? <SettingsMenu onClose={() => setMenuOpen(false)} /> : null}
      <ProgressBar onScrub={onScrub} />
      <div className="dp-bar">
        <div className="dp-bar-left">
          {hasPrevious ? <ControlButton icon="previous" tip="Trước (SHIFT+P)" onClick={() => p.previous()} /> : null}
          <ControlButton
            icon={playingIcon}
            size={30}
            tip={p.status === 'ended' ? 'Xem lại' : p.playing ? 'Tạm dừng (k)' : 'Phát (k)'}
            testId="player-play"
            onClick={() => p.togglePlay()}
          />
          <ControlButton icon="next" tip={next ? `Tiếp theo (SHIFT+N)` : 'Không có video tiếp theo'} disabled={!next} onClick={() => p.next()} />
          <Volume />
          <TimeDisplay />
          <ChapterButton />
        </div>
        <div className="dp-bar-right">
          {sleep ? (
            <button type="button" className="dp-sleep-chip" data-tip="Hẹn giờ tắt" onClick={() => setMenuOpen(true)}>
              <PIcon name="bedtime" size={16} /> {sleep}
            </button>
          ) : null}
          {!p.live ? <AutoplaySwitch /> : null}
          {p.captionTracks.length ? (
            <ControlButton
              icon="captions"
              tip={p.captionTrack ? 'Tắt phụ đề (c)' : 'Phụ đề (c)'}
              active={!!p.captionTrack}
              onClick={() => p.toggleCaptions()}
            />
          ) : null}
          <ControlButton
            icon={castDevice ? 'castConnected' : 'cast'}
            tip={castDevice ? `Đang phát trên ${castDevice.name}` : 'Truyền tới TV'}
            active={!!castDevice}
            testId="player-cast"
            onClick={() => useCast.getState().openPicker(castDevice ? null : p.current, 'play')}
          />
          <ControlButton icon="settings" tip="Cài đặt" active={menuOpen} testId="player-settings-button" onClick={() => setMenuOpen(!menuOpen)} />
          <ControlButton icon="miniplayer" tip="Trình phát thu nhỏ (i)" onClick={onMiniPlayer} />
          {!p.fullscreen ? (
            <ControlButton
              icon={theater ? 'theaterOff' : 'theater'}
              tip={theater ? 'Chế độ mặc định (t)' : 'Chế độ rạp chiếu phim (t)'}
              onClick={() => useSettings.getState().update({ theaterMode: !theater })}
            />
          ) : null}
          <ControlButton icon="pip" tip="Hình trong hình" active={p.pip} onClick={() => p.togglePip()} />
          <ControlButton
            icon={p.fullscreen ? 'fullscreenExit' : 'fullscreen'}
            tip={p.fullscreen ? 'Thoát toàn màn hình (f)' : 'Toàn màn hình (f)'}
            testId="player-fullscreen"
            onClick={() => p.toggleFullscreen()}
          />
        </div>
      </div>
    </div>
  )
}
