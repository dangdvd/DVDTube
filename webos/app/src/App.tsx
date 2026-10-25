// The app shell: the left rail (Tìm kiếm, Trang chủ, Shorts, Nghe nhạc, Kênh đăng ký, Thư viện,
// Tài khoản, Cài đặt, Ủng hộ tác giả), the section screen plus the stack of screens on top of it, dialogs,
// toasts, the parental lock, and the Back key (overlay → previous screen → rail → home →
// "Thoát DVDTube?").

import { useEffect, useState } from 'preact/hooks'
import { apiMode, onEvent, type ApiMode } from './api'
import { currentScope, focusByKey, focusElement, focusFirst } from './focus'
import { useKeys } from './keys'
import { exitApp, isBackKey, isTyping } from './platform'
import { ChannelScreen, PlaylistScreen } from './pages/Channel'
import { HomeScreen } from './pages/Home'
import { AccountFeedScreen, LibraryScreen, LocalListScreen, LocalPlaylistScreen, SubscriptionsScreen } from './pages/Library'
import { MusicBrowseScreen, MusicScreen } from './pages/Music'
import { AccountScreen, PairingScreen } from './pages/Account'
import { SearchResultsScreen, SearchScreen } from './pages/Search'
import { AboutScreen, ParentalScreen, SettingsScreen, SyncScreen } from './pages/Settings'
import { ShortsScreen } from './pages/Shorts'
import { SupportScreen } from './pages/Support'
import { PlayerScreen } from './player/Player'
import { Screen } from './screen'
import { accountStore } from './state/account'
import { SECTIONS, nav, navStore, toastStore, type Route, type Section } from './state/nav'
import { parental, parentalStore, watchedTodayText } from './state/parental'
import { useStore } from './store'
import { Avatar, Button } from './ui/base'
import { DialogHost, confirm, hasDialog, pinPrompt } from './ui/dialogs'
import { Icon } from './ui/icons'
import { forgotParentalPin } from './pages/parentalGuard'
import { hidesShorts, searchDisabled } from './state/parental'

function SectionScreen({ section }: { section: Section }) {
  switch (section) {
    case 'search':
      return <SearchScreen />
    case 'home':
      return <HomeScreen />
    case 'shorts':
      return <ShortsScreen />
    case 'music':
      return <MusicScreen />
    case 'subscriptions':
      return <SubscriptionsScreen />
    case 'library':
      return <LibraryScreen />
    case 'account':
      return <AccountScreen />
    case 'settings':
      return <SettingsScreen />
    case 'support':
      return <SupportScreen />
  }
}

function RouteScreen({ route }: { route: Route }) {
  switch (route.name) {
    case 'player':
      return <PlayerScreen />
    case 'channel':
      return <ChannelScreen channel={route.channel} />
    case 'playlist':
      return <PlaylistScreen playlist={route.playlist} />
    case 'localPlaylist':
      return <LocalPlaylistScreen id={route.id} />
    case 'localList':
      return <LocalListScreen list={route.list} />
    case 'accountFeed':
      return <AccountFeedScreen kind={route.kind} title={route.title} />
    case 'searchResults':
      return <SearchResultsScreen query={route.query} />
    case 'pairing':
      return <PairingScreen />
    case 'musicBrowse':
      return <MusicBrowseScreen browseId={route.browseId} title={route.title} />
    case 'sync':
      return <SyncScreen />
    case 'parental':
      return <ParentalScreen />
    case 'about':
      return <AboutScreen />
  }
}

function Rail() {
  const section = useStore(navStore, (s) => s.section)
  const profile = useStore(accountStore, (s) => (s.state.signedIn ? s.state.profile ?? null : null))
  const parentalKey = useStore(parentalStore, (s) => `${s.config.enabled}${s.config.hideShorts}${s.config.disableSearch}`)
  const [mode, setMode] = useState<ApiMode>(apiMode())
  useEffect(() => {
    const off = onEvent('connection', (c) => setMode(c.mode))
    setMode(apiMode())
    return off
  }, [])
  void parentalKey
  const sections = SECTIONS.filter((s) => !(s.id === 'shorts' && hidesShorts()) && !(s.id === 'search' && searchDisabled()))
  return (
    <nav class="rail" data-rail data-group data-enter="default" data-testid="rail">
      <div class="rail-logo">
        <span class="rail-logo-mark">▶</span>
        <span class="rail-label">DVDTube</span>
      </div>
      {sections.map((s) => (
        <button
          type="button"
          key={s.id}
          class={`rail-item${s.id === section ? ' selected' : ''}`}
          data-f
          tabIndex={-1}
          data-key={`rail-${s.id}`}
          data-default={s.id === section ? '' : undefined}
          data-testid={`rail-${s.id}`}
          onClick={() => {
            if (s.id === section && !nav.get().stack.length) {
              focusFirst(document.querySelector<HTMLElement>(`[data-screen="section-${s.id}"]`) ?? undefined)
              return
            }
            nav.select(s.id)
          }}
        >
          {s.id === 'account' && profile ? <Avatar src={profile.avatar} name={profile.name} size={40} /> : <Icon name={s.icon} size={40} />}
          <span class="rail-label">{s.title}</span>
        </button>
      ))}
      {mode === 'mock' && <div class="rail-badge">Chế độ mẫu</div>}
      {mode === 'offline' && <div class="rail-badge error">Mất kết nối dịch vụ</div>}
    </nav>
  )
}

function Toast() {
  const { message, id } = useStore(toastStore)
  if (!message) return null
  return (
    <div class="toast" key={id} data-testid="toast">
      {message}
    </div>
  )
}

/** "Đã hết thời gian xem hôm nay": the PIN gives more time (like the Android TV lock). */
function ParentalLock() {
  const lock = useStore(parentalStore, (s) => s.lock)
  useKeys((event) => {
    if (!lock) return false
    // Nothing behind the lock reacts; Back leaves the app's screens alone.
    if (isBackKey(event)) return true
    return false
  }, !!lock, 90)
  useEffect(() => {
    if (lock) setTimeout(() => focusByKey('lock-15'), 50)
  }, [lock])
  if (!lock) return null
  const grant = async (choice: 15 | 30 | 'day') => {
    if (await pinPrompt('Nhập mã PIN', (pin) => parental.verifyPin(pin), { onForgot: () => void forgotParentalPin() })) parental.grant(choice)
  }
  return (
    <div class="lock-screen" data-scope data-testid="parental-lock">
      <Icon name="lock" size={96} />
      <h1>{lock === 'limit' ? 'Đã hết thời gian xem hôm nay' : 'Ngoài khung giờ được xem'}</h1>
      <div class="screen-subtitle">{`Phụ huynh nhập mã PIN để cho xem thêm. Hôm nay đã xem ${watchedTodayText()}.`}</div>
      <div class="button-row">
        <Button label="Thêm 15 phút" focusKey="lock-15" onClick={() => void grant(15)} />
        <Button label="Thêm 30 phút" focusKey="lock-30" onClick={() => void grant(30)} />
        <Button label="Hết hôm nay" focusKey="lock-day" onClick={() => void grant('day')} />
      </div>
    </div>
  )
}

export function App() {
  const { section, stack } = useStore(navStore)
  const top = stack[stack.length - 1] ?? null
  const fullscreen = top?.name === 'player'

  // The Back key nobody else took.
  useKeys((event) => {
    if (!isBackKey(event) || isTyping() || hasDialog()) return false
    if (nav.back()) return true
    const active = document.activeElement as HTMLElement | null
    const onRail = !!active?.closest('[data-rail]')
    if (!onRail) {
      focusByKey(`rail-${nav.get().section}`)
      return true
    }
    if (nav.get().section !== 'home') {
      nav.select('home')
      setTimeout(() => focusByKey('rail-home'), 30)
      return true
    }
    void confirm('Thoát DVDTube?', { confirmLabel: 'Thoát', cancelLabel: 'Ở lại' }).then((yes) => {
      if (yes) exitApp()
    })
    return true
  }, true, -10)

  // Keep the focus inside the visible layer (e.g. after a screen closed under it).
  useEffect(() => {
    const timer = setInterval(() => {
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body && active.getClientRects().length > 0 && currentScope().contains(active)) return
      if (isTyping()) return
      const scope = currentScope()
      if (scope !== document.body) {
        focusFirst(scope)
        return
      }
      const screen = document.querySelector<HTMLElement>('.screen:not([style*="none"])')
      if (screen) {
        const remembered = screen.querySelector<HTMLElement>('[data-autofocus]')
        if (remembered && remembered.getClientRects().length) focusElement(remembered)
        else focusFirst(screen)
      }
    }, 700)
    return () => clearInterval(timer)
  }, [])

  return (
    <div class={`app${fullscreen ? ' fullscreen' : ''}`}>
      {!fullscreen && <Rail />}
      <main class="content">
        <Screen info={{ key: `section-${section}`, active: !top }}>
          <SectionScreen key={section} section={section} />
        </Screen>
        {stack.map((route) => (
          <Screen key={route.key} info={{ key: route.key, active: route === top }} fullscreen={route.name === 'player'}>
            <RouteScreen route={route} />
          </Screen>
        ))}
      </main>
      <ParentalLock />
      <DialogHost />
      <Toast />
    </div>
  )
}
