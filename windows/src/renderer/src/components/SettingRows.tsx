// Building blocks of the settings page: sections, toggle / select / slider / button rows.

import { useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './Icon'
import { Menu } from './Menu'
import { Switch } from './Switch'

export function SettingsSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="settings-section" id={id} data-section={id}>
      <h2 className="settings-section-title">{title}</h2>
      {description && <p className="settings-section-desc">{description}</p>}
      <div className="settings-card">{children}</div>
    </section>
  )
}

function RowText({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="setting-text">
      <div className="setting-title">{title}</div>
      {subtitle && <div className="setting-subtitle">{subtitle}</div>}
    </div>
  )
}

export function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
  disabled,
  testId,
}: {
  title: ReactNode
  subtitle?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <div className={'setting-row is-clickable' + (disabled ? ' is-disabled' : '')} onClick={() => !disabled && onChange(!checked)}>
      <RowText title={title} subtitle={subtitle} />
      <Switch checked={checked} onChange={onChange} disabled={disabled} testId={testId} />
    </div>
  )
}

export function SelectRow<T extends string | number | null>({
  title,
  subtitle,
  value,
  options,
  onChange,
  testId,
}: {
  title: ReactNode
  subtitle?: ReactNode
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  testId?: string
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const current = options.find((o) => o.value === value)?.label ?? String(value ?? '')
  return (
    <div className="setting-row">
      <RowText title={title} subtitle={subtitle} />
      <button className={'select-btn' + (anchor ? ' is-open' : '')} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} data-testid={testId}>
        <span>{current}</span>
        <Icon name="chevronDown" size={18} />
      </button>
      {anchor && (
        <Menu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          className="select-menu"
          items={options.map((o) => ({ label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) }))}
        />
      )}
    </div>
  )
}

export function SliderRow({
  title,
  subtitle,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  title: ReactNode
  subtitle?: ReactNode
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const percent = ((value - min) / (max - min)) * 100
  return (
    <div className="setting-row">
      <RowText title={title} subtitle={subtitle} />
      <div className="slider-box">
        <input
          type="range"
          className="slider"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ '--fill': `${percent}%` } as CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider-value">{format(value)}</span>
      </div>
    </div>
  )
}

export function ButtonRow({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <RowText title={title} subtitle={subtitle} />
      <div className="setting-actions">{children}</div>
    </div>
  )
}

export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check-row setting-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box">{checked && <Icon name="check" size={16} weight={3} />}</span>
      <span className="check-label">{label}</span>
    </label>
  )
}
