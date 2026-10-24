// HTTP access for the core. The actual transport is injected by the main process (Electron
// sessions + `ses.fetch`, i.e. Chromium's network stack); outside Electron (unit tests, scripts)
// the global `fetch` is used. Adds the 15 s timeout, one retry on network failures and
// Vietnamese error messages.

import { CoreError, Errors } from './errors'

/**
 * - `auth`: the signed-in account's cookie jar (only ever used for youtube.com / google.com).
 * - `anon`: an in-memory jar that only keeps YouTube's visitor cookies (signed-out requests).
 * - `plain`: no cookies at all (third-party services, GitHub, googlevideo downloads).
 */
export type Transport = 'auth' | 'anon' | 'plain'

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  signal?: AbortSignal
}

export type Fetcher = (transport: Transport, url: string, init: FetchInit) => Promise<Response>

let fetcher: Fetcher = (_transport, url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body as RequestInit['body'], signal: init.signal })

export function setFetcher(fn: Fetcher): void {
  fetcher = fn
}

export interface RequestOptions extends FetchInit {
  transport?: Transport
  /** Whole request including the body (default 15 s). */
  timeoutMs?: number
  /** One retry when the connection fails (default true; off for non-idempotent posts). */
  retry?: boolean
}

export interface TextResponse {
  status: number
  headers: Headers
  text: string
}

export function isYouTubeOrGoogleHost(host: string): boolean {
  const h = host.toLowerCase()
  return (
    h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'google.com' || h.endsWith('.google.com')
  )
}

/** Cookies of the account must never leave youtube.com / google.com. */
export function safeTransport(url: string, transport: Transport): Transport {
  if (transport !== 'auth') return transport
  try {
    return isYouTubeOrGoogleHost(new URL(url).hostname) ? 'auth' : 'plain'
  } catch {
    return 'plain'
  }
}

function networkError(url: string): CoreError {
  try {
    return isYouTubeOrGoogleHost(new URL(url).hostname) || new URL(url).hostname.endsWith('googleapis.com')
      ? Errors.network()
      : Errors.networkOther()
  } catch {
    return Errors.networkOther()
  }
}

async function once<T>(url: string, opts: RequestOptions, read: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? 15_000
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) throw Errors.cancelled()
    opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  // Racing a rejection keeps callers from hanging even if a transport ignores the signal.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(Errors.timeout())
    }, timeoutMs)
    controller.signal.addEventListener('abort', () => {
      if (!timedOut) reject(Errors.cancelled())
    })
  })
  deadline.catch(() => {})
  try {
    const work = (async () => {
      const response = await fetcher(safeTransport(url, opts.transport ?? 'plain'), url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      })
      return read(response)
    })()
    work.catch(() => {})
    return await Promise.race([work, deadline])
  } catch (error) {
    if (error instanceof CoreError) throw error
    if (timedOut) throw Errors.timeout()
    if (opts.signal?.aborted) throw Errors.cancelled()
    throw networkError(url)
  } finally {
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

async function withRetry<T>(url: string, opts: RequestOptions, read: (response: Response) => Promise<T>): Promise<T> {
  try {
    return await once(url, opts, read)
  } catch (error) {
    const retryable = error instanceof CoreError && error.kind === 'network'
    if (!retryable || opts.retry === false) throw error
    await new Promise((resolve) => setTimeout(resolve, 600))
    return once(url, opts, read)
  }
}

/** Status, headers and the body as text. HTTP errors are returned, not thrown. */
export function requestText(url: string, opts: RequestOptions = {}): Promise<TextResponse> {
  return withRetry(url, opts, async (response) => ({
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  }))
}

/** Status, headers and the body as bytes. HTTP errors are returned, not thrown. */
export function requestBytes(
  url: string,
  opts: RequestOptions = {},
): Promise<{ status: number; headers: Headers; bytes: Uint8Array }> {
  return withRetry(url, opts, async (response) => ({
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  }))
}

/** A User-Agent of desktop Chrome matching the bundled Chromium (no "Electron" token). */
export function chromeUserAgent(chromeVersion: string, platform: string): string {
  const major = chromeVersion.split('.')[0] || '140'
  const os =
    platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}
