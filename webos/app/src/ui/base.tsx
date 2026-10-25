// Basic building blocks of the 10-foot interface: buttons, option rows, chips, shelves, grids,
// lazy images, avatars and the loading / message states.

import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { onLongPress } from '../keys'
import { Icon } from './icons'

type Click = () => void

// MARK: Buttons

export function Button(props: {
  label: string
  icon?: string
  onClick: Click
  accent?: boolean
  selected?: boolean
  focusKey?: string
  autofocus?: boolean
  testid?: string
  small?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      class={`btn${props.accent ? ' accent' : ''}${props.selected ? ' selected' : ''}${props.small ? ' small' : ''}`}
      data-f
      tabIndex={-1}
      data-key={props.focusKey ?? `btn-${props.label}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid={props.testid}
      aria-disabled={props.disabled ? 'true' : undefined}
      onClick={() => !props.disabled && props.onClick()}
    >
      {props.icon && <Icon name={props.icon} size={30} />}
      <span>{props.label}</span>
    </button>
  )
}

/** Round icon button of the player; its label shows in the line above the row while focused. */
export function IconButton(props: {
  icon: string
  label: string
  onClick: Click
  active?: boolean
  focusKey?: string
  autofocus?: boolean
  onFocusLabel?: (label: string) => void
  testid?: string
  big?: boolean
}) {
  return (
    <button
      type="button"
      class={`icon-btn${props.active ? ' active' : ''}${props.big ? ' big' : ''}`}
      data-f
      tabIndex={-1}
      data-key={props.focusKey ?? `ib-${props.icon}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid={props.testid}
      aria-label={props.label}
      onFocus={() => props.onFocusLabel?.(props.label)}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={props.big ? 48 : 36} />
    </button>
  )
}

export function OptionRow(props: {
  title: string
  subtitle?: string | null
  value?: string | null
  icon?: string | null
  selected?: boolean
  onClick?: Click
  focusKey?: string
  autofocus?: boolean
  indent?: boolean
  testid?: string
  danger?: boolean
}) {
  return (
    <div
      class={`option${props.selected ? ' selected' : ''}${props.indent ? ' indent' : ''}${props.danger ? ' danger' : ''}`}
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey ?? `opt-${props.title}`}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid={props.testid}
      onClick={() => props.onClick?.()}
    >
      {props.icon && <Icon name={props.icon} size={34} class="option-icon" />}
      <div class="option-text">
        <div class="option-title">{props.title}</div>
        {props.subtitle && <div class="option-subtitle">{props.subtitle}</div>}
      </div>
      {props.value && <div class="option-value">{props.value}</div>}
      {props.selected && <Icon name="check" size={34} class="option-check" />}
    </div>
  )
}

export function SectionTitle({ children }: { children: ComponentChildren }) {
  return <div class="section-title">{children}</div>
}

// MARK: Chips

export function Chips<T extends string>(props: { items: { id: T; title: string }[]; selected: T; onSelect: (id: T) => void; keyPrefix: string; testid?: string }) {
  return (
    <div class="chips" data-scroll="x" data-group data-testid={props.testid}>
      <div class="chips-inner">
        {props.items.map((item) => (
          <button
            type="button"
            key={item.id}
            class={`chip${item.id === props.selected ? ' selected' : ''}`}
            data-f
            tabIndex={-1}
            data-key={`${props.keyPrefix}-${item.id}`}
            data-default={item.id === props.selected ? '' : undefined}
            onClick={() => props.onSelect(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
    </div>
  )
}

// MARK: Shelves and grids

export function Shelf(props: { title?: string | null; children: ComponentChildren; testid?: string; subtitle?: string | null; tall?: boolean }) {
  const track = useRef<HTMLDivElement>(null)
  const scroll = (dir: number) => {
    const el = track.current
    if (el) el.scrollLeft += dir * el.clientWidth * 0.8
  }
  return (
    <section class={`shelf${props.tall ? ' tall' : ''}`} data-row data-testid={props.testid}>
      {props.title && (
        <h2 class="shelf-title">
          {props.title}
          {props.subtitle && <span class="shelf-subtitle">{props.subtitle}</span>}
        </h2>
      )}
      <div class="shelf-track" data-scroll="x" data-group ref={track}>
        <div class="shelf-inner">{props.children}</div>
      </div>
      <button type="button" class="shelf-arrow left" tabIndex={-1} onClick={() => scroll(-1)} aria-label="Trước">
        <Icon name="chevronLeft" size={40} />
      </button>
      <button type="button" class="shelf-arrow right" tabIndex={-1} onClick={() => scroll(1)} aria-label="Sau">
        <Icon name="chevronRight" size={40} />
      </button>
    </section>
  )
}

export function Grid({ children, testid, columns = 4 }: { children: ComponentChildren; testid?: string; columns?: number }) {
  return (
    <div class={`grid cols-${columns}`} data-testid={testid}>
      {children}
    </div>
  )
}

/** Calls `onVisible` when the element scrolls near the viewport (paging of feeds). */
export function LoadMore({ onVisible, active }: { onVisible: () => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const callback = useRef(onVisible)
  callback.current = onVisible
  useEffect(() => {
    const el = ref.current
    if (!el || !active || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current()
      },
      { rootMargin: '900px 900px 900px 900px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [active])
  return <div class="load-more" ref={ref} />
}

// MARK: Images

let observer: IntersectionObserver | null = null
const pending = new WeakMap<Element, () => void>()

function lazyObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          pending.get(entry.target)?.()
          pending.delete(entry.target)
          observer?.unobserve(entry.target)
        }
      },
      { rootMargin: '400px 700px 400px 700px' },
    )
  }
  return observer
}

/** An image that only loads near the viewport (Chromium 68 has no loading="lazy"). */
export function LazyImg(props: { src: string | null | undefined; alt?: string; class?: string; eager?: boolean; fallback?: string | null }) {
  const ref = useRef<HTMLImageElement>(null)
  const [src, setSrc] = useState<string | null>(props.eager ? props.src ?? null : null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    if (props.eager || !props.src) {
      setSrc(props.src ?? null)
      return
    }
    const el = ref.current
    const io = lazyObserver()
    if (!el || !io) {
      setSrc(props.src)
      return
    }
    pending.set(el, () => setSrc(props.src ?? null))
    io.observe(el)
    return () => {
      pending.delete(el)
      io.unobserve(el)
    }
  }, [props.src, props.eager])
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [props.src])
  const shown = failed ? props.fallback ?? null : src
  return (
    <img
      ref={ref}
      class={`${props.class ?? ''}${shown && !broken ? ' loaded' : ''}${broken ? ' broken' : ''}`}
      src={shown ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACw='}
      alt={props.alt ?? ''}
      onError={() => {
        if (!failed && props.fallback && props.fallback !== shown) setFailed(true)
        else setBroken(true)
      }}
    />
  )
}

export function Avatar({ src, name, size = 48 }: { src?: string | null; name?: string | null; size?: number }) {
  const letter = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
  const style: JSX.CSSProperties = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.45)}px` }
  if (src) return <LazyImg src={src} class="avatar" eager />
  return (
    <div class="avatar letter" style={style}>
      {letter}
    </div>
  )
}

// MARK: States

export function Loading({ label }: { label?: string }) {
  return (
    <div class="loading" data-testid="loading">
      <div class="spinner" />
      {label && <div class="loading-label">{label}</div>}
    </div>
  )
}

export function Message(props: { title: string; detail?: string | null; children?: ComponentChildren; icon?: string; testid?: string }) {
  return (
    <div class="message" data-testid={props.testid}>
      {props.icon && <Icon name={props.icon} size={72} class="message-icon" />}
      <div class="message-title">{props.title}</div>
      {props.detail && <div class="message-detail">{props.detail}</div>}
      {props.children && <div class="message-actions">{props.children}</div>}
    </div>
  )
}

export function ScreenTitle({ title, subtitle, children }: { title: string; subtitle?: string | null; children?: ComponentChildren }) {
  return (
    <div class="screen-title">
      <h1>{title}</h1>
      {subtitle && <div class="screen-subtitle">{subtitle}</div>}
      {children}
    </div>
  )
}

/** Long press OK (or the red key) on a focusable element. */
export function useLongPress(handler: (() => void) | undefined): (el: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null)
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => () => cleanup.current?.(), [])
  return (el: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = el && handlerRef.current ? onLongPress(el, () => handlerRef.current?.()) : null
  }
}
