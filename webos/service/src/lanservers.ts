// The two one-time QR servers of the TV on the local network, with the TV's wording (the
// protocols are the shared ones, see windows/src/main/core/tvlogin.ts and windows/src/main/sync.ts):
//
// - "Đăng nhập bằng điện thoại" (TCP 8765): QR `dvdtube://tv-login?h=<ip:port>&t=…&k=…&n=<name>`,
//   the phone POSTs `/pair` `{"t","n","c"}` (AES-256-GCM, AAD = token), plaintext `{"cookies":{…}}`.
// - "Đồng bộ thư viện" (TCP 8768): QR `dvdtube://sync?h=…&t=…&k=…&n=…`, the phone POSTs `/sync`
//   with its library; the merged library goes back encrypted the same way.
//
// Both: private-LAN peers only, Content-Length bodies with a size limit, single use, 10 minutes,
// stop after 20 bad attempts.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import QRCode from 'qrcode'
import type { PairingInfo, PairingStatus, SyncInfo, SyncStatus } from '../../../windows/src/shared/api'
import { parseLibraryExport, type LibraryExport } from '../../../windows/src/shared/library'
import { cookiesFrom, decode, decrypt, encode, encrypt, link, PAIR_PATH, randomBytes, sameToken } from '../../../windows/src/main/core/tvlogin'
import { failure, isLanAddress, lanInterfaces, listen, readJsonBody, sendJson } from '../../../windows/src/main/lan'

export const PAIRING_PORT = 8765
export const SYNC_PORT = 8768
const LIFETIME_MS = 10 * 60_000

export function syncLink(host: string, token: Uint8Array, key: Uint8Array, name: string): string {
  return `dvdtube://sync?h=${host}&t=${encode(token)}&k=${encode(key)}&n=${encodeURIComponent(name)}`
}

export interface QrServerOptions {
  port?: number
  /** Address in the QR code (default: the TV's private LAN IPv4). */
  address?: string
  deviceName: string
  lifetimeMs?: number
  log?: (message: string) => void
}

abstract class OneTimeServer {
  protected readonly token = randomBytes(16)
  protected readonly key = randomBytes(32)
  protected server: Server | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  protected busy = false
  protected used = false
  protected stopped = false
  private failures = 0

  constructor(protected readonly options: QrServerOptions) {}

  protected abstract defaultPort: number
  protected abstract link(host: string): string
  protected abstract onExpired(): void
  protected abstract onTooManyFailures(): void
  protected abstract respond(req: IncomingMessage): Promise<[number, unknown]>

  get deviceName(): string {
    return this.options.deviceName.trim() || 'TV'
  }

  protected async open(): Promise<{ host: string; qrText: string; qrDataUrl: string; expiresAt: number }> {
    const ip = this.options.address ?? lanInterfaces()[0]?.address
    if (!ip) throw new Error('TV chưa kết nối mạng Wi-Fi hoặc cáp mạng.')
    const server = createServer((req, res) => void this.handle(req, res))
    server.setTimeout(60_000)
    server.keepAliveTimeout = 1000
    let port: number
    try {
      port = await listen(server, this.options.port ?? this.defaultPort, '0.0.0.0')
    } catch (error) {
      throw new Error(`Không mở được cổng kết nối trên TV: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.server = server
    const host = `${ip}:${port}`
    const qrText = this.link(host)
    const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 2, width: 360 })
    const lifetime = this.options.lifetimeMs ?? LIFETIME_MS
    this.timer = setTimeout(() => {
      if (this.used || this.stopped) return
      this.onExpired()
      this.stop()
    }, lifetime)
    this.options.log?.(`${this.constructor.name}: listening on port ${port}`)
    return { host, qrText, qrDataUrl, expiresAt: Date.now() + lifetime }
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.server) {
      this.server.close()
      const s = this.server as Server & { closeAllConnections?: () => void }
      s.closeAllConnections?.()
    }
    this.server = null
  }

  get port(): number {
    const address = this.server?.address()
    return typeof address === 'object' && address ? address.port : 0
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const [status, body] = await this.respond(req)
      sendJson(res, status, body)
    } catch {
      sendJson(res, 400, failure('Yêu cầu không hợp lệ.'))
    }
  }

  protected rejected(message: string): [number, unknown] {
    this.failures++
    if (this.failures >= 20) {
      this.onTooManyFailures()
      setTimeout(() => this.stop(), 0)
    }
    return [403, failure(message)]
  }
}

// MARK: Sign in from the phone

export interface PairingCallbacks {
  /** Signs in with the phone's cookies; returns the account name or throws a Vietnamese message. */
  signIn(cookies: Record<string, string>): Promise<string>
  onStatus(status: PairingStatus): void
}

export class TvPairingServer extends OneTimeServer {
  protected defaultPort = PAIRING_PORT

  constructor(
    private readonly callbacks: PairingCallbacks,
    options: QrServerOptions,
  ) {
    super(options)
  }

  protected link(host: string): string {
    return link(host, this.token, this.key, this.deviceName)
  }

  protected onExpired(): void {
    this.callbacks.onStatus({ state: 'expired' })
  }

  protected onTooManyFailures(): void {
    this.callbacks.onStatus({ state: 'failed', message: 'Đã dừng vì có quá nhiều lần gửi sai. Hãy tạo mã mới.' })
  }

  async start(): Promise<PairingInfo> {
    const opened = await this.open()
    this.callbacks.onStatus({ state: 'waiting' })
    return { qrText: opened.qrText, qrDataUrl: opened.qrDataUrl, host: opened.host, deviceName: this.deviceName, expiresAt: opened.expiresAt }
  }

  protected async respond(req: IncomingMessage): Promise<[number, unknown]> {
    if (!isLanAddress(req.socket.remoteAddress)) return [403, failure('Chỉ thiết bị trong cùng mạng nội bộ mới đăng nhập được.')]
    const path = (req.url ?? '').split('?')[0]
    if (path !== PAIR_PATH) return [404, failure('Không có trang này.')]
    if (req.method === 'GET') return [200, { ok: true, tv: this.deviceName }]
    if (req.method !== 'POST') return [405, failure('Phương thức không được hỗ trợ.')]
    const body = await readJsonBody(req, 64 * 1024)
    if (!body.ok) return [body.status, failure(body.error)]
    if (this.busy || this.used || this.stopped) return [403, failure('TV đang xử lý một lần đăng nhập khác.')]
    const json = (body.json ?? {}) as Record<string, unknown>
    if (!sameToken(decode(json.t), this.token)) return this.rejected('Mã QR đã cũ. Hãy quét lại mã đang hiện trên TV.')
    const nonce = decode(json.n)
    const sealed = decode(json.c)
    if (!nonce || !sealed) return this.rejected('Dữ liệu không hợp lệ.')
    const plaintext = decrypt(this.key, this.token, nonce, sealed)
    if (!plaintext) return this.rejected('Không giải mã được dữ liệu đăng nhập.')
    const cookies = cookiesFrom(plaintext)
    if (!cookies) return this.rejected('Dữ liệu đăng nhập không hợp lệ.')
    this.busy = true
    let name: string
    try {
      name = await this.callbacks.signIn(cookies)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lỗi đăng nhập'
      this.callbacks.onStatus({ state: 'failed', message })
      return [400, failure(message)]
    } finally {
      this.busy = false
    }
    this.used = true
    this.options.log?.('pairing: signed in from the phone')
    this.callbacks.onStatus({ state: 'success', accountName: name })
    setTimeout(() => this.stop(), 1000)
    return [200, { ok: true, name }]
  }
}

// MARK: Library sync

export interface SyncCallbacks {
  /** Merges the phone's library into the TV's (done by the UI); the merged library and a summary. */
  merge(library: LibraryExport, device: string): Promise<{ merged: LibraryExport; summary: string }>
  onStatus(status: SyncStatus): void
}

export class TvSyncServer extends OneTimeServer {
  protected defaultPort = SYNC_PORT

  constructor(
    private readonly callbacks: SyncCallbacks,
    options: QrServerOptions,
  ) {
    super(options)
  }

  protected link(host: string): string {
    return syncLink(host, this.token, this.key, this.deviceName)
  }

  protected onExpired(): void {
    this.callbacks.onStatus({ state: 'expired' })
  }

  protected onTooManyFailures(): void {
    this.callbacks.onStatus({ state: 'failed', message: 'Đã dừng vì có quá nhiều lần gửi sai. Hãy tạo mã mới.' })
  }

  async start(): Promise<SyncInfo> {
    let opened: Awaited<ReturnType<OneTimeServer['open']>>
    try {
      opened = await this.open()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      throw new Error(message.startsWith('TV chưa') ? 'Thiết bị chưa kết nối Wi-Fi hoặc mạng nội bộ.' : 'Không mở được cổng kết nối để đồng bộ.')
    }
    this.callbacks.onStatus({ state: 'waiting' })
    return { qrText: opened.qrText, qrDataUrl: opened.qrDataUrl, host: opened.host, deviceName: this.deviceName, expiresAt: opened.expiresAt }
  }

  protected async respond(req: IncomingMessage): Promise<[number, unknown]> {
    if (!isLanAddress(req.socket.remoteAddress)) return [403, failure('Chỉ thiết bị trong cùng mạng nội bộ mới đồng bộ được.')]
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/sync') return [404, failure('Không có trang này.')]
    if (req.method === 'GET') return [200, { ok: true, name: this.deviceName }]
    if (req.method !== 'POST') return [405, failure('Phương thức không được hỗ trợ.')]
    const body = await readJsonBody(req, 16 * 1024 * 1024)
    if (!body.ok) return [body.status, failure(body.error)]
    if (this.busy || this.used || this.stopped) return [403, failure('Mã QR này đã được dùng. Hãy tạo mã mới.')]
    const json = (body.json ?? {}) as Record<string, unknown>
    if (!sameToken(decode(json.t), this.token)) return this.rejected('Mã QR đã cũ. Hãy quét lại mã đang hiển thị.')
    const nonce = decode(json.n)
    const sealed = decode(json.c)
    if (!nonce || !sealed) return this.rejected('Dữ liệu không hợp lệ.')
    const plaintext = decrypt(this.key, this.token, nonce, sealed)
    if (!plaintext) return this.rejected('Không giải mã được dữ liệu.')
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
    this.options.log?.(`sync: merged a library from another device (${summary})`)
    this.callbacks.onStatus({ state: 'success', device, summary })
    setTimeout(() => this.stop(), 1000)
    return [200, { ok: true, n: encode(reply.nonce), c: encode(reply.sealed) }]
  }
}
