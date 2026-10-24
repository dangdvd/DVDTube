// Request filter for googlevideo.com: the byte range goes into the `range=` query parameter
// instead of a `Range` header. Without custom headers the request stays a "simple" CORS
// request (no preflight, which googlevideo would reject); the main process adds the
// Access-Control-Allow-Origin header to the responses.

import type { shaka } from './shaka'

export function isGooglevideo(uri: string): boolean {
  try {
    return /(^|\.)googlevideo\.com$/i.test(new URL(uri).hostname)
  } catch {
    return false
  }
}

function withRange(uri: string, range: string): string {
  const url = new URL(uri)
  url.searchParams.set('range', range)
  return url.toString()
}

export function googlevideoRequestFilter(_type: shaka.net.NetworkingEngine.RequestType, request: shaka.extern.Request): void {
  if (!request.uris.some(isGooglevideo)) return
  const key = Object.keys(request.headers).find((k) => k.toLowerCase() === 'range')
  if (!key) return
  const match = /bytes=(\d+)-(\d*)/.exec(request.headers[key])
  delete request.headers[key]
  if (!match) return
  const range = `${match[1]}-${match[2]}`
  request.uris = request.uris.map((uri) => (isGooglevideo(uri) ? withRange(uri, range) : uri))
}
