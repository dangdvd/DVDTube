// App-wide keyboard / mouse shortcuts: Ctrl+K or "/" focus the search box, Alt+← / Alt+→ and the
// mouse back / forward buttons navigate, F5 reloads the page data, Ctrl+V of a YouTube link
// outside text fields opens it. Player shortcuts live in the player module.

import { useEffect } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { looksLikeLink, openLink } from './links'
import { useUi } from './ui'

/** True when keys typed now go into a text field. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(type)
}

export function useGlobalShortcuts(navigate: NavigateFunction): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const typing = isTyping(e.target)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUi.getState().focusSearch()
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        useUi.getState().focusSearch()
      } else if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        navigate(e.key === 'ArrowLeft' ? -1 : 1)
      } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault()
        useUi.getState().reload()
      } else if (e.key === 'BrowserBack') {
        navigate(-1)
      } else if (e.key === 'BrowserForward') {
        navigate(1)
      }
    }
    // Mouse buttons 3 / 4 are "back" / "forward" (side buttons).
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        navigate(e.button === 3 ? -1 : 1)
      }
    }
    const swallow = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!looksLikeLink(text)) return
      e.preventDefault()
      void openLink(text, navigate)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('mousedown', swallow)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('mousedown', swallow)
      document.removeEventListener('paste', onPaste)
    }
  }, [navigate])
}
