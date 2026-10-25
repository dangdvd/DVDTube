// Top bar: ☰, logo, search box, then ♡ "Ủng hộ tác giả", "Tạo", 🔔 and the avatar (signed in) or
// ⋮ + "Đăng nhập".

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { paths } from '@/lib/nav'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useSettings } from '@/state/settings'
import { Icon, LogoMark } from '../Icon'
import { SupportDialog } from '../SupportDialog'
import { AccountMenuButton, GuestMenuButton } from './AccountMenu'
import { NotificationsButton } from './Notifications'
import { SearchBox } from './SearchBox'

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link to={paths.home} className="logo" aria-label="DVDTube – Trang chủ" title="DVDTube – Trang chủ" onClick={onClick} data-testid="logo">
      <LogoMark size={30} />
      <span className="logo-text">DVDTube</span>
    </Link>
  )
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const navigate = useNavigate()
  const signedIn = useAccount((s) => s.signedIn)
  const loaded = useAccount((s) => s.loaded)
  const incognito = useSettings((s) => s.settings.incognito)
  const [support, setSupport] = useState(false)

  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-start">
        <button className="icon-btn" aria-label="Menu" title="Menu" onClick={onMenu} data-testid="menu-button">
          <Icon name="menu" />
        </button>
        <Logo />
      </div>
      <div className="topbar-center">
        <SearchBox />
      </div>
      <div className="topbar-end">
        {incognito && (
          <button className="incognito-chip" onClick={() => useSettings.getState().update({ incognito: false })} title="Nhấn để tắt chế độ ẩn danh">
            <Icon name="incognito" size={18} />
            Ẩn danh
          </button>
        )}
        <button className="icon-btn" aria-label="Ủng hộ tác giả" title="Ủng hộ tác giả" onClick={() => setSupport(true)} data-testid="support-button">
          <Icon name="heart" />
        </button>
        {signedIn ? (
          <>
            <button
              className="btn btn-tonal create-btn"
              onClick={() => void api.openStudio().catch((e) => toast(errorMessage(e)))}
              title="Tải video lên hoặc quản lý kênh trong YouTube Studio"
            >
              <Icon name="plus" size={22} />
              Tạo
            </button>
            <NotificationsButton />
            <AccountMenuButton />
          </>
        ) : (
          <>
            <GuestMenuButton />
            {loaded && (
              <button className="btn btn-signin" onClick={() => navigate(paths.account)} data-testid="signin-button">
                <Icon name="account" size={22} />
                Đăng nhập
              </button>
            )}
          </>
        )}
      </div>
      {support && <SupportDialog onClose={() => setSupport(false)} />}
    </header>
  )
}
