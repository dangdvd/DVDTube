// "Trình phát web": YouTube's embed in an Electron <webview>, used when every native source
// failed. The host page (served by the main process, see src/main/webplayer.ts) drives the embed
// with the IFrame API and reports `DVDWEB{…}` console lines; commands go back as
// `dvdCommand(name, args)` (playVideo, pauseVideo, seekTo, setVolume, mute, unMute,
// setPlaybackRate).
//
// A <webview> reloads whenever it is moved in the DOM, so it never moves: it sits in a fixed
// layer that follows the player's current slot (watch page, mini player, mini window) every
// frame, and the player controls are moved into that layer on top of it while it is in use.

import { api, isElectron } from '@/lib/api'
import { usePlayer } from '@/state/player'
import { getStage } from '../stage'

export interface WebPlayerState {
  /** Seconds. */
  t: number
  d: number
  /** YouTube player state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  s: number
  m: boolean
  v: number
  r: number
  ad: boolean
}

interface WebviewElement extends HTMLElement {
  src: string
  executeJavaScript(code: string): Promise<unknown>
}

export function webErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'Mã video không hợp lệ.'
    case 5:
      return 'Trình phát web không phát được video này.'
    case 100:
      return 'Video không tồn tại hoặc đã bị xóa.'
    case 101:
    case 150:
      return 'Chủ sở hữu không cho phép phát video này bên ngoài YouTube.'
    case 152:
    case 153:
      return 'YouTube từ chối trình phát nhúng (lỗi cấu hình trình phát).'
    default:
      return `Trình phát web gặp lỗi (mã ${code}).`
  }
}

let layer: HTMLDivElement | null = null
let frame = 0
let lastBox = ''

/** The fixed layer holding the webview (and, while in use, the player controls). */
export function webLayer(): HTMLDivElement {
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'dp-web-layer'
    layer.dataset.testid = 'web-player'
    layer.style.display = 'none'
    document.body.append(layer)
  }
  return layer
}

function track(): void {
  const el = webLayer()
  const root = getStage().root
  const slot = root.parentElement
  const rect = root.getBoundingClientRect()
  const parked = !slot || slot.classList.contains('dp-parking') || rect.width < 2 || rect.height < 2
  const s = usePlayer.getState()
  const z = s.windowMini ? 5001 : s.mode === 'mini' ? 1501 : 90
  const radius = slot ? getComputedStyle(slot).borderRadius : '0'
  const box = parked || document.fullscreenElement === el ? (parked ? 'parked' : 'fullscreen') : `${rect.left}|${rect.top}|${rect.width}|${rect.height}|${z}|${radius}`
  if (box !== lastBox) {
    lastBox = box
    if (box === 'fullscreen') {
      el.style.cssText = 'display:block'
    } else if (parked) {
      el.style.cssText = 'display:block;left:-10000px;top:0;width:320px;height:180px'
    } else {
      el.style.cssText = `display:block;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:${z};border-radius:${radius}`
    }
  }
  frame = requestAnimationFrame(track)
}

function startTracking(): void {
  if (frame) return
  lastBox = ''
  // The controls (React portal target) move on top of the webview.
  webLayer().append(getStage().overlay)
  frame = requestAnimationFrame(track)
}

function stopTracking(): void {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  const el = webLayer()
  el.style.cssText = 'display:none'
  const { root, overlay } = getStage()
  if (overlay.parentElement !== root) root.append(overlay)
}

export interface WebPlayback {
  load(videoId: string, startSeconds: number, loop: boolean): Promise<void>
  command(name: string, args?: unknown[]): void
  unload(): void
  onState: ((state: WebPlayerState) => void) | null
  onError: ((message: string) => void) | null
  onReady: (() => void) | null
}

/** The real one, inside Electron. */
class WebviewPlayback implements WebPlayback {
  private view: WebviewElement | null = null
  onState: ((state: WebPlayerState) => void) | null = null
  onError: ((message: string) => void) | null = null
  onReady: (() => void) | null = null

  async load(videoId: string, startSeconds: number, loop: boolean): Promise<void> {
    const { url, partition } = await api.webPlayerSource(videoId, startSeconds, loop)
    this.unload()
    const view = document.createElement('webview') as WebviewElement
    view.className = 'dp-webview'
    view.setAttribute('partition', partition)
    view.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes')
    view.addEventListener('console-message', (event) => {
      const message = String((event as unknown as { message?: string }).message ?? '')
      if (!message.startsWith('DVDWEB')) return
      let data: { ev?: string; code?: number } & Partial<WebPlayerState>
      try {
        data = JSON.parse(message.slice(6))
      } catch {
        return
      }
      if (data.ev === 'state') this.onState?.(data as WebPlayerState)
      else if (data.ev === 'ready') this.onReady?.()
      else if (data.ev === 'error') this.onError?.(webErrorMessage(Number(data.code) || 0))
    })
    view.addEventListener('did-fail-load', (event) => {
      const e = event as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (e.isMainFrame && e.errorCode !== -3) this.onError?.('Không mở được trình phát web. Kiểm tra mạng và thử lại.')
    })
    view.setAttribute('src', url)
    this.view = view
    webLayer().append(view)
    startTracking()
  }

  command(name: string, args: unknown[] = []): void {
    this.view?.executeJavaScript(`window.dvdCommand && window.dvdCommand(${JSON.stringify(name)}, ${JSON.stringify(args)})`).catch(() => {})
  }

  unload(): void {
    this.view?.remove()
    this.view = null
    stopTracking()
  }
}

/** Mock mode (plain browser, screenshots): a stand-in that "plays" by itself. */
class MockPlayback implements WebPlayback {
  private el: HTMLDivElement | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private state: WebPlayerState = { t: 0, d: 0, s: -1, m: false, v: 100, r: 1, ad: false }
  onState: ((state: WebPlayerState) => void) | null = null
  onError: ((message: string) => void) | null = null
  onReady: (() => void) | null = null

  async load(videoId: string, startSeconds: number): Promise<void> {
    this.unload()
    const el = document.createElement('div')
    el.className = 'dp-webview dp-webview--mock'
    el.textContent = `YouTube • ${videoId}`
    this.el = el
    webLayer().append(el)
    startTracking()
    const duration = usePlayer.getState().current?.durationSeconds || 240
    this.state = { t: startSeconds, d: duration, s: 1, m: false, v: 100, r: 1, ad: false }
    setTimeout(() => this.onReady?.(), 300)
    this.timer = setInterval(() => {
      if (this.state.s === 1) this.state.t = Math.min(this.state.d, this.state.t + 0.25 * this.state.r)
      if (this.state.t >= this.state.d) this.state.s = 0
      this.onState?.({ ...this.state })
    }, 250)
  }

  command(name: string, args: unknown[] = []): void {
    if (name === 'playVideo') this.state.s = 1
    else if (name === 'pauseVideo') this.state.s = 2
    else if (name === 'seekTo') this.state.t = Number(args[0]) || 0
    else if (name === 'mute') this.state.m = true
    else if (name === 'unMute') this.state.m = false
    else if (name === 'setVolume') this.state.v = Number(args[0]) || 0
    else if (name === 'setPlaybackRate') this.state.r = Number(args[0]) || 1
  }

  unload(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.el?.remove()
    this.el = null
    stopTracking()
  }
}

export function createWebPlayback(): WebPlayback {
  return isElectron ? new WebviewPlayback() : new MockPlayback()
}
