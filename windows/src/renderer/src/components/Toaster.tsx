// Bottom-left snackbars (YouTube style). Each toast hides itself after its duration; hovering
// keeps it open.

import { useEffect, useRef, useState } from 'react'
import { useToasts, type ToastItem } from '@/lib/toast'
import { Icon } from './Icon'

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss)
  const [leaving, setLeaving] = useState(false)
  const hovered = useRef(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (ms: number) => {
      timer = setTimeout(() => {
        if (hovered.current) return schedule(1000)
        setLeaving(true)
        timer = setTimeout(() => dismiss(item.id), 180)
      }, ms)
    }
    schedule(item.durationMs)
    return () => clearTimeout(timer)
  }, [item.id, item.durationMs, dismiss])

  return (
    <div
      className={'toast' + (leaving ? ' toast--leaving' : '')}
      role="status"
      onMouseEnter={() => (hovered.current = true)}
      onMouseLeave={() => (hovered.current = false)}
    >
      <span className="toast-message">{item.message}</span>
      {item.action && (
        <button
          className="toast-action"
          onClick={() => {
            item.action!.run()
            dismiss(item.id)
          }}
        >
          {item.action.label}
        </button>
      )}
      <button className="toast-close" aria-label="Đóng" onClick={() => dismiss(item.id)}>
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} />
      ))}
    </div>
  )
}
