// Layers on top of the video: captions, spinner, error, "preparing" countdown, SponsorBlock
// skip button, autoplay countdown / replay, audio-only artwork, feedback bubbles, stats.

import { useEffect, useState, type CSSProperties } from 'react'
import { displayThumbnail, formatTime } from '@shared/models'
import { EQ_PRESETS } from '@shared/settings'
import { api } from '@/lib/api'
import { usePlayer } from '@/state/player'
import { useSettings } from '@/state/settings'
import { engineStats, mainVideo, sponsorTitle } from '../controller'
import { loudnessGain } from '../engine/audio'
import { SOURCE_LABELS } from '../engine/sources'
import { useFeedback } from './feedback'
import { PIcon } from './icons'

export function CaptionOverlay({ raised }: { raised: boolean }) {
  const cues = usePlayer((s) => s.captionCues)
  const track = usePlayer((s) => s.captionTrack)
  const size = useSettings((s) => s.settings.captionSize)
  const background = useSettings((s) => s.settings.captionBackground)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (!track || !cues.length) {
      setText(null)
      return
    }
    const update = () => {
      const t = mainVideo().currentTime
      const active = cues.filter((c) => t >= c.start && t < c.end).slice(-2)
      setText(active.length ? active.map((c) => c.text).join('\n') : null)
    }
    update()
    const timer = setInterval(update, 150)
    return () => clearInterval(timer)
  }, [cues, track])

  if (!text) return null
  return (
    <div
      className={'dp-captions' + (raised ? ' dp-captions--raised' : '')}
      style={{ '--cap-scale': size / 100, '--cap-bg': background } as CSSProperties}
      data-testid="player-captions"
    >
      <span>{text}</span>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="dp-spinner" aria-label="Đang tải">
      <svg viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" />
      </svg>
    </div>
  )
}

export function ErrorOverlay() {
  const error = usePlayer((s) => s.error)
  const detail = usePlayer((s) => s.errorDetail)
  const current = usePlayer((s) => s.current)
  if (!error) return null
  return (
    <div className="dp-error" data-testid="player-error" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="dp-error-icon">!</div>
      <div className="dp-error-title">Không phát được video</div>
      <div className="dp-error-message">{error !== 'Không phát được video' ? error : null}</div>
      {detail ? <div className="dp-error-detail">{detail}</div> : null}
      <div className="dp-error-actions">
        <button type="button" className="dp-btn dp-btn--light" onClick={() => usePlayer.getState().retry()}>
          Thử lại
        </button>
        {current ? (
          <button type="button" className="dp-btn" onClick={() => api.openExternal(`https://www.youtube.com/watch?v=${current.id}`).catch(() => {})}>
            Mở bằng trình duyệt
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function WaitOverlay() {
  const seconds = usePlayer((s) => s.waitSeconds)
  if (seconds <= 0) return null
  return (
    <div className="dp-wait">
      <Spinner />
      <div>Đang chuẩn bị video… {seconds} giây</div>
      <div className="dp-wait-sub">Thời gian chờ thay cho quảng cáo</div>
    </div>
  )
}

export function SponsorSkipButton() {
  const segment = usePlayer((s) => s.sponsorPrompt)
  if (!segment) return null
  return (
    <button
      type="button"
      className="dp-skip"
      onClick={(e) => {
        e.stopPropagation()
        usePlayer.getState().skipSponsor()
      }}
    >
      Bỏ qua {sponsorTitle(segment).toLowerCase()}
      <PIcon name="skip" size={20} />
    </button>
  )
}

export function UpNextCard({ compact }: { compact: boolean }) {
  const next = usePlayer((s) => s.upNext)
  const endsAt = usePlayer((s) => s.upNextEndsAt)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!next) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [next])
  if (!next || !endsAt) return null
  const left = Math.max(0, endsAt - now)
  const progress = 1 - left / 5000
  const circumference = 2 * Math.PI * 30
  const p = usePlayer.getState()
  return (
    <div className={'dp-upnext' + (compact ? ' dp-upnext--compact' : '')} data-testid="player-upnext" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {!compact ? <div className="dp-upnext-label">Tiếp theo sau {Math.ceil(left / 1000)} giây</div> : null}
      {!compact ? (
        <div className="dp-upnext-video">
          <img src={displayThumbnail(next)} alt="" />
          <div className="dp-upnext-meta">
            <div className="dp-upnext-title">{next.title}</div>
            <div className="dp-upnext-channel">{next.channelName}</div>
          </div>
        </div>
      ) : null}
      <button type="button" className="dp-upnext-play" onClick={() => p.playUpNextNow()} aria-label="Phát ngay">
        <svg className="dp-upnext-ring-svg" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" className="dp-upnext-ring-bg" />
          <circle cx="32" cy="32" r="30" className="dp-upnext-ring" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }} />
        </svg>
        <PIcon name="play" size={30} />
      </button>
      <div className="dp-upnext-actions">
        <button type="button" className="dp-btn" onClick={() => p.cancelUpNext()}>
          Hủy
        </button>
        {!compact ? (
          <button type="button" className="dp-btn dp-btn--light" onClick={() => p.playUpNextNow()}>
            Phát ngay
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function EndScreen() {
  const ended = usePlayer((s) => s.status === 'ended' && !s.upNext)
  if (!ended) return null
  return (
    <button
      type="button"
      className="dp-replay"
      onClick={(e) => {
        e.stopPropagation()
        usePlayer.getState().replay()
      }}
    >
      <PIcon name="replay" size={44} />
      <span>Xem lại</span>
    </button>
  )
}

export function AudioOnlyBackdrop({ compact }: { compact: boolean }) {
  const audioOnly = usePlayer((s) => s.audioOnly || s.pictureless)
  const current = usePlayer((s) => s.current)
  const source = usePlayer((s) => s.source)
  if (!audioOnly || !current) return null
  const thumbnail = displayThumbnail(current)
  return (
    <div className="dp-audio-only">
      <div className="dp-audio-only-bg" style={{ backgroundImage: `url("${thumbnail}")` }} />
      {!compact ? (
        <div className="dp-audio-only-card">
          <img src={thumbnail} alt="" />
          <div className="dp-audio-only-label">
            <PIcon name="headphones" size={18} /> Chỉ phát âm thanh
          </div>
          {source !== 'download' ? (
            <button
              type="button"
              className="dp-btn"
              onClick={(e) => {
                e.stopPropagation()
                usePlayer.getState().setAudioOnly(false)
              }}
            >
              Bật hình
            </button>
          ) : null}
        </div>
      ) : (
        <PIcon name="headphones" size={32} className="dp-audio-only-icon" />
      )}
    </div>
  )
}

export function FeedbackBubble() {
  const feedback = useFeedback((s) => s.feedback)
  if (!feedback) return null
  return (
    <div key={feedback.id} className={`dp-feedback dp-feedback--${feedback.place}`}>
      {feedback.icon ? <PIcon name={feedback.icon} size={feedback.place === 'center' ? 36 : 22} /> : null}
      {feedback.text ? <span>{feedback.text}</span> : null}
    </div>
  )
}

export function BoostBadge() {
  const boosted = usePlayer((s) => s.boosted)
  if (!boosted) return null
  return (
    <div className="dp-boost">
      Tốc độ 2x <PIcon name="skip" size={18} />
    </div>
  )
}

function kbps(bits: number): string {
  return bits > 0 ? `${Math.round(bits / 1000).toLocaleString('vi-VN')} Kbps` : '–'
}

export function StatsOverlay() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const s = usePlayer.getState()
  const settings = useSettings.getState().settings
  const stats = engineStats()
  const video = mainVideo()
  const gain = loudnessGain(s.info?.loudnessDb ?? null, settings.stableVolume)
  const eq = settings.equalizer
  const lines: [string, string][] = [
    ['ID video / Ứng dụng', `${s.current?.id ?? '–'} / ${s.info?.client ?? '–'}`],
    ['Cách phát', s.source ? SOURCE_LABELS[s.source] : '–'],
    [
      'Độ phân giải',
      stats ? `${stats.width}×${stats.height}${stats.fps ? '@' + Math.round(stats.fps) : ''}` + (s.quality ? ` (chọn ${s.quality}p)` : ' (tự động)') : '–',
    ],
    ['Khung hình', stats ? `${stats.droppedFrames} bị bỏ / ${stats.decodedFrames}` : '–'],
    ['Mã hóa', stats ? `${stats.videoCodec ?? '–'} / ${stats.audioCodec ?? '–'}` : '–'],
    ['Bitrate luồng', stats ? kbps(stats.streamBandwidth) : '–'],
    ['Tốc độ kết nối', stats ? kbps(stats.estimatedBandwidth) : '–'],
    ['Bộ đệm', stats ? `${stats.bufferAhead.toFixed(2).replace('.', ',')} giây` : '–'],
    ['Âm lượng / Chuẩn hóa', `${Math.round(video.volume * 100)}% / ${gain !== 1 ? (20 * Math.log10(gain)).toFixed(1).replace('.', ',') + ' dB' : 'tắt'}`],
    ['Bộ chỉnh âm', eq.enabled ? (EQ_PRESETS.find((p) => p.id === eq.preset)?.title ?? 'Tùy chỉnh') : 'Tắt'],
    ['Tốc độ phát', `${(s.boosted ? 2 : s.rate).toString().replace('.', ',')}x`],
    ['Vị trí', `${formatTime(video.currentTime)} / ${formatTime(s.duration)}`],
  ]
  return (
    <div className="dp-stats" data-testid="player-stats" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="dp-stats-close" aria-label="Đóng" onClick={() => usePlayer.getState().setStats(false)}>
        <PIcon name="close" size={16} />
      </button>
      {lines.map(([label, value]) => (
        <div key={label} className="dp-stats-line">
          <span className="dp-stats-label">{label}</span>
          <span className="dp-stats-value">{value}</span>
        </div>
      ))}
    </div>
  )
}
