// Google sign-in on Google's own page, in a modal window of the `persist:yt` partition (or a
// temporary one for "add account"), and YouTube Studio in its own window with the same session.

import { randomBytes } from 'node:crypto'
import { BrowserWindow, session, shell } from 'electron'
import { SIGNIN_REFUSED } from '@shared/api'
import type { AccountState } from '@shared/models'
import { accountState, completeAddAccount, completeWindowSignIn, currentIdentity } from './accounts'
import { coreState } from './core/config'
import { hasAuthCookies } from './core/auth'
import { log } from './log'
import { chromeUA, YT_PARTITION } from './net'
import { appIcon } from './resources'

function loginUrl(hl: string): string {
  const next = `https://www.youtube.com/signin?action_handle_signin=true&app=desktop&hl=${hl}&next=%2F`
  return `https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=${encodeURIComponent(next)}&hl=${hl}`
}

function isGoogleOrYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return /(^|\.)(google|youtube|gstatic|googleusercontent)\.com$/.test(host) || /(^|\.)google\.[a-z.]+$/.test(host)
  } catch {
    return false
  }
}

/** Google's "Không thể đăng nhập cho bạn" page (it refuses this browser / app). */
function isRefusal(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'accounts.google.com' && parsed.pathname.includes('/signin/rejected')
  } catch {
    return false
  }
}

function openOutside(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

let signInWindow: BrowserWindow | null = null

/** Opens Google's sign-in page; resolves when the window closes (signed in or not). */
export async function signIn(parent: BrowserWindow | null, addAccount: boolean): Promise<AccountState> {
  if (signInWindow && !signInWindow.isDestroyed()) {
    signInWindow.focus()
    return accountState()
  }
  const partition = addAccount ? `dvd-signin-${randomBytes(6).toString('hex')}` : YT_PARTITION
  const ses = session.fromPartition(partition)
  ses.setUserAgent(chromeUA())
  const window = new BrowserWindow({
    parent: parent ?? undefined,
    modal: !!parent,
    width: 520,
    height: 720,
    minWidth: 380,
    minHeight: 500,
    title: addAccount ? 'Thêm tài khoản' : 'Đăng nhập Google',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: appIcon(),
    show: false,
    webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  signInWindow = window
  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => window.show())
  window.webContents.setUserAgent(chromeUA())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleOrYouTube(url)) {
      void window.loadURL(url)
    } else {
      openOutside(url)
    }
    return { action: 'deny' }
  })

  return new Promise<AccountState>((resolve, reject) => {
    let finished = false
    let checking = false

    const check = async (url: string) => {
      if (finished || checking) return
      if (isRefusal(url)) {
        // Nothing to retry in this window: say so and point to signing in from the phone.
        finished = true
        log.warn('sign-in: Google refused to sign in inside the app')
        window.destroy()
        if (addAccount) void ses.clearStorageData().catch(() => {})
        reject(new Error(SIGNIN_REFUSED))
        return
      }
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return
      }
      const host = parsed.hostname.toLowerCase()
      if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return
      if (parsed.pathname.startsWith('/signin')) return
      checking = true
      try {
        const cookies = await ses.cookies.get({ url: 'https://www.youtube.com' })
        const map = Object.fromEntries(cookies.map((c) => [c.name, c.value]))
        if (!hasAuthCookies(map)) return
        finished = true
        log.info('sign-in: Google session reached youtube.com')
        window.hide()
        try {
          const state = addAccount ? await completeAddAccount(partition) : await completeWindowSignIn()
          resolve(state)
        } catch (error) {
          reject(error)
        } finally {
          if (!window.isDestroyed()) window.destroy()
          if (addAccount) void ses.clearStorageData().catch(() => {})
        }
      } finally {
        checking = false
      }
    }

    const onNavigate = (_event: unknown, url: string) => void check(url)
    window.webContents.on('did-navigate', onNavigate)
    window.webContents.on('did-redirect-navigation', (details) => void check(details.url))
    window.webContents.on('did-navigate-in-page', onNavigate)
    window.webContents.on('did-finish-load', () => void check(window.webContents.getURL()))
    window.on('closed', () => {
      signInWindow = null
      if (!finished) {
        finished = true
        if (addAccount) void ses.clearStorageData().catch(() => {})
        resolve(accountState())
      }
    })
    void window.loadURL(loginUrl(coreState.hl || 'vi')).catch((error) => {
      log.warn(`sign-in: page failed to load (${error instanceof Error ? error.message : String(error)})`)
    })
  })
}

let studioWindow: BrowserWindow | null = null

/** YouTube Studio (upload, manage videos), signed in with the same account. */
export function openStudio(): void {
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show()
    studioWindow.focus()
    return
  }
  const identity = currentIdentity()
  const url = identity.authUser > 0 ? `https://studio.youtube.com/?authuser=${identity.authUser}` : 'https://studio.youtube.com/'
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    title: 'YouTube Studio',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: { partition: YT_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  studioWindow = window
  window.setMenuBarVisibility(false)
  window.webContents.setUserAgent(chromeUA())
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isGoogleOrYouTube(target)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          icon: appIcon(),
          webPreferences: { partition: YT_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
        },
      }
    }
    openOutside(target)
    return { action: 'deny' }
  })
  window.on('closed', () => {
    studioWindow = null
  })
  void window.loadURL(url)
}
