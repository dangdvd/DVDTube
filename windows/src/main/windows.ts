// The main window: remembered size / position, navigation guards, external links, and the
// window modes (fullscreen, always on top, mini player window).

import { join } from 'node:path'
import { BrowserWindow, screen, shell, type Rectangle } from 'electron'
import type { WindowMode } from '@shared/api'
import { emit, registerAppWindow } from './ipc'
import { log } from './log'
import { appIcon } from './resources'
import { readJsonSync, userDataFile, writeJson } from './store'
import { guardWebviews } from './webplayer'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const MIN_WIDTH = 480
const MIN_HEIGHT = 360
const MINI_WIDTH = 480
const MINI_HEIGHT = 270

let mainWindow: BrowserWindow | null = null
let mode: WindowMode = 'normal'
let beforeMini: { bounds: Rectangle; maximized: boolean } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let smokeMode = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function stateFile(): string {
  return userDataFile('window.json')
}

function loadState(): WindowState {
  const saved = readJsonSync<WindowState>(stateFile())
  const fallback: WindowState = { width: 1280, height: 800, maximized: false }
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return fallback
  const state: WindowState = {
    width: Math.max(MIN_WIDTH, saved.width),
    height: Math.max(MIN_HEIGHT, saved.height),
    maximized: !!saved.maximized,
  }
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    // Only keep the position when it is still on a connected display.
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea
      return saved.x! + 100 > area.x && saved.x! < area.x + area.width - 100 && saved.y! >= area.y - 10 && saved.y! < area.y + area.height - 100
    })
    if (visible) {
      state.x = saved.x
      state.y = saved.y
    }
  }
  return state
}

function saveState(): void {
  const window = getMainWindow()
  if (!window || smokeMode || mode === 'mini' || window.isFullScreen()) return
  const bounds = window.getNormalBounds()
  void writeJson(stateFile(), { ...bounds, maximized: window.isMaximized() }).catch(() => {})
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveState, 800)
}

function rendererUrl(): string | null {
  return process.env.ELECTRON_RENDERER_URL ?? null
}

/** Pages of the app itself (the bundled renderer or the dev server). */
function isAppUrl(url: string): boolean {
  const dev = rendererUrl()
  if (dev) return url.startsWith(dev)
  return url.startsWith('file:') && url.includes('/renderer/index.html')
}

function openExternalSafe(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

export function createMainWindow(options: { smoke: boolean; hidden: boolean }): BrowserWindow {
  smokeMode = options.smoke
  const state: WindowState = options.smoke ? { width: 1280, height: 800, maximized: false } : loadState()
  const window = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: '#0f0f0f',
    title: 'DVDTube',
    icon: appIcon(),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      // Only for the web player fallback; every <webview> is checked by guardWebviews().
      webviewTag: true,
    },
  })
  mainWindow = window
  registerAppWindow(window)
  window.setMenuBarVisibility(false)
  if (state.maximized && !options.smoke) window.maximize()

  window.once('ready-to-show', () => {
    if (!options.hidden) window.show()
  })
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) window.on(event as 'resize', scheduleSave)
  window.on('close', saveState)
  window.on('leave-full-screen', () => {
    if (mode === 'fullscreen') {
      mode = 'normal'
      emit('windowMode', mode)
    }
  })
  window.on('enter-full-screen', () => {
    if (mode !== 'fullscreen') {
      mode = 'fullscreen'
      emit('windowMode', mode)
    }
  })

  const contents = window.webContents
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternalSafe(url)
  })
  guardWebviews(contents)
  contents.on('render-process-gone', (_event, details) => log.error(`renderer gone: ${details.reason} (${details.exitCode})`))
  contents.on('unresponsive', () => log.warn('renderer unresponsive'))

  const dev = rendererUrl()
  if (dev) void window.loadURL(dev)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

export function showMainWindow(): void {
  const window = getMainWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

export function currentWindowMode(): WindowMode {
  return mode
}

export function setWindowMode(next: WindowMode): void {
  const window = getMainWindow()
  if (!window) return
  if (next === mode && next !== 'normal') return

  // Leave the current mode first.
  if (mode === 'mini' && next !== 'mini') {
    window.setAlwaysOnTop(false)
    window.setAspectRatio(0)
    window.setMinimumSize(MIN_WIDTH, MIN_HEIGHT)
    if (beforeMini) {
      window.setBounds(beforeMini.bounds)
      if (beforeMini.maximized) window.maximize()
    }
    beforeMini = null
  }
  if (mode === 'fullscreen' && next !== 'fullscreen') window.setFullScreen(false)
  if (mode === 'alwaysOnTop' && next !== 'alwaysOnTop') window.setAlwaysOnTop(false)

  switch (next) {
    case 'fullscreen':
      window.setFullScreen(true)
      break
    case 'alwaysOnTop':
      window.setAlwaysOnTop(true, 'floating')
      break
    case 'mini': {
      if (mode !== 'mini') beforeMini = { bounds: window.getNormalBounds(), maximized: window.isMaximized() }
      if (window.isMaximized()) window.unmaximize()
      const area = screen.getDisplayMatching(window.getBounds()).workArea
      window.setMinimumSize(320, 180)
      window.setBounds({
        x: area.x + area.width - MINI_WIDTH - 24,
        y: area.y + area.height - MINI_HEIGHT - 24,
        width: MINI_WIDTH,
        height: MINI_HEIGHT,
      })
      window.setAspectRatio(16 / 9)
      window.setAlwaysOnTop(true, 'floating')
      break
    }
    case 'normal':
      break
  }
  mode = next
  emit('windowMode', mode)
}

export function setWindowTitle(title: string | null | undefined): void {
  const window = getMainWindow()
  if (!window) return
  window.setTitle(title && title.trim() ? `${title.trim()} - DVDTube` : 'DVDTube')
}
