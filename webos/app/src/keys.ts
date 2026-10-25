// Key handling: screens and dialogs register handlers (the most recent one gets the key first);
// what nobody handles falls back to spatial navigation (arrows), click (OK / Enter, long press =
// options) and Back (registered by the app shell).

import { useEffect, useRef } from 'preact/hooks'
import { activeFocusable, move } from './focus'
import { KEY, isTyping } from './platform'

export type KeyHandler = (event: KeyboardEvent) => boolean | void

interface Entry {
  fn: KeyHandler
  priority: number
  order: number
}

let handlers: Entry[] = []
let counter = 0

/**
 * Higher `priority` first (dialogs 100, the PIN pad / text fields above them, screens 0, the
 * app's Back fallback below), then the most recently registered.
 */
export function pushKeyHandler(fn: KeyHandler, priority = 0): () => void {
  const entry: Entry = { fn, priority, order: ++counter }
  handlers.push(entry)
  handlers.sort((a, b) => b.priority - a.priority || b.order - a.order)
  return () => {
    handlers = handlers.filter((h) => h !== entry)
  }
}

/** Registers a key handler for the lifetime of the component (latest render's closure wins). */
export function useKeys(handler: KeyHandler, active = true, priority = 0): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    return pushKeyHandler((event) => ref.current(event), priority)
  }, [active, priority])
}

const LONG_PRESS_MS = 650
let enterDown: { target: HTMLElement | null; timer: ReturnType<typeof setTimeout>; consumed: boolean } | null = null

function dispatch(event: KeyboardEvent): boolean {
  for (const entry of handlers.slice()) {
    try {
      if (entry.fn(event) === true) return true
    } catch (error) {
      console.error(error)
    }
  }
  return false
}

let lastKeyAt = 0

/** When the user last pressed a key (remote or keyboard). */
export function lastKeyTime(): number {
  return lastKeyAt
}

function onKeyDown(event: KeyboardEvent): void {
  const code = event.keyCode
  lastKeyAt = Date.now()
  if (isTyping()) {
    // The text field handles typing itself; Back / Enter still reach the screen handlers.
    if (code !== KEY.BACK && code !== KEY.ESCAPE && code !== KEY.ENTER && code !== KEY.UP && code !== KEY.DOWN) return
  }
  if (code === KEY.ENTER && !isTyping()) {
    event.preventDefault()
    if (event.repeat || enterDown) return
    // Handlers see Enter first (e.g. the player shows its controls on OK).
    if (dispatch(event)) return
    const target = activeFocusable()
    enterDown = {
      target,
      consumed: false,
      timer: setTimeout(() => {
        if (!enterDown || !target) return
        const long = new CustomEvent('dvd-longpress', { bubbles: true, cancelable: true })
        target.dispatchEvent(long)
        if (long.defaultPrevented) enterDown.consumed = true
      }, LONG_PRESS_MS),
    }
    return
  }
  // The red key = long press (the options of the focused card), unless nothing takes it.
  if (code === KEY.RED) {
    const target = activeFocusable()
    if (target) {
      const long = new CustomEvent('dvd-longpress', { bubbles: true, cancelable: true })
      target.dispatchEvent(long)
      if (long.defaultPrevented) {
        event.preventDefault()
        return
      }
    }
  }
  if (dispatch(event)) {
    event.preventDefault()
    return
  }
  const dir = code === KEY.LEFT ? 'left' : code === KEY.RIGHT ? 'right' : code === KEY.UP ? 'up' : code === KEY.DOWN ? 'down' : null
  if (dir) {
    event.preventDefault()
    move(dir)
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.keyCode !== KEY.ENTER || !enterDown) return
  const pressed = enterDown
  enterDown = null
  clearTimeout(pressed.timer)
  if (pressed.consumed) return
  const target = pressed.target
  if (target && target.isConnected) target.click()
}

export function initKeys(): void {
  document.addEventListener('keydown', onKeyDown, false)
  document.addEventListener('keyup', onKeyUp, false)
  // Losing the window (e.g. the system's own overlay) must not leave a half-pressed OK.
  window.addEventListener('blur', () => {
    if (enterDown) clearTimeout(enterDown.timer)
    enterDown = null
  })
}

/** Long press (or the red key) on an element. */
export function onLongPress(el: HTMLElement | null, handler: () => void): () => void {
  if (!el) return () => {}
  const listener = (event: Event) => {
    event.preventDefault()
    handler()
  }
  el.addEventListener('dvd-longpress', listener)
  return () => el.removeEventListener('dvd-longpress', listener)
}
