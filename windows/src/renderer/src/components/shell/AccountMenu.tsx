// The avatar menu (signed in) and the ⋮ settings menu (signed out): account switcher, sign out,
// YouTube Studio, Giao diện, Chế độ ẩn danh, Cài đặt.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ThemeMode } from '@shared/settings'
import { api, errorMessage } from '@/lib/api'
import { confirmDialog } from '@/lib/dialogs'
import { paths } from '@/lib/nav'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useSettings } from '@/state/settings'
import { Avatar } from '../Avatar'
import { Icon } from '../Icon'
import { requireParentalPin } from '@/lib/parental'
import { Menu, type MenuEntry } from '../Menu'

export const THEME_TITLES: Record<ThemeMode, string> = { system: 'Theo hệ thống', dark: 'Tối', light: 'Sáng' }

export async function signIn(addAccount = false): Promise<void> {
  if (!(await requireParentalPin('Đăng nhập được bảo vệ bởi kiểm soát của phụ huynh.'))) return
  try {
    const state = await api.signIn(addAccount)
    useAccount.setState({ ...state, loaded: true })
    if (state.signedIn) toast(`Đã đăng nhập: ${state.profile?.name ?? 'tài khoản Google'}`)
  } catch (error) {
    toast('Không đăng nhập được: ' + errorMessage(error))
  }
}

export async function signOut(): Promise<void> {
  if (!(await requireParentalPin('Đăng xuất được bảo vệ bởi kiểm soát của phụ huynh.'))) return
  if (
    !(await confirmDialog({
      title: 'Đăng xuất khỏi tài khoản Google?',
      message: 'Video đã xem, danh sách phát và kênh đăng ký trên máy vẫn được giữ lại.',
      confirmLabel: 'Đăng xuất',
    }))
  )
    return
  try {
    const state = await api.signOut()
    useAccount.setState({ ...state, loaded: true })
    toast('Đã đăng xuất')
  } catch (error) {
    toast(errorMessage(error))
  }
}

export async function switchIdentity(id: string): Promise<void> {
  try {
    const state = await api.switchIdentity(id)
    useAccount.setState({ ...state, loaded: true })
    toast(`Đang dùng ${state.profile?.name ?? 'tài khoản'}`)
  } catch (error) {
    toast('Không chuyển được tài khoản: ' + errorMessage(error))
  }
}

/** Theme + incognito + settings entries shared by both menus. */
function appEntries(navigate: (to: string) => void): MenuEntry[] {
  const { settings, update } = useSettings.getState()
  return [
    {
      label: `Giao diện: ${THEME_TITLES[settings.theme]}`,
      icon: settings.theme === 'light' ? 'sun' : 'moon',
      submenu: {
        title: 'Giao diện',
        items: (['system', 'dark', 'light'] as ThemeMode[]).map((mode) => ({
          label: THEME_TITLES[mode],
          checked: settings.theme === mode,
          onSelect: () => update({ theme: mode }),
        })),
      },
    },
    {
      label: 'Chế độ ẩn danh',
      icon: 'incognito',
      toggle: settings.incognito,
      onSelect: () => {
        const on = !useSettings.getState().settings.incognito
        update({ incognito: on })
        toast(on ? 'Bạn đang ẩn danh: video đã xem và nội dung tìm kiếm không được lưu.' : 'Đã tắt chế độ ẩn danh')
      },
      testId: 'menu-incognito',
    },
    'divider',
    { label: 'Cài đặt', icon: 'settings', onSelect: () => navigate(paths.settings) },
    { label: 'Phím tắt', icon: 'keyboard', onSelect: () => navigate(paths.settings + '#phim-tat') },
  ]
}

export function AccountMenuButton() {
  const navigate = useNavigate()
  const profile = useAccount((s) => s.profile)
  const identities = useAccount((s) => s.identities)
  const incognito = useSettings((s) => s.settings.incognito)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const items = (): MenuEntry[] => [
    {
      label: 'Chuyển đổi tài khoản',
      icon: 'switchAccount',
      submenu: {
        title: 'Tài khoản',
        items: [
          ...identities.map((i) => ({
            label: i.name,
            detail: i.byline ?? i.email ?? undefined,
            checked: i.isSelected,
            onSelect: () => !i.isSelected && void switchIdentity(i.id),
          })),
          'divider' as const,
          { label: 'Thêm tài khoản', icon: 'plus', onSelect: () => void signIn(true) },
          { label: 'Đăng xuất', icon: 'logout', onSelect: () => void signOut() },
        ],
      },
    },
    { label: 'Đăng xuất', icon: 'logout', onSelect: () => void signOut() },
    'divider',
    { label: 'YouTube Studio', icon: 'studio', onSelect: () => void api.openStudio().catch((e) => toast(errorMessage(e))) },
    { label: 'Tài khoản', icon: 'account', onSelect: () => navigate(paths.account) },
    'divider',
    ...appEntries(navigate),
  ]

  return (
    <>
      <button
        className={'avatar-btn' + (incognito ? ' is-incognito' : '')}
        aria-label="Tài khoản"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        data-testid="avatar-button"
      >
        {incognito ? (
          <span className="avatar avatar--incognito" style={{ width: 32, height: 32 }}>
            <Icon name="incognito" size={22} />
          </span>
        ) : (
          <Avatar src={profile?.avatar} name={profile?.name} size={32} />
        )}
      </button>
      {anchor && (
        <Menu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          className="account-menu"
          testId="account-menu"
          header={
            <div className="account-menu-header">
              <Avatar src={profile?.avatar} name={profile?.name} size={40} />
              <div className="account-menu-text">
                <div className="account-menu-name">{profile?.name}</div>
                {profile?.handle && <div className="account-menu-handle">{profile.handle}</div>}
                {profile?.channelId ? (
                  <Link to={paths.channel(profile.channelId)} className="link" onClick={() => setAnchor(null)}>
                    Xem kênh của bạn
                  </Link>
                ) : (
                  profile?.email && <div className="account-menu-handle">{profile.email}</div>
                )}
              </div>
            </div>
          }
          items={items()}
        />
      )}
    </>
  )
}

export function GuestMenuButton() {
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        className={'icon-btn' + (anchor ? ' is-open' : '')}
        aria-label="Cài đặt"
        title="Cài đặt"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <Icon name="more" />
      </button>
      {anchor && <Menu anchor={anchor} onClose={() => setAnchor(null)} items={appEntries(navigate)} className="account-menu" />}
    </>
  )
}
