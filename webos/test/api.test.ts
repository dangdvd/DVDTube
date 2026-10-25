// The service started in-process: the local JSON API (routing, token, errors, CORS, events),
// the stream API through the relay, the account session, and the three LAN servers — the cast
// receiver (8766), "Đăng nhập bằng điện thoại" (8765) and "Đồng bộ thư viện" (8768) — speaking
// the exact protocols of the phone / desktop apps.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { setFetcher, type Transport } from '../../windows/src/main/core/http'
import { cookiesJson, decode, decrypt, encode, encrypt } from '../../windows/src/main/core/tvlogin'
import { makeLibraryExport, parseLibraryExport, type LibraryExport } from '../../windows/src/shared/library'
import type { ServiceEvent } from '../service/src/events'
import { nodeFetch } from '../service/src/fetcher'
import { startRuntime, type Runtime } from '../service/src/runtime'

// MARK: Fake YouTube (behind the core's fetcher) and fake googlevideo (a local server)

interface YtCall {
  transport: Transport
  url: URL
  headers: Record<string, string>
}

const ytCalls: YtCall[] = []
let upstream: Server
let up = ''

const ACCOUNT_MENU = {
  actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: { simpleText: 'Minh Anh' }, channelHandle: { simpleText: '@minhanh' } } } } } } }],
}

function youtube(call: YtCall): { status?: number; json: unknown } {
  const path = call.url.pathname
  if (path.endsWith('/account/account_menu')) {
    // Only a signed-in request (SAPISIDHASH + cookies) gets the profile.
    return call.transport === 'auth' && /^SAPISIDHASH /.test(call.headers['Authorization'] ?? '') ? { json: ACCOUNT_MENU } : { json: { responseContext: {} } }
  }
  if (path.endsWith('/visitor_id')) return { json: { responseContext: { visitorData: 'VISITOR_1' } } }
  if (path.endsWith('/player')) {
    return {
      json: {
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed', channelId: 'UC4QobU6STFB0P71PMvOGN5A', lengthSeconds: '19' },
        streamingData: {
          hlsManifestUrl: `${up}/api/manifest/hls_variant/c/VISIONOS/index.m3u8`,
          formats: [{ itag: 18, url: `${up}/videoplayback?itag=18`, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', width: 640, height: 360, contentLength: '1000', bitrate: 500000 }],
        },
      },
    }
  }
  return { json: {} }
}

const MASTER = `#EXTM3U
#EXT-X-MEDIA:URI="/a/en.m3u8",TYPE=AUDIO,GROUP-ID="234",NAME="English original",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:URI="/a/vi.m3u8",TYPE=AUDIO,GROUP-ID="234",NAME="Tiếng Việt",LANGUAGE="vi",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,AUDIO="234"
/v/720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="234"
/v/1080.m3u8
`

// MARK: Helpers

let rt: Runtime
let api = ''

async function call(method: string, ...args: unknown[]): Promise<{ ok: boolean; result?: any; error?: string; kind?: string | null }> {
  const r = await fetch(`${api}/api/call?m=${method}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ t: rt.token, args }) })
  assert.equal(r.status, 200, `${method}: HTTP ${r.status}`)
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
  return (await r.json()) as { ok: boolean; result?: unknown; error?: string }
}

async function nextEvent(name: string, after: number, timeoutMs = 5000): Promise<ServiceEvent> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = rt.events.since(after).find((e) => e.name === name)
    if (found) return found
    await rt.events.wait(rt.events.lastSeq, 200)
  }
  throw new Error(`no ${name} event`)
}

function qrParams(qr: string): { host: string; token: Buffer; key: Buffer; name: string } {
  const q = new URL(qr.replace(/^dvdtube:\/\/[a-z-]+/, 'https://x/')).searchParams
  return { host: q.get('h')!, token: decode(q.get('t'))!, key: decode(q.get('k'))!, name: q.get('n')! }
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: r.status, json: await r.json() }
}

function sealed(token: Buffer, key: Buffer, plaintext: string): { t: string; n: string; c: string } {
  const { nonce, sealed } = encrypt(key, token, Buffer.from(plaintext, 'utf8'))
  return { t: encode(token), n: encode(nonce), c: encode(sealed) }
}

before(async () => {
  upstream = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (path.endsWith('index.m3u8')) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end(MASTER)
    } else if (path.endsWith('.m3u8')) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n/seg/0.ts\n#EXT-X-ENDLIST\n')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`

  rt = await startRuntime({
    version: '1.0.7',
    apiPort: 0,
    castPort: 0,
    mdns: false,
    remoteConfig: false,
    lan: { address: '127.0.0.1', pairingPort: 0, syncPort: 0 },
    allowHost: (host) => host === '127.0.0.1',
  })
  api = `http://127.0.0.1:${rt.port}`
  // YouTube requests of the core go to the fake; everything else (googlevideo here) is real.
  setFetcher(async (transport, url, init) => {
    const u = new URL(url)
    if (u.hostname === '127.0.0.1') return (await nodeFetch(url, init)) as unknown as Response
    const call: YtCall = { transport, url: u, headers: init.headers ?? {} }
    ytCalls.push(call)
    const { status = 200, json } = youtube(call)
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
  })
})

after(async () => {
  await rt?.stop()
  upstream?.close()
})

// MARK: Tests

describe('local API', () => {
  test('health, CORS preflight and routing errors', async () => {
    const health = await fetch(`${api}/health`)
    assert.deepEqual(await health.json(), { ok: true, app: 'DVDTube', version: '1.0.7' })
    assert.equal(health.headers.get('access-control-allow-origin'), '*')

    const preflight = await fetch(`${api}/api/call?m=appInfo`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'content-type' } })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true')
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type')

    const wrongToken = await fetch(`${api}/api/call?m=appInfo`, { method: 'POST', body: JSON.stringify({ t: 'nope', args: [] }) })
    assert.equal(wrongToken.status, 403)
    assert.equal(((await wrongToken.json()) as { error: string }).error, 'Không có quyền truy cập.')

    for (const name of ['nothing', 'toString', '__proto__', 'constructor', '']) {
      const r = await fetch(`${api}/api/call?m=${name}`, { method: 'POST', body: JSON.stringify({ t: rt.token }) })
      assert.equal(r.status, 404, name)
    }
    assert.equal((await fetch(`${api}/api/call?m=appInfo`, { method: 'POST', body: '{nope' })).status, 400)
    assert.equal((await fetch(`${api}/api/call?m=appInfo`)).status, 405)
    assert.equal((await fetch(`${api}/elsewhere`)).status, 404)
    assert.equal((await fetch(`${api}/hls/master.m3u8?k=wrong&u=x`)).status, 403)
    assert.equal((await fetch(`${api}/api/events?t=wrong`)).status, 403)
  })

  test('calls return results or Vietnamese errors', async () => {
    const info = await call('appInfo')
    assert.equal(info.ok, true)
    assert.equal(info.result.version, '1.0.7')
    assert.equal(info.result.platform, 'webos')
    assert.equal(info.result.signedIn, false)
    assert.match(info.result.node, /^v\d+/)

    const bad = await call('watchInfo', 'không phải mã')
    assert.deepEqual([bad.ok, bad.error], [false, 'Mã video không hợp lệ.'])
    const empty = await call('search', '')
    assert.deepEqual([empty.ok, empty.error], [false, 'Từ khóa không hợp lệ.'])
    assert.deepEqual((await call('suggestions', '   ')).result, [])
    const signedOut = await call('accountFeed', 'history')
    assert.equal(signedOut.ok, false)
    assert.equal(signedOut.kind, 'signedOut')
  })

  test('events: catch up and long-poll', async () => {
    const start = rt.events.lastSeq
    rt.events.emit('hello', { a: 1 })
    const caught = (await (await fetch(`${api}/api/events?t=${rt.token}&after=${start}&wait=0`)).json()) as { ok: boolean; last: number; events: ServiceEvent[] }
    assert.equal(caught.events.length, 1)
    assert.deepEqual([caught.events[0].name, caught.events[0].payload], ['hello', { a: 1 }])
    const pending = fetch(`${api}/api/events?t=${rt.token}&after=${caught.last}&wait=5000`).then((r) => r.json() as Promise<{ events: ServiceEvent[] }>)
    setTimeout(() => rt.events.emit('later', 2), 100)
    const t0 = Date.now()
    const waited = await pending
    assert.ok(Date.now() - t0 < 3000, 'answered as soon as the event came')
    assert.deepEqual(waited.events.map((e) => e.name), ['later'])
    // A UI that kept a sequence number from an earlier service run gets everything again.
    const future = (await (await fetch(`${api}/api/events?t=${rt.token}&after=999999&wait=0`)).json()) as { events: ServiceEvent[] }
    assert.ok(future.events.length >= 2)
  })
})

describe('stream API through the relay', () => {
  test('stream() answers relay URLs, qualities and audio tracks', async () => {
    const r = await call('stream', 'jNQXAC9IVRw', { quality: 720, audioLanguage: 'vi' })
    assert.equal(r.ok, true, r.error)
    const s = r.result
    assert.equal(s.title, 'Me at the zoo')
    assert.deepEqual(s.qualities, [1080, 720])
    assert.deepEqual(s.audioTracks.map((t: { language: string }) => t.language).sort(), ['en', 'vi'])
    const hls = new URL(s.hls)
    assert.equal(hls.origin, api)
    assert.equal(hls.pathname, '/hls/master.m3u8')
    assert.equal(hls.searchParams.get('k'), rt.token)
    assert.equal(hls.searchParams.get('q'), '720')
    assert.equal(hls.searchParams.get('a'), 'vi')
    assert.ok(s.mp4.startsWith(`${api}/media?`))
    assert.equal(s.mp4Quality, 360)

    const master = await (await fetch(s.hls)).text()
    assert.ok(master.includes('RESOLUTION=1280x720'))
    assert.ok(!master.includes('RESOLUTION=1920x1080'), 'capped at 720p')
    assert.ok(master.includes('LANGUAGE="vi"'))
    assert.ok(!master.includes('LANGUAGE="en"'), 'only the chosen audio language')
    const media = master.split('\n').find((line) => line.startsWith('http://127.0.0.1') && line.includes('/hls/playlist.m3u8'))
    assert.ok(media)
    const playlist = await (await fetch(media!)).text()
    assert.match(playlist, /\/hls\/segment\?k=/)
  })
})

describe('account session', () => {
  test('setSession → signed in, profile from YouTube; cookies never logged', async () => {
    const cookies = { SAPISID: 'sapisid-value-123', LOGIN_INFO: 'login-info-value-456', SID: 'sid-value-789', 'bad;name': 'x' }
    const after0 = rt.events.lastSeq
    const state = await call('setSession', { cookies, identity: { authUser: 0, pageId: null } })
    assert.equal(state.result.signedIn, true)
    const account = await nextEvent('account', after0)
    assert.equal((account.payload as { profile: { name: string } }).profile.name, 'Minh Anh')
    const menu = ytCalls.find((c) => c.url.pathname.endsWith('/account/account_menu'))!
    assert.equal(menu.transport, 'auth')
    assert.equal(menu.url.hostname, 'www.youtube.com')
    const exported = await call('exportSession')
    assert.deepEqual(exported.result.cookies, { SAPISID: 'sapisid-value-123', LOGIN_INFO: 'login-info-value-456', SID: 'sid-value-789' })
    const logs = rt.log.join('\n') + JSON.stringify((await call('diagnostics')).result)
    for (const secret of Object.values(cookies)) if (secret !== 'x') assert.ok(!logs.includes(secret), 'cookie value in the log')
    const out = await call('signOut')
    assert.equal(out.result.signedIn, false)
    assert.equal((await call('exportSession')).result, null)
  })
})

describe('cast receiver (kind tv)', () => {
  test('configure starts it; /api/info, /api/play → castCommand, /api/status', async () => {
    await call('configure', { deviceName: 'Phòng khách TV', deviceId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', castReceiver: true, language: 'vi', region: 'VN' })
    const deadline = Date.now() + 5000
    while (!rt.cast.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert.ok(rt.cast.running)
    const cast = `http://127.0.0.1:${rt.cast.port}`
    const info = (await (await fetch(`${cast}/api/info`)).json()) as Record<string, unknown>
    assert.deepEqual(info, { ok: true, app: 'DVDTube', protocol: 1, id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', name: 'Phòng khách TV', kind: 'tv', version: '1.0.7', features: ['queue-edit'] })
    assert.equal((await call('appInfo')).result.castRunning, true)

    const before = rt.events.lastSeq
    const play = await postJson(`${cast}/api/play`, { video: { id: 'jNQXAC9IVRw', title: 'Me at the zoo' }, startSeconds: 5, sender: 'Điện thoại' })
    assert.deepEqual(play, { status: 200, json: { ok: true } })
    const command = (await nextEvent('castCommand', before)).payload as { type: string; request: { video: { id: string }; startSeconds: number; sender: string } }
    assert.equal(command.type, 'play')
    assert.equal(command.request.video.id, 'jNQXAC9IVRw')
    assert.equal(command.request.startSeconds, 5)
    assert.equal(command.request.sender, 'Điện thoại')
    const control = await postJson(`${cast}/api/control`, { action: 'pause' })
    assert.equal(control.status, 200)
    assert.equal(((await nextEvent('castCommand', before + 1)).payload as { action: string }).action, 'pause')
    assert.equal((await postJson(`${cast}/api/play`, { video: { id: '!' } })).status, 400)

    await call('castReceiverStatus', { state: 'playing', video: { id: 'jNQXAC9IVRw', title: 'Me at the zoo' }, position: 12.5, duration: 19, volume: 0.5 })
    const status = (await (await fetch(`${cast}/api/status`)).json()) as Record<string, any>
    assert.equal(status.state, 'playing')
    assert.equal(status.video.id, 'jNQXAC9IVRw')
    assert.equal(status.position, 12.5)

    await call('configure', { deviceName: 'Phòng khách TV', deviceId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', castReceiver: false })
    const stopDeadline = Date.now() + 5000
    while (rt.cast.running && Date.now() < stopDeadline) await new Promise((r) => setTimeout(r, 50))
    assert.equal(rt.cast.running, false)
  })
})

describe('sign in from the phone (TV login protocol)', () => {
  test('wrong token → 403, the phone session signs the TV in once', async () => {
    const before = rt.events.lastSeq
    const info = (await call('startPairing')).result
    assert.ok(info.qrDataUrl.startsWith('data:image/png;base64,'))
    assert.ok(info.qrText.startsWith('dvdtube://tv-login?h=127.0.0.1:'))
    const { host, token, key, name } = qrParams(info.qrText)
    assert.equal(name, 'Phòng khách TV')
    assert.equal(((await nextEvent('pairing', before)).payload as { state: string }).state, 'waiting')
    const url = `http://${host}/pair`
    assert.deepEqual((await (await fetch(url)).json()) as unknown, { ok: true, tv: 'Phòng khách TV' })

    const cookies = { SAPISID: 'phone-sapisid', LOGIN_INFO: 'phone-login', SID: 'phone-sid' }
    const wrong = await postJson(url, sealed(Buffer.alloc(16, 7), key, cookiesJson(cookies)))
    assert.equal(wrong.status, 403)
    assert.equal(wrong.json.error, 'Mã QR đã cũ. Hãy quét lại mã đang hiện trên TV.')
    const tampered = sealed(token, key, cookiesJson(cookies))
    tampered.c = encode(Buffer.from(decode(tampered.c)!.map((b, i) => (i === 0 ? b ^ 1 : b))))
    assert.equal((await postJson(url, tampered)).json.error, 'Không giải mã được dữ liệu đăng nhập.')
    assert.equal((await postJson(url, '{nope')).status, 400)

    const ok = await postJson(url, sealed(token, key, cookiesJson(cookies)))
    assert.deepEqual(ok, { status: 200, json: { ok: true, name: 'Minh Anh' } })
    const success = rt.events.since(before).filter((e) => e.name === 'pairing').pop()!.payload as { state: string; accountName: string }
    assert.deepEqual(success, { state: 'success', accountName: 'Minh Anh' })
    assert.equal((await call('account')).result.signedIn, true)
    assert.deepEqual((await call('exportSession')).result.cookies, cookies)
    assert.ok(rt.events.since(before).some((e) => e.name === 'session'), 'the UI is told to store the new session')
    const again = await postJson(url, sealed(token, key, cookiesJson(cookies))).catch(() => ({ status: 0, json: {} }))
    assert.notEqual(again.status, 200, 'single use')
    for (const value of Object.values(cookies)) assert.ok(!rt.log.join('\n').includes(value))
    await call('signOut')
  })

  test('cookies YouTube does not accept are refused and the old session stays', async () => {
    const info = (await call('startPairing')).result
    const { host, token, key } = qrParams(info.qrText)
    const missing = await postJson(`http://${host}/pair`, sealed(token, key, cookiesJson({ PREF: 'x' })))
    assert.equal(missing.status, 400)
    assert.equal(missing.json.error, 'Không tìm thấy cookie đăng nhập YouTube (cần LOGIN_INFO và SAPISID).')
    assert.equal((await call('account')).result.signedIn, false)
    await call('stopPairing')
  })
})

describe('library sync receiver', () => {
  test('the phone library is merged by the UI and the merged library goes back encrypted', async () => {
    const before = rt.events.lastSeq
    const info = (await call('startSyncReceiver')).result
    assert.ok(info.qrText.startsWith('dvdtube://sync?h=127.0.0.1:'))
    const { host, token, key, name } = qrParams(info.qrText)
    assert.equal(name, 'Phòng khách TV')
    const url = `http://${host}/sync`
    assert.deepEqual((await (await fetch(url)).json()) as unknown, { ok: true, name: 'Phòng khách TV' })

    const video = { id: 'jNQXAC9IVRw', title: 'Me at the zoo', channelName: 'jawed', channelId: 'UC4QobU6STFB0P71PMvOGN5A' }
    const phone = makeLibraryExport(
      { subscriptions: [], history: [{ video: video as never, watchedAt: 1000, position: 5, duration: 19 }], watchLater: [], liked: [], playlists: [], searchHistory: ['nhạc trẻ'] },
      'Điện thoại của Minh',
      'android',
    )
    const reply = postJson(url, sealed(token, key, JSON.stringify(phone)))
    const incoming = (await nextEvent('syncIncoming', before)).payload as { requestId: string; device: string; library: LibraryExport }
    assert.equal(incoming.device, 'Điện thoại của Minh')
    assert.deepEqual(incoming.library.searchHistory, ['nhạc trẻ'])
    const merged = { ...incoming.library, device: 'Phòng khách TV', platform: 'tv', searchHistory: ['nhạc trẻ', 'tin tức'] }
    await call('syncReply', incoming.requestId, merged, 'Đã thêm 1 video vào lịch sử')
    const answer = await reply
    assert.equal(answer.status, 200)
    const plain = decrypt(key, token, decode(answer.json.n)!, decode(answer.json.c)!)
    assert.ok(plain)
    const back = parseLibraryExport(JSON.parse(plain!.toString('utf8')))!
    assert.deepEqual(back.searchHistory, ['nhạc trẻ', 'tin tức'])
    assert.equal(back.history[0].video.id, 'jNQXAC9IVRw')
    const status = rt.events.since(before).filter((e) => e.name === 'syncStatus').map((e) => (e.payload as { state: string }).state)
    assert.deepEqual(status, ['waiting', 'merging', 'success'])
  })

  test('wrong token and garbage are refused', async () => {
    const info = (await call('startSyncReceiver')).result
    const { host, key, token } = qrParams(info.qrText)
    const wrong = await postJson(`http://${host}/sync`, sealed(Buffer.alloc(16, 1), key, '{}'))
    assert.equal(wrong.status, 403)
    assert.equal(wrong.json.error, 'Mã QR đã cũ. Hãy quét lại mã đang hiển thị.')
    const notLibrary = await postJson(`http://${host}/sync`, sealed(token, key, '{"format":"other"}'))
    assert.equal(notLibrary.json.error, 'Dữ liệu thư viện không hợp lệ.')
    await call('stopSyncReceiver')
  })
})
