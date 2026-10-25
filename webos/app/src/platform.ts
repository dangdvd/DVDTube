// webOS TV integration of the web app: luna calls through PalmServiceBridge (what webOSTV.js'
// `webOS.service.request` does), launch / relaunch parameters, leaving the app, the Magic
// Remote pointer and the remote's key codes.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 461,
  ESCAPE: 27,
  BACKSPACE: 8,
  PLAY: 415,
  PAUSE: 19,
  PLAY_PAUSE: 10252,
  STOP: 413,
  REWIND: 412,
  FAST_FORWARD: 417,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  CHANNEL_UP: 33,
  CHANNEL_DOWN: 34,
  SPACE: 32,
} as const

export function isBackKey(event: KeyboardEvent): boolean {
  return event.keyCode === KEY.BACK || event.keyCode === KEY.ESCAPE || (event.keyCode === KEY.BACKSPACE && !isTyping())
}

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

const w = window as any

export function isWebOS(): boolean {
  return typeof w.PalmServiceBridge === 'function' || typeof w.PalmServiceBridge === 'object'
}

export interface LunaHandle {
  cancel(): void
}

/**
 * One luna call. `onResponse` gets every answer (a subscription keeps answering); for a plain
 * call the bridge is released after the first answer.
 */
export function lunaCall(uri: string, params: Record<string, unknown>, onResponse: (payload: Record<string, any>) => void): LunaHandle {
  const Bridge = w.PalmServiceBridge
  if (!Bridge) {
    setTimeout(() => onResponse({ returnValue: false, errorCode: -1, errorText: 'PalmServiceBridge not found.' }), 0)
    return { cancel() {} }
  }
  let bridge: any = new Bridge()
  const subscribe = params.subscribe === true
  bridge.onservicecallback = (text: string) => {
    let payload: Record<string, any>
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { returnValue: false, errorCode: -1, errorText: String(text) }
    }
    try {
      onResponse(payload)
    } finally {
      if (!subscribe && bridge) {
        try {
          bridge.cancel()
        } catch {
          // already released
        }
        bridge = null
      }
    }
  }
  bridge.call(uri, JSON.stringify(params))
  return {
    cancel() {
      if (!bridge) return
      try {
        bridge.cancel()
      } catch {
        // ignore
      }
      bridge = null
    },
  }
}

export function lunaRequest(uri: string, params: Record<string, unknown> = {}, timeoutMs = 8000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      handle.cancel()
      reject(new Error('timeout'))
    }, timeoutMs)
    const handle = lunaCall(uri, params, (payload) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (payload.returnValue === false) reject(new Error(String(payload.errorText ?? 'luna error')))
      else resolve(payload)
    })
  })
}

// MARK: Launch parameters

export type LaunchParams = Record<string, unknown>

export function launchParams(): LaunchParams {
  const raw = w.launchParams ?? w.PalmSystem?.launchParams
  if (!raw) return {}
  if (typeof raw === 'object') return raw as LaunchParams
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** `handlesRelaunch`: the system sends `webOSRelaunch` instead of reloading the page. */
export function onRelaunch(handler: (params: LaunchParams) => void): void {
  document.addEventListener(
    'webOSRelaunch',
    (event: Event) => {
      const detail = (event as CustomEvent).detail
      let params: LaunchParams = {}
      if (detail && typeof detail === 'object') params = detail as LaunchParams
      else if (typeof detail === 'string') {
        try {
          params = JSON.parse(detail)
        } catch {
          params = {}
        }
      } else params = launchParams()
      try {
        w.PalmSystem?.activate?.()
      } catch {
        // older firmware
      }
      handler(params)
    },
    true,
  )
}

// MARK: Leaving

/** "Thoát DVDTube?" → Có: closes the app (webOS keeps nothing running). */
export function exitApp(): void {
  try {
    window.close()
  } catch {
    // ignore
  }
  // Some firmware ignores window.close() for packaged apps: hand the Back key to the system.
  setTimeout(() => {
    try {
      w.PalmSystem?.platformBack?.()
    } catch {
      // ignore
    }
  }, 300)
}

// MARK: Device

export interface DeviceInfo {
  modelName: string | null
  platformVersion: string | null
  deviceName: string | null
}

export async function deviceInfo(): Promise<DeviceInfo> {
  const info: DeviceInfo = { modelName: null, platformVersion: null, deviceName: null }
  try {
    const raw = w.PalmSystem?.deviceInfo
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (parsed && typeof parsed === 'object') {
      info.modelName = typeof parsed.modelName === 'string' ? parsed.modelName : null
      info.platformVersion = typeof parsed.platformVersion === 'string' ? parsed.platformVersion : null
    }
  } catch {
    // ignore
  }
  if (!isWebOS()) return info
  try {
    const sys = await lunaRequest('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'sdkVersion'] }, 3000)
    if (typeof sys.modelName === 'string') info.modelName = sys.modelName
    if (typeof sys.sdkVersion === 'string' && !info.platformVersion) info.platformVersion = sys.sdkVersion
  } catch {
    // not allowed on this firmware
  }
  try {
    const net = await lunaRequest('luna://com.webos.settingsservice/getSystemSettings', { category: 'network', keys: ['deviceName'] }, 3000)
    const name = net.settings?.deviceName
    if (typeof name === 'string' && name.trim()) info.deviceName = name.trim()
  } catch {
    // not allowed on this firmware
  }
  return info
}

// MARK: Magic Remote pointer

let pointerVisible = false
const pointerListeners: ((visible: boolean) => void)[] = []

export function isPointerVisible(): boolean {
  return pointerVisible
}

export function onPointerChange(listener: (visible: boolean) => void): () => void {
  pointerListeners.push(listener)
  return () => {
    const i = pointerListeners.indexOf(listener)
    if (i >= 0) pointerListeners.splice(i, 1)
  }
}

function setPointer(visible: boolean): void {
  if (visible === pointerVisible) return
  pointerVisible = visible
  document.documentElement.classList.toggle('pointer', visible)
  for (const l of pointerListeners.slice()) l(visible)
}

export function initPointer(): void {
  // webOS: the Magic Remote's cursor appears / hides (it hides when an arrow key is pressed).
  document.addEventListener('cursorStateChange', (event: Event) => {
    const detail = (event as CustomEvent).detail
    setPointer(!!(detail && detail.visibility))
  })
  let lastX = -1
  let lastY = -1
  document.addEventListener(
    'mousemove',
    (event) => {
      if (Math.abs(event.screenX - lastX) + Math.abs(event.screenY - lastY) < 2) return
      lastX = event.screenX
      lastY = event.screenY
      setPointer(true)
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.keyCode >= 37 && event.keyCode <= 40) setPointer(false)
    },
    true,
  )
}

/** The on-screen keyboard opened / closed (webOS `keyboardStateChange`). */
export function onKeyboardChange(listener: (visible: boolean) => void): void {
  document.addEventListener('keyboardStateChange', (event: Event) => {
    const detail = (event as CustomEvent).detail
    listener(!!(detail && detail.visibility))
  })
}
