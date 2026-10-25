// Every screen (section or stacked route) stays mounted while it is in the stack, hidden when
// covered, so Back returns to it instantly with its scroll position. Screens use the context to
// know whether they are on top (only then do they take keys and the focus).

import { createContext, type ComponentChildren } from 'preact'
import { useContext, useEffect, useRef } from 'preact/hooks'
import { firstFocusable, focusByKey, focusElement } from './focus'
import { lastKeyTime, useKeys, type KeyHandler } from './keys'
import { recalledFocus } from './state/nav'

export interface ScreenInfo {
  key: string
  active: boolean
}

const ScreenContext = createContext<ScreenInfo>({ key: 'root', active: true })

export function Screen({ info, children, fullscreen }: { info: ScreenInfo; children: ComponentChildren; fullscreen?: boolean }) {
  return (
    <ScreenContext.Provider value={info}>
      <div class={`screen${fullscreen ? ' fullscreen' : ''}`} data-screen={info.key} style={info.active ? undefined : { display: 'none' }}>
        {children}
      </div>
    </ScreenContext.Provider>
  )
}

export function useScreen(): ScreenInfo {
  return useContext(ScreenContext)
}

/** Keys for this screen only while it is on top. */
export function useScreenKeys(handler: KeyHandler, priority = 0): void {
  const screen = useScreen()
  useKeys(handler, screen.active, priority)
}

function screenElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-screen="${key}"]`)
}

function focusIsIn(el: HTMLElement): boolean {
  const active = document.activeElement
  return !!active && el.contains(active) && active !== el
}

/**
 * Gives the screen the focus once its content is there (`ready`), and again when it comes back
 * on top: the remembered element, else [data-autofocus], else the first focusable.
 */
export function useInitialFocus(ready: boolean, options: { keepRail?: boolean } = {}): void {
  const screen = useScreen()
  const wasActive = useRef(false)
  const done = useRef(false)
  const activatedAt = useRef(0)
  useEffect(() => {
    if (!screen.active) {
      wasActive.current = false
      return
    }
    const returning = !wasActive.current && done.current
    if (!wasActive.current) activatedAt.current = Date.now()
    wasActive.current = true
    if (!ready) return
    if (done.current && !returning) return
    const timer = setTimeout(() => {
      const el = screenElement(screen.key)
      if (!el) return
      // The user went back to the rail meanwhile: leave the focus there.
      const active = document.activeElement as HTMLElement | null
      if (options.keepRail && active?.closest('[data-rail]') && !returning) {
        done.current = true
        return
      }
      // Already inside: keep it if the user moved there; an automatic placement (e.g. on the
      // filter chips while the results were loading) gives way to the content.
      if (focusIsIn(el) && !returning && lastKeyTime() > activatedAt.current) {
        done.current = true
        return
      }
      // The remembered element is for coming back (Back); the first time, the content decides.
      const remembered = returning ? recalledFocus(screen.key) : null
      if (!(remembered && focusByKey(remembered, el))) {
        const first = firstFocusable(el)
        if (first) focusElement(first)
      }
      done.current = true
    }, 60)
    return () => clearTimeout(timer)
  }, [screen.active, ready])
}
