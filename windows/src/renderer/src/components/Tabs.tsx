// Underlined tabs (channel page, history source…).

import type { ReactNode } from 'react'

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
  className,
}: {
  tabs: { id: T; title: string }[]
  value: T
  onChange: (id: T) => void
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div className={'tabs' + (className ? ' ' + className : '')} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          className={'tab' + (t.id === value ? ' is-active' : '')}
          onClick={() => onChange(t.id)}
          data-testid={`tab-${t.id}`}
        >
          {t.title}
        </button>
      ))}
      {trailing}
    </div>
  )
}
