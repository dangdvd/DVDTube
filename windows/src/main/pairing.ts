// "Đăng nhập bằng điện thoại": a one-time HTTP endpoint on the local network that accepts the
// phone's encrypted YouTube session (port of the Android TV `TvPairingServer`; protocol in
// `core/tvlogin.ts`). Only the user-confirmed phone on the same network can use it: the QR code
// carries the token and the AES key, and the server stops after one success, 20 bad attempts or
// 10 minutes.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import QRCode from 'qrcode'
import type { PairingInfo, PairingStatus } from '@shared/api'
import { cookiesFrom, decode, decrypt, isPrivateIPv4, link, PAIR_PATH, randomBytes, sameToken } from './core/tvlogin'

export const PAIRING_PORT = 8765
const MAX_BODY = 64 * 1024
const LIFETIME_MS = 10 * 60_000

export interface PairingCallbacks {
  /** Signs in with the phone's cookies; returns the account name or throws a user-facing message. */
  signIn(cookies: Record<string, string>): Promise<string>
  onStatus(status: PairingStatus): void
  log?(message: string): void
}

export interface PairingOptions {
  port?: number
  /** Address shown in the QR code (default: this PC's LAN IPv4). */
  address?: string
  deviceName?: string
  lifetimeMs?: number
}

/** This PC's IPv4 address on the local network (private ranges only, physical adapters first). */
export function localAddress(): string | null {
  const candidates: { address: string; score: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIPv4(entry.address)) continue
      let score = 0
      if (entry.address.startsWith('169.254.')) score -= 10
      if (/vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|vbox|virbr|br-|Loopback|Bluetooth|tailscale|ZeroTier|VPN|TAP/i.test(name)) score -= 5
      if (/Wi-?Fi|WLAN|Wireless|Ethernet|en\d|eth\d|wl/i.test(name)) score += 2
      if (entry.address.startsWith('192.168.')) score += 1
      candidates.push({ address: entry.address, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.address ?? null
}

function failure(message: string): string {
  return JSON.stringify({ ok: false, error: message })
}

export class PairingServer {
  private readonly token = randomBytes(16)
  private readonly key = randomBytes(32)
  private server: Server | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private failures = 0
  private busy = false
  private signedIn = false
  private stopped = false
  readonly deviceName: string

  constructor(
    private readonly callbacks: PairingCallbacks,
    private readonly options: PairingOptions = {},
  ) {
    this.deviceName = (options.deviceName ?? hostname()).trim() || 'Máy tính'
  }

  async start(): Promise<PairingInfo> {
    const ip = this.options.address ?? localAddress()
    if (!ip) throw new Error('Máy tính chưa kết nối mạng Wi-Fi hoặc cáp mạng.')
    const server = createServer((req, res) => void this.handle(req, res))
    server.requestTimeout = 10_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 1000
    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        server.once('error', onError)
        server.listen(port, '0.0.0.0', () => {
          server.off('error', onError)
          resolve()
        })
      })
    try {
      await listen(this.options.port ?? PAIRING_PORT)
    } catch {
      try {
        await listen(0)
      } catch (error) {
        throw new Error(`Không mở được cổng kết nối trên máy tính: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.server = server
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : PAIRING_PORT
    const host = `${ip}:${port}`
    const qrText = link(host, this.token, this.key, this.deviceName)
    const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 2, width: 360 })
    const lifetime = this.options.lifetimeMs ?? LIFETIME_MS
    this.timer = setTimeout(() => {
      if (this.signedIn || this.stopped) return
      this.callbacks.onStatus({ state: 'expired' })
      this.stop()
    }, lifetime)
    this.callbacks.log?.(`pairing: listening on port ${port}`)
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

  private send(res: ServerResponse, status: number, body: string): void {
    const bytes = Buffer.from(body, 'utf8')
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': bytes.length,
      Connection: 'close',
    })
    res.end(bytes)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const [status, body] = await this.respond(req)
      this.send(res, status, body)
    } catch {
      this.send(res, 400, failure('Yêu cầu không hợp lệ.'))
    }
  }

  private readBody(req: IncomingMessage, length: number): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > length) {
          req.destroy()
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(size === length ? Buffer.concat(chunks) : null))
      req.on('error', () => resolve(null))
      req.on('aborted', () => resolve(null))
    })
  }

  private async respond(req: IncomingMessage): Promise<[number, string]> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== PAIR_PATH) return [404, failure('Không có trang này.')]
    if (req.method === 'GET') return [200, JSON.stringify({ ok: true, tv: this.deviceName })]
    if (req.method !== 'POST') return [405, failure('Phương thức không được hỗ trợ.')]

    const header = req.headers['content-length']
    const length = header !== undefined && /^\d+$/.test(header) ? parseInt(header, 10) : null
    if (length === null) return [400, failure('Thiếu Content-Length.')]
    if (length <= 0 || length > MAX_BODY) return [413, failure('Dữ liệu quá lớn.')]
    const body = await this.readBody(req, length)
    if (!body) return [400, failure('Dữ liệu bị cắt ngang.')]

    if (this.busy || this.signedIn || this.stopped) return [403, failure('Máy tính đang xử lý một lần đăng nhập khác.')]
    let json: Record<string, unknown>
    try {
      json = JSON.parse(body.toString('utf8')) as Record<string, unknown>
      if (typeof json !== 'object' || json === null) throw new Error()
    } catch {
      return [400, failure('Dữ liệu không hợp lệ.')]
    }
    const sentToken = decode(json.t)
    const nonce = decode(json.n)
    const sealed = decode(json.c)
    if (!sameToken(sentToken, this.token)) return this.rejected('Mã QR đã cũ. Hãy quét lại mã đang hiện trên máy tính.')
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
    this.signedIn = true
    this.callbacks.log?.('pairing: signed in from the phone')
    this.callbacks.onStatus({ state: 'success', accountName: name })
    // The code is single-use: stop listening once the reply is out.
    setTimeout(() => this.stop(), 1000)
    return [200, JSON.stringify({ ok: true, name })]
  }

  /** Too many bad attempts close the endpoint (someone else on the network guessing). */
  private rejected(message: string): [number, string] {
    this.failures++
    if (this.failures >= 20) {
      this.callbacks.onStatus({ state: 'failed', message: 'Đã dừng vì có quá nhiều lần gửi sai. Hãy tạo mã mới.' })
      setTimeout(() => this.stop(), 0)
    }
    return [403, failure(message)]
  }
}
