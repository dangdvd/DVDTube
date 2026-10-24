// Filter chips and the horizontally scrolling row that holds them (with ‹ › arrows and fades
// like YouTube when the chips overflow).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Chip({
  selected,
  onClick,
  children,
  testId,
  title,
}: {
  selected?: boolean
  onClick?: () => void
  children: ReactNode
  testId?: string
  title?: string
}) {
  return (
    <button className={'chip' + (selected ? ' is-selected' : '')} onClick={onClick} aria-pressed={!!selected} data-testid={testId} title={title}>
      {children}
    </button>
  )
}

/** Horizontal scroller with arrow buttons that show only when there is more to see. */
export function HScroll({
  children,
  className,
  step = 0.8,
  arrowClass,
}: {
  children: ReactNode
  className?: string
  step?: number
  arrowClass?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => {
      const max = node.scrollWidth - node.clientWidth
      setEdges({ start: node.scrollLeft <= 2, end: node.scrollLeft >= max - 2 })
    }
    update()
    node.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(node)
    for (const child of Array.from(node.children)) observer.observe(child)
    return () => {
      node.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [children])

  const scroll = (dir: number) => {
    const node = ref.current
    if (node) node.scrollBy({ left: dir * node.clientWidth * step, behavior: 'smooth' })
  }

  return (
    <div className={'hscroll' + (className ? ' ' + className : '')}>
      {!edges.start && (
        <div className="hscroll-edge hscroll-edge--start">
          <button className={'icon-btn hscroll-arrow' + (arrowClass ? ' ' + arrowClass : '')} aria-label="Trước" onClick={() => scroll(-1)}>
            <Icon name="chevronLeft" />
          </button>
        </div>
      )}
      <div className="hscroll-track" ref={ref}>
        {children}
      </div>
      {!edges.end && (
        <div className="hscroll-edge hscroll-edge--end">
          <button className={'icon-btn hscroll-arrow' + (arrowClass ? ' ' + arrowClass : '')} aria-label="Tiếp" onClick={() => scroll(1)}>
            <Icon name="chevronRight" />
          </button>
        </div>
      )}
    </div>
  )
}

export function ChipBar<T extends string>({
  options,
  value,
  onChange,
  sticky,
  trailing,
  testId,
}: {
  options: { id: T; title: string }[]
  value: T
  onChange: (id: T) => void
  sticky?: boolean
  trailing?: ReactNode
  testId?: string
}) {
  return (
    <div className={'chipbar' + (sticky ? ' chipbar--sticky' : '')} data-testid={testId}>
      <HScroll className="chipbar-scroll">
        {options.map((o) => (
          <Chip key={o.id} selected={o.id === value} onClick={() => onChange(o.id)} testId={`chip-${o.id}`}>
            {o.title}
          </Chip>
        ))}
      </HScroll>
      {trailing}
    </div>
  )
}
