// "Đang phát trên <thiết bị>": the remote control shown at the bottom while connected to a
// DVDTube receiver (artwork, title, ⏮ −10 ⏯ +10 ⏭, seek bar from /api/status, volume,
// "Ngắt kết nối" / "Tiếp tục trên thiết bị này").

import { useEffect, useState, type CSSProperties } from 'react'
import { displayThumbnail, formatTime } from '@shared/models'
import { useCast } from '@/state/cast'
import { PIcon } from '@/player/ui/icons'
import { Menu } from '../Menu'
import { Icon } from '../Icon'

export function CastBar() {
  const device = useCast((s) => s.connected)
  const status = useCast((s) => s.status)
  const lost = useCast((s) => s.lost)
  const [seeking, setSeeking] = useState<number | null>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [volume, setVolume] = useState<number | null>(null)
  useEffect(() => setSeeking(null), [status?.video?.id])
  if (!device) return null
  const cast = useCast.getState()
  const video = status?.video ?? null
  const playing = status?.state === 'playing' || status?.state === 'buffering' || status?.state === 'loading'
  const duration = status?.duration ?? 0
  const position = seeking ?? status?.position ?? 0
  const shownVolume = volume ?? (status?.muted ? 0 : (status?.volume ?? 1))
  const line = lost
    ? `Đang kết nối lại với ${device.name}…`
    : status?.state === 'error'
      ? `${device.name}: ${status.error ?? 'lỗi phát video'}`
      : `Đang phát trên ${device.name}`
  return (
    <div className="cast-bar" data-testid="cast-bar">
      <div className="cast-bar-seek">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          value={Math.min(position, Math.max(duration, 1))}
          disabled={!duration}
          aria-label="Tua"
          style={{ '--fill': `${duration ? (position / duration) * 100 : 0}%` } as CSSProperties}
          onChange={(e) => setSeeking(Number(e.target.value))}
          onPointerUp={() => {
            if (seeking !== null) cast.control('seek', seeking)
            setTimeout(() => setSeeking(null), 1200)
          }}
          onKeyUp={() => {
            if (seeking !== null) cast.control('seek', seeking)
            setSeeking(null)
          }}
        />
      </div>
      <div className="cast-bar-row">
        <div className="cast-bar-info">
          {video ? <img className="cast-bar-art" src={displayThumbnail(video)} alt="" /> : <span className="cast-bar-art cast-bar-art--empty"><Icon name="cast" /></span>}
          <div className="cast-bar-text">
            <div className="cast-bar-title">{video?.title || 'Chưa phát video nào'}</div>
            <div className={'cast-bar-device' + (lost ? ' is-lost' : '')}>
              <Icon name={device.kind === 'tv' ? 'tv' : 'monitor'} size={14} />
              {line}
              {duration ? <span className="cast-bar-time">{formatTime(position)} / {formatTime(duration)}</span> : null}
            </div>
          </div>
        </div>
        <div className="cast-bar-controls">
          <button className="cast-btn" aria-label="Video trước" title="Video trước" onClick={() => cast.control('previous')}>
            <PIcon name="previous" size={22} />
          </button>
          <button className="cast-btn cast-btn--text" aria-label="Lùi 10 giây" title="Lùi 10 giây" onClick={() => cast.control('skip', -10)}>
            <PIcon name="replay" size={20} />
            <span>10</span>
          </button>
          <button className="cast-btn cast-btn--play" aria-label={playing ? 'Tạm dừng' : 'Phát'} onClick={() => cast.control('toggle')} data-testid="cast-play">
            <PIcon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <button className="cast-btn cast-btn--text" aria-label="Tới 10 giây" title="Tới 10 giây" onClick={() => cast.control('skip', 10)}>
            <PIcon name="forward" size={20} />
            <span>10</span>
          </button>
          <button className="cast-btn" aria-label="Video tiếp theo" title="Video tiếp theo" onClick={() => cast.control('next')}>
            <PIcon name="next" size={22} />
          </button>
        </div>
        <div className="cast-bar-end">
          <button className="cast-btn" aria-label={status?.muted ? 'Bật tiếng' : 'Tắt tiếng'} onClick={() => cast.control('mute', status?.muted ? 0 : 1)}>
            <PIcon name={status?.muted || shownVolume === 0 ? 'volumeOff' : shownVolume < 0.5 ? 'volumeLow' : 'volumeHigh'} size={22} />
          </button>
          <input
            className="slider cast-bar-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={shownVolume}
            aria-label="Âm lượng trên thiết bị"
            style={{ '--fill': `${shownVolume * 100}%` } as CSSProperties}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              cast.control('volume', v)
            }}
            onPointerUp={() => setTimeout(() => setVolume(null), 1500)}
          />
          <button className="btn btn-tonal btn-small" onClick={(e) => setMenu(menu ? null : e.currentTarget)} data-testid="cast-disconnect">
            <PIcon name="castConnected" size={18} />
            Ngắt kết nối
          </button>
          {menu && (
            <Menu
              anchor={menu}
              onClose={() => setMenu(null)}
              placement="top-end"
              items={[
                { label: 'Tiếp tục trên thiết bị này', icon: 'monitor', onSelect: () => void cast.disconnect(true) },
                { label: 'Ngắt kết nối và dừng phát', icon: 'close', onSelect: () => void cast.disconnect(false) },
                { label: 'Chọn thiết bị khác…', icon: 'cast', onSelect: () => cast.openPicker(null, 'play') },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  )
}
