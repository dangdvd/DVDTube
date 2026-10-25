// "Đồng bộ thư viện" over the local network, receiving side: this computer shows a QR code
// `dvdtube://sync?h=<ip>:<port>&t=<token>&k=<key>&n=<name>` (16-byte token, 32-byte AES key,
// port 8768 or a free one, private LAN IPv4, 10 minutes, single use). The phone that scans it
// POSTs `/sync` with `{"t","n","c"}` exactly like the TV sign-in (AES-256-GCM, 12-byte nonce,
// AAD = raw token, ciphertext‖tag, base64url without padding); the plaintext is its library.
// We merge it, save, and answer `{"ok":true,"n","c"}` with the MERGED library encrypted the same
// way, so both devices end up equal.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import QRCode from 'qrcode'
import type { SyncInfo, SyncStatus } from '@shared/api'
import { parseLibraryExport, type LibraryExport } from '@shared/library'
import { decode, decrypt, encode, encrypt, randomBytes, sameToken } from './core/tvlogin'
import { deviceName, failure, isLanAddress, lanInterfaces, listen, readJsonBody, sendJson } from './lan'

export const SYNC_PORT = 8768
export const SYNC_PATH = '/sync'
const MAX_BODY = 16 * 1024 * 1024
const LIFETIME_MS = 10 * 60_000

export function syncLink(host: string, token: Uint8Array, key: Uint8Array, name: string): string {
  return `dvdtube://sync?h=${host}&t=${encode(token)}&k=${encode(key)}&n=${encodeURIComponent(name)}`
}

export interface SyncCallbacks {
  /** Merges the phone's library into ours; resolves with the merged library and a summary. */
  merge(library: LibraryExport, device: string): Promise<{ merged: LibraryExport; summary: string }>
  onStatus(status: SyncStatus): void
  log?(message: string): void
}

export interface SyncOptions {
  port?: number
  address?: string
  deviceName?: string
  lifetimeMs?: number
}

export class SyncServer {
  private readonly token = randomBytes(16)
  private readonly key = randomBytes(32)
  private server: Server | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  private used = false
  private stopped = false
  private failures = 0
  readonly deviceName: string

  constructor(
    private readonly callbacks: SyncCallbacks,
    private readonly options: SyncOptions = {},
  ) {
    this.deviceName = (options.deviceName ?? deviceName()).trim() || 'Máy tính'
  }

  async start(): Promise<SyncInfo> {
    const ip = this.options.address ?? lanInterfaces()[0]?.address
    if (!ip) throw new Error('Máy tính chưa kết nối mạng Wi-Fi hoặc cáp mạng.')
    const server = createServer((req, res) => void this.handle(req, res))
    server.requestTimeout = 60_000
    server.headersTimeout = 10_000
    let port: number
    try {
      port = await listen(server, this.options.port ?? SYNC_PORT, '0.0.0.0')
    } catch (error) {
      throw new Error(`Không mở được cổng kết nối trên máy tính: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.server = server
    const host = `${ip}:${port}`
    const qrText = syncLink(host, this.token, this.key, this.deviceName)
    const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 2, width: 360 })
    const lifetime = this.options.lifetimeMs ?? LIFETIME_MS
    this.timer = setTimeout(() => {
      if (this.used || this.stopped) return
      this.callbacks.onStatus({ state: 'expired' })
      this.stop()
    }, lifetime)
    this.callbacks.log?.(`sync: listening on port ${port}`)
    this.callbacks.onStatus({ state: 'waiting' })
    return { qrText, qrDataUrl, host, deviceName: this.deviceName, expiresAt: Date.now() + lifetime }
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.server) {
      this.server.close()
      this.server.closeAllConnections?.()
    }
    this.server = null
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
    if (!isLanAddress(req.socket.remoteAddress)) return [403, failure('Chỉ thiết bị trong cùng mạng nội bộ mới đồng bộ được.')]
    const path = (req.url ?? '').split('?')[0]
    if (path !== SYNC_PATH) return [404, failure('Không có trang này.')]
    if (req.method === 'GET') return [200, { ok: true, name: this.deviceName }]
    if (req.method !== 'POST') return [405, failure('Phương thức không được hỗ trợ.')]
    const body = await readJsonBody(req, MAX_BODY)
    if (!body.ok) return [body.status, failure(body.error)]
    if (this.busy || this.used || this.stopped) return [403, failure('Mã QR này đã được dùng. Hãy tạo mã mới trên máy tính.')]

    const json = (body.json ?? {}) as Record<string, unknown>
    if (!sameToken(decode(json.t), this.token)) return this.rejected('Mã QR đã cũ. Hãy quét lại mã đang hiện trên máy tính.')
    const nonce = decode(json.n)
    const sealed = decode(json.c)
    if (!nonce || !sealed) return this.rejected('Dữ liệu không hợp lệ.')
    const plaintext = decrypt(this.key, this.token, nonce, sealed)
    if (!plaintext) return this.rejected('Không giải mã được dữ liệu đồng bộ.')
    let library: LibraryExport | null = null
    try {
      library = parseLibraryExport(JSON.parse(plaintext.toString('utf8')))
    } catch {
      library = null
    }
    if (!library) return this.rejected('Dữ liệu thư viện không hợp lệ.')

    this.busy = true
    const device = library.device || 'thiết bị khác'
    this.callbacks.onStatus({ state: 'merging', device })
    let merged: LibraryExport
    let summary: string
    try {
      ;({ merged, summary } = await this.callbacks.merge(library, device))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không gộp được thư viện.'
      this.callbacks.onStatus({ state: 'failed', message })
      return [500, failure(message)]
    } finally {
      this.busy = false
    }
    this.used = true
    const reply = encrypt(this.key, this.token, Buffer.from(JSON.stringify(merged), 'utf8'))
    this.callbacks.log?.(`sync: merged a library from another device (${summary})`)
    this.callbacks.onStatus({ state: 'success', device, summary })
    setTimeout(() => this.stop(), 1000)
    return [200, { ok: true, n: encode(reply.nonce), c: encode(reply.sealed) }]
  }

  private rejected(message: string): [number, unknown] {
    this.failures++
    if (this.failures >= 20) {
      this.callbacks.onStatus({ state: 'failed', message: 'Đã dừng vì có quá nhiều lần gửi sai. Hãy tạo mã mới.' })
      setTimeout(() => this.stop(), 0)
    }
    return [403, failure(message)]
  }
}
