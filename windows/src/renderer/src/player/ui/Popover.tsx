// Small menus anchored to a button (watch page actions, comment sort…), in a portal with
// fixed positioning, kept inside the window, closed by Esc or a click outside.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PIcon, type PlayerIconName } from './icons'

export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  className,
}: {
  anchor: HTMLElement
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const a = anchor.getBoundingClientRect()
    const width = node.offsetWidth
    const height = node.offsetHeight
    let left = align === 'end' ? a.right - width : a.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    let top = a.bottom + 4
    if (top + height > window.innerHeight - 8) top = Math.max(8, a.top - height - 4)
    setPosition({ top, left })
  }, [anchor, align])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) close.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current()
      }
    }
    const onScroll = () => close.current()
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className={'dp-popover' + (className ? ' ' + className : '')}
      role="menu"
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({
  icon,
  label,
  detail,
  checked,
  onSelect,
}: {
  icon?: PlayerIconName
  label: string
  detail?: string | null
  checked?: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" role="menuitem" className="dp-menu-item" onClick={onSelect}>
      {icon ? <PIcon name={icon} size={22} /> : checked != null ? <span className="dp-menu-check">{checked ? <PIcon name="check" size={20} /> : null}</span> : null}
      <span className="dp-menu-label">{label}</span>
      {detail ? <span className="dp-menu-detail">{detail}</span> : null}
    </button>
  )
}

/** A popover menu opened from a button; `children` gets `close()`. */
export function useMenu(): {
  anchor: HTMLElement | null
  open: (event: { currentTarget: HTMLElement }) => void
  close: () => void
} {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return {
    anchor,
    open: (event) => setAnchor((current) => (current ? null : event.currentTarget)),
    close: () => setAnchor(null),
  }
}
