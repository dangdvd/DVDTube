// App layout and routes: top bar, sidebar (full / mini rail / overlay drawer), the scrolling
// content area with per-entry scroll restoration, and the app-wide behaviours (theme, global
// shortcuts, external links, new-video notifier, update check, smoke scenario).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import type { UpdateInfo } from '@shared/api'
import './styles/base.css'
import './styles/shell.css'
import './styles/cards.css'
import './styles/pages.css'
import { PlayerHost, ShortsPage, WatchPage } from './player'
import { DialogHost } from './components/DialogHost'
import { Icon } from './components/Icon'
import { ScrollRootContext } from './components/InfiniteScroll'
import { Drawer, MiniRail, Sidebar } from './components/shell/Sidebar'
import { TopBar } from './components/shell/TopBar'
import { Toaster } from './components/Toaster'
import { api, onEvent } from './lib/api'
import { startDownloadSync } from './lib/downloads'
import { openLink } from './lib/links'
import { startNotifier } from './lib/notifier'
import { useGlobalShortcuts } from './lib/shortcuts'
import { runSmoke } from './lib/smoke'
import { useMediaQuery, useTheme } from './lib/theme'
import { useUi } from './lib/ui'
import { useSettings } from './state/settings'
import { AccountPage } from './pages/AccountPage'
import { ChannelPage } from './pages/ChannelPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { LikedPage, WatchLaterPage } from './pages/LocalListPages'
import { LocalPlaylistPage } from './pages/LocalPlaylistPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { PlaylistPage } from './pages/PlaylistPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { SubscriptionsPage } from './pages/SubscriptionsPage'

const scrollPositions = new Map<string, number>()

/** Remembers the content scroll position per history entry and restores it on back / forward. */
function useScrollRestoration(root: HTMLElement | null) {
  const location = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (!root) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => scrollPositions.set(location.key, root.scrollTop))
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll)
    }
  }, [root, location.key])

  useLayoutEffect(() => {
    if (!root) return
    const saved = navigationType === 'POP' ? scrollPositions.get(location.key) : undefined
    if (saved == null) {
      root.scrollTop = 0
      return
    }
    // The page may still be rendering its (cached) items: retry a few times until it fits.
    const timers: ReturnType<typeof setTimeout>[] = []
    const apply = () => {
      if (root.scrollHeight - root.clientHeight >= saved - 4) root.scrollTop = saved
    }
    apply()
    for (const delay of [30, 120, 300, 700]) timers.push(setTimeout(apply, delay))
    return () => timers.forEach(clearTimeout)
  }, [root, location.key, navigationType])
}

function UpdateBanner({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <Icon name="download" size={20} />
      <span>
        Đã có phiên bản mới <b>{info.version}</b>
        {info.notes ? ` — ${info.notes}` : ''}
      </span>
      <button className="btn btn-accent btn-small" onClick={() => void api.openExternal(info.downloadUrl ?? info.url)}>
        Tải bản mới
      </button>
      <button className="icon-btn" aria-label="Đóng" onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </div>
  )
}

export function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const drawerOpen = useUi((s) => s.drawerOpen)
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const [content, setContent] = useState<HTMLElement | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const started = useRef(false)
  const wide = useMediaQuery('(min-width: 1313px)')
  const narrow = useMediaQuery('(max-width: 791px)')
  const onWatch = location.pathname === '/watch'

  useTheme()
  useGlobalShortcuts(navigate)
  useScrollRestoration(content)

  // One-time app start: downloads, external links, notifier, update check, smoke test.
  useEffect(() => {
    if (started.current) return
    started.current = true
    startDownloadSync()
    onEvent('openLink', (url) => void openLink(url, navigate))
    void api.appInfo().then((info) => {
      if (info.smoke) {
        void runSmoke(navigate)
        return
      }
      startNotifier()
      if (useSettings.getState().settings.checkUpdates) {
        api
          .checkUpdate()
          .then((u) => u && setUpdate(u))
          .catch(() => {})
      }
    })
  }, [navigate])

  // The drawer closes on navigation.
  useEffect(() => {
    useUi.getState().setDrawer(false)
  }, [location.pathname, location.search])

  const layout = onWatch || narrow ? 'none' : wide && !collapsed ? 'full' : 'mini'
  const toggleMenu = () => {
    if (layout === 'full' || (wide && collapsed && !onWatch)) useUi.getState().toggleCollapsed()
    else useUi.getState().setDrawer(!drawerOpen)
  }

  return (
    <div className={`app app--${layout}`} data-route={location.pathname.split('/')[1] || 'home'}>
      <TopBar onMenu={toggleMenu} />
      <div className="app-body">
        {layout === 'full' && <Sidebar />}
        {layout === 'mini' && <MiniRail />}
        <main className="app-content" ref={setContent} data-testid="content">
          <ScrollRootContext.Provider value={content}>
            {update && <UpdateBanner info={update} onClose={() => setUpdate(null)} />}
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/results" element={<SearchPage />} />
              <Route path="/watch" element={<WatchPage />} />
              <Route path="/shorts/:id?" element={<ShortsPage />} />
              <Route path="/channel/:id/:tab?" element={<ChannelPage />} />
              <Route path="/playlist" element={<PlaylistPage />} />
              <Route path="/local-playlist/:id" element={<LocalPlaylistPage />} />
              <Route path="/feed/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/feed/library" element={<LibraryPage />} />
              <Route path="/feed/history" element={<HistoryPage />} />
              <Route path="/feed/watch-later" element={<WatchLaterPage />} />
              <Route path="/feed/liked" element={<LikedPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ScrollRootContext.Provider>
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={() => useUi.getState().setDrawer(false)} />
      <PlayerHost />
      <Toaster />
      <DialogHost />
    </div>
  )
}
