// System tray ("thu nhỏ xuống khay hệ thống"), window visibility events and the Windows taskbar
// thumbnail buttons (⏮ ⏯ ⏭).

import { app, Menu, Tray, type BrowserWindow } from 'electron'
import type { ThumbarState } from '@shared/api'
import { emit } from './ipc'
import { image, trayIcon } from './resources'
import { getMainWindow, setWindowTitle, showMainWindow } from './windows'

let tray: Tray | null = null
let trayEnabled = false
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

function quit(): void {
  quitting = true
  app.quit()
}

function createTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('DVDTube')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở DVDTube', click: () => showMainWindow() },
      { label: 'Phát / Tạm dừng', click: () => emit('mediaCommand', 'playPause') },
      { label: 'Tiếp theo', click: () => emit('mediaCommand', 'next') },
      { type: 'separator' },
      { label: 'Thoát', click: quit },
    ]),
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Closing the window hides it to the tray while enabled (or when started hidden). */
export function setTrayEnabled(enabled: boolean): void {
  trayEnabled = enabled
  if (enabled) createTray()
  else if (getMainWindow()?.isVisible() !== false) destroyTray()
}

export function attachWindowBehaviour(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (trayEnabled && !quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('hide', () => emit('visibility', false))
  window.on('show', () => {
    emit('visibility', true)
    if (!trayEnabled) destroyTray()
  })
  window.on('minimize', () => emit('visibility', false))
  window.on('restore', () => emit('visibility', true))
}

/** Taskbar thumbnail buttons and the window title "<video> - DVDTube". */
export function setThumbar(state: ThumbarState, title?: string | null): void {
  setWindowTitle(title)
  const window = getMainWindow()
  if (!window || process.platform !== 'win32') return
  const flag = (enabled: boolean) => (enabled ? ['enabled'] : ['disabled'])
  window.setThumbarButtons([
    { tooltip: 'Video trước', icon: image('thumbar', 'prev.png'), flags: flag(state.hasPrevious), click: () => emit('mediaCommand', 'previous') },
    {
      tooltip: state.playing ? 'Tạm dừng' : 'Phát',
      icon: image('thumbar', state.playing ? 'pause.png' : 'play.png'),
      flags: ['enabled'],
      click: () => emit('mediaCommand', 'playPause'),
    },
    { tooltip: 'Video tiếp theo', icon: image('thumbar', 'next.png'), flags: flag(state.hasNext), click: () => emit('mediaCommand', 'next') },
  ])
}
