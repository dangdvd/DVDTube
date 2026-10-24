// The ⚙ menu of the player: quality, speed, captions (+ auto-translate, size, background),
// audio track, sleep timer, loop, audio only, stable volume, equalizer, stats for nerds.

import { useEffect, useState, type ReactNode } from 'react'
import { captionTrackId } from '@shared/models'
import { EQ_PRESETS } from '@shared/settings'
import { usePlayer } from '@/state/player'
import { useSettings } from '@/state/settings'
import { EqualizerPanel } from '../EqualizerPanel'
import { languageName } from '../engine/engine'
import { PIcon, type PlayerIconName } from './icons'

type Page = 'main' | 'quality' | 'speed' | 'captions' | 'translate' | 'captionStyle' | 'audio' | 'sleep' | 'equalizer'

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4]
const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90, 120]
const TRANSLATE_LANGUAGES = ['vi', 'en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'th', 'id', 'fr', 'de', 'es', 'pt', 'ru', 'hi', 'ar', 'it']
const CAPTION_SIZES = [50, 75, 100, 150, 200]
const CAPTION_BACKGROUNDS = [0, 0.25, 0.5, 0.75, 1]

export function speedLabel(rate: number): string {
  return rate === 1 ? 'Chuẩn' : String(rate).replace('.', ',')
}

export function sleepLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`
  const rest = minutes % 60
  return rest ? `${Math.floor(minutes / 60)} giờ ${rest} phút` : `${minutes / 60} giờ`
}

export function useSleepRemaining(): string | null {
  const endsAt = usePlayer((s) => s.sleepEndsAt)
  const atEnd = usePlayer((s) => s.sleepAtEnd)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!endsAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [endsAt])
  if (atEnd) return 'Hết video'
  if (!endsAt) return null
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

function Row({ icon, label, value, onClick }: { icon: PlayerIconName; label: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="dp-sm-row" onClick={onClick}>
      <PIcon name={icon} size={22} />
      <span className="dp-sm-label">{label}</span>
      <span className="dp-sm-value">{value}</span>
      <PIcon name="chevronRight" size={20} className="dp-sm-chevron" />
    </button>
  )
}

function ToggleRow({ icon, label, on, onChange }: { icon: PlayerIconName; label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className="dp-sm-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <PIcon name={icon} size={22} />
      <span className="dp-sm-label">{label}</span>
      <span className={'dp-switch' + (on ? ' dp-switch--on' : '')} />
    </button>
  )
}

function Option({ label, checked, onClick, badge, detail }: { label: string; checked: boolean; onClick: () => void; badge?: string | null; detail?: string | null }) {
  return (
    <button type="button" className="dp-sm-option" role="menuitemradio" aria-checked={checked} onClick={onClick}>
      <span className="dp-sm-check">{checked ? <PIcon name="check" size={20} /> : null}</span>
      <span className="dp-sm-label">
        {label}
        {badge ? <sup className="dp-badge">{badge}</sup> : null}
      </span>
      {detail ? <span className="dp-sm-value">{detail}</span> : null}
    </button>
  )
}

function Header({ title, onBack, extra }: { title: string; onBack: () => void; extra?: ReactNode }) {
  return (
    <div className="dp-sm-header">
      <button type="button" className="dp-sm-back" onClick={onBack} aria-label="Quay lại">
        <PIcon name="chevronLeft" size={22} />
        <span>{title}</span>
      </button>
      {extra}
    </div>
  )
}

export function SettingsMenu({ onClose, initialPage = 'main' }: { onClose: () => void; initialPage?: Page }) {
  const [page, setPage] = useState<Page>(initialPage)
  const p = usePlayer()
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const sleepRemaining = useSleepRemaining()
  const back = () => setPage(page === 'translate' || page === 'captionStyle' ? 'captions' : 'main')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (page === 'main') onClose()
      else back()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const autoLabel = p.activeHeight ? `Tự động (${p.activeHeight}p${p.activeFps >= 48 ? p.activeFps : ''})` : 'Tự động'
  const selectedQuality = p.qualities.find((q) => q.height === p.quality)
  const qualityValue = p.quality ? (selectedQuality?.label ?? `${p.quality}p`) : autoLabel
  const captionValue = p.captionTrack ? p.captionTrack.name + (p.captionTranslate ? ` → ${languageName(p.captionTranslate)}` : '') : 'Tắt'
  const audioValue = p.audioTracks.find((t) => t.id === p.audioTrack)?.label ?? ''
  const eqValue = settings.equalizer.enabled ? (EQ_PRESETS.find((x) => x.id === settings.equalizer.preset)?.title ?? 'Tùy chỉnh') : 'Tắt'
  const adaptive = p.source !== 'progressive' && p.source !== 'download'

  let body: ReactNode
  switch (page) {
    case 'quality':
      body = (
        <>
          <Header title="Chất lượng" onBack={back} />
          <div className="dp-sm-list">
            {p.qualities.map((q) => (
              <Option
                key={q.label}
                label={q.label}
                badge={q.badge}
                checked={p.quality === q.height}
                onClick={() => {
                  p.setQuality(q.height)
                  onClose()
                }}
              />
            ))}
            <Option
              label={autoLabel}
              checked={!p.quality}
              onClick={() => {
                p.setQuality(0)
                onClose()
              }}
            />
          </div>
        </>
      )
      break
    case 'speed':
      body = (
        <>
          <Header title="Tốc độ phát" onBack={back} />
          <div className="dp-sm-custom">
            <span>Tùy chỉnh ({p.rate.toFixed(2).replace('.', ',')}x)</span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={p.rate}
              onChange={(e) => p.setRate(Number(e.target.value))}
              aria-label="Tốc độ tùy chỉnh"
            />
          </div>
          <div className="dp-sm-list">
            {SPEEDS.map((rate) => (
              <Option key={rate} label={speedLabel(rate)} checked={Math.abs(p.rate - rate) < 0.001} onClick={() => p.setRate(rate)} />
            ))}
          </div>
        </>
      )
      break
    case 'captions':
      body = (
        <>
          <Header
            title={`Phụ đề (${p.captionTracks.length})`}
            onBack={back}
            extra={
              <button type="button" className="dp-sm-link" onClick={() => setPage('captionStyle')}>
                Tùy chọn
              </button>
            }
          />
          <div className="dp-sm-list">
            <Option label="Tắt" checked={!p.captionTrack} onClick={() => p.setCaption(null)} />
            {p.captionTracks.map((track) => (
              <Option
                key={captionTrackId(track)}
                label={track.name}
                checked={!!p.captionTrack && captionTrackId(p.captionTrack) === captionTrackId(track) && !p.captionTranslate}
                onClick={() => p.setCaption(track, null)}
              />
            ))}
            {p.captionTracks.some((t) => t.isTranslatable) ? (
              <button type="button" className="dp-sm-option" onClick={() => setPage('translate')}>
                <span className="dp-sm-check">{p.captionTranslate ? <PIcon name="check" size={20} /> : null}</span>
                <span className="dp-sm-label">Tự dịch</span>
                <span className="dp-sm-value">{p.captionTranslate ? languageName(p.captionTranslate) : ''}</span>
                <PIcon name="chevronRight" size={20} className="dp-sm-chevron" />
              </button>
            ) : null}
          </div>
        </>
      )
      break
    case 'translate': {
      const source = p.captionTracks.find((t) => t.isTranslatable && !t.isAutoGenerated) ?? p.captionTracks.find((t) => t.isTranslatable)
      body = (
        <>
          <Header title="Tự dịch sang" onBack={back} />
          <div className="dp-sm-list">
            {TRANSLATE_LANGUAGES.map((code) => (
              <Option
                key={code}
                label={languageName(code)}
                checked={p.captionTranslate === code}
                onClick={() => {
                  const track = p.captionTrack?.isTranslatable ? p.captionTrack : source
                  if (track) p.setCaption(track, code)
                  onClose()
                }}
              />
            ))}
          </div>
        </>
      )
      break
    }
    case 'captionStyle':
      body = (
        <>
          <Header title="Tùy chọn phụ đề" onBack={back} />
          <div className="dp-sm-chips-title">Kích thước chữ</div>
          <div className="dp-sm-chips">
            {CAPTION_SIZES.map((size) => (
              <button key={size} type="button" className={'dp-chip' + (settings.captionSize === size ? ' dp-chip--on' : '')} onClick={() => update({ captionSize: size })}>
                {size}%
              </button>
            ))}
          </div>
          <div className="dp-sm-chips-title">Độ đậm nền</div>
          <div className="dp-sm-chips">
            {CAPTION_BACKGROUNDS.map((value) => (
              <button
                key={value}
                type="button"
                className={'dp-chip' + (Math.abs(settings.captionBackground - value) < 0.01 ? ' dp-chip--on' : '')}
                onClick={() => update({ captionBackground: value })}
              >
                {Math.round(value * 100)}%
              </button>
            ))}
          </div>
        </>
      )
      break
    case 'audio':
      body = (
        <>
          <Header title="Bản âm thanh" onBack={back} />
          <div className="dp-sm-list">
            {p.audioTracks.map((track) => (
              <Option
                key={track.id}
                label={track.label + (track.isDefault && !/gốc|original|nguyên bản/i.test(track.label) ? ' (gốc)' : '')}
                checked={p.audioTrack === track.id}
                onClick={() => {
                  p.setAudioTrack(track.id)
                  onClose()
                }}
              />
            ))}
          </div>
        </>
      )
      break
    case 'sleep':
      body = (
        <>
          <Header title="Hẹn giờ tắt" onBack={back} />
          {sleepRemaining ? <div className="dp-sm-note">{p.sleepAtEnd ? 'Sẽ dừng khi hết video này' : `Dừng phát sau ${sleepRemaining}`}</div> : null}
          <div className="dp-sm-list">
            <Option label="Tắt" checked={!p.sleepEndsAt && !p.sleepAtEnd} onClick={() => p.setSleepTimer(null)} />
            {SLEEP_MINUTES.map((m) => (
              <Option
                key={m}
                label={sleepLabel(m)}
                checked={false}
                onClick={() => {
                  p.setSleepTimer(m)
                  onClose()
                }}
              />
            ))}
            <Option
              label="Hết video"
              checked={p.sleepAtEnd}
              onClick={() => {
                p.setSleepTimer(0)
                onClose()
              }}
            />
          </div>
          <div className="dp-sm-note dp-sm-note--small">Âm thanh nhỏ dần trong 10 giây cuối rồi video tạm dừng.</div>
        </>
      )
      break
    case 'equalizer':
      body = (
        <>
          <Header title="Bộ chỉnh âm" onBack={back} />
          <div className="dp-sm-eq">
            <EqualizerPanel compact />
          </div>
        </>
      )
      break
    default:
      body = (
        <div className="dp-sm-list">
          {p.qualities.length > 0 && adaptive ? (
            <Row
              icon="quality"
              label="Chất lượng"
              value={
                <>
                  {qualityValue}
                  {p.quality && selectedQuality?.badge ? <sup className="dp-badge">{selectedQuality.badge}</sup> : null}
                </>
              }
              onClick={() => setPage('quality')}
            />
          ) : null}
          {!p.live ? <Row icon="speed" label="Tốc độ phát" value={speedLabel(p.rate)} onClick={() => setPage('speed')} /> : null}
          {p.captionTracks.length ? <Row icon="captions" label={`Phụ đề (${p.captionTracks.length})`} value={captionValue} onClick={() => setPage('captions')} /> : null}
          {p.audioTracks.length > 1 ? <Row icon="audioTrack" label="Bản âm thanh" value={audioValue} onClick={() => setPage('audio')} /> : null}
          <Row icon="bedtime" label="Hẹn giờ tắt" value={sleepRemaining ?? 'Tắt'} onClick={() => setPage('sleep')} />
          {!p.live ? <ToggleRow icon="repeat" label="Lặp lại" on={p.loop} onChange={(on) => p.setLoop(on)} /> : null}
          {p.source !== 'download' ? <ToggleRow icon="headphones" label="Chỉ âm thanh" on={p.audioOnly} onChange={(on) => p.setAudioOnly(on)} /> : null}
          <ToggleRow icon="volumeHigh" label="Âm lượng ổn định" on={settings.stableVolume} onChange={(on) => update({ stableVolume: on })} />
          <Row icon="equalizer" label="Bộ chỉnh âm" value={eqValue} onClick={() => setPage('equalizer')} />
          <ToggleRow
            icon="info"
            label="Thống kê chuyên sâu"
            on={p.stats}
            onChange={(on) => {
              p.setStats(on)
              onClose()
            }}
          />
        </div>
      )
  }

  return (
    <div
      className={'dp-settings' + (page === 'equalizer' ? ' dp-settings--wide' : '')}
      data-testid="player-settings"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {body}
    </div>
  )
}
