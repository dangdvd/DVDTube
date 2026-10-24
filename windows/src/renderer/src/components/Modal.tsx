// Modal dialog rendered in a portal: dimmed backdrop, Esc / backdrop click closes, focus moves
// into the dialog and back to the previously focused element afterwards.

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface ModalProps {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Buttons at the bottom-right. */
  actions?: ReactNode
  width?: number
  className?: string
  /** Hides the ✕ in the header. */
  hideClose?: boolean
  testId?: string
}

export function Modal({ title, onClose, children, actions, width = 440, className, hideClose, testId }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const first = node?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not(.modal-close)')
    ;(first ?? node)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={'modal' + (className ? ' ' + className : '')}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-testid={testId}
      >
        {(title || !hideClose) && (
          <div className="modal-header">
            <div className="modal-title">{title}</div>
            {!hideClose && (
              <button className="icon-btn modal-close" aria-label="Đóng" onClick={onClose}>
                <Icon name="close" />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
