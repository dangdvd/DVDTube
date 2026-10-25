// The music player UI: the bottom bar on the "Nghe nhạc" pages and the now-playing screen (big
// artwork, seek bar, ⏮ ⏯ ⏭, shuffle / repeat, queue, lyrics, "Radio từ bài này", sleep timer, EQ).

import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { displayThumbnail, formatTime, type VideoItem } from '@shared/models'
import { Icon } from '@/components/Icon'
import { Menu, Popover } from '@/components/Menu'
import { watchPath } from '@/lib/nav'
import { toast } from '@/lib/toast'
import { useCast } from '@/state/cast'
import { useMusic } from '@/state/music'
import { usePlayer } from '@/state/player'
import { EqualizerPanel } from '../EqualizerPanel'
import { PIcon } from '../ui/icons'
import { sleepLabel } from '../ui/SettingsMenu'
import { LyricsPanel } from './LyricsPanel'

export function artworkOf(video: VideoItem): string {
  return displayThumbnail(video)
}

/** "Radio từ bài này": an endless YouTube mix starting from this song. */
export function startRadio(video: VideoItem): void {
  const p = usePlayer.getState()
  const playlistId = 'RDAMVM' + video.id
  if (p.current?.id === video.id) p.play(video, { playlistId, music: true })
  else p.play(video, { queue: [video], index: 0, playlistId, music: true, startAt: 0 })
  toast('Đang phát radio từ bài này')
}

function SeekBar() {
  const current = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const [drag, setDrag] = useState<number | null>(null)
  const value = drag ?? current
  return (
    <div className="music-seek">
      <span className="music-time">{formatTime(value)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 1)}
        step={0.5}
        value={Math.min(value, Math.max(duration, 1))}
        aria-label="Tua"
        style={{ '--fill': `${duration ? (value / duration) * 100 : 0}%` } as CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) usePlayer.getState().seek(drag)
          setDrag(null)
        }}
        onKeyUp={() => {
          if (drag !== null) usePlayer.getState().seek(drag)
          setDrag(null)
        }}
      />
      <span className="music-time">{formatTime(duration)}</span>
    </div>
  )
}

function Transport({ big }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing)
  const status = usePlayer((s) => s.status)
  const loop = usePlayer((s) => s.loop)
  const loopQueue = usePlayer((s) => s.loopQueue)
  const shuffled = usePlayer((s) => s.shuffled)
  const p = usePlayer.getState()
  const repeatMode = loop ? 'one' : loopQueue ? 'all' : 'off'
  return (
    <div className={'music-transport' + (big ? ' music-transport--big' : '')}>
      {big && (
        <button className={'music-btn' + (shuffled ? ' is-on' : '')} aria-label="Trộn bài" title="Trộn bài" onClick={() => p.shuffleQueue()}>
          <PIcon name="shuffle" size={22} />
        </button>
      )}
      <button className="music-btn" aria-label="Bài trước" title="Bài trước" onClick={() => p.previous()}>
        <PIcon name="previous" size={big ? 30 : 24} />
      </button>
      <button className="music-btn music-btn--play" aria-label={playing ? 'Tạm dừng' : 'Phát'} onClick={() => p.togglePlay()} data-testid="music-play">
        <PIcon name={status === 'ended' ? 'replay' : playing ? 'pause' : 'play'} size={big ? 40 : 30} />
      </button>
      <button className="music-btn" aria-label="Bài tiếp theo" title="Bài tiếp theo" onClick={() => p.next()}>
        <PIcon name="next" size={big ? 30 : 24} />
      </button>
      {big && (
        <button
          className={'music-btn' + (repeatMode !== 'off' ? ' is-on' : '')}
          aria-label="Lặp lại"
          title={repeatMode === 'one' ? 'Lặp lại một bài' : repeatMode === 'all' ? 'Lặp lại tất cả' : 'Không lặp lại'}
          onClick={() => {
            if (repeatMode === 'off') p.setLoopQueue(true)
            else if (repeatMode === 'all') {
              usePlayer.setState({ loopQueue: false })
              p.setLoop(true)
            } else p.setLoop(false)
          }}
        >
          <PIcon name="repeat" size={22} />
          {repeatMode === 'one' && <span className="music-repeat-one">1</span>}
        </button>
      )}
    </div>
  )
}

/** Bottom bar of the music pages. */
export function MusicBar() {
  const current = usePlayer((s) => s.current)
  const restored = usePlayer((s) => s.restored)
  const open = useMusic((s) => s.nowPlayingOpen)
  const casting = useCast((s) => !!s.connected)
  if (!current || casting) return null
  return (
    <div className="music-bar" data-testid="music-bar">
      <SeekBar />
      <div className="music-bar-row">
        <button className="music-bar-info" onClick={() => useMusic.getState().setNowPlaying(!open)} title={open ? 'Thu nhỏ' : 'Mở trình phát nhạc'}>
          <img className="music-bar-art" src={artworkOf(current)} alt="" />
          <span className="music-bar-text">
            <span className="music-bar-title">{current.title || 'Đang tải…'}</span>
            <span className="music-bar-artist">{restored ? 'Tiếp tục phát…' : current.channelName}</span>
          </span>
        </button>
        <Transport />
        <div className="music-bar-end">
          <button className="music-btn" aria-label={open ? 'Thu nhỏ' : 'Mở rộng'} onClick={() => useMusic.getState().setNowPlaying(!open)}>
            <PIcon name={open ? 'chevronDown' : 'chevronUp'} size={26} />
          </button>
        </div>
      </div>
    </div>
  )
}

function QueueList() {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.queueIndex)
  return (
    <div className="music-queue" data-testid="music-queue">
      {queue.map((v, i) => (
        <button key={v.id + i} className={'music-queue-item' + (i === index ? ' is-current' : '')} onClick={() => usePlayer.getState().playQueueItem(i)}>
          <img src={artworkOf(v)} alt="" />
          <span className="music-queue-text">
            <span className="music-queue-title">{v.title}</span>
            <span className="music-queue-artist">{v.channelName}</span>
          </span>
          <span className="music-queue-duration">{v.durationText ?? ''}</span>
        </button>
      ))}
      {!queue.length && <div className="lyrics-empty">Hàng đợi trống</div>}
    </div>
  )
}

export function NowPlaying() {
  const current = usePlayer((s) => s.current)
  const audioOnly = usePlayer((s) => s.audioOnly)
  const sleepEndsAt = usePlayer((s) => s.sleepEndsAt)
  const sleepAtEnd = usePlayer((s) => s.sleepAtEnd)
  const [tab, setTab] = useState<'queue' | 'lyrics'>('lyrics')
  const [sleep, setSleep] = useState<HTMLElement | null>(null)
  const [eq, setEq] = useState<HTMLElement | null>(null)
  const navigate = useNavigate()
  if (!current) return null
  return (
    <div className="now-playing" data-testid="now-playing">
      <div className="now-playing-bg" style={{ backgroundImage: `url("${artworkOf(current)}")` }} />
      <div className="now-playing-main">
        <div className="now-playing-art">
          <img src={artworkOf(current)} alt="" />
        </div>
        <h1 className="now-playing-title">{current.title}</h1>
        <div className="now-playing-artist">{current.channelName}</div>
        <SeekBar />
        <Transport big />
        <div className="now-playing-actions">
          <button className="chip chip--small" onClick={() => startRadio(current)}>
            <Icon name="radio" size={16} /> Radio từ bài này
          </button>
          <button className={'chip chip--small' + (sleepEndsAt || sleepAtEnd ? ' is-selected' : '')} onClick={(e) => setSleep(sleep ? null : e.currentTarget)}>
            <Icon name="watchLater" size={16} /> Hẹn giờ tắt
          </button>
          <button className="chip chip--small" onClick={(e) => setEq(eq ? null : e.currentTarget)}>
            <Icon name="equalizer" size={16} /> Bộ chỉnh âm
          </button>
          <button className={'chip chip--small' + (!audioOnly ? ' is-selected' : '')} onClick={() => usePlayer.getState().setAudioOnly(!audioOnly)}>
            <Icon name="monitor" size={16} /> {audioOnly ? 'Hiện hình' : 'Chỉ âm thanh'}
          </button>
          <button className="chip chip--small" onClick={() => navigate(watchPath(current.id), { state: { video: current } })}>
            <Icon name="external" size={16} /> Trang video
          </button>
          <button className="chip chip--small" onClick={() => useCast.getState().openPicker(current, 'play')}>
            <Icon name="cast" size={16} /> Truyền tới TV
          </button>
        </div>
      </div>
      <div className="now-playing-side">
        <div className="tabs now-playing-tabs">
          <button className={'tab' + (tab === 'queue' ? ' is-active' : '')} onClick={() => setTab('queue')}>
            Tiếp theo
          </button>
          <button className={'tab' + (tab === 'lyrics' ? ' is-active' : '')} onClick={() => setTab('lyrics')} data-testid="tab-lyrics">
            Lời bài hát
          </button>
        </div>
        {tab === 'queue' ? <QueueList /> : <LyricsPanel videoId={current.id} />}
      </div>
      {sleep && (
        <Menu
          anchor={sleep}
          onClose={() => setSleep(null)}
          placement="top-start"
          items={[
            { label: 'Tắt', checked: !sleepEndsAt && !sleepAtEnd, onSelect: () => usePlayer.getState().setSleepTimer(null) },
            ...[15, 30, 45, 60, 90, 120].map((m) => ({ label: sleepLabel(m), onSelect: () => usePlayer.getState().setSleepTimer(m) })),
            { label: 'Hết bài này', checked: sleepAtEnd, onSelect: () => usePlayer.getState().setSleepTimer(0) },
          ]}
        />
      )}
      {eq && (
        <Popover anchor={eq} onClose={() => setEq(null)} placement="top-start" className="music-eq-popover">
          <EqualizerPanel />
        </Popover>
      )}
    </div>
  )
}
