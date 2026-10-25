// Helpers of the small JSON servers this computer runs on the local network (cast receiver,
// library sync): only private / loopback peers, Content-Length bodies with a size limit, UTF-8
// JSON answers `{"ok":true,…}` / `{"ok":false,"error":"<Vietnamese>"}`.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { isPrivateIPv4 } from './core/tvlogin'
import { readJsonSync, userDataFile, writeJson } from './store'

/** IPv4 (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8) or IPv6 (::1, fc00::/7, fe80::/10). */
export function isLanAddress(address: string | undefined | null): boolean {
  if (!address) return false
  let a = address.trim().toLowerCase()
  if (a.startsWith('::ffff:') && a.includes('.')) a = a.slice(7)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return isPrivateIPv4(a) || a.startsWith('127.')
  if (a === '::1') return true
  const zone = a.indexOf('%')
  if (zone >= 0) a = a.slice(0, zone)
  const first = a.split(':')[0]
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false
  const value = parseInt(first, 16)
  return (value & 0xfe00) === 0xfc00 || (value & 0xffc0) === 0xfe80
}

export function jsonBody(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = jsonBody(value)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
  res.end(body)
}

export function failure(message: string): { ok: false; error: string } {
  return { ok: false, error: message }
}

export type BodyResult = { ok: true; json: unknown } | { ok: false; status: number; error: string }

/** Reads a JSON request body; `Content-Length` is required and at most `maxBytes`. */
export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  const header = req.headers['content-length']
  const length = header !== undefined && /^\d+$/.test(header) ? parseInt(header, 10) : null
  if (length === null) return Promise.resolve({ ok: false, status: 411, error: 'Thiếu Content-Length.' })
  if (length > maxBytes) return Promise.resolve({ ok: false, status: 413, error: 'Dữ liệu quá lớn.' })
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (result: BodyResult) => {
      if (done) return
      done = true
      resolve(result)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > length) {
        finish({ ok: false, status: 400, error: 'Dữ liệu không khớp Content-Length.' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size !== length) return finish({ ok: false, status: 400, error: 'Dữ liệu bị cắt ngang.' })
      if (length === 0) return finish({ ok: true, json: {} })
      try {
        finish({ ok: true, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        finish({ ok: false, status: 400, error: 'Dữ liệu JSON không hợp lệ.' })
      }
    })
    req.on('error', () => finish({ ok: false, status: 400, error: 'Dữ liệu bị cắt ngang.' }))
    req.on('aborted', () => finish({ ok: false, status: 400, error: 'Dữ liệu bị cắt ngang.' }))
  })
}

/** Listens on `port` (all interfaces), or on any free port when it is busy; returns the port. */
export function listen(server: Server, port: number, host?: string): Promise<number> {
  const attempt = (p: number) =>
    new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      server.once('error', onError)
      const ready = () => {
        server.off('error', onError)
        resolve()
      }
      if (host) server.listen(p, host, ready)
      else server.listen(p, ready)
    })
  return attempt(port)
    .catch(() => attempt(0))
    .then(() => {
      const address = server.address()
      return typeof address === 'object' && address ? address.port : port
    })
}

/** This computer's name as phones and TVs show it ("DESKTOP-ABC", "MacBook-Pro"). */
export function deviceName(): string {
  const name = hostname().replace(/\.local$/i, '').trim()
  return name || 'Máy tính'
}

let cachedId: string | null = null

/** Stable random id of this computer for the cast / sync protocols (not tied to any account). */
export function deviceId(): string {
  if (cachedId) return cachedId
  const file = userDataFile('device.json')
  const saved = readJsonSync<{ id?: string }>(file)
  if (saved?.id && /^[0-9a-f-]{36}$/i.test(saved.id)) {
    cachedId = saved.id
  } else {
    cachedId = randomUUID()
    void writeJson(file, { id: cachedId }).catch(() => {})
  }
  return cachedId
}

export interface LocalInterface {
  name: string
  address: string
  netmask: string
}

/** Private IPv4 addresses of this computer (physical adapters first). */
export function lanInterfaces(): LocalInterface[] {
  const list: (LocalInterface & { score: number })[] = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIPv4(entry.address)) continue
      let score = 0
      if (entry.address.startsWith('169.254.')) score -= 10
      if (/vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|vbox|virbr|br-|Loopback|Bluetooth|tailscale|ZeroTier|VPN|TAP|utun/i.test(name)) score -= 5
      if (/Wi-?Fi|WLAN|Wireless|Ethernet|en\d|eth\d|wl/i.test(name)) score += 2
      if (entry.address.startsWith('192.168.')) score += 1
      list.push({ name, address: entry.address, netmask: entry.netmask, score })
    }
  }
  return list.sort((a, b) => b.score - a.score).map(({ name, address, netmask }) => ({ name, address, netmask }))
}

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((n, part) => ((n << 8) | (parseInt(part, 10) & 255)) >>> 0, 0)
}

export function sameSubnet(a: string, b: string, netmask: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+\.\d+$/.test(b)) return false
  const mask = ipv4ToInt(netmask)
  return (ipv4ToInt(a) & mask) === (ipv4ToInt(b) & mask)
}
