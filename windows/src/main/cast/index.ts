// "Truyền tới DVDTube" on the desktop: the receiver (HTTP API + DNS-SD advertisement, when
// "Cho phép truyền video tới máy tính này" is on) and the sender side (discovery of TVs / PCs
// advertising `_dvdtube._tcp`, receivers added by IP, the HTTP calls of the remote control).

import { request } from 'node:http'
import type { CastAction, CastCommand, CastDevice, CastDeviceKind, CastPlayRequest, CastStatus, VideoItem } from '@shared/models'
import { cleanVideoItem } from '@shared/models'
import { deviceId, deviceName, isLanAddress } from '../lan'
import { readJsonSync, userDataFile, writeJson } from '../store'
import { Mdns, pickAddress, type FoundService } from './mdns'
import { CAST_PORT, CastReceiver, IDLE_STATUS, cleanStatus } from './receiver'

export const SERVICE_TYPE = '_dvdtube._tcp'

export interface CastHost {
  version: string
  onCommand(command: CastCommand): void
  onDevices(devices: CastDevice[]): void
  log(message: string): void
}

// MARK: HTTP client (sender)

function validHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isLanAddress(host)
}

/** One JSON call to a receiver; throws a Vietnamese message. */
export function callReceiver(host: string, port: number, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 5000): Promise<Record<string, unknown>> {
  if (!validHost(host) || !(port > 0 && port < 65536)) return Promise.reject(new Error('Địa chỉ thiết bị không hợp lệ.'))
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { Accept: 'application/json' }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = payload.length
    }
    const req = request({ host, port, method, path, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) req.destroy(new Error('too large'))
        else chunks.push(chunk)
      })
      res.on('end', () => {
        let json: Record<string, unknown>
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        } catch {
          reject(new Error('Thiết bị trả lời không hợp lệ (không phải DVDTube?).'))
          return
        }
        if (json.ok !== true) {
          reject(new Error(typeof json.error === 'string' && json.error ? json.error : `Thiết bị báo lỗi (HTTP ${res.statusCode}).`))
          return
        }
        resolve(json)
      })
      res.on('error', () => reject(new Error('Mất kết nối với thiết bị.')))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (error) =>
      reject(
        new Error(
          error.message === 'timeout'
            ? 'Thiết bị không phản hồi. Kiểm tra DVDTube đang mở trên thiết bị và cùng mạng Wi-Fi.'
            : 'Không kết nối được với thiết bị. Kiểm tra DVDTube đang mở trên thiết bị và cùng mạng Wi-Fi.',
        ),
      ),
    )
    req.end(payload ?? undefined)
  })
}

/** `192.168.1.20` or `192.168.1.20:8766`. */
export function parseAddress(text: string): { host: string; port: number } | null {
  const match = /^\s*(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\s*$/.exec(text)
  if (!match) return null
  const port = match[2] ? parseInt(match[2], 10) : CAST_PORT
  if (!validHost(match[1]) || port < 1 || port > 65535) return null
  return { host: match[1], port }
}

function kindOf(value: unknown): CastDeviceKind {
  return value === 'tv' ? 'tv' : 'desktop'
}

export function deviceFromInfo(info: Record<string, unknown>, host: string, port: number, manual: boolean): CastDevice {
  if (info.app !== 'DVDTube') throw new Error('Thiết bị này không phải DVDTube.')
  const id = typeof info.id === 'string' && info.id ? info.id.slice(0, 100) : `manual:${host}:${port}`
  return {
    id,
    name: typeof info.name === 'string' && info.name.trim() ? info.name.trim().slice(0, 100) : host,
    kind: kindOf(info.kind),
    host,
    port,
    version: typeof info.version === 'string' ? info.version.slice(0, 40) : null,
    manual,
    online: true,
  }
}

export function deviceFromService(service: FoundService, interfaces: Parameters<typeof pickAddress>[1]): CastDevice | null {
  const host = pickAddress(service, interfaces)
  if (!host || !service.port || !validHost(host)) return null
  const txt = service.txt ?? {}
  const id = txt.id || `mdns:${service.instance[0]}`
  return {
    id,
    name: (txt.name || service.instance[0] || host).slice(0, 100),
    kind: kindOf(txt.kind),
    host,
    port: service.port,
    version: null,
    manual: false,
    online: true,
  }
}

// MARK: Service

export class CastService {
  private readonly mdns: Mdns
  private mdnsStarted: Promise<void> | null = null
  private receiver: CastReceiver | null = null
  private receiverWanted = false
  private status: CastStatus = IDLE_STATUS
  private manual: CastDevice[] = []
  private lastDevices = ''
  private scanTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly host: CastHost) {
    this.mdns = new Mdns({ log: (m) => host.log(m) })
    this.mdns.onChange = () => this.publish()
    const saved = readJsonSync<CastDevice[]>(userDataFile('cast-devices.json'))
    this.manual = Array.isArray(saved) ? saved.filter((d) => d && validHost(d.host) && d.port > 0).map((d) => ({ ...d, manual: true, online: false })) : []
  }

  private ensureMdns(): Promise<void> {
    this.mdnsStarted ??= this.mdns.start().catch((error) => {
      this.host.log(`mdns: not available (${error instanceof Error ? error.message : String(error)})`)
      this.mdnsStarted = null
    })
    return this.mdnsStarted
  }

  // Receiver

  async setReceiverEnabled(enabled: boolean): Promise<void> {
    this.receiverWanted = enabled
    if (enabled && !this.receiver) {
      const receiver = new CastReceiver(
        { id: deviceId(), name: deviceName(), kind: 'desktop', version: this.host.version },
        { onCommand: (c) => this.host.onCommand(c), status: () => this.status, log: (m) => this.host.log(m) },
      )
      this.receiver = receiver
      try {
        const port = await receiver.start()
        if (!this.receiverWanted || this.receiver !== receiver) {
          receiver.stop()
          return
        }
        await this.ensureMdns()
        this.mdns.advertise({
          instance: deviceName(),
          type: SERVICE_TYPE,
          port,
          host: `DVDTube-${deviceId().slice(0, 8)}`,
          txt: { id: deviceId(), v: '1', kind: 'desktop', name: deviceName() },
        })
      } catch (error) {
        this.host.log(`cast receiver: not started (${error instanceof Error ? error.message : String(error)})`)
        this.receiver = null
      }
    } else if (!enabled && this.receiver) {
      this.receiver.stop()
      this.receiver = null
      await this.mdns.unadvertise().catch(() => {})
    }
  }

  setStatus(status: unknown): void {
    this.status = cleanStatus(status)
  }

  // Sender

  /** Asks the network now and twice more (answers trickle in), and checks manual receivers. */
  async scan(): Promise<void> {
    await this.ensureMdns()
    this.mdns.browse(SERVICE_TYPE)
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.mdns.query()
      this.scanTimer = setTimeout(() => this.mdns.query(), 3000)
    }, 1000)
    void Promise.all(this.manual.map((d) => this.refreshManual(d))).then(() => this.publish())
  }

  private async refreshManual(device: CastDevice): Promise<void> {
    try {
      const info = await callReceiver(device.host, device.port, 'GET', '/api/info', undefined, 2500)
      const fresh = deviceFromInfo(info, device.host, device.port, true)
      Object.assign(device, fresh)
    } catch {
      device.online = false
    }
  }

  devices(): CastDevice[] {
    const ownId = this.receiver ? deviceId() : null
    const found = this.mdns
      .services()
      .map((s) => deviceFromService(s, this.mdns.localInterfaces))
      .filter((d): d is CastDevice => d !== null && d.id !== ownId)
    const byId = new Map<string, CastDevice>()
    for (const d of found) byId.set(d.id, d)
    for (const d of this.manual) {
      const discovered = byId.get(d.id)
      if (discovered) byId.set(d.id, { ...discovered, manual: true })
      else if (d.id !== ownId) byId.set(d.id, d)
    }
    // TVs first, then computers; by name.
    return [...byId.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'vi') : a.kind === 'tv' ? -1 : 1))
  }

  private publish(): void {
    const devices = this.devices()
    const key = JSON.stringify(devices)
    if (key === this.lastDevices) return
    this.lastDevices = key
    this.host.onDevices(devices)
  }

  async addManual(address: string): Promise<CastDevice> {
    const parsed = parseAddress(address)
    if (!parsed) throw new Error('Địa chỉ không hợp lệ. Nhập dạng 192.168.1.20 hoặc 192.168.1.20:8766.')
    const info = await callReceiver(parsed.host, parsed.port, 'GET', '/api/info', undefined, 4000)
    const device = deviceFromInfo(info, parsed.host, parsed.port, true)
    this.manual = [device, ...this.manual.filter((d) => d.id !== device.id && !(d.host === device.host && d.port === device.port))]
    this.saveManual()
    this.publish()
    return device
  }

  forget(id: string): void {
    this.manual = this.manual.filter((d) => d.id !== id)
    this.saveManual()
    this.publish()
  }

  private saveManual(): void {
    void writeJson(
      userDataFile('cast-devices.json'),
      this.manual.map(({ id, name, kind, host, port, version }) => ({ id, name, kind, host, port, version })),
    ).catch(() => {})
  }

  async play(device: CastDevice, play: CastPlayRequest): Promise<void> {
    await callReceiver(device.host, device.port, 'POST', '/api/play', { ...play, sender: play.sender ?? deviceName() }, 8000)
  }

  async queue(device: CastDevice, video: VideoItem, next: boolean): Promise<void> {
    await callReceiver(device.host, device.port, 'POST', '/api/queue', { video, next: !!next })
  }

  async control(device: CastDevice, action: CastAction, value: number | null): Promise<void> {
    await callReceiver(device.host, device.port, 'POST', '/api/control', { action, value })
  }

  async remoteStatus(device: CastDevice): Promise<CastStatus> {
    const json = await callReceiver(device.host, device.port, 'GET', '/api/status', undefined, 3000)
    const status = cleanStatus(json)
    return { ...status, video: cleanVideoItem(json.video) }
  }

  async stop(): Promise<void> {
    this.receiver?.stop()
    this.receiver = null
    if (this.mdnsStarted) await this.mdns.stop().catch(() => {})
  }
}
