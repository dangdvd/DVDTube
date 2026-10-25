// Region / language and other values the networking layer needs (pushed by the renderer with
// `configure()`), plus a pluggable debug logger so the core stays free of Electron imports.

export interface CoreState {
  hl: string
  gl: string
  incognito: boolean
  remoteConfigUrl: string
  /** Parental controls: `lockedSafetyMode` and no content-check bypass. */
  restrictedMode: boolean
}

export const coreState: CoreState = {
  hl: 'vi',
  gl: 'VN',
  incognito: false,
  remoteConfigUrl: '',
  restrictedMode: false,
}

type Logger = (message: string) => void

let logger: Logger = () => {}

export function setCoreLogger(fn: Logger): void {
  logger = fn
}

/** Endpoints, HTTP status codes and errors only — never cookies, auth headers or account data. */
export function debug(message: string): void {
  logger(message)
}

export function isVietnamese(): boolean {
  return coreState.hl === 'vi'
}
