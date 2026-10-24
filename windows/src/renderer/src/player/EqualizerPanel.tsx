// 10-band equalizer with genre presets, editing `settings.equalizer` live (the player's Web
// Audio graph follows the settings). Used in the player ⚙ menu and on the Settings page.

import { useMemo } from 'react'
import { EQ_BANDS, EQ_PRESETS, type EqualizerSettings } from '@shared/settings'
import { useSettings } from '@/state/settings'
import { autoHeadroom } from './engine/audio'

const MIN = -12
const MAX = 12

function frequencyLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}K` : String(hz)
}

function gainText(gain: number): string {
  if (gain === 0) return '0'
  const rounded = Math.round(gain * 10) / 10
  return (rounded > 0 ? '+' : '') + String(rounded).replace('.', ',')
}

/** Smooth curve through the band gains, drawn behind the sliders. */
function curvePath(gains: number[], width: number, height: number): string {
  const points = gains.map((g, i) => ({
    x: ((i + 0.5) / gains.length) * width,
    y: height / 2 - (g / MAX) * (height / 2 - 4),
  }))
  let d = `M0 ${points[0].y} L${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const mid = (a.x + b.x) / 2
    d += ` C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`
  }
  return d + ` L${width} ${points[points.length - 1].y}`
}

export function EqualizerPanel({ compact = false }: { compact?: boolean } = {}) {
  const eq = useSettings((s) => s.settings.equalizer)
  const update = useSettings((s) => s.update)
  const gains = useMemo(() => EQ_BANDS.map((_, i) => eq.gains[i] ?? 0), [eq.gains])
  const change = (patch: Partial<EqualizerSettings>) => update({ equalizer: { ...eq, ...patch } })
  const headroom = autoHeadroom(gains)

  const setBand = (index: number, value: number) => {
    const next = [...gains]
    next[index] = Math.min(MAX, Math.max(MIN, value))
    change({ gains: next, preset: 'custom', enabled: true })
  }

  return (
    <div className={'dp-eq' + (compact ? ' dp-eq--compact' : '') + (eq.enabled ? '' : ' dp-eq--off')} data-testid="equalizer">
      <div className="dp-eq-head">
        <div className="dp-eq-title">
          <div className="dp-eq-name">Bật bộ chỉnh âm</div>
          {!compact ? <div className="dp-eq-sub">10 dải tần, áp dụng cho mọi video kể cả khi phát trong nền</div> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={eq.enabled}
          aria-label="Bật bộ chỉnh âm"
          className={'dp-switch' + (eq.enabled ? ' dp-switch--on' : '')}
          onClick={() => change({ enabled: !eq.enabled })}
        />
      </div>

      <div className="dp-eq-presets" role="radiogroup" aria-label="Kiểu nhạc">
        {EQ_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={eq.preset === preset.id}
            className={'dp-chip' + (eq.preset === preset.id ? ' dp-chip--on' : '')}
            onClick={() => change({ preset: preset.id, gains: [...preset.gains], enabled: preset.id !== 'flat' || eq.enabled })}
          >
            {preset.title}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={eq.preset === 'custom'} className={'dp-chip' + (eq.preset === 'custom' ? ' dp-chip--on' : '')} onClick={() => change({ preset: 'custom', enabled: true })}>
          Tùy chỉnh
        </button>
      </div>

      <div className="dp-eq-bands">
        <svg className="dp-eq-curve" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="400" y1="70" y2="70" />
          <path d={curvePath(gains, 400, 140)} />
        </svg>
        {EQ_BANDS.map((hz, i) => (
          <div key={hz} className="dp-eq-band">
            <span className="dp-eq-value">{gainText(gains[i])}</span>
            <input
              type="range"
              className="dp-eq-slider"
              min={MIN}
              max={MAX}
              step={0.5}
              value={gains[i]}
              aria-label={`${frequencyLabel(hz)} Hz`}
              onChange={(e) => setBand(i, Number(e.target.value))}
              onDoubleClick={() => setBand(i, 0)}
            />
            <span className="dp-eq-freq">{frequencyLabel(hz)}</span>
          </div>
        ))}
      </div>

      <div className="dp-eq-preamp">
        <span className="dp-eq-preamp-label">Tiền khuếch đại</span>
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={0.5}
          value={eq.preamp}
          aria-label="Tiền khuếch đại"
          onChange={(e) => change({ preamp: Number(e.target.value) })}
        />
        <span className="dp-eq-preamp-value">{gainText(eq.preamp)} dB</span>
      </div>
      {!compact ? (
        <div className="dp-eq-hint">
          Kéo từng cột để chỉnh âm trầm (bên trái) đến âm cao (bên phải); chỉnh tay sẽ chuyển sang “Tùy chỉnh” và được lưu lại.
          {headroom < 0 ? ` Đầu vào tự giảm ${gainText(headroom)} dB để tránh rè tiếng.` : ''}
        </div>
      ) : null}
      <div className="dp-eq-actions">
        <button type="button" className="dp-btn" onClick={() => change({ preset: 'flat', gains: EQ_BANDS.map(() => 0), preamp: 0 })}>
          Đặt lại
        </button>
      </div>
    </div>
  )
}
