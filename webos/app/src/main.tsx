// Start of the TV interface: polyfills, the webOS hooks (keys, pointer, relaunch), the
// connection to the service, the stored session, then the app.

import './polyfills'
import './styles/app.css'
import { render } from 'preact'
import type { ResolvedLink } from '@shared/models'
import { App } from './App'
import { api, connect, onEvent, wantsMock } from './api'
import { initFocusTracking, initPointerFocus } from './focus'
import { initKeys } from './keys'
import { deviceInfo, initPointer, isPointerVisible, launchParams, onRelaunch, type LaunchParams } from './platform'
import { editQueue, enqueue, play, playerControls, closePlayer, playIndex, playerStore } from './player/controller'
import { initAccount, restoreSession } from './state/account'
import { library } from './state/library'
import { nav, rememberFocus, screenKey, toast } from './state/nav'
import { onRestrictedChange, restrictedMode } from './state/parental'
import { onSettingsChange, settings } from './state/settings'
import { flushSaves, loadJson, saveJson } from './store'
import { showUpdate } from './pages/Settings'

const root = document.getElementById('app')!

function deviceId(): string {
  const saved = loadJson<{ id?: string }>('device')
  if (saved?.id && /^[0-9a-f-]{36}$/i.test(saved.id)) return saved.id
  let id: string
  try {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  } catch {
    id = '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12)
  }
  saveJson('device', { id })
  return id
}

let tvName = 'LG webOS TV'

function pushConfig(): void {
  const s = settings()
  void api
    .configure({
      language: s.language,
      region: s.region,
      incognito: s.incognito,
      restrictedMode: restrictedMode(),
      remoteConfigUrl: s.remoteConfigUrl,
      castReceiver: s.castReceiver,
      deviceName: s.deviceName.trim() || tvName,
      deviceId: deviceId(),
    })
    .catch(() => {})
}

// MARK: Deep links ("handlesRelaunch")

async function openLink(link: ResolvedLink | null): Promise<void> {
  if (!link) return
  switch (link.type) {
    case 'video':
      play({ id: link.videoId, title: '' }, { startAt: link.startSeconds ?? null, playlistId: link.playlistId ?? null })
      break
    case 'shorts':
      nav.openShorts([{ id: link.videoId, title: '', isShort: true }], { id: link.videoId, title: '' })
      break
    case 'channel':
      nav.open({ name: 'channel', channel: { id: link.channelId, name: '' } })
      break
    case 'playlist':
      nav.open({ name: 'playlist', playlist: { id: link.playlistId, title: 'Danh sách phát' } })
      break
    case 'search':
      nav.search(link.query)
      break
    case 'app':
      nav.select(link.page === 'shorts' ? 'shorts' : link.page === 'music' ? 'music' : 'search')
      break
  }
}

export async function handleLaunch(params: LaunchParams): Promise<void> {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const videoId = str(params.videoId) ?? str(params.v)
  const t = Number(params.t ?? params.start ?? 0)
  if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    play({ id: videoId, title: '' }, { startAt: Number.isFinite(t) && t > 0 ? t : null })
    return
  }
  const query = str(params.query) ?? str(params.q)
  if (query) {
    nav.search(query)
    return
  }
  const page = str(params.page)
  if (page === 'shorts' || page === 'music' || page === 'search') {
    nav.select(page)
    return
  }
  let target = str(params.target) ?? str(params.url) ?? str(params.link)
  const content = str(params.contentTarget)
  if (!target && content) {
    // `contentTarget: "v=<id>&t=30"` (system launchers / voice).
    const q = new URLSearchParams(content.replace(/^v=v=/, 'v='))
    const id = q.get('v')
    if (id) {
      const start = Number(q.get('t') ?? 0)
      play({ id, title: '' }, { startAt: start > 0 ? start : null })
      return
    }
    target = content
  }
  if (target) {
    try {
      await openLink(await api.resolveLink(target))
    } catch {
      toast('Không mở được liên kết')
    }
  }
}

// MARK: Casting receiver (phones / PCs → this TV)

function initCast(): void {
  onEvent('castCommand', (command) => {
    if (command.type === 'play') {
      const r = command.request
      play(r.video, { queue: r.queue ?? null, startAt: r.startSeconds ?? null, playlistId: r.playlistId ?? null, sender: r.sender ?? null })
      if (r.sender) toast(`Đang phát từ ${r.sender}`)
      return
    }
    if (command.type === 'queue') {
      enqueue(command.video, command.next)
      toast(command.next ? 'Đã thêm để phát tiếp theo' : 'Đã thêm vào hàng đợi')
      return
    }
    if (command.type === 'edit') {
      editQueue(command.edit)
      return
    }
    const c = playerControls()
    switch (command.action) {
      case 'play':
        c?.play()
        break
      case 'pause':
        c?.pause()
        break
      case 'toggle':
        c?.toggle()
        break
      case 'seek':
        if (command.value !== null) c?.seek(command.value)
        break
      case 'skip':
        if (command.value !== null) c?.skip(command.value)
        break
      case 'next':
        playIndex(playerStore.get().index + 1)
        break
      case 'previous':
        playIndex(playerStore.get().index - 1)
        break
      case 'stop':
        closePlayer()
        break
      case 'volume':
        if (command.value !== null) c?.setVolume(command.value)
        break
      case 'mute':
        c?.setMuted(command.value !== 0)
        break
    }
  })
  // The receiver answers GET /api/status with what we report.
  let idleSent = false
  setInterval(() => {
    const c = playerControls()
    if (!c) {
      if (!idleSent) void api.castReceiverStatus({ state: 'idle', video: null, position: 0, duration: 0, volume: 1, muted: false, queue: [], index: 0, error: null }).catch(() => {})
      idleSent = true
      return
    }
    idleSent = false
    void api.castReceiverStatus(c.status()).catch(() => {})
  }, 1000)
}

// MARK: Library sync (a phone sends its library)

function initSync(): void {
  onEvent('syncIncoming', ({ requestId, device, library: remote }) => {
    try {
      const { merged, summary } = library.mergeFrom(remote, settings().deviceName.trim() || tvName)
      void api.syncReply(requestId, merged, summary)
      toast(`Đồng bộ với ${device}: ${summary}`)
    } catch (error) {
      void api.syncReply(requestId, null, error instanceof Error ? error.message : 'Không gộp được thư viện.')
    }
  })
}

async function checkUpdatesDaily(): Promise<void> {
  if (!settings().checkUpdates || wantsMock()) return
  const last = loadJson<number>('update-check') ?? 0
  if (Date.now() - last < 24 * 3600_000) return
  saveJson('update-check', Date.now())
  await showUpdate(false)
}

async function start(): Promise<void> {
  initKeys()
  initPointer()
  initPointerFocus(isPointerVisible)
  initFocusTracking((el) => {
    const key = el.getAttribute('data-key')
    const screen = el.closest('[data-screen]')?.getAttribute('data-screen')
    if (key && screen) rememberFocus(screen, key)
    void screenKey
  })
  initAccount()
  initCast()
  initSync()
  onRelaunch((params) => void handleLaunch(params))
  window.addEventListener('beforeunload', flushSaves)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSaves()
  })

  if (wantsMock() || new URLSearchParams(location.search).get('debug') === '1') {
    // Development hooks (screenshots, smoke test, the browser console).
    ;(window as unknown as { __dvd: unknown }).__dvd = { nav, play, library, settings, handleLaunch, api }
  }
  render(<App />, root)
  document.getElementById('boot')?.remove()

  if (wantsMock() && new URLSearchParams(location.search).get('demo') === '1' && library.get().history.length === 0) {
    const { demoLibrary } = await import('./mock')
    const { libraryStore } = await import('./state/library')
    libraryStore.replace({ ...libraryStore.get(), ...(demoLibrary() as object) })
  }
  try {
    await connect()
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 8000)
  }
  const info = await deviceInfo().catch(() => null)
  tvName = info?.deviceName || (info?.modelName ? `LG ${info.modelName}` : 'LG webOS TV')
  pushConfig()
  onSettingsChange((_s, changed) => {
    if (changed.some((k) => ['language', 'region', 'incognito', 'castReceiver', 'deviceName', 'remoteConfigUrl'].includes(k))) pushConfig()
  })
  onRestrictedChange(pushConfig)
  onEvent('connection', (c) => {
    if (c.mode === 'service') pushConfig()
  })
  await restoreSession()
  await handleLaunch(launchParams())
  setTimeout(() => void checkUpdatesDaily(), 8000)
}

void start()
