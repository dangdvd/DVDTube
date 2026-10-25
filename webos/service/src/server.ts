// The service's local HTTP server (127.0.0.1 only): the JSON API of the TV interface, its event
// long-poll, and the stream relay. The interface is a `file://` page, so every answer carries
// CORS headers; calls are "simple" requests (POST text/plain), so there is no preflight.
// Every request must carry the random token of this service run (`t` in the body / `k` in the
// relay URLs), so other pages and apps on the TV cannot use the account through it.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { debug } from '../../../windows/src/main/core/config'
import { describeError } from '../../../windows/src/main/core/errors'
import type { ApiMethod } from './api'
import type { EventBus } from './events'
import { corsHeaders, serveRelay, type RelayContext, type RelayKind } from './hls'

export const API_PORT = 8770
const MAX_BODY = 24 * 1024 * 1024

export interface LocalServerOptions {
  port?: number
  host?: string
  token: string
  version: string
  events: EventBus
  relay: RelayContext
  methods: Record<string, ApiMethod>
}

function send(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        finish(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
    req.on('aborted', () => finish(null))
  })
}

const RELAY_ROUTES: Record<string, RelayKind> = {
  '/hls/master.m3u8': 'master',
  '/hls/playlist.m3u8': 'playlist',
  '/hls/segment': 'segment',
  '/media': 'media',
}

/** Calls whose arguments may hold personal data are not named in the log. */
const QUIET = new Set(['castReceiverStatus', 'log', 'setSession', 'exportSession', 'syncReply', 'diagnostics'])

export class LocalServer {
  private server: Server | null = null
  private boundPort = 0

  constructor(private readonly options: LocalServerOptions) {}

  get port(): number {
    return this.boundPort
  }

  start(): Promise<number> {
    if (this.server) return Promise.resolve(this.boundPort)
    const server = createServer((req, res) => void this.handle(req, res))
    server.keepAliveTimeout = 30_000
    server.setTimeout(0)
    const host = this.options.host ?? '127.0.0.1'
    const tryListen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.removeListener('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, host)
      })
    const preferred = this.options.port ?? API_PORT
    return tryListen(preferred)
      .catch(() => tryListen(0))
      .then(() => {
        const address = server.address()
        this.boundPort = typeof address === 'object' && address ? address.port : preferred
        this.server = server
        this.options.relay.port = this.boundPort
        debug(`local server: listening on ${host}:${this.boundPort}`)
        return this.boundPort
      })
  }

  stop(): void {
    this.options.events.close()
    if (!this.server) return
    this.server.close()
    const s = this.server as Server & { closeAllConnections?: () => void }
    s.closeAllConnections?.()
    this.server = null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = req.url ?? '/'
    const q = raw.indexOf('?')
    const path = q >= 0 ? raw.slice(0, q) : raw
    const query = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '')
    const method = req.method ?? 'GET'
    try {
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          ...corsHeaders(),
          'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': String(req.headers['access-control-request-headers'] ?? 'Content-Type, Range'),
          'Access-Control-Allow-Private-Network': 'true',
          'Access-Control-Max-Age': '86400',
        })
        res.end()
        return
      }
      if (path === '/health') {
        send(res, 200, { ok: true, app: 'DVDTube', version: this.options.version })
        return
      }
      const relay = RELAY_ROUTES[path]
      if (relay) {
        if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.' })
        if (query.get('k') !== this.options.token) return send(res, 403, { ok: false, error: 'Không có quyền truy cập.' })
        await serveRelay(this.options.relay, relay, query, req, res)
        return
      }
      if (path === '/api/events') {
        if (query.get('t') !== this.options.token) return send(res, 403, { ok: false, error: 'Không có quyền truy cập.' })
        const after = parseInt(query.get('after') ?? '0', 10) || 0
        const wait = Math.min(Math.max(parseInt(query.get('wait') ?? '25000', 10) || 0, 0), 30_000)
        let closed = false
        req.on('close', () => {
          closed = true
        })
        const events = await this.options.events.wait(after, wait)
        if (closed) return
        send(res, 200, { ok: true, last: this.options.events.lastSeq, events })
        return
      }
      if (path === '/api/call') {
        if (method !== 'POST') return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.' })
        const name = query.get('m') ?? ''
        const text = await readBody(req, MAX_BODY)
        if (text === null) return send(res, 413, { ok: false, error: 'Dữ liệu quá lớn.' })
        let body: { t?: unknown; args?: unknown }
        try {
          body = JSON.parse(text || '{}')
        } catch {
          return send(res, 400, { ok: false, error: 'Dữ liệu JSON không hợp lệ.' })
        }
        if (body.t !== this.options.token) return send(res, 403, { ok: false, error: 'Không có quyền truy cập.' })
        const fn = Object.prototype.hasOwnProperty.call(this.options.methods, name) ? this.options.methods[name] : undefined
        if (!fn) return send(res, 404, { ok: false, error: 'Không có chức năng này.' })
        const args = Array.isArray(body.args) ? body.args : []
        try {
          const result = await fn(...args)
          send(res, 200, { ok: true, result: result === undefined ? null : result })
        } catch (error) {
          const message = describeError(error)
          if (!QUIET.has(name)) debug(`api ${name} failed: ${message}`)
          const kind = (error as { kind?: string }).kind
          send(res, 200, { ok: false, error: message, kind: typeof kind === 'string' ? kind : null })
        }
        return
      }
      send(res, 404, { ok: false, error: 'Không có trang này.' })
    } catch (error) {
      debug(`local server: ${describeError(error)}`)
      if (!res.headersSent) send(res, 500, { ok: false, error: 'Lỗi máy chủ nội bộ.' })
      else res.destroy()
    }
  }
}
