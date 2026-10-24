// Popovers and menus (⋮ menus, avatar menu, select boxes). Rendered in a portal with fixed
// positioning next to their anchor, kept inside the window, closed by Esc / outside click.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { Switch } from './Switch'

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start'

export interface PopoverProps {
  anchor: HTMLElement
  onClose: () => void
  children: ReactNode
  placement?: Placement
  className?: string
  /** Distance from the anchor in px. */
  offset?: number
  testId?: string
}

export function Popover({ anchor, onClose, children, placement = 'bottom-end', className, offset = 4, testId }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const w = node.offsetWidth
      const h = node.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      let top: number
      let left: number
      if (placement === 'right-start' || placement === 'left-start') {
        top = a.top
        left = placement === 'right-start' ? a.right + offset : a.left - w - offset
      } else {
        const below = placement.startsWith('bottom')
        top = below ? a.bottom + offset : a.top - h - offset
        if (below && top + h > vh - 8 && a.top - h - offset > 8) top = a.top - h - offset
        if (!below && top < 8 && a.bottom + offset + h < vh - 8) top = a.bottom + offset
        left = placement.endsWith('start') ? a.left : a.right - w
      }
      left = Math.min(Math.max(8, left), vw - w - 8)
      top = Math.min(Math.max(8, top), vh - h - 8)
      setPos({ top, left })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(node)
    return () => observer.disconnect()
  }, [anchor, placement, offset])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        anchor.focus?.()
      }
    }
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return
      closeRef.current()
    }
    const onResize = () => closeRef.current()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className={'popover' + (className ? ' ' + className : '')}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      data-testid={testId}
    >
      {children}
    </div>,
    document.body,
  )
}

export interface MenuItem {
  label: string
  icon?: IconName
  onSelect?: () => void
  /** Opens a nested list in place of this one (with a back row). */
  submenu?: { title: string; items: MenuEntry[] }
  /** Shows a check mark (selected option). */
  checked?: boolean
  /** Renders a switch in the row; selecting flips it. */
  toggle?: boolean
  /** Secondary text on the right (current value of a setting). */
  detail?: string
  danger?: boolean
  disabled?: boolean
  /** Keep the menu open after selecting (toggles). */
  keepOpen?: boolean
  testId?: string
}

export type MenuEntry = MenuItem | 'divider' | { header: ReactNode }

function isItem(entry: MenuEntry): entry is MenuItem {
  return typeof entry === 'object' && 'label' in entry
}

/** The list part of a menu; usable inside any popover. */
export function MenuList({ items, onClose, checkColumn }: { items: MenuEntry[]; onClose: () => void; checkColumn?: boolean }) {
  const [stack, setStack] = useState<{ title: string; items: MenuEntry[] }[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const level = stack[stack.length - 1]
  const entries = level ? level.items : items
  const showChecks = checkColumn ?? (!!level && entries.some((e) => isItem(e) && e.checked !== undefined))

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus({ preventScroll: true })
  }, [stack.length])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
      if (e.key === 'ArrowLeft' && stack.length) setStack(stack.slice(0, -1))
      return
    }
    e.preventDefault()
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])
    const index = buttons.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div className="menu" role="menu" ref={listRef} onKeyDown={onKeyDown}>
      {level && (
        <>
          <button className="menu-item menu-back" onClick={() => setStack(stack.slice(0, -1))}>
            <Icon name="back" size={22} />
            <span className="menu-label">{level.title}</span>
          </button>
          <div className="menu-divider" />
        </>
      )}
      {entries.map((entry, i) => {
        if (entry === 'divider') return <div key={i} className="menu-divider" />
        if (!isItem(entry))
          return (
            <div key={i} className="menu-header">
              {entry.header}
            </div>
          )
        return (
          <button
            key={i}
            role={entry.toggle !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            className={'menu-item' + (entry.danger ? ' menu-item--danger' : '')}
            disabled={entry.disabled}
            data-testid={entry.testId}
            onClick={() => {
              if (entry.submenu) return setStack([...stack, entry.submenu])
              entry.onSelect?.()
              if (!entry.keepOpen && entry.toggle === undefined) onClose()
            }}
          >
            {showChecks && <span className="menu-check">{entry.checked && <Icon name="check" size={20} />}</span>}
            {entry.icon && <Icon name={entry.icon} size={22} />}
            <span className="menu-label">{entry.label}</span>
            {entry.detail && <span className="menu-detail">{entry.detail}</span>}
            {entry.toggle !== undefined && <Switch checked={entry.toggle} onChange={() => entry.onSelect?.()} tabIndex={-1} />}
            {entry.submenu && <Icon name="chevronRight" size={20} className="menu-chevron" />}
          </button>
        )
      })}
    </div>
  )
}

export interface MenuProps {
  anchor: HTMLElement
  items: MenuEntry[]
  onClose: () => void
  placement?: Placement
  header?: ReactNode
  className?: string
  testId?: string
}

export function Menu({ anchor, items, onClose, placement, header, className, testId }: MenuProps) {
  return (
    <Popover anchor={anchor} onClose={onClose} placement={placement} className={'popover-menu' + (className ? ' ' + className : '')} testId={testId}>
      {header}
      <MenuList items={items} onClose={onClose} />
    </Popover>
  )
}

/** An icon button that opens a menu. `items` is evaluated when the menu opens. */
export function MenuButton({
  items,
  icon = 'more',
  label = 'Tác vụ khác',
  className,
  placement = 'bottom-end',
  size = 40,
  testId,
}: {
  items: () => MenuEntry[]
  icon?: IconName
  label?: string
  className?: string
  placement?: Placement
  size?: number
  testId?: string
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        className={'icon-btn' + (anchor ? ' is-open' : '') + (className ? ' ' + className : '')}
        style={{ width: size, height: size }}
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setAnchor(anchor ? null : e.currentTarget)
        }}
      >
        <Icon name={icon} size={size >= 36 ? 24 : 20} />
      </button>
      {anchor && <Menu anchor={anchor} items={items()} onClose={() => setAnchor(null)} placement={placement} />}
    </>
  )
}
