// Main process entry: profile / smoke setup, single instance, sessions, the API, the main window,
// tray and links opened from outside (dvdtube://, youtube.com URLs).

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, Menu, session, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { DEFAULT_SEARCH_FILTERS, feedVideos } from '@shared/models'
import type { AppSettings } from '@shared/settings'
import { initAccounts, flushAccounts } from './accounts'
import { createApi } from './api'
import { configureAutoDownload, initAutoDownloads } from './autodownload'
import { CastService } from './cast'
import { APIConfig, refreshRemoteConfig, setRemoteConfigPersistence } from './core/clients'
import { coreState, setCoreLogger } from './core/config'
import { describeError } from './core/errors'
import * as service from './core/services'
import { initDownloads } from './downloads'
import { emit, registerApi } from './ipc'
import { initLog, log } from './log'
import { setUserAgentFallback, setupNetwork } from './net'
import { attachSmokeWindow, initSmoke, isSmoke, parseSmokeDir, runCoreDiagnostics } from './smoke'
import { flushStore, initStore, readJsonSync, storeRead, storeWrite, userDataFile, writeFileAtomic } from './store'
import { attachWindowBehaviour, markQuitting, setTrayEnabled } from './tray'
import { createMainWindow, getMainWindow, showMainWindow } from './windows'

// MARK: Profile and flags (before the app is ready)

const smokeDirectory = parseSmokeDir(process.argv)
const startHidden = process.argv.includes('--hidden') && !smokeDirectory
if (smokeDirectory) {
  app.setPath('userData', join(smokeDirectory, 'userdata'))
  initSmoke(smokeDirectory)
}
const userData = app.getPath('userData')
initLog(userData, smokeDirectory)
initStore(userData)
setCoreLogger((message) => log.info(message))
setRemoteConfigPersistence({
  load: () => {
    try {
      return readFileSync(userDataFile('remote-config.json'), 'utf8')
    } catch {
      return null
    }
  },
  save: (text) => void writeFileAtomic(userDataFile('remote-config.json'), text).catch(() => {}),
})

const savedSettings = readJsonSync<Partial<AppSettings>>(userDataFile('store', 'settings.json')) ?? {}
if (savedSettings.hardwareAcceleration === false) app.disableHardwareAcceleration()
if (typeof savedSettings.language === 'string') coreState.hl = savedSettings.language
if (typeof savedSettings.region === 'string') coreState.gl = savedSettings.region
if (typeof savedSettings.remoteConfigUrl === 'string') coreState.remoteConfigUrl = savedSettings.remoteConfigUrl
// Parental controls' restricted mode applies from the very first request.
const savedParental = readJsonSync<{ config?: { enabled?: boolean; restricted?: boolean } }>(userDataFile('store', 'parental.json'))
coreState.restrictedMode = savedParental?.config?.enabled === true && savedParental.config.restricted === true
setUserAgentFallback()

log.info(`DVDTube ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform})${isSmoke() ? ' — smoke mode' : ''}`)

process.on('uncaughtException', (error) => log.error(`uncaught: ${error.stack ?? error.message}`))
process.on('unhandledRejection', (reason) => log.error(`unhandled rejection: ${describeError(reason)}`))

// MARK: Links opened from outside

const LINK_PATTERN = /^(dvdtube:\/\/(?!tv-login|sync)|https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\/)/i
const pendingLinks: string[] = []
let rendererReady = false

function linksIn(argv: string[]): string[] {
  return argv.filter((arg) => LINK_PATTERN.test(arg))
}

function openLink(url: string): void {
  if (!LINK_PATTERN.test(url)) return
  if (rendererReady) emit('openLink', url)
  else pendingLinks.push(url)
}

// MARK: Single instance

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.dangdvd.dvdtube')
  if (!isSmoke()) {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('dvdtube', process.execPath, [resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('dvdtube')
    }
  }
  pendingLinks.push(...linksIn(process.argv))

  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    for (const link of linksIn(argv)) openLink(link)
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    showMainWindow()
    openLink(url)
  })

  app.whenReady().then(start).catch((error) => {
    log.error(`startup failed: ${describeError(error)}`)
    app.exit(1)
  })
}

function applicationMenu(): Menu {
  const edit: MenuItemConstructorOptions = {
    label: 'Sửa',
    submenu: [
      { role: 'undo', label: 'Hoàn tác' },
      { role: 'redo', label: 'Làm lại' },
      { type: 'separator' },
      { role: 'cut', label: 'Cắt' },
      { role: 'copy', label: 'Sao chép' },
      { role: 'paste', label: 'Dán' },
      ...(process.platform === 'darwin' ? [{ role: 'pasteAndMatchStyle' as const, label: 'Dán và khớp kiểu' }, { role: 'delete' as const, label: 'Xóa' }] : []),
      { role: 'selectAll', label: 'Chọn tất cả' },
    ],
  }
  const view: MenuItemConstructorOptions = {
    label: 'Xem',
    submenu: [
      { role: 'zoomIn', label: 'Phóng to' },
      { role: 'zoomOut', label: 'Thu nhỏ' },
      { role: 'resetZoom', label: 'Cỡ mặc định' },
      { type: 'separator' },
      ...(process.platform === 'darwin' ? [{ role: 'togglefullscreen' as const, label: 'Toàn màn hình' }, { type: 'separator' as const }] : []),
      { role: 'toggleDevTools', label: 'Công cụ nhà phát triển' },
    ],
  }
  if (process.platform !== 'darwin') return Menu.buildFromTemplate([edit, view])
  // macOS: the app menu and standard Edit / Window menus (copy / paste shortcuts need them).
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Giới thiệu DVDTube' },
        { type: 'separator' },
        { label: 'Cài đặt…', accelerator: 'Cmd+,', click: () => openLink('dvdtube://app/settings') },
        { type: 'separator' },
        { role: 'services', label: 'Dịch vụ' },
        { type: 'separator' },
        { role: 'hide', label: 'Ẩn DVDTube' },
        { role: 'hideOthers', label: 'Ẩn các ứng dụng khác' },
        { role: 'unhide', label: 'Hiện tất cả' },
        { type: 'separator' },
        { role: 'quit', label: 'Thoát DVDTube' },
      ],
    },
    edit,
    view,
    {
      label: 'Cửa sổ',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Thu nhỏ' },
        { role: 'zoom', label: 'Phóng to cửa sổ' },
        { type: 'separator' },
        { role: 'front', label: 'Đưa tất cả lên trước' },
      ],
    },
    {
      label: 'Trợ giúp',
      role: 'help',
      submenu: [{ label: 'Trang DVDTube trên GitHub', click: () => void shell.openExternal('https://github.com/dangdvd/DVDTube') }],
    },
  ])
}

function setupPermissions(): void {
  const allowed = new Set([
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'notifications',
    'pointerLock',
    'keyboardLock',
    'mediaKeySystem',
    'window-management',
    'speaker-selection',
  ])
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)))
  ses.setPermissionCheckHandler((_contents, permission) => allowed.has(permission))
}

async function start(): Promise<void> {
  setupNetwork()
  setupPermissions()
  Menu.setApplicationMenu(applicationMenu())
  try {
    await initAccounts()
  } catch (error) {
    log.error(`accounts init failed: ${describeError(error)}`)
  }
  await initDownloads().catch((error) => log.error(`downloads init failed: ${describeError(error)}`))
  initAutoDownloads()
  configureAutoDownload(savedSettings.autoDownload)
  cast = new CastService({
    version: app.getVersion(),
    onCommand: (command) => {
      if (command.type === 'play') showMainWindow()
      emit('castCommand', command)
    },
    onDevices: (devices) => emit('castDevices', devices),
    log: (message) => log.info(message),
  })
  // Receivers must be findable even while the window is hidden in the tray.
  if (!isSmoke() && savedSettings.castReceiver !== false) void cast.setReceiverEnabled(true)
  registerApi(createApi({ smoke: isSmoke(), hidden: startHidden, cast }))

  const window = createMainWindow({ smoke: isSmoke(), hidden: startHidden })
  attachWindowBehaviour(window)
  attachSmokeWindow(window)
  setTrayEnabled(!!savedSettings.minimizeToTray || startHidden)
  window.webContents.on('did-finish-load', () => deliverLinksSoon(window))

  void refreshRemoteConfig()
  if (isSmoke()) void coreDiagnostics()

  app.on('activate', () => {
    if (!getMainWindow()) createMainWindow({ smoke: isSmoke(), hidden: false })
    else showMainWindow()
  })
}

/** The renderer subscribes to `openLink` once React has mounted. */
function deliverLinksSoon(window: BrowserWindow): void {
  rendererReady = false
  setTimeout(() => {
    if (window.isDestroyed()) return
    rendererReady = true
    for (const link of pendingLinks.splice(0)) emit('openLink', link)
  }, 2500)
}

async function coreDiagnostics(): Promise<void> {
  await runCoreDiagnostics([
    {
      name: 'core-ipc',
      run: async () => {
        const value = { at: Date.now(), text: 'Tiếng Việt' }
        await storeWrite('smoke-core', value)
        const back = (await storeRead('smoke-core')) as typeof value | null
        if (!back || back.at !== value.at || back.text !== value.text) throw new Error('store round trip mismatch')
        return 'storeWrite / storeRead ok'
      },
    },
    {
      name: 'core-remote-config',
      run: async () => {
        await refreshRemoteConfig()
        return `player clients: ${APIConfig.playerProfiles.map((p) => `${p.name} ${p.version}`).join(', ')}; web ${APIConfig.webProfile.version}`
      },
    },
    {
      name: 'core-search',
      run: async () => {
        const page = await service.search('nhạc trẻ remix', DEFAULT_SEARCH_FILTERS)
        return `${page.items.length} items, ${feedVideos(page).length} videos, more: ${page.continuation ? 'yes' : 'no'}`
      },
    },
    {
      name: 'core-player',
      run: async () => {
        const info = await service.player('jNQXAC9IVRw')
        const video = info.adaptiveFormats.filter((f) => f.mimeType.startsWith('video/'))
        const audio = info.adaptiveFormats.filter((f) => f.mimeType.startsWith('audio/'))
        const ranged = info.adaptiveFormats.filter((f) => f.initRange && f.indexRange).length
        return `client ${info.client}; hls ${info.hlsUrl ? 'yes' : 'no'}; ${video.length} video + ${audio.length} audio formats (${ranged} with byte ranges), ${info.muxedFormats.length} muxed`
      },
    },
  ])
}

let flushedBeforeQuit = false
let cast: CastService | null = null

/**
 * Lets the renderer save what it has pending (queue, positions), then keeps the newest cookie
 * values of the account and the store writes (at most 2.5 s); says goodbye on the network.
 */
app.on('before-quit', (event) => {
  markQuitting()
  if (flushedBeforeQuit) return
  flushedBeforeQuit = true
  event.preventDefault()
  emit('beforeQuit', true)
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500))
  const work = new Promise((resolve) => setTimeout(resolve, 400)).then(() => Promise.all([flushAccounts(), flushStore(), cast?.stop()]))
  void Promise.race([work, timeout]).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  app.quit()
})
