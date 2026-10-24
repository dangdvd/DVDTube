// 🔔 with the unseen count, and the notifications list (popover + /notifications page).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AccountNotification } from '@shared/models'
import { api, errorMessage } from '@/lib/api'
import { paths, watchPath } from '@/lib/nav'
import { useAccount } from '@/state/account'
import { Avatar } from '../Avatar'
import { Icon } from '../Icon'
import { Popover } from '../Menu'
import { EmptyState, ErrorState, Spinner } from '../States'

export function NotificationList({ items, onOpen }: { items: AccountNotification[]; onOpen?: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="notif-list" data-testid="notification-list">
      {items.map((n) => (
        <button
          key={n.id}
          className={'notif' + (n.isRead ? '' : ' is-unread')}
          onClick={() => {
            onOpen?.()
            if (n.videoId) navigate(watchPath(n.videoId))
          }}
        >
          <span className="notif-dot" aria-hidden />
          <Avatar src={n.avatar} name={n.message} size={48} />
          <span className="notif-text">
            <span className="notif-message">{n.message}</span>
            {n.timeText && <span className="notif-time">{n.timeText}</span>}
          </span>
          {n.thumbnail && <img className="notif-thumb" src={n.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        </button>
      ))}
    </div>
  )
}

export function NotificationsButton() {
  const navigate = useNavigate()
  const signedIn = useAccount((s) => s.signedIn)
  const identity = useAccount((s) => s.identities.find((i) => i.isSelected)?.id ?? '')
  const [count, setCount] = useState(0)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [items, setItems] = useState<AccountNotification[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const refresh = () =>
      api
        .unseenNotificationCount()
        .then((n) => alive && setCount(n))
        .catch(() => {})
    refresh()
    const timer = setInterval(refresh, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [signedIn, identity])

  const openPanel = (el: HTMLElement) => {
    setAnchor(el)
    setItems(null)
    setError(null)
    api
      .accountNotifications()
      .then((list) => {
        setItems(list)
        setCount(0)
      })
      .catch((e) => setError(errorMessage(e)))
  }

  return (
    <>
      <button
        className={'icon-btn notif-btn' + (anchor ? ' is-open' : '')}
        aria-label="Thông báo"
        title="Thông báo"
        data-testid="notifications-button"
        onClick={(e) => (anchor ? setAnchor(null) : openPanel(e.currentTarget))}
      >
        <Icon name={anchor ? 'bellFilled' : 'bell'} />
        {count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} className="notif-popover" testId="notifications-popover">
          <div className="notif-header">
            <span>Thông báo</span>
            <button
              className="icon-btn"
              aria-label="Xem tất cả"
              title="Xem tất cả"
              onClick={() => {
                setAnchor(null)
                navigate(paths.notifications)
              }}
            >
              <Icon name="external" size={20} />
            </button>
          </div>
          <div className="notif-scroll">
            {!items && !error && (
              <div className="center-spinner">
                <Spinner />
              </div>
            )}
            {error && <ErrorState title="Không tải được thông báo." message={error} compact />}
            {items && items.length === 0 && <EmptyState icon="bell" title="Không có thông báo" compact />}
            {items && items.length > 0 && <NotificationList items={items} onOpen={() => setAnchor(null)} />}
          </div>
        </Popover>
      )}
    </>
  )
}
