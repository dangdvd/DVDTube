// Left navigation: full (240 px), mini rail (72 px) and the overlay drawer used on narrow
// windows and on the watch page.

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { HomeCategory } from '@shared/models'
import { HOME_CATEGORIES } from '@shared/models'
import { paths } from '@/lib/nav'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { Avatar } from '../Avatar'
import { Icon, type IconName } from '../Icon'
import { Logo } from './TopBar'

const EXPLORE_ICONS: Record<Exclude<HomeCategory, 'all'>, IconName> = {
  music: 'music',
  gaming: 'gaming',
  live: 'live',
  news: 'news',
  sports: 'sports',
  learning: 'learning',
  podcasts: 'podcast',
  movies: 'movies',
}
const EXPLORE_ORDER: Exclude<HomeCategory, 'all'>[] = ['music', 'gaming', 'live', 'news', 'sports', 'learning', 'podcasts', 'movies']

export const homeCategoryPath = (c: HomeCategory) => (c === 'all' ? paths.home : `${paths.home}?c=${c}`)

function useActive(): (to: string) => boolean {
  const location = useLocation()
  const current = location.pathname + location.search
  return (to: string) => {
    if (to === paths.home) return location.pathname === '/' && !new URLSearchParams(location.search).get('c')
    if (to.includes('?')) return current === to
    if (to === paths.shorts()) return location.pathname.startsWith('/shorts')
    return location.pathname === to || (to !== '/' && location.pathname.startsWith(to + '/'))
  }
}

function Item({
  to,
  icon,
  activeIcon,
  label,
  active,
  onNavigate,
  testId,
}: {
  to: string
  icon: IconName
  activeIcon?: IconName
  label: string
  active: boolean
  onNavigate?: () => void
  testId?: string
}) {
  return (
    <Link to={to} className={'side-item' + (active ? ' is-active' : '')} onClick={onNavigate} title={label} data-testid={testId}>
      <Icon name={active && activeIcon ? activeIcon : icon} />
      <span className="side-label">{label}</span>
    </Link>
  )
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const active = useActive()
  const location = useLocation()
  const subscriptions = useLibrary((s) => s.subscriptions)
  const signedIn = useAccount((s) => s.signedIn)
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? subscriptions : subscriptions.slice(0, 7)

  return (
    <div className="side-content">
      <div className="side-section">
        <Item
          to={paths.home}
          icon="home"
          activeIcon="homeFilled"
          label="Trang chủ"
          active={active(paths.home)}
          onNavigate={onNavigate}
          testId="nav-home"
        />
        <Item to={paths.shorts()} icon="shorts" label="Shorts" active={active(paths.shorts())} onNavigate={onNavigate} testId="nav-shorts" />
        <Item
          to={paths.subscriptions}
          icon="subscriptions"
          activeIcon="subscriptionsFilled"
          label="Kênh đăng ký"
          active={active(paths.subscriptions) && !location.search}
          onNavigate={onNavigate}
          testId="nav-subscriptions"
        />
      </div>
      <div className="side-section">
        <Link
          to={paths.library}
          className={'side-heading side-heading--link' + (active(paths.library) && !location.search ? ' is-active' : '')}
          onClick={onNavigate}
        >
          Bạn
          <Icon name="chevronRight" size={18} />
        </Link>
        <Item to={paths.history} icon="history" label="Nhật ký xem" active={active(paths.history)} onNavigate={onNavigate} />
        <Item
          to={paths.library + '?tab=playlists'}
          icon="playlist"
          label="Danh sách phát"
          active={active(paths.library + '?tab=playlists')}
          onNavigate={onNavigate}
        />
        <Item to={paths.watchLater} icon="watchLater" label="Xem sau" active={active(paths.watchLater)} onNavigate={onNavigate} />
        <Item to={paths.liked} icon="like" label="Video đã thích" active={active(paths.liked)} onNavigate={onNavigate} />
        <Item to={paths.downloads} icon="download" label="Nội dung tải xuống" active={active(paths.downloads)} onNavigate={onNavigate} />
      </div>
      <div className="side-section">
        <div className="side-heading">Kênh đăng ký</div>
        {subscriptions.length === 0 && (
          <div className="side-note">
            {signedIn
              ? 'Nhập kênh đăng ký từ tài khoản trong trang Kênh đăng ký › Quản lý.'
              : 'Nhấn Đăng ký trên trang kênh để theo dõi kênh ngay trên máy này.'}
          </div>
        )}
        {shown.map((c) => (
          <Link
            key={c.id}
            to={paths.channel(c.id)}
            className={'side-item side-channel' + (active(paths.channel(c.id)) ? ' is-active' : '')}
            onClick={onNavigate}
            title={c.name}
          >
            <Avatar src={c.avatar} name={c.name} size={24} />
            <span className="side-label">{c.name}</span>
          </Link>
        ))}
        {subscriptions.length > 7 && (
          <button className="side-item" onClick={() => setExpanded(!expanded)}>
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
            <span className="side-label">{expanded ? 'Ẩn bớt' : `Hiện thêm ${subscriptions.length - 7} kênh`}</span>
          </button>
        )}
        {subscriptions.length > 0 && (
          <Item
            to={paths.subscriptions + '?view=manage'}
            icon="filter"
            label="Quản lý kênh đăng ký"
            active={active(paths.subscriptions + '?view=manage')}
            onNavigate={onNavigate}
          />
        )}
      </div>
      <div className="side-section">
        <div className="side-heading">Khám phá</div>
        {EXPLORE_ORDER.map((id) => {
          const to = homeCategoryPath(id)
          return (
            <Item
              key={id}
              to={to}
              icon={EXPLORE_ICONS[id]}
              label={HOME_CATEGORIES.find((c) => c.id === id)!.title}
              active={active(to)}
              onNavigate={onNavigate}
            />
          )
        })}
      </div>
      <div className="side-section">
        <Item to={paths.settings} icon="settings" label="Cài đặt" active={active(paths.settings)} onNavigate={onNavigate} testId="nav-settings" />
        <Item to={paths.account} icon="account" label={signedIn ? 'Tài khoản' : 'Đăng nhập'} active={active(paths.account)} onNavigate={onNavigate} />
      </div>
      <div className="side-footer">
        <div>DVDTube cho Windows</div>
        <div>Xem YouTube không quảng cáo. Ứng dụng không liên kết với Google.</div>
      </div>
    </div>
  )
}

export function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Điều hướng" data-testid="sidebar">
      <SidebarContent />
    </nav>
  )
}

export function MiniRail() {
  const active = useActive()
  const items: { to: string; icon: IconName; activeIcon?: IconName; label: string }[] = [
    { to: paths.home, icon: 'home', activeIcon: 'homeFilled', label: 'Trang chủ' },
    { to: paths.shorts(), icon: 'shorts', label: 'Shorts' },
    { to: paths.subscriptions, icon: 'subscriptions', activeIcon: 'subscriptionsFilled', label: 'Kênh đăng ký' },
    { to: paths.library, icon: 'you', label: 'Bạn' },
    { to: paths.downloads, icon: 'download', label: 'Tải xuống' },
  ]
  return (
    <nav className="minirail" aria-label="Điều hướng" data-testid="minirail">
      {items.map((item) => {
        const on = active(item.to)
        return (
          <Link key={item.to} to={item.to} className={'rail-item' + (on ? ' is-active' : '')} title={item.label}>
            <Icon name={on && item.activeIcon ? item.activeIcon : item.icon} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={'drawer-root' + (open ? ' is-open' : '')} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" data-testid="drawer">
        <div className="drawer-header">
          <button className="icon-btn" aria-label="Đóng menu" onClick={onClose}>
            <Icon name="menu" />
          </button>
          <Logo onClick={onClose} />
        </div>
        {open && <SidebarContent onNavigate={onClose} />}
      </aside>
    </div>
  )
}
