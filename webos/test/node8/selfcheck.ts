// A self-check built exactly like service.js (target node8, polyfills injected) and run by
// bundle.test.ts under the current Node and under OLD_NODE (Node 8.12 = webOS TV 5). It drives
// the real code paths that use newer APIs: the polyfills, the fetcher's body decoding, the core's
// InnerTube player + SAPISIDHASH auth, the API server, the HLS relay, the TV-login AES-GCM
// pairing (with its QR code) and the library sync. Prints "SELFCHECK OK" or fails with exit 1.

import * as assert from 'assert'
import * as http from 'http'
import * as zlib from 'zlib'
import { setFetcher } from '../../../windows/src/main/core/http'
import { coreState } from '../../../windows/src/main/core/config'
import { NumberText } from '../../../windows/src/main/core/extras'
import { cookiesJson, decode, decrypt, encode, encrypt } from '../../../windows/src/main/core/tvlogin'
import { makeLibraryExport, parseLibraryExport } from '../../../windows/src/shared/library'
import { HeadersLike, ResponseLike, nodeFetch } from '../../service/src/fetcher'
import { startRuntime } from '../../service/src/runtime'

const g = globalThis as any

function checkPolyfills(): void {
  assert.strictEqual(typeof g.URL, 'function')
  const u = new URL('https://www.youtube.com/watch?v=abc&t=10')
  assert.strictEqual(u.searchParams.get('t'), '10')
  assert.strictEqual(new TextDecoder().decode(new TextEncoder().encode('Tiếng Việt')), 'Tiếng Việt')
  assert.deepStrictEqual([[1, [2]], [3]].flat(), [1, [2], 3])
  assert.deepStrictEqual([1, 2].flatMap((x) => [x, x * 10]), [1, 10, 2, 20])
  assert.deepStrictEqual(Object.fromEntries([['a', 1]]), { a: 1 })
  assert.strictEqual('  x'.trimStart(), 'x')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test((require('crypto') as { randomUUID(): string }).randomUUID()))
  assert.strictEqual(Buffer.from([0xfb, 0xff]).toString('base64url' as BufferEncoding), '-_8')
  assert.deepStrictEqual([...Buffer.from('-_8', 'base64url' as BufferEncoding)], [0xfb, 0xff])
  const controller = new AbortController()
  let aborted = false
  controller.signal.addEventListener('abort', () => (aborted = true))
  controller.abort()
  assert.ok(aborted && controller.signal.aborted)
  coreState.hl = 'vi'
  assert.strictEqual(NumberText.compact(1_500_000), '1,5 Tr')
  assert.strictEqual(NumberText.relative(Date.now() - 2 * 86_400_000 - 1000), '2 ngày trước')
}

const BODY = 'Xin chào '.repeat(100)
const MASTER = `#EXTM3U
#EXT-X-MEDIA:URI="/a/vi.m3u8",TYPE=AUDIO,GROUP-ID="a",NAME="Tiếng Việt",LANGUAGE="vi",DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,AUDIO="a"
/v/720.m3u8
`

function startUpstream(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0]
    if (path === '/gzip') {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.end(zlib.gzipSync(BODY))
    } else if (path === '/deflate') {
      res.writeHead(200, { 'Content-Encoding': 'deflate' })
      res.end(zlib.deflateRawSync(BODY))
    } else if (path === '/index.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end(MASTER)
    } else if (path.endsWith('.m3u8')) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXTINF:5,\n/seg/0.ts\n#EXT-X-ENDLIST\n')
    } else if (path === '/seg/0.ts') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from([0x47, 1, 2, 3]))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` })))
}

async function main(): Promise<void> {
  checkPolyfills()
  const { server, base } = await startUpstream()
  assert.strictEqual(await (await nodeFetch(`${base}/gzip`)).text(), BODY)
  assert.strictEqual(await (await nodeFetch(`${base}/deflate`)).text(), BODY)

  const rt = await startRuntime({ apiPort: 0, castPort: 0, mdns: false, remoteConfig: false, lan: { address: '127.0.0.1', pairingPort: 0, syncPort: 0 }, allowHost: (h) => h === '127.0.0.1' })
  setFetcher(async (transport, url, init) => {
    const u = new URL(url)
    let json: unknown = {}
    if (u.pathname.endsWith('/player')) {
      json = {
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', lengthSeconds: '19' },
        streamingData: { hlsManifestUrl: `${base}/index.m3u8` },
      }
    } else if (u.pathname.endsWith('/visitor_id')) {
      json = { responseContext: { visitorData: 'V' } }
    } else if (u.pathname.endsWith('/account/account_menu') && transport === 'auth' && /^SAPISIDHASH \d+_[0-9a-f]{40}/.test((init.headers || {})['Authorization'] || '')) {
      json = { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: { simpleText: 'Minh Anh' } } } } } } }] }
    }
    return new ResponseLike(Buffer.from(JSON.stringify(json)), 200, new HeadersLike({ 'content-type': 'application/json' }), url) as unknown as Response
  })
  const api = `http://127.0.0.1:${rt.port}`
  const call = async (method: string, ...args: unknown[]): Promise<any> => {
    const r = (await (await nodeFetch(`${api}/api/call?m=${method}`, { method: 'POST', body: JSON.stringify({ t: rt.token, args }) })).json()) as { ok: boolean; result: unknown; error?: string }
    if (!r.ok) throw new Error(`${method}: ${r.error}`)
    return r.result
  }
  const post = async (url: string, body: unknown): Promise<any> => (await nodeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()

  // Stream + relay.
  const stream = await call('stream', 'jNQXAC9IVRw', { quality: 0 })
  assert.deepStrictEqual(stream.qualities, [720])
  const master = await (await nodeFetch(stream.hls)).text()
  const media = master.split('\n').filter((l) => l.indexOf('http://') === 0 && l.indexOf('/hls/playlist.m3u8') > 0)[0]
  assert.ok(media, master)
  const playlist = await (await nodeFetch(media)).text()
  const segment = playlist.split('\n').filter((l) => l.indexOf('http://') === 0 && l.indexOf('/hls/segment') > 0)[0]
  const bytes = Buffer.from(await (await nodeFetch(segment)).arrayBuffer())
  assert.deepStrictEqual([...bytes], [0x47, 1, 2, 3])

  // Pairing (AES-256-GCM, QR code, SAPISIDHASH).
  const pairing = await call('startPairing')
  assert.ok(pairing.qrDataUrl.indexOf('data:image/png;base64,') === 0)
  const q = new URL(pairing.qrText.replace('dvdtube://tv-login', 'https://x/')).searchParams
  const token = decode(q.get('t'))!
  const key = decode(q.get('k'))!
  const sealedCookies = encrypt(key, token, Buffer.from(cookiesJson({ SAPISID: 'a', LOGIN_INFO: 'b', SID: 'c' })))
  const paired = await post(`http://${q.get('h')}/pair`, { t: encode(token), n: encode(sealedCookies.nonce), c: encode(sealedCookies.sealed) })
  assert.deepStrictEqual(paired, { ok: true, name: 'Minh Anh' })
  assert.strictEqual((await call('account')).signedIn, true)

  // Library sync.
  const sync = await call('startSyncReceiver')
  const s = new URL(sync.qrText.replace('dvdtube://sync', 'https://x/')).searchParams
  const sToken = decode(s.get('t'))!
  const sKey = decode(s.get('k'))!
  const library = makeLibraryExport({ subscriptions: [], history: [], watchLater: [], liked: [], playlists: [], searchHistory: ['nhạc'] }, 'Điện thoại', 'android')
  const sealedLibrary = encrypt(sKey, sToken, Buffer.from(JSON.stringify(library)))
  const after = rt.events.lastSeq
  const reply = post(`http://${s.get('h')}/sync`, { t: encode(sToken), n: encode(sealedLibrary.nonce), c: encode(sealedLibrary.sealed) })
  let incoming = null as { requestId: string; library: typeof library } | null
  for (let i = 0; i < 50 && !incoming; i++) {
    const found = (await rt.events.wait(after, 200)).filter((e) => e.name === 'syncIncoming')[0]
    if (found) incoming = found.payload as typeof incoming
  }
  assert.ok(incoming, 'syncIncoming')
  await call('syncReply', incoming!.requestId, { ...incoming!.library, device: 'TV', searchHistory: ['nhạc', 'tin tức'] }, 'xong')
  const answer = await reply
  const plain = decrypt(sKey, sToken, decode(answer.n)!, decode(answer.c)!)
  assert.deepStrictEqual(parseLibraryExport(JSON.parse(plain!.toString('utf8')))!.searchHistory, ['nhạc', 'tin tức'])

  await rt.stop()
  server.close()
  console.log(`SELFCHECK OK ${process.version}`)
  // keep-alive agents would hold the process a few seconds longer
  setTimeout(() => process.exit(0), 50)
}

main().catch((error) => {
  console.error(`SELFCHECK FAILED ${process.version}: ${error && error.stack ? error.stack : String(error)}`)
  process.exit(1)
})
