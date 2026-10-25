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
import './styles/features.css'
import { CastBar } from './components/cast/CastBar'
import { CastPicker } from './components/cast/CastPicker'
import { DialogHost } from './components/DialogHost'
import { ParentalLock } from './components/ParentalLock'
import { SyncDialog } from './components/SyncDialog'
import { UpdateBanner } from './components/UpdateBanner'
import { Icon } from './components/Icon'
import { ScrollRootContext } from './components/InfiniteScroll'
import { Drawer, MiniRail, Sidebar } from './components/shell/Sidebar'
import { TopBar } from './components/shell/TopBar'
import { Toaster } from './components/Toaster'
import { startAlarms } from './lib/alarms'
import { api, onEvent } from './lib/api'
import { startCastReceiver } from './lib/castReceiver'
import { startDownloadSync } from './lib/downloads'
import { openLink } from './lib/links'
import { startNotifier } from './lib/notifier'
import { restorePlayerSession, startPlayerSessionSaving } from './lib/playerSession'
import { loadPrefs, usePrefs } from './lib/prefs'
import { startRecentVideos } from './lib/recentVideos'
import { startSyncListener } from './lib/sync'
import { useGlobalShortcuts } from './lib/shortcuts'
import { runSmoke } from './lib/smoke'
import { useMediaQuery, useTheme } from './lib/theme'
import { useUi } from './lib/ui'
import { startCastDiscovery, useCast } from './state/cast'
import { startParentalWatch } from './state/parental'
import { usePlayer } from './state/player'
import { useSettings } from './state/settings'
import { AccountPage } from './pages/AccountPage'
import { ChannelPage } from './pages/ChannelPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { LikedPage, WatchLaterPage } from './pages/LocalListPages'
import { LocalPlaylistPage } from './pages/LocalPlaylistPage'
import { MusicPage } from './pages/MusicPage'
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

const DAY = 24 * 60 * 60_000

/** Any picture playing: the main player (also the web player and music) or a Short. */
function anythingPlaying(): boolean {
  if (usePlayer.getState().playing) return true
  return Array.from(document.querySelectorAll('video')).some((v) => !v.paused && !v.ended && v.readyState > 2)
}

function stopAllPlayback(): void {
  if (usePlayer.getState().playing) usePlayer.getState().pause()
  document.querySelectorAll('video').forEach((v) => v.pause())
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
    startCastDiscovery()
    startCastReceiver(navigate)
    startSyncListener()
    startParentalWatch(anythingPlaying, stopAllPlayback)
    onEvent('openLink', (url) => void openLink(url, navigate))
    void api.appInfo().then(async (info) => {
      if (info.smoke) {
        void runSmoke(navigate)
        return
      }
      await restorePlayerSession().catch(() => {})
      startPlayerSessionSaving()
      startRecentVideos()
      void startAlarms(navigate)
      startNotifier()
      await loadPrefs()
      // Automatic checks at most once a day (a development build is older than any release).
      if (useSettings.getState().settings.checkUpdates && Date.now() - usePrefs.getState().lastUpdateCheck > DAY) {
        usePrefs.getState().set({ lastUpdateCheck: Date.now() })
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

  const casting = useCast((s) => !!s.connected)
  const layout = onWatch || narrow ? 'none' : wide && !collapsed ? 'full' : 'mini'
  const toggleMenu = () => {
    if (layout === 'full' || (wide && collapsed && !onWatch)) useUi.getState().toggleCollapsed()
    else useUi.getState().setDrawer(!drawerOpen)
  }

  return (
    <div className={`app app--${layout}` + (casting ? ' app--casting' : '')} data-route={location.pathname.split('/')[1] || 'home'}>
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
              <Route path="/music" element={<MusicPage />} />
              <Route path="/music/browse/:id" element={<MusicPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ScrollRootContext.Provider>
        </main>
      </div>
      <Drawer open={drawerOpen} onClose={() => useUi.getState().setDrawer(false)} />
      <PlayerHost />
      <CastBar />
      <CastPicker />
      <SyncDialog />
      <ParentalLock />
      <Toaster />
      <DialogHost />
    </div>
  )
}
