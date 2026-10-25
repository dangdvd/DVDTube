// "Cho phép truyền video tới máy tính này": the DVDTube cast receiver (protocol 1, shared with the
// Android TV app). HTTP/1.1 JSON API on TCP 8766 (or any free port), only for private / loopback
// peers. Senders only send video ids and remote-control commands; this computer fetches the
// streams itself. No cookies or account data are ever sent or accepted.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { cleanVideoItem, type CastAction, type CastCommand, type CastPlayRequest, type CastStatus, type VideoItem } from '@shared/models'
import { failure, isLanAddress, listen, readJsonBody, sendJson } from '../lan'

export const CAST_PORT = 8766
export const CAST_PROTOCOL = 1
const MAX_BODY = 256 * 1024
const MAX_QUEUE = 500

export const CAST_ACTIONS: CastAction[] = ['play', 'pause', 'toggle', 'seek', 'skip', 'next', 'previous', 'stop', 'volume', 'mute']

export interface ReceiverIdentity {
  id: string
  name: string
  kind: 'tv' | 'desktop'
  version: string
}

export interface ReceiverCallbacks {
  onCommand(command: CastCommand): void
  status(): CastStatus
  log?(message: string): void
}

export const IDLE_STATUS: CastStatus = {
  state: 'idle',
  video: null,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  queue: [],
  index: 0,
  error: null,
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function shortText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

/** Validates a `POST /api/play` body; null when the video is missing or invalid. */
export function parsePlayRequest(json: unknown): CastPlayRequest | null {
  if (typeof json !== 'object' || json === null) return null
  const body = json as Record<string, unknown>
  const video = cleanVideoItem(body.video)
  if (!video) return null
  let queue: VideoItem[] | null = null
  if (Array.isArray(body.queue)) {
    queue = body.queue
      .slice(0, MAX_QUEUE)
      .map(cleanVideoItem)
      .filter((v): v is VideoItem => v !== null)
  }
  const index = finite(body.index)
  const start = finite(body.startSeconds)
  const playlistId = shortText(body.playlistId, 200)
  return {
    video,
    startSeconds: start !== null && start > 0 ? start : null,
    queue: queue && queue.length ? queue : null,
    index: index !== null && queue && index >= 0 && index < queue.length ? Math.floor(index) : null,
    playlistId: playlistId && /^[A-Za-z0-9_-]+$/.test(playlistId) ? playlistId : null,
    sender: shortText(body.sender, 100),
  }
}

export function parseControl(json: unknown): { action: CastAction; value: number | null } | null {
  if (typeof json !== 'object' || json === null) return null
  const body = json as Record<string, unknown>
  const action = body.action
  if (typeof action !== 'string' || !CAST_ACTIONS.includes(action as CastAction)) return null
  let value = finite(body.value)
  if (action === 'volume') value = value === null ? null : Math.min(1, Math.max(0, value))
  if (action === 'seek' && value !== null) value = Math.max(0, value)
  if ((action === 'seek' || action === 'skip' || action === 'volume') && value === null) return null
  return { action: action as CastAction, value }
}

export class CastReceiver {
  private server: Server | null = null
  private boundPort = 0

  constructor(
    private readonly identity: ReceiverIdentity,
    private readonly callbacks: ReceiverCallbacks,
    private readonly preferredPort = CAST_PORT,
  ) {}

  get port(): number {
    return this.boundPort
  }

  get running(): boolean {
    return this.server !== null
  }

  async start(): Promise<number> {
    if (this.server) return this.boundPort
    const server = createServer((req, res) => void this.handle(req, res))
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5000
    // Without a host: IPv6 + IPv4 where available (peers may use fe80:: / fc00:: addresses).
    this.boundPort = await listen(server, this.preferredPort)
    this.server = server
    this.callbacks.log?.(`cast receiver: listening on port ${this.boundPort}`)
    return this.boundPort
  }

  stop(): void {
    if (!this.server) return
    this.server.close()
    this.server.closeAllConnections?.()
    this.server = null
    this.callbacks.log?.('cast receiver: stopped')
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const [status, body] = await this.respond(req)
      sendJson(res, status, body)
    } catch {
      sendJson(res, 400, failure('Yêu cầu không hợp lệ.'))
    }
  }

  private async respond(req: IncomingMessage): Promise<[number, unknown]> {
    if (!isLanAddress(req.socket.remoteAddress)) {
      return [403, failure('Chỉ thiết bị trong cùng mạng nội bộ mới điều khiển được máy tính này.')]
    }
    const path = (req.url ?? '').split('?')[0]
    const method = req.method ?? 'GET'
    const routes: Record<string, string> = {
      '/api/info': 'GET',
      '/api/status': 'GET',
      '/api/play': 'POST',
      '/api/queue': 'POST',
      '/api/control': 'POST',
    }
    const expected = routes[path]
    if (!expected) return [404, failure('Không có trang này.')]
    if (method !== expected) return [405, failure('Phương thức không được hỗ trợ.')]

    if (path === '/api/info') {
      const { id, name, kind, version } = this.identity
      return [200, { ok: true, app: 'DVDTube', protocol: CAST_PROTOCOL, id, name, kind, version }]
    }
    if (path === '/api/status') {
      return [200, { ok: true, ...this.callbacks.status() }]
    }

    const body = await readJsonBody(req, MAX_BODY)
    if (!body.ok) return [body.status, failure(body.error)]

    if (path === '/api/play') {
      const request = parsePlayRequest(body.json)
      if (!request) return [400, failure('Video không hợp lệ.')]
      this.callbacks.log?.(`cast receiver: play ${request.video.id}${request.queue ? ` (queue of ${request.queue.length})` : ''}`)
      this.callbacks.onCommand({ type: 'play', request })
      return [200, { ok: true }]
    }
    if (path === '/api/queue') {
      const json = body.json as Record<string, unknown> | null
      const video = cleanVideoItem(json?.video)
      if (!video) return [400, failure('Video không hợp lệ.')]
      this.callbacks.onCommand({ type: 'queue', video, next: json?.next === true })
      return [200, { ok: true }]
    }
    const control = parseControl(body.json)
    if (!control) return [400, failure('Lệnh điều khiển không hợp lệ.')]
    this.callbacks.onCommand({ type: 'control', action: control.action, value: control.value })
    return [200, { ok: true }]
  }
}

/** Validates the status the renderer reports (it is answered to other devices as is). */
export function cleanStatus(value: unknown): CastStatus {
  if (typeof value !== 'object' || value === null) return IDLE_STATUS
  const s = value as Record<string, unknown>
  const states: CastStatus['state'][] = ['idle', 'loading', 'playing', 'paused', 'buffering', 'ended', 'error']
  const queue = Array.isArray(s.queue) ? s.queue.slice(0, MAX_QUEUE).map(cleanVideoItem).filter((v): v is VideoItem => v !== null) : []
  const num = (key: string, fallback = 0) => finite(s[key]) ?? fallback
  return {
    state: states.includes(s.state as CastStatus['state']) ? (s.state as CastStatus['state']) : 'idle',
    video: cleanVideoItem(s.video),
    position: Math.max(0, num('position')),
    duration: Math.max(0, num('duration')),
    volume: Math.min(1, Math.max(0, num('volume', 1))),
    muted: s.muted === true,
    queue,
    index: Math.max(0, Math.floor(num('index'))),
    error: typeof s.error === 'string' ? s.error.slice(0, 500) : null,
  }
}
