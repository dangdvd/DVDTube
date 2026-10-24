// Thông báo (/notifications): the account's notifications (signed in).

import { useNavigate } from 'react-router-dom'
import type { AccountNotification } from '@shared/models'
import { NotificationList } from '@/components/shell/Notifications'
import { CenterSpinner, EmptyState, ErrorState } from '@/components/States'
import { api } from '@/lib/api'
import { useLoad } from '@/lib/feed'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { useAccount } from '@/state/account'

export function NotificationsPage() {
  const navigate = useNavigate()
  const signedIn = useAccount((s) => s.signedIn)
  const identity = useAccount((s) => s.identities.find((i) => i.isSelected)?.id ?? '')
  const list = useLoad<AccountNotification[]>(signedIn ? 'notifications:' + identity : null, () => api.accountNotifications())
  usePageTitle('Thông báo')

  return (
    <div className="page page-pad page--narrow" data-testid="notifications-page">
      <div className="page-header">
        <h1 className="page-title">Thông báo</h1>
      </div>
      {!signedIn ? (
        <EmptyState
          icon="bell"
          title="Đăng nhập để xem thông báo"
          message="Thông báo về video mới, bình luận và hoạt động trên kênh của tài khoản Google."
          action={
            <button className="btn btn-primary" onClick={() => navigate(paths.account)}>
              Đăng nhập
            </button>
          }
        />
      ) : list.loading ? (
        <CenterSpinner />
      ) : list.error ? (
        <ErrorState title="Không tải được thông báo." message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon="bell" title="Không có thông báo" />
      ) : (
        <div className="card notif-page-list">
          <NotificationList items={list.data} />
        </div>
      )}
    </div>
  )
}
