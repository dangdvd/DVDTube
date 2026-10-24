// Floating mini player (bottom-right) shown while something plays outside the watch page.
// The same <video> keeps playing; it is just shown here. Drag the title row to move it.

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { usePlayer } from '@/state/player'
import { nextVideo } from '../controller'
import { PIcon } from './icons'
import { togglePlayWithFeedback } from './PlayerOverlay'
import { PlayerSlot } from './PlayerSlot'
import { setMiniHovered } from './shortcuts'

/** Offset from the default bottom-right corner, kept while the app runs. */
let offset = { x: 0, y: 0 }

export function MiniPlayer({ onExpand }: { onExpand: () => void }) {
  const current = usePlayer((s) => s.current)
  const playing = usePlayer((s) => s.playing)
  const status = usePlayer((s) => s.status)
  const queueIndex = usePlayer((s) => s.queueIndex)
  const queueLength = usePlayer((s) => s.queue.length)
  const progress = usePlayer((s) => (s.duration > 0 && !s.live ? Math.min(1, s.currentTime / s.duration) : 0))
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(offset)
  const drag = useRef<{ x: number; y: number; start: typeof offset } | null>(null)

  // Keep the card inside the window after a resize.
  useLayoutEffect(() => {
    const clamp = () => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const maxX = 0
      const minX = -(window.innerWidth - rect.width - 24)
      const maxY = 0
      const minY = -(window.innerHeight - rect.height - 24)
      const next = { x: Math.min(maxX, Math.max(minX, offset.x)), y: Math.min(maxY, Math.max(minY, offset.y)) }
      if (next.x !== offset.x || next.y !== offset.y) {
        offset = next
        setPosition(next)
      }
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [])

  if (!current) return null

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    drag.current = { x: event.clientX, y: event.clientY, start: offset }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(0, Math.max(-(window.innerWidth - rect.width - 24), d.start.x + event.clientX - d.x))
    const y = Math.min(0, Math.max(-(window.innerHeight - rect.height - 24), d.start.y + event.clientY - d.y))
    offset = { x, y }
    setPosition(offset)
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const hasNext = !!nextVideo() || queueIndex + 1 < queueLength

  return (
    <div
      ref={ref}
      className="dp-mini"
      data-testid="mini-player"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onMouseEnter={() => setMiniHovered(true)}
      onMouseLeave={() => setMiniHovered(false)}
    >
      <PlayerSlot className="dp-mini-video" />
      <div className="dp-mini-progress">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="dp-mini-info" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="dp-mini-text" onDoubleClick={onExpand} title="Kéo để di chuyển · nhấp đúp để mở rộng">
          <div className="dp-mini-title">{current.title || 'Đang tải…'}</div>
          <div className="dp-mini-channel">
            {queueLength > 1 ? `${queueIndex + 1}/${queueLength} • ` : ''}
            {current.channelName}
          </div>
        </div>
        <button type="button" className="dp-mini-icon" aria-label={playing ? 'Tạm dừng' : 'Phát'} onClick={togglePlayWithFeedback}>
          <PIcon name={status === 'ended' ? 'replay' : playing ? 'pause' : 'play'} size={24} />
        </button>
        <button type="button" className="dp-mini-icon" aria-label="Tiếp theo" disabled={!hasNext} onClick={() => usePlayer.getState().next()}>
          <PIcon name="next" size={24} />
        </button>
        <button type="button" className="dp-mini-icon" aria-label="Mở rộng" onClick={onExpand}>
          <PIcon name="expand" size={20} />
        </button>
        <button type="button" className="dp-mini-icon" aria-label="Đóng" data-testid="mini-player-close" onClick={() => usePlayer.getState().close()}>
          <PIcon name="close" size={22} />
        </button>
      </div>
    </div>
  )
}
