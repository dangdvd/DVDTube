// Spatial navigation for the remote's arrow keys (and focus-on-hover for the Magic Remote).
//
// Markup contract:
//   data-f                 focusable element (gets tabindex=-1; Enter = click)
//   data-key="…"           stable key, used to restore focus when a screen comes back
//   data-autofocus         preferred first element of a screen / dialog
//   data-scope             a modal layer (dialogs): navigation stays inside the topmost one
//   data-group             remembers its last focused child and returns to it when entered again
//   data-enter="default"   …or always enters at its [data-default] child (the rail: the section)
//   data-scroll="x|y"      scroll container kept in view programmatically
//   data-row               a shelf: vertical scrolling keeps the whole row visible

export type Direction = 'left' | 'right' | 'up' | 'down'

const remembered = new WeakMap<Element, HTMLElement>()

function visible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (el.getClientRects().length === 0) return false
  if (el.closest('[aria-hidden="true"], [data-inert]')) return false
  return !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true'
}

/** The topmost modal layer, or the whole document. */
export function currentScope(): HTMLElement {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-scope]')).filter((s) => s.getClientRects().length > 0)
  return scopes[scopes.length - 1] ?? document.body
}

export function focusables(root: ParentNode = currentScope()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-f]')).filter(visible)
}

export function isFocusable(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.hasAttribute('data-f') && visible(el)
}

export function activeFocusable(): HTMLElement | null {
  const el = document.activeElement
  if (isFocusable(el) && currentScope().contains(el)) return el
  return null
}

// MARK: Scrolling

const PAD_X = 96
const PAD_TOP = 150
const PAD_BOTTOM = 70

export function ensureVisible(el: HTMLElement): void {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body) {
    const axis = node.getAttribute('data-scroll')
    if (axis === 'x') {
      const c = node.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (r.left < c.left + PAD_X) node.scrollLeft -= c.left + PAD_X - r.left
      else if (r.right > c.right - PAD_X) node.scrollLeft += r.right - (c.right - PAD_X)
    } else if (axis === 'y') {
      const c = node.getBoundingClientRect()
      const row = (el.closest('[data-row]') as HTMLElement | null) ?? el
      const target = node.contains(row) ? row : el
      const r = target.getBoundingClientRect()
      const padTop = node.hasAttribute('data-scroll-tight') ? 24 : PAD_TOP
      if (r.top < c.top + padTop) node.scrollTop -= c.top + padTop - r.top
      else if (r.bottom > c.bottom - PAD_BOTTOM) {
        // Tall rows: keep their top in view.
        const delta = Math.min(r.bottom - (c.bottom - PAD_BOTTOM), r.top - (c.top + padTop))
        if (delta > 0) node.scrollTop += delta
      }
    }
    node = node.parentElement
  }
}

// MARK: Focusing

export function focusElement(el: HTMLElement, options: { scroll?: boolean } = {}): void {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  try {
    el.focus({ preventScroll: true })
  } catch {
    el.focus()
  }
  if (options.scroll !== false) ensureVisible(el)
}

/** Records the last focused child of every group around `el`. */
function remember(el: HTMLElement): void {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    if (node.hasAttribute('data-group')) remembered.set(node, el)
    node = node.parentElement
  }
}

export function initFocusTracking(onFocus: (el: HTMLElement) => void): void {
  document.addEventListener(
    'focusin',
    (event) => {
      const el = event.target as HTMLElement
      if (el && el.hasAttribute && el.hasAttribute('data-f')) {
        remember(el)
        onFocus(el)
      }
    },
    true,
  )
}

/** The first element of a container: [data-autofocus], else the first in reading order. */
export function firstFocusable(root: ParentNode = currentScope()): HTMLElement | null {
  const list = focusables(root)
  return list.find((el) => el.hasAttribute('data-autofocus')) ?? list[0] ?? null
}

export function focusFirst(root: ParentNode = currentScope()): boolean {
  const el = firstFocusable(root)
  if (!el) return false
  focusElement(el)
  return true
}

export function focusByKey(key: string, root: ParentNode = currentScope()): boolean {
  const el = focusables(root).find((e) => e.getAttribute('data-key') === key)
  if (!el) return false
  focusElement(el)
  return true
}

// MARK: Moving

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

function score(dir: Direction, from: Rect, to: Rect): number | null {
  const fcx = (from.left + from.right) / 2
  const fcy = (from.top + from.bottom) / 2
  const tcx = (to.left + to.right) / 2
  const tcy = (to.top + to.bottom) / 2
  let primary: number
  let overlap: number
  let crossCenter: number
  switch (dir) {
    case 'right':
      if (tcx <= fcx + 1 || to.right <= from.right - 1) return null
      primary = Math.max(0, to.left - from.right)
      overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top)
      crossCenter = Math.abs(tcy - fcy)
      break
    case 'left':
      if (tcx >= fcx - 1 || to.left >= from.left + 1) return null
      primary = Math.max(0, from.left - to.right)
      overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top)
      crossCenter = Math.abs(tcy - fcy)
      break
    case 'down':
      if (tcy <= fcy + 1 || to.bottom <= from.bottom - 1) return null
      primary = Math.max(0, to.top - from.bottom)
      overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left)
      crossCenter = Math.abs(tcx - fcx)
      break
    case 'up':
      if (tcy >= fcy - 1 || to.top >= from.top + 1) return null
      primary = Math.max(0, from.top - to.bottom)
      overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left)
      crossCenter = Math.abs(tcx - fcx)
      break
  }
  const gap = overlap > 0 ? 0 : -overlap
  // Elements beside the current one (overlapping on the other axis) win clearly.
  return primary + gap * 2.5 + crossCenter * 0.12 + (overlap > 0 ? 0 : 400)
}

/** The group an arrow press enters (outermost group around `target` that does not hold `from`). */
function enteredGroup(target: HTMLElement, from: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = target.parentElement
  let found: HTMLElement | null = null
  while (node && node !== document.body) {
    if (node.hasAttribute('data-group')) {
      if (from && node.contains(from)) break
      found = node
    }
    node = node.parentElement
  }
  return found
}

function groupEntry(group: HTMLElement, fallback: HTMLElement): HTMLElement {
  if (group.getAttribute('data-enter') === 'default') {
    const def = group.querySelector<HTMLElement>('[data-default]')
    if (def && visible(def)) return def
  }
  const last = remembered.get(group)
  if (last && group.contains(last) && visible(last)) return last
  return fallback
}

/** Moves the focus one step; false when nothing lies in that direction. */
export function move(dir: Direction): boolean {
  const scope = currentScope()
  const current = activeFocusable()
  if (!current) return focusFirst(scope)
  const from = current.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of focusables(scope)) {
    if (el === current) continue
    const s = score(dir, from, el.getBoundingClientRect())
    if (s !== null && s < bestScore) {
      bestScore = s
      best = el
    }
  }
  if (!best) return false
  const group = enteredGroup(best, current)
  focusElement(group ? groupEntry(group, best) : best)
  return true
}

/** Hover with the Magic Remote moves the focus too (no scrolling, the pointer is there). */
export function initPointerFocus(isPointerActive: () => boolean): void {
  document.addEventListener(
    'mouseover',
    (event) => {
      if (!isPointerActive()) return
      const target = (event.target as HTMLElement | null)?.closest?.('[data-f]') as HTMLElement | null
      if (!target || target === document.activeElement || !visible(target)) return
      if (!currentScope().contains(target)) return
      focusElement(target, { scroll: false })
    },
    true,
  )
}
