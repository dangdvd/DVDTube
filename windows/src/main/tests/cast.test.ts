// "Truyền tới DVDTube": the receiver's HTTP API (protocol 1), the sender's HTTP client against
// it, the DNS-SD packet codec / responder answers / discovery, and the LAN address checks.

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { networkInterfaces } from 'node:os'
import { after, before, describe, it } from 'node:test'
import type { CastCommand, CastQueueEdit, CastStatus, VideoItem } from '@shared/models'
import { applyQueueEdit } from '@shared/models'
import { callReceiver, deviceFromInfo, deviceFromService, parseAddress } from '../cast'
import {
  TYPE_A,
  TYPE_PTR,
  TYPE_SRV,
  TYPE_TXT,
  Mdns,
  absorb,
  announcement,
  answersFor,
  decodePacket,
  encodePacket,
  label,
  pickAddress,
  txtMap,
  type DnsPacket,
  type FoundService,
  type ServiceAdvert,
} from '../cast/mdns'
import { CastReceiver, IDLE_STATUS, cleanStatus, parseControl, parsePlayRequest, parseQueueEdit } from '../cast/receiver'
import { isLanAddress } from '../lan'

function http(port: number, method: string, path: string, body?: string, headers: Record<string, string | number> = {}) {
  return new Promise<{ status: number; type: string; json: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }),
      )
    })
    req.on('error', reject)
    req.end(body)
  })
}

function post(port: number, path: string, value: unknown) {
  const body = JSON.stringify(value)
  return http(port, 'POST', path, body, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
}

describe('cast receiver API', () => {
  const commands: CastCommand[] = []
  let status: CastStatus = IDLE_STATUS
  const receiver = new CastReceiver(
    { id: '7f1c2a9e-1111-4c2b-9d7e-1234567890ab', name: 'Phòng khách PC', kind: 'desktop', version: '1.0.42' },
    { onCommand: (c) => commands.push(c), status: () => status },
    0,
  )
  let port = 0
  before(async () => {
    port = await receiver.start()
  })
  after(() => receiver.stop())

  it('answers /api/info exactly like the protocol', async () => {
    const res = await http(port, 'GET', '/api/info')
    assert.equal(res.status, 200)
    assert.equal(res.type, 'application/json')
    assert.deepEqual(res.json, {
      ok: true,
      app: 'DVDTube',
      protocol: 1,
      id: '7f1c2a9e-1111-4c2b-9d7e-1234567890ab',
      name: 'Phòng khách PC',
      kind: 'desktop',
      version: '1.0.42',
      features: ['queue-edit'],
    })
  })

  it('passes /api/queue/edit to the window and refuses invalid edits', async () => {
    const res = await post(port, '/api/queue/edit', { op: 'move', index: 3, videoId: 'jNQXAC9IVRw', to: 1 })
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { ok: true })
    assert.deepEqual(commands.at(-1), { type: 'edit', edit: { op: 'move', index: 3, videoId: 'jNQXAC9IVRw', to: 1 } })
    assert.equal((await post(port, '/api/queue/edit', { op: 'clear' })).status, 200)
    assert.deepEqual(commands.at(-1), { type: 'edit', edit: { op: 'clear', index: 0, videoId: null, to: null } })
    for (const body of [{ op: 'shuffle', index: 0, videoId: 'jNQXAC9IVRw' }, { op: 'remove', index: 1 }, { op: 'move', index: 1, videoId: 'jNQXAC9IVRw' }, { op: 'play', index: -1, videoId: 'jNQXAC9IVRw' }]) {
      const bad = await post(port, '/api/queue/edit', body)
      assert.equal(bad.status, 400, JSON.stringify(body))
    }
  })

  it('passes /api/play to the window with a cleaned video and queue', async () => {
    const res = await post(port, '/api/play', {
      video: { id: 'dQw4w9WgXcQ', title: 'Bài hát', channelName: 'Kênh', durationSeconds: 213, publishedDate: 1700000000000, extra: 'ignored' },
      startSeconds: 42.5,
      queue: [{ id: 'dQw4w9WgXcQ' }, { id: 'jNQXAC9IVRw', title: 'Me at the zoo' }, { title: 'no id' }],
      index: 0,
      playlistId: 'PLxyz',
      sender: 'iPhone của An',
    })
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { ok: true })
    const command = commands.at(-1)!
    assert.equal(command.type, 'play')
    if (command.type !== 'play') return
    assert.equal(command.request.video.id, 'dQw4w9WgXcQ')
    assert.equal(command.request.video.title, 'Bài hát')
    assert.equal((command.request.video as unknown as Record<string, unknown>).extra, undefined)
    assert.equal(command.request.startSeconds, 42.5)
    assert.deepEqual(command.request.queue?.map((v) => v.id), ['dQw4w9WgXcQ', 'jNQXAC9IVRw'])
    assert.equal(command.request.index, 0)
    assert.equal(command.request.playlistId, 'PLxyz')
    assert.equal(command.request.sender, 'iPhone của An')
  })

  it('queues and controls', async () => {
    assert.equal((await post(port, '/api/queue', { video: { id: 'jNQXAC9IVRw' }, next: true })).status, 200)
    assert.deepEqual(commands.at(-1), { type: 'queue', video: { ...parsePlayRequest({ video: { id: 'jNQXAC9IVRw' } })!.video }, next: true })
    for (const [action, value, expected] of [
      ['toggle', null, null],
      ['seek', 90, 90],
      ['skip', -10, -10],
      ['volume', 1.7, 1],
      ['mute', 1, 1],
    ] as const) {
      const res = await post(port, '/api/control', { action, value })
      assert.equal(res.status, 200, action)
      assert.deepEqual(commands.at(-1), { type: 'control', action, value: expected })
    }
  })

  it('reports the status the window gives', async () => {
    status = { ...IDLE_STATUS, state: 'playing', video: { id: 'dQw4w9WgXcQ', title: 'Bài hát' }, position: 12.5, duration: 213, volume: 0.8, queue: [], index: 0 }
    const res = await http(port, 'GET', '/api/status')
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
    assert.equal(res.json.state, 'playing')
    assert.equal(res.json.position, 12.5)
    assert.equal((res.json.video as { id: string }).id, 'dQw4w9WgXcQ')
    assert.equal(res.json.error, null)
  })

  it('rejects bad requests with Vietnamese errors', async () => {
    const missing = await http(port, 'GET', '/nope')
    assert.equal(missing.status, 404)
    assert.equal(missing.json.ok, false)
    assert.match(String(missing.json.error), /trang/)
    assert.equal((await http(port, 'GET', '/api/play')).status, 405)
    assert.equal((await post(port, '/api/play', { video: { title: 'no id' } })).status, 400)
    assert.equal((await post(port, '/api/control', { action: 'explode' })).status, 400)
    assert.equal((await post(port, '/api/control', { action: 'seek' })).status, 400)
    const noLength = await http(port, 'POST', '/api/control', undefined, { 'Transfer-Encoding': 'chunked' })
    assert.equal(noLength.status, 411)
    const huge = 'x'.repeat(300 * 1024)
    const tooBig = await http(port, 'POST', '/api/play', huge, { 'Content-Length': huge.length })
    assert.equal(tooBig.status, 413)
  })

  it('is driven by the sender client', async () => {
    const info = await callReceiver('127.0.0.1', port, 'GET', '/api/info')
    const device = deviceFromInfo(info, '127.0.0.1', port, true)
    assert.equal(device.name, 'Phòng khách PC')
    assert.equal(device.kind, 'desktop')
    await callReceiver('127.0.0.1', port, 'POST', '/api/control', { action: 'next', value: null })
    assert.deepEqual(commands.at(-1), { type: 'control', action: 'next', value: null })
    await assert.rejects(() => callReceiver('127.0.0.1', port, 'POST', '/api/control', { action: 'bad' }), /không hợp lệ/)
    await assert.rejects(() => callReceiver('8.8.8.8', port, 'GET', '/api/info'), /không hợp lệ/)
  })
})

describe('cast validation', () => {
  it('accepts only private and loopback peers', () => {
    for (const a of ['10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.20', '169.254.3.3', '127.0.0.1', '::1', '::ffff:192.168.0.5', 'fe80::1%eth0', 'fd12:3456::1', 'fc00::2']) {
      assert.ok(isLanAddress(a), a)
    }
    for (const a of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:db8::1', '::ffff:8.8.8.8', '', undefined]) assert.ok(!isLanAddress(a), String(a))
  })

  it('parses manual addresses', () => {
    assert.deepEqual(parseAddress('192.168.1.20'), { host: '192.168.1.20', port: 8766 })
    assert.deepEqual(parseAddress(' 10.0.0.7:9000 '), { host: '10.0.0.7', port: 9000 })
    assert.equal(parseAddress('8.8.8.8'), null)
    assert.equal(parseAddress('tv.local'), null)
    assert.equal(parseAddress('192.168.1.20:99999'), null)
  })

  it('cleans play bodies and status', () => {
    assert.equal(parsePlayRequest({ video: { id: 'bad id!' } }), null)
    assert.equal(parsePlayRequest({ video: { id: 'dQw4w9WgXcQ' }, index: 5, queue: [{ id: 'jNQXAC9IVRw' }] })!.index, null)
    assert.deepEqual(parseControl({ action: 'mute', value: null }), { action: 'mute', value: null })
    assert.equal(cleanStatus({ state: 'weird', volume: 4 }).state, 'idle')
    assert.equal(cleanStatus({ state: 'paused', volume: 4 }).volume, 1)
  })
})

describe('DNS-SD', () => {
  const advert: ServiceAdvert = {
    instance: 'DESKTOP-ABC',
    type: '_dvdtube._tcp',
    port: 8766,
    host: 'DVDTube-7f1c2a9e',
    txt: { id: '7f1c2a9e-1111', v: '1', kind: 'desktop', name: 'Máy tính phòng khách' },
  }

  it('round-trips packets (UTF-8 labels, TXT, SRV, A)', () => {
    const packet = announcement({ ...advert, instance: 'Tivi phòng khách. TCL' }, '192.168.1.20')
    const decoded = decodePacket(encodePacket(packet))
    assert.equal(decoded.flags, 0x8400)
    assert.deepEqual(
      decoded.answers.map((r) => r.type),
      [TYPE_PTR, TYPE_SRV, TYPE_TXT, TYPE_A],
    )
    const ptr = decoded.answers[0]
    assert.deepEqual(ptr.data, { kind: 'ptr', target: ['Tivi phòng khách. TCL', '_dvdtube', '_tcp', 'local'] })
    const srv = decoded.answers[1]
    assert.equal(srv.flush, true)
    assert.deepEqual(srv.data, { kind: 'srv', srv: { priority: 0, weight: 0, port: 8766, target: ['DVDTube-7f1c2a9e', 'local'] } })
    assert.deepEqual(txtMap((decoded.answers[2].data as { entries: string[] }).entries), advert.txt)
    assert.deepEqual(decoded.answers[3].data, { kind: 'a', address: '192.168.1.20' })
    assert.ok(announcement(advert, '192.168.1.20', true).answers.every((r) => r.ttl === 0))
  })

  it('reads compressed names', () => {
    // Question _dvdtube._tcp.local at offset 12; the answer points back to it twice.
    const name = Buffer.from([8, ...Buffer.from('_dvdtube'), 4, ...Buffer.from('_tcp'), 5, ...Buffer.from('local'), 0])
    const header = Buffer.from([0, 0, 0x84, 0, 0, 1, 0, 1, 0, 0, 0, 0])
    const question = Buffer.concat([name, Buffer.from([0, 12, 0, 1])])
    const rdata = Buffer.from([2, ...Buffer.from('TV'), 0xc0, 12])
    const answer = Buffer.concat([Buffer.from([0xc0, 12, 0, 12, 0, 1, 0, 0, 0x11, 0x94, 0, rdata.length]), rdata])
    const bytes = Buffer.concat([header, question, answer])
    const decoded = decodePacket(bytes)
    assert.deepEqual(decoded.questions[0].name, ['_dvdtube', '_tcp', 'local'])
    assert.deepEqual(decoded.answers[0].name, ['_dvdtube', '_tcp', 'local'])
    assert.equal(decoded.answers[0].ttl, 4500)
    assert.deepEqual(decoded.answers[0].data, { kind: 'ptr', target: ['TV', '_dvdtube', '_tcp', 'local'] })
    assert.throws(() => decodePacket(bytes.subarray(0, bytes.length - 3)))
    // A pointer loop is rejected, not followed forever.
    const loop = Buffer.concat([Buffer.from([0, 0, 0x84, 0, 0, 1, 0, 0, 0, 0, 0, 0]), Buffer.from([0xc0, 12, 0, 12, 0, 1])])
    assert.throws(() => decodePacket(loop))
  })

  it('answers browse, resolve and address queries', () => {
    const ptr = answersFor(advert, [{ name: ['_dvdtube', '_tcp', 'local'], type: TYPE_PTR }], '10.0.0.5')
    assert.deepEqual(ptr.answers.map((r) => r.type), [TYPE_PTR])
    assert.deepEqual(ptr.additionals.map((r) => r.type), [TYPE_SRV, TYPE_TXT, TYPE_A])
    const services = answersFor(advert, [{ name: ['_services', '_dns-sd', '_udp', 'local'], type: TYPE_PTR }], '10.0.0.5')
    assert.deepEqual(services.answers[0].data, { kind: 'ptr', target: ['_dvdtube', '_tcp', 'local'] })
    const srv = answersFor(advert, [{ name: ['desktop-abc', '_DVDTUBE', '_tcp', 'local'], type: TYPE_SRV }], '10.0.0.5')
    assert.deepEqual(srv.answers.map((r) => r.type), [TYPE_SRV])
    assert.deepEqual(srv.additionals.map((r) => r.type), [TYPE_A])
    const a = answersFor(advert, [{ name: ['DVDTube-7f1c2a9e', 'local'], type: TYPE_A }], '10.0.0.5')
    assert.deepEqual(a.answers[0].data, { kind: 'a', address: '10.0.0.5' })
    assert.equal(answersFor(advert, [{ name: ['_googlecast', '_tcp', 'local'], type: TYPE_PTR }], '10.0.0.5').answers.length, 0)
    assert.equal(Buffer.byteLength(label('Ổ'.repeat(40))) <= 63, true)
  })

  it('discovers receivers from answers and goodbyes', () => {
    const found = new Map<string, FoundService>()
    const packet: DnsPacket = { ...announcement({ ...advert, instance: 'TCL Smart TV Pro', txt: { id: 'tv-1', v: '1', kind: 'tv', name: 'TCL Smart TV Pro' } }, '192.168.1.50') }
    assert.equal(absorb(found, '_dvdtube._tcp', packet, '192.168.1.50'), true)
    const [service] = found.values()
    assert.equal(service.port, 8766)
    assert.deepEqual(service.addresses, ['192.168.1.50'])
    const device = deviceFromService(service, [{ name: 'Wi-Fi', address: '192.168.1.10', netmask: '255.255.255.0' }])!
    assert.deepEqual(
      { id: device.id, name: device.name, kind: device.kind, host: device.host, port: device.port },
      { id: 'tv-1', name: 'TCL Smart TV Pro', kind: 'tv', host: '192.168.1.50', port: 8766 },
    )
    assert.equal(pickAddress({ ...service, addresses: ['10.9.9.9', '192.168.1.50'] }, [{ name: 'Wi-Fi', address: '192.168.1.10', netmask: '255.255.255.0' }]), '192.168.1.50')
    // Goodbye (TTL 0) removes it.
    assert.equal(absorb(found, '_dvdtube._tcp', announcement({ ...advert, instance: 'TCL Smart TV Pro' }, '192.168.1.50', true), '192.168.1.50'), true)
    assert.equal(found.size, 0)
  })
})

describe('DNS-SD on the network', () => {
  // Any non-loopback IPv4 interface works for a same-host multicast round trip.
  const iface = Object.entries(networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((e) => ({ name, ...e })))
    .find((e) => e.family === 'IPv4' && !e.internal)

  it('advertises and finds a receiver over multicast', { skip: !iface && 'no network interface' }, async () => {
    const interfaces = () => [{ name: iface!.name, address: iface!.address, netmask: iface!.netmask }]
    const port = 20000 + Math.floor(Math.random() * 20000)
    const receiver = new Mdns({ port, interfaces })
    const sender = new Mdns({ port, interfaces })
    await receiver.start()
    await sender.start()
    try {
      receiver.advertise({ instance: 'Máy tính thử', type: '_dvdtube._tcp', port: 8766, host: 'DVDTube-test', txt: { id: 'test-id', v: '1', kind: 'desktop', name: 'Máy tính thử' } })
      await new Promise((r) => setTimeout(r, 300))
      const found = new Promise<FoundService[]>((resolve) => {
        sender.onChange = () => {
          const list = sender.services()
          if (list.some((s) => s.port && s.txt)) resolve(list)
        }
      })
      sender.browse('_dvdtube._tcp')
      const list = await Promise.race([found, new Promise<FoundService[]>((r) => setTimeout(() => r(sender.services()), 3000))])
      const service = list.find((s) => s.txt?.id === 'test-id')
      assert.ok(service, 'the receiver was found')
      assert.equal(service!.port, 8766)
      assert.equal(service!.txt?.name, 'Máy tính thử')
      assert.equal(service!.instance[0], 'Máy tính thử')
    } finally {
      await receiver.stop()
      await sender.stop()
    }
  })
})

describe('cast queue edits', () => {
  const v = (id: string): VideoItem => ({ id: id.padEnd(11, '_'), title: id })
  const ids = (queue: VideoItem[]) => queue.map((x) => x.title).join('')
  const queue = ['a', 'b', 'c', 'd', 'e'].map(v)
  const edit = (op: CastQueueEdit['op'], index: number, id: string | null, to: number | null = null): CastQueueEdit => ({
    op,
    index,
    videoId: id ? id.padEnd(11, '_') : null,
    to,
  })

  it('removes, but not what plays, and keeps the current index on the same video', () => {
    const before = applyQueueEdit(queue, 2, edit('remove', 0, 'a'))!
    assert.equal(ids(before.queue), 'bcde')
    assert.equal(before.index, 1)
    const after = applyQueueEdit(queue, 2, edit('remove', 4, 'e'))!
    assert.equal(ids(after.queue), 'abcd')
    assert.equal(after.index, 2)
    assert.equal(applyQueueEdit(queue, 2, edit('remove', 2, 'c')), null)
  })

  it('moves ("Phát tiếp theo") and follows the playing video', () => {
    // e right after the current c.
    let r = applyQueueEdit(queue, 2, edit('move', 4, 'e', 3))!
    assert.equal(ids(r.queue), 'abced')
    assert.equal(r.index, 2)
    // a (already played) right after c: c moves to 1, a lands at 2.
    r = applyQueueEdit(queue, 2, edit('move', 0, 'a', 2))!
    assert.equal(ids(r.queue), 'bcade')
    assert.equal(r.index, 1)
    // The playing video itself.
    r = applyQueueEdit(queue, 2, edit('move', 2, 'c', 4))!
    assert.equal(ids(r.queue), 'abdec')
    assert.equal(r.index, 4)
    // Past the end: clamped.
    r = applyQueueEdit(queue, 0, edit('move', 1, 'b', 99))!
    assert.equal(ids(r.queue), 'acdeb')
  })

  it('finds the item by id when the queue changed meanwhile, else does nothing', () => {
    const r = applyQueueEdit(queue, 0, edit('play', 1, 'd'))!
    assert.equal(r.play, 3)
    assert.equal(applyQueueEdit(queue, 0, edit('remove', 1, 'zzz')), null)
  })

  it('clears all but the playing video', () => {
    const r = applyQueueEdit(queue, 3, edit('clear', 0, null))!
    assert.equal(ids(r.queue), 'd')
    assert.equal(r.index, 0)
  })

  it('validates edit bodies', () => {
    assert.deepEqual(parseQueueEdit({ op: 'play', index: 2.7, videoId: 'dQw4w9WgXcQ' }), { op: 'play', index: 2, videoId: 'dQw4w9WgXcQ', to: null })
    assert.equal(parseQueueEdit({ op: 'remove', index: 1, videoId: 'bad id!' }), null)
    assert.equal(parseQueueEdit(null), null)
  })
})
