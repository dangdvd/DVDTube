// Minimal multicast DNS / DNS-SD (RFC 6762 / 6763) over UDP 224.0.0.251:5353, enough to
// advertise this computer as a `_dvdtube._tcp` receiver and to find the TVs, PCs and phones that
// advertise one. IPv4 only. Every packet is sent from port 5353 on each LAN interface in turn
// (iOS ignores multicast responses from any other port).

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { lanInterfaces, sameSubnet, type LocalInterface } from '../lan'

export const MDNS_GROUP = '224.0.0.251'
export const MDNS_PORT = 5353

export const TYPE_A = 1
export const TYPE_PTR = 12
export const TYPE_TXT = 16
export const TYPE_AAAA = 28
export const TYPE_SRV = 33
export const TYPE_NSEC = 47
export const TYPE_ANY = 255

/** A domain name as its labels (instance names may contain dots and any UTF-8). */
export type Labels = string[]

export interface DnsQuestion {
  name: Labels
  type: number
  /** QU bit: the asker prefers a unicast answer. */
  unicast?: boolean
}

export interface SrvData {
  priority: number
  weight: number
  port: number
  target: Labels
}

export type RecordData =
  | { kind: 'a'; address: string }
  | { kind: 'ptr'; target: Labels }
  | { kind: 'srv'; srv: SrvData }
  | { kind: 'txt'; entries: string[] }
  | { kind: 'raw'; bytes: Buffer }

export interface DnsRecord {
  name: Labels
  type: number
  /** Cache-flush bit (unique records). */
  flush?: boolean
  ttl: number
  data: RecordData
}

export interface DnsPacket {
  id: number
  /** 0x8400 = response, authoritative answer. */
  flags: number
  questions: DnsQuestion[]
  answers: DnsRecord[]
  authorities: DnsRecord[]
  additionals: DnsRecord[]
}

export function isResponse(packet: DnsPacket): boolean {
  return (packet.flags & 0x8000) !== 0
}

export function sameName(a: Labels, b: Labels): boolean {
  return a.length === b.length && a.every((label, i) => label.toLowerCase() === b[i].toLowerCase())
}

export function nameOf(text: string): Labels {
  return text.split('.').filter((l) => l.length > 0)
}

// MARK: Encoding

/** Truncates to 63 bytes of UTF-8 without cutting a character. */
export function label(text: string): string {
  let out = text
  while (Buffer.byteLength(out, 'utf8') > 63) out = Array.from(out).slice(0, -1).join('')
  return out
}

function encodeName(labels: Labels): Buffer {
  const parts: Buffer[] = []
  for (const l of labels) {
    const bytes = Buffer.from(label(l), 'utf8')
    parts.push(Buffer.from([bytes.length]), bytes)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

function u16(value: number): Buffer {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(value & 0xffff)
  return b
}

function u32(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(value >>> 0)
  return b
}

function encodeData(record: DnsRecord): Buffer {
  const d = record.data
  switch (d.kind) {
    case 'a':
      return Buffer.from(d.address.split('.').map((p) => parseInt(p, 10) & 255))
    case 'ptr':
      return encodeName(d.target)
    case 'srv':
      return Buffer.concat([u16(d.srv.priority), u16(d.srv.weight), u16(d.srv.port), encodeName(d.srv.target)])
    case 'txt': {
      const parts = d.entries.map((entry) => {
        let bytes = Buffer.from(entry, 'utf8')
        if (bytes.length > 255) bytes = bytes.subarray(0, 255)
        return Buffer.concat([Buffer.from([bytes.length]), bytes])
      })
      return parts.length ? Buffer.concat(parts) : Buffer.from([0])
    }
    case 'raw':
      return d.bytes
  }
}

function encodeRecord(record: DnsRecord): Buffer {
  const data = encodeData(record)
  return Buffer.concat([encodeName(record.name), u16(record.type), u16((record.flush ? 0x8000 : 0) | 1), u32(record.ttl), u16(data.length), data])
}

export function encodePacket(packet: DnsPacket): Buffer {
  const header = Buffer.concat([
    u16(packet.id),
    u16(packet.flags),
    u16(packet.questions.length),
    u16(packet.answers.length),
    u16(packet.authorities.length),
    u16(packet.additionals.length),
  ])
  const questions = packet.questions.map((q) => Buffer.concat([encodeName(q.name), u16(q.type), u16((q.unicast ? 0x8000 : 0) | 1)]))
  return Buffer.concat([header, ...questions, ...packet.answers.map(encodeRecord), ...packet.authorities.map(encodeRecord), ...packet.additionals.map(encodeRecord)])
}

// MARK: Decoding

class Reader {
  offset = 0
  constructor(readonly buf: Buffer) {}

  need(count: number): void {
    if (this.offset + count > this.buf.length) throw new Error('truncated packet')
  }
  u8(): number {
    this.need(1)
    return this.buf[this.offset++]
  }
  u16(): number {
    this.need(2)
    const v = this.buf.readUInt16BE(this.offset)
    this.offset += 2
    return v
  }
  u32(): number {
    this.need(4)
    const v = this.buf.readUInt32BE(this.offset)
    this.offset += 4
    return v
  }

  /** A (possibly compressed) name starting at the current offset. */
  name(): Labels {
    const { labels, end } = readName(this.buf, this.offset)
    this.offset = end
    return labels
  }
}

function readName(buf: Buffer, start: number): { labels: Labels; end: number } {
  const labels: Labels = []
  let offset = start
  let end = -1
  let jumps = 0
  for (;;) {
    if (offset >= buf.length) throw new Error('truncated name')
    const length = buf[offset]
    if (length === 0) {
      offset += 1
      break
    }
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= buf.length) throw new Error('truncated pointer')
      const pointer = ((length & 0x3f) << 8) | buf[offset + 1]
      if (end < 0) end = offset + 2
      if (++jumps > 32 || pointer >= buf.length) throw new Error('bad name pointer')
      offset = pointer
      continue
    }
    if ((length & 0xc0) !== 0) throw new Error('bad label')
    if (offset + 1 + length > buf.length) throw new Error('truncated label')
    labels.push(buf.toString('utf8', offset + 1, offset + 1 + length))
    offset += 1 + length
    if (labels.length > 128) throw new Error('name too long')
  }
  return { labels, end: end >= 0 ? end : offset }
}

function decodeRecord(r: Reader): DnsRecord {
  const name = r.name()
  const type = r.u16()
  const klass = r.u16()
  const ttl = r.u32()
  const length = r.u16()
  r.need(length)
  const start = r.offset
  const end = start + length
  let data: RecordData
  if (type === TYPE_A && length === 4) {
    data = { kind: 'a', address: [...r.buf.subarray(start, end)].join('.') }
  } else if (type === TYPE_PTR) {
    data = { kind: 'ptr', target: readName(r.buf, start).labels }
  } else if (type === TYPE_SRV && length >= 7) {
    data = {
      kind: 'srv',
      srv: {
        priority: r.buf.readUInt16BE(start),
        weight: r.buf.readUInt16BE(start + 2),
        port: r.buf.readUInt16BE(start + 4),
        target: readName(r.buf, start + 6).labels,
      },
    }
  } else if (type === TYPE_TXT) {
    const entries: string[] = []
    let offset = start
    while (offset < end) {
      const size = r.buf[offset]
      if (offset + 1 + size > end) break
      if (size > 0) entries.push(r.buf.toString('utf8', offset + 1, offset + 1 + size))
      offset += 1 + size
    }
    data = { kind: 'txt', entries }
  } else {
    data = { kind: 'raw', bytes: Buffer.from(r.buf.subarray(start, end)) }
  }
  r.offset = end
  return { name, type, flush: (klass & 0x8000) !== 0, ttl, data }
}

export function decodePacket(buf: Buffer): DnsPacket {
  const r = new Reader(buf)
  const id = r.u16()
  const flags = r.u16()
  const qd = r.u16()
  const an = r.u16()
  const ns = r.u16()
  const ar = r.u16()
  const questions: DnsQuestion[] = []
  for (let i = 0; i < qd; i++) {
    const name = r.name()
    const type = r.u16()
    const klass = r.u16()
    questions.push({ name, type, unicast: (klass & 0x8000) !== 0 })
  }
  const records = (count: number) => Array.from({ length: count }, () => decodeRecord(r))
  return { id, flags, questions, answers: records(an), authorities: records(ns), additionals: records(ar) }
}

/** TXT entries `key=value` → object (first value wins, keys lower-cased). */
export function txtMap(entries: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of entries) {
    const index = entry.indexOf('=')
    const key = (index >= 0 ? entry.slice(0, index) : entry).toLowerCase()
    if (key && !(key in map)) map[key] = index >= 0 ? entry.slice(index + 1) : ''
  }
  return map
}

// MARK: Service description

export interface ServiceAdvert {
  /** Instance name shown to users, e.g. "DESKTOP-ABC". */
  instance: string
  /** `_dvdtube._tcp` */
  type: string
  port: number
  txt: Record<string, string>
  /** Host name label (a `.local` name of our own, so we never clash with the OS's). */
  host: string
}

const LOCAL = 'local'
const SERVICES = ['_services', '_dns-sd', '_udp', LOCAL]

function typeName(type: string): Labels {
  return [...nameOf(type), LOCAL]
}

/** Answers our advert gives to a query (empty when the query is not about it). */
export function answersFor(advert: ServiceAdvert, questions: DnsQuestion[], address: string): { answers: DnsRecord[]; additionals: DnsRecord[] } {
  const service = typeName(advert.type)
  const instance = [label(advert.instance), ...service]
  const host = [label(advert.host), LOCAL]
  const ptr: DnsRecord = { name: service, type: TYPE_PTR, ttl: 4500, data: { kind: 'ptr', target: instance } }
  const srv: DnsRecord = { name: instance, type: TYPE_SRV, flush: true, ttl: 120, data: { kind: 'srv', srv: { priority: 0, weight: 0, port: advert.port, target: host } } }
  const txt: DnsRecord = {
    name: instance,
    type: TYPE_TXT,
    flush: true,
    ttl: 4500,
    data: { kind: 'txt', entries: Object.entries(advert.txt).map(([k, v]) => `${k}=${v}`) },
  }
  const a: DnsRecord = { name: host, type: TYPE_A, flush: true, ttl: 120, data: { kind: 'a', address } }
  const answers: DnsRecord[] = []
  const additionals: DnsRecord[] = []
  const add = (list: DnsRecord[], record: DnsRecord) => {
    if (!answers.includes(record) && !additionals.includes(record)) list.push(record)
  }
  for (const q of questions) {
    const any = q.type === TYPE_ANY
    if (sameName(q.name, SERVICES) && (q.type === TYPE_PTR || any)) {
      add(answers, { name: SERVICES, type: TYPE_PTR, ttl: 4500, data: { kind: 'ptr', target: service } })
    } else if (sameName(q.name, service) && (q.type === TYPE_PTR || any)) {
      add(answers, ptr)
    } else if (sameName(q.name, instance)) {
      if (q.type === TYPE_SRV || any) add(answers, srv)
      if (q.type === TYPE_TXT || any) add(answers, txt)
    } else if (sameName(q.name, host) && (q.type === TYPE_A || any)) {
      add(answers, a)
    }
  }
  if (answers.length === 0) return { answers, additionals }
  if (answers.includes(ptr)) {
    add(additionals, srv)
    add(additionals, txt)
  }
  if (answers.includes(srv) || additionals.includes(srv)) add(additionals, a)
  return { answers, additionals }
}

/** The unsolicited announcement (TTL 0 = goodbye). */
export function announcement(advert: ServiceAdvert, address: string, goodbye = false): DnsPacket {
  const { answers, additionals } = answersFor(advert, [{ name: typeName(advert.type), type: TYPE_PTR }], address)
  const all = [...answers, ...additionals].map((r) => (goodbye ? { ...r, ttl: 0 } : r))
  return { id: 0, flags: 0x8400, questions: [], answers: all, authorities: [], additionals: [] }
}

// MARK: Discovered services

export interface FoundService {
  /** Full instance name, e.g. ["TCL Smart TV Pro", "_dvdtube", "_tcp", "local"]. */
  instance: Labels
  port: number | null
  target: Labels | null
  txt: Record<string, string> | null
  addresses: string[]
  /** Address the last answer came from. */
  sender: string | null
  expiresAt: number
}

/** Folds the records of one response into the known services of `type`. */
export function absorb(found: Map<string, FoundService>, type: string, packet: DnsPacket, sender: string, now = Date.now()): boolean {
  const service = typeName(type)
  const records = [...packet.answers, ...packet.additionals]
  let changed = false
  const key = (labels: Labels) => labels.map((l) => l.toLowerCase()).join('.')
  for (const record of records) {
    if (record.type !== TYPE_PTR || record.data.kind !== 'ptr' || !sameName(record.name, service)) continue
    const instance = record.data.target
    const id = key(instance)
    if (record.ttl === 0) {
      if (found.delete(id)) changed = true
      continue
    }
    const existing = found.get(id)
    if (!existing) {
      found.set(id, { instance, port: null, target: null, txt: null, addresses: [], sender, expiresAt: now + record.ttl * 1000 })
      changed = true
    } else {
      existing.expiresAt = now + record.ttl * 1000
      existing.sender = sender
    }
  }
  for (const entry of found.values()) {
    for (const record of records) {
      if (record.type === TYPE_SRV && record.data.kind === 'srv' && sameName(record.name, entry.instance)) {
        if (record.ttl === 0) continue
        if (entry.port !== record.data.srv.port || !entry.target || !sameName(entry.target, record.data.srv.target)) changed = true
        entry.port = record.data.srv.port
        entry.target = record.data.srv.target
        entry.sender = sender
      } else if (record.type === TYPE_TXT && record.data.kind === 'txt' && sameName(record.name, entry.instance)) {
        const txt = txtMap(record.data.entries)
        if (JSON.stringify(txt) !== JSON.stringify(entry.txt)) changed = true
        entry.txt = txt
      }
    }
    if (!entry.target) continue
    const addresses = records
      .filter((r) => r.type === TYPE_A && r.data.kind === 'a' && sameName(r.name, entry.target!) && r.ttl > 0)
      .map((r) => (r.data as { address: string }).address)
    if (addresses.length && JSON.stringify(addresses) !== JSON.stringify(entry.addresses)) {
      entry.addresses = addresses
      changed = true
    }
  }
  return changed
}

/** The address to connect to: one of ours' subnets first, else the address the answer came from. */
export function pickAddress(service: FoundService, interfaces: LocalInterface[]): string | null {
  for (const iface of interfaces) {
    const match = service.addresses.find((a) => sameSubnet(a, iface.address, iface.netmask))
    if (match) return match
  }
  if (service.sender && /^\d+\.\d+\.\d+\.\d+$/.test(service.sender)) return service.sender
  return service.addresses[0] ?? null
}

// MARK: Socket

export interface MdnsOptions {
  log?: (message: string) => void
  /** Tests: a different group port. */
  port?: number
  /** Tests: the interfaces to use (default: this computer's private IPv4 interfaces). */
  interfaces?: () => LocalInterface[]
}

/**
 * One UDP socket on port 5353 (shared with the OS's own responder via SO_REUSEADDR), joined to
 * the mDNS group on every LAN interface. Answers queries about the advert and collects answers
 * about the browsed type.
 */
export class Mdns {
  private socket: Socket | null = null
  private interfaces: LocalInterface[] = []
  private joined = new Set<string>()
  private advert: ServiceAdvert | null = null
  private browseType: string | null = null
  private readonly found = new Map<string, FoundService>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private sendChain: Promise<void> = Promise.resolve()
  onChange: (() => void) | null = null

  constructor(private readonly options: MdnsOptions = {}) {}

  private get port(): number {
    return this.options.port ?? MDNS_PORT
  }

  async start(): Promise<void> {
    if (this.socket) return
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo))
    socket.on('error', (error) => this.options.log?.(`mdns: ${error.message}`))
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(this.port, () => {
        socket.off('error', reject)
        resolve()
      })
    })
    try {
      socket.setMulticastTTL(255)
      socket.setMulticastLoopback(true)
    } catch {
      // not fatal
    }
    this.socket = socket
    this.refreshInterfaces()
    this.refreshTimer = setInterval(() => this.refreshInterfaces(), 30_000)
    this.refreshTimer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.advert) await this.unadvertise()
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    await this.sendChain.catch(() => {})
    this.socket?.close()
    this.socket = null
    this.joined.clear()
  }

  /** Joins the group on new interfaces (Wi-Fi reconnects, docking…). */
  private refreshInterfaces(): void {
    const socket = this.socket
    if (!socket) return
    const before = this.interfaces.map((i) => i.address).join(',')
    this.interfaces = (this.options.interfaces ?? lanInterfaces)()
    for (const iface of this.interfaces) {
      if (this.joined.has(iface.address)) continue
      try {
        socket.addMembership(MDNS_GROUP, iface.address)
        this.joined.add(iface.address)
      } catch (error) {
        // Already joined through another socket of this process, or the interface went away.
        this.joined.add(iface.address)
        this.options.log?.(`mdns: join ${iface.name} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (this.advert && before !== this.interfaces.map((i) => i.address).join(',')) void this.announce()
  }

  /** Sends `build(interface)` from port 5353 on each interface, one after the other. */
  private sendOnInterfaces(targets: LocalInterface[], build: (iface: LocalInterface) => DnsPacket | null, to = MDNS_GROUP, port = this.port): Promise<void> {
    const socket = this.socket
    if (!socket) return Promise.resolve()
    const run = async () => {
      for (const iface of targets) {
        const packet = build(iface)
        if (!packet) continue
        const bytes = encodePacket(packet)
        await new Promise<void>((resolve) => {
          try {
            if (to === MDNS_GROUP) socket.setMulticastInterface(iface.address)
            socket.send(bytes, port, to, () => resolve())
          } catch {
            resolve()
          }
        })
      }
    }
    this.sendChain = this.sendChain.then(run, run)
    return this.sendChain
  }

  advertise(advert: ServiceAdvert): void {
    this.advert = advert
    void this.announce()
    // RFC 6762 §8.3: at least two announcements, one second apart.
    setTimeout(() => void (this.advert === advert && this.announce()), 1000).unref?.()
  }

  private announce(): Promise<void> {
    const advert = this.advert
    if (!advert) return Promise.resolve()
    return this.sendOnInterfaces(this.interfaces, (iface) => announcement(advert, iface.address))
  }

  async unadvertise(): Promise<void> {
    const advert = this.advert
    this.advert = null
    if (advert) await this.sendOnInterfaces(this.interfaces, (iface) => announcement(advert, iface.address, true))
  }

  /** Starts collecting answers about `type` and asks the network once. */
  browse(type: string): void {
    this.browseType = type
    this.query()
  }

  /** Asks every interface for `browseType` (PTR) again. */
  query(): void {
    const type = this.browseType
    if (!type) return
    const packet: DnsPacket = { id: 0, flags: 0, questions: [{ name: typeName(type), type: TYPE_PTR }], answers: [], authorities: [], additionals: [] }
    void this.sendOnInterfaces(this.interfaces, () => packet)
  }

  /** Services seen recently (expired ones dropped). */
  services(now = Date.now()): FoundService[] {
    for (const [key, entry] of this.found) if (entry.expiresAt < now) this.found.delete(key)
    return [...this.found.values()]
  }

  get localInterfaces(): LocalInterface[] {
    return this.interfaces
  }

  private onMessage(msg: Buffer, rinfo: RemoteInfo): void {
    let packet: DnsPacket
    try {
      packet = decodePacket(msg)
    } catch {
      return
    }
    if (isResponse(packet)) {
      if (this.browseType && absorb(this.found, this.browseType, packet, rinfo.address)) {
        this.resolveMissing()
        this.onChange?.()
      }
      return
    }
    const advert = this.advert
    if (!advert || packet.questions.length === 0) return
    // Legacy unicast query (not from port 5353): answer to its address with its id.
    const legacy = rinfo.port !== this.port
    const matching = this.interfaces.filter((i) => sameSubnet(i.address, rinfo.address, i.netmask))
    const targets = matching.length ? matching : this.interfaces
    const build = (iface: LocalInterface): DnsPacket | null => {
      const { answers, additionals } = answersFor(advert, packet.questions, iface.address)
      if (answers.length === 0) return null
      const ttl = (r: DnsRecord) => (legacy ? { ...r, ttl: Math.min(r.ttl, 10), flush: false } : r)
      return {
        id: legacy ? packet.id : 0,
        flags: 0x8400,
        questions: legacy ? packet.questions : [],
        answers: answers.map(ttl),
        authorities: [],
        additionals: additionals.map(ttl),
      }
    }
    if (legacy) {
      void this.sendOnInterfaces(targets.slice(0, 1), build, rinfo.address, rinfo.port)
      return
    }
    // Shared records: a short random delay avoids answering at the same time as others.
    setTimeout(() => void this.sendOnInterfaces(targets, build), 20 + Math.floor(Math.random() * 100)).unref?.()
  }

  /** Asks for the SRV / TXT / A records a PTR answer did not include. */
  private resolveMissing(): void {
    const questions: DnsQuestion[] = []
    for (const entry of this.found.values()) {
      if (entry.port === null) questions.push({ name: entry.instance, type: TYPE_SRV })
      if (entry.txt === null) questions.push({ name: entry.instance, type: TYPE_TXT })
      if (entry.target && entry.addresses.length === 0 && !entry.sender) questions.push({ name: entry.target, type: TYPE_A })
    }
    if (questions.length === 0) return
    const packet: DnsPacket = { id: 0, flags: 0, questions: questions.slice(0, 12), answers: [], authorities: [], additionals: [] }
    void this.sendOnInterfaces(this.interfaces, () => packet)
  }
}
