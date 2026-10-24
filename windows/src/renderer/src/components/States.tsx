// Spinner, empty and error states shared by every page.

import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Spinner({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={'spinner' + (className ? ' ' + className : '')} style={{ width: size, height: size }} role="progressbar" aria-label="Đang tải">
      <svg viewBox="0 0 50 50" width={size} height={size}>
        <circle cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
      </svg>
    </span>
  )
}

export function CenterSpinner() {
  return (
    <div className="center-spinner">
      <Spinner />
    </div>
  )
}

export function EmptyState({
  icon = 'info',
  title,
  message,
  action,
  compact,
  testId,
}: {
  icon?: IconName
  title: string
  message?: ReactNode
  action?: ReactNode
  compact?: boolean
  testId?: string
}) {
  return (
    <div className={'empty-state' + (compact ? ' empty-state--compact' : '')} data-testid={testId}>
      <div className="empty-state-icon">
        <Icon name={icon} size={compact ? 40 : 64} weight={1.2} />
      </div>
      <div className="empty-state-title">{title}</div>
      {message && <div className="empty-state-message">{message}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

/** Error with "Thử lại". */
export function ErrorState({
  title = 'Không tải được nội dung.',
  message,
  onRetry,
  compact,
}: {
  title?: string
  message?: string | null
  onRetry?: () => void
  compact?: boolean
}) {
  const offline = !!message && /mạng|kết nối|network|offline/i.test(message)
  return (
    <EmptyState
      icon={offline ? 'offline' : 'alert'}
      title={title}
      message={message ?? undefined}
      compact={compact}
      testId="error-state"
      action={
        onRetry && (
          <button className="btn btn-outline" onClick={onRetry}>
            <Icon name="refresh" size={18} />
            Thử lại
          </button>
        )
      }
    />
  )
}
