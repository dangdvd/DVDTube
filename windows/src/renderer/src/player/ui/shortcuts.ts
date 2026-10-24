// Keyboard shortcuts of the main player (YouTube's), active on the watch page, in the mini
// player and in fullscreen, unless focus is in a text field or a dialog is open.

import { useEffect } from 'react'
import { usePlayer, type PlayerMode } from '@/state/player'
import { settings, useSettings } from '@/state/settings'
import { volumeIcon } from './Controls'
import { showFeedback } from './feedback'
import { togglePlayWithFeedback } from './PlayerOverlay'

/** The pointer is over the mini player: arrow keys go to the player instead of the page. */
let miniHovered = false
export function setMiniHovered(value: boolean): void {
  miniHovered = value
}

export const SHORTCUTS: [string, string][] = [
  ['Space / K', 'Phát / tạm dừng (giữ Space: tốc độ 2x)'],
  ['J / L', 'Tua lại / tới 10 giây'],
  ['← / →', 'Tua lại / tới theo bước tua'],
  ['↑ / ↓', 'Tăng / giảm âm lượng 5%'],
  ['M', 'Tắt / bật tiếng'],
  ['F', 'Toàn màn hình'],
  ['T', 'Chế độ rạp chiếu phim'],
  ['I', 'Trình phát thu nhỏ'],
  ['C', 'Bật / tắt phụ đề'],
  ['Shift + < / >', 'Giảm / tăng tốc độ phát'],
  [', / .', 'Lùi / tới một khung hình (khi tạm dừng)'],
  ['0 – 9', 'Tua tới 0% – 90% video'],
  ['Home / End', 'Về đầu / cuối video'],
  ['Shift + N / P', 'Video tiếp theo / trước'],
  ['Esc', 'Thoát toàn màn hình'],
]

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(type)
  }
  return false
}

function dialogOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"], dialog[open]')
}

export function usePlayerShortcuts(mode: PlayerMode, disabled: boolean, actions: { miniPlayer: () => void; expand: () => void }): void {
  useEffect(() => {
    if (mode === 'hidden' || disabled) return
    let spaceTimer: ReturnType<typeof setTimeout> | null = null
    let spaceHeld = false
    let spaceDown = false

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || dialogOpen()) return
      const p = usePlayer.getState()
      if (!p.current) return
      const page = p.mode === 'page' || p.fullscreen
      const focused = page || miniHovered
      const onRange = (event.target as HTMLInputElement | null)?.type === 'range'
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const handled = () => event.preventDefault()

      switch (key) {
        case ' ':
          handled()
          if (event.repeat || spaceDown) return
          spaceDown = true
          spaceHeld = false
          spaceTimer = setTimeout(() => {
            if (usePlayer.getState().playing) {
              spaceHeld = true
              usePlayer.getState().setBoost(true)
            }
          }, 500)
          return
        case 'k':
          handled()
          return togglePlayWithFeedback()
        case 'j':
        case 'l': {
          handled()
          const delta = key === 'j' ? -10 : 10
          p.seekBy(delta)
          return showFeedback({ place: delta < 0 ? 'left' : 'right', icon: delta < 0 ? 'rewind' : 'skip', text: '10 giây' })
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!focused || onRange) return
          handled()
          const step = settings().seekStep || 5
          const delta = key === 'ArrowLeft' ? -step : step
          p.seekBy(delta)
          return showFeedback({ place: delta < 0 ? 'left' : 'right', icon: delta < 0 ? 'rewind' : 'skip', text: `${step} giây` })
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!focused || onRange) return
          handled()
          const s = settings()
          const next = Math.min(1, Math.max(0, (s.muted ? 0 : s.volume) + (key === 'ArrowUp' ? 0.05 : -0.05)))
          p.setVolume(next)
          return showFeedback({ place: 'top', icon: volumeIcon(next, next === 0), text: `${Math.round(next * 100)}%` })
        }
        case 'm': {
          handled()
          p.toggleMute()
          const s = settings()
          return showFeedback({ place: 'center', icon: volumeIcon(s.volume, s.muted) })
        }
        case 'f':
          if (!page) return
          handled()
          return p.toggleFullscreen()
        case 't':
          if (p.mode !== 'page' || p.fullscreen) return
          handled()
          return useSettings.getState().update({ theaterMode: !settings().theaterMode })
        case 'i':
          handled()
          if (p.fullscreen) void document.exitFullscreen().catch(() => {})
          return p.mode === 'page' ? actions.miniPlayer() : actions.expand()
        case 'c': {
          handled()
          const had = !!p.captionTrack
          p.toggleCaptions()
          if (had) showFeedback({ place: 'top', text: 'Đã tắt phụ đề' })
          else if (p.captionTracks.length) showFeedback({ place: 'top', text: 'Đã bật phụ đề' })
          return
        }
        case '<':
        case '>': {
          handled()
          const rate = Math.min(4, Math.max(0.25, p.rate + (key === '<' ? -0.25 : 0.25)))
          p.setRate(rate)
          return showFeedback({ place: 'top', icon: 'speed', text: `${String(rate).replace('.', ',')}x` })
        }
        case ',':
        case '.':
          if (!p.playing || p.status === 'paused') {
            handled()
            p.frameStep(key === ',' ? -1 : 1)
          }
          return
        case 'Home':
        case 'End':
          if (!page) return
          handled()
          return p.seek(key === 'Home' ? 0 : p.duration)
        case 'n':
        case 'p':
          if (!event.shiftKey) return
          handled()
          return key === 'n' ? p.next() : p.previous()
        case 'Escape':
          if (document.fullscreenElement) {
            handled()
            void document.exitFullscreen().catch(() => {})
          }
          return
        default:
          if (/^[0-9]$/.test(key) && !event.shiftKey && p.duration > 0 && !p.live) {
            handled()
            p.seek((p.duration * Number(key)) / 10)
          }
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !spaceDown) return
      spaceDown = false
      if (spaceTimer) clearTimeout(spaceTimer)
      spaceTimer = null
      event.preventDefault()
      if (spaceHeld) usePlayer.getState().setBoost(false)
      else if (!isTyping(event.target) && !dialogOpen()) togglePlayWithFeedback()
      spaceHeld = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (spaceTimer) clearTimeout(spaceTimer)
      if (spaceHeld) usePlayer.getState().setBoost(false)
    }
  }, [mode, disabled, actions])
}
