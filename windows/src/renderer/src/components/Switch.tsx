// Toggle switch (settings rows, menus).

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  tabIndex,
  testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  tabIndex?: number
  testId?: string
}) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={tabIndex ?? (disabled ? -1 : 0)}
      data-testid={testId}
      className={'switch' + (checked ? ' is-on' : '') + (disabled ? ' is-disabled' : '')}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onChange(!checked)
      }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange(!checked)
        }
      }}
    >
      <span className="switch-thumb" />
    </span>
  )
}
