// The Node fetcher shim the core runs on inside the webOS service: body decoding, the Response /
// Headers look-alikes, redirects, POST bodies, abort, and the cookie jars (account cookies only
// ever go to youtube.com).

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import * as zlib from 'node:zlib'
import { requestText, setFetcher } from '../../windows/src/main/core/http'
import { CookieJar, HeadersLike, ResponseLike, VisitorJar, createFetcher, nodeFetch, parseSetCookie } from '../service/src/fetcher'

const BODY = 'Xin chào, DVDTube! '.repeat(200)

interface Seen {
  path: string
  method: string
  headers: IncomingMessage['headers']
  body: string
}

let server: Server
let base = ''
const seen: Seen[] = []

function handle(req: IncomingMessage, res: ServerResponse, body: string): void {
  const url = new URL(req.url ?? '/', 'http://x')
  seen.push({ path: url.pathname, method: req.method ?? '', headers: req.headers, body })
  switch (url.pathname) {
    case '/gzip':
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(zlib.gzipSync(BODY))
      return
    case '/deflate':
      res.writeHead(200, { 'Content-Encoding': 'deflate' })
      res.end(zlib.deflateSync(BODY))
      return
    case '/raw-deflate':
      res.writeHead(200, { 'Content-Encoding': 'deflate' })
      res.end(zlib.deflateRawSync(BODY))
      return
    case '/plain':
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Multi': 'a' })
      res.end(JSON.stringify({ ok: true, text: 'Tiếng Việt' }))
      return
    case '/redirect':
      res.writeHead(302, { Location: '/plain', 'Set-Cookie': 'hop=1; Path=/' })
      res.end()
      return
    case '/redirect-other-host':
      res.writeHead(302, { Location: `http://localhost:${(server.address() as AddressInfo).port}/echo` })
      res.end()
      return
    case '/redirect-307':
      res.writeHead(307, { Location: '/echo' })
      res.end()
      return
    case '/loop':
      res.writeHead(302, { Location: '/loop' })
      res.end()
      return
    case '/echo':
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ method: req.method, body, cookie: req.headers.cookie ?? null, ua: req.headers['user-agent'] ?? null }))
      return
    case '/status/404':
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('không tìm thấy')
      return
    case '/slow':
      // Never answers; the client aborts.
      return
    case '/cookies':
      res.writeHead(200, { 'Set-Cookie': ['YSC=abc; Path=/; Domain=.youtube.com', 'SID=secret; Path=/'] })
      res.end('ok')
      return
    default:
      res.writeHead(404)
      res.end()
  }
}

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.closeAllConnections?.()
  server.close()
})

describe('Headers / Response look-alikes', () => {
  test('headers are case-insensitive and appendable', () => {
    const h = new HeadersLike({ 'Content-Type': 'text/plain', 'Set-Cookie': ['a=1', 'b=2'], Skip: undefined })
    assert.equal(h.get('content-type'), 'text/plain')
    assert.equal(h.get('SET-COOKIE'), 'a=1, b=2')
    assert.equal(h.has('skip'), false)
    h.append('X-A', '1')
    h.append('x-a', '2')
    assert.equal(h.get('x-a'), '1, 2')
    h.delete('X-A')
    assert.equal(h.get('x-a'), null)
    assert.deepEqual([...h.keys()].sort(), ['content-type', 'set-cookie'])
    const fromPairs = new HeadersLike([['A', '1'], ['a', '2']])
    assert.equal(fromPairs.get('a'), '1, 2')
  })

  test('the body can be read once (text / json / arrayBuffer)', async () => {
    const r = new ResponseLike(Buffer.from('{"a":1}'), 200, new HeadersLike(), 'http://x/')
    assert.equal(r.ok, true)
    assert.deepEqual(await r.json(), { a: 1 })
    await assert.rejects(() => r.text(), TypeError)
    const bytes = new ResponseLike(Buffer.from([1, 2, 3]), 404, new HeadersLike(), 'http://x/')
    assert.equal(bytes.ok, false)
    assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())], [1, 2, 3])
  })
})

describe('nodeFetch', () => {
  test('gzip, deflate and raw deflate bodies are decoded', async () => {
    for (const path of ['/gzip', '/deflate', '/raw-deflate']) {
      const r = await nodeFetch(base + path)
      assert.equal(r.status, 200, path)
      assert.equal(await r.text(), BODY, path)
      assert.equal(r.headers.get('content-encoding'), null, 'encoding header removed after decoding')
    }
    const last = seen[seen.length - 1]
    assert.match(String(last.headers['accept-encoding']), /gzip, deflate/)
    assert.equal(last.headers['user-agent'], 'Mozilla/5.0', 'a default user agent is sent')
  })

  test('JSON, headers and HTTP errors are returned (not thrown)', async () => {
    const r = await nodeFetch(base + '/plain', { headers: { 'User-Agent': 'DVDTube-Test' } })
    assert.equal(r.headers.get('Content-Type'), 'application/json')
    assert.deepEqual(await r.json(), { ok: true, text: 'Tiếng Việt' })
    assert.equal(seen[seen.length - 1].headers['user-agent'], 'DVDTube-Test')
    const missing = await nodeFetch(base + '/status/404')
    assert.equal(missing.status, 404)
    assert.equal(missing.ok, false)
    assert.equal(await missing.text(), 'không tìm thấy')
  })

  test('redirects are followed, Set-Cookie of every hop is reported', async () => {
    const hops: [string, string[] | undefined][] = []
    const r = await nodeFetch(base + '/redirect', { onSetCookie: (host, values) => hops.push([host, values]) })
    assert.equal(r.status, 200)
    assert.equal(r.url, base + '/plain')
    assert.deepEqual(hops[0], ['127.0.0.1', ['hop=1; Path=/']])
    assert.equal(hops.length, 2)
  })

  test('the cookie header is asked again for the host of each redirect', async () => {
    const asked: string[] = []
    const r = await nodeFetch(base + '/redirect-other-host', {
      cookieFor: (host) => {
        asked.push(host)
        return host === '127.0.0.1' ? 'A=1' : null
      },
    })
    const echo = (await r.json()) as { cookie: string | null }
    assert.deepEqual(asked, ['127.0.0.1', 'localhost'])
    assert.equal(echo.cookie, null, 'the cookie of the first host is not carried to the second')
  })

  test('POST bodies; 307 keeps the method and body; 302 turns into GET', async () => {
    const posted = (await (await nodeFetch(base + '/echo', { method: 'POST', body: '{"q":"nhạc"}' })).json()) as { method: string; body: string }
    assert.deepEqual([posted.method, posted.body], ['POST', '{"q":"nhạc"}'])
    const bytes = (await (await nodeFetch(base + '/echo', { method: 'POST', body: new Uint8Array([104, 105]) })).json()) as { body: string }
    assert.equal(bytes.body, 'hi')
    const kept = (await (await nodeFetch(base + '/redirect-307', { method: 'POST', body: 'x=1' })).json()) as { method: string; body: string }
    assert.deepEqual([kept.method, kept.body], ['POST', 'x=1'])
  })

  test('redirect loops stop after maxRedirects', async () => {
    const r = await nodeFetch(base + '/loop', { maxRedirects: 2 })
    assert.equal(r.status, 302)
  })

  test('abort signals cancel the request', async () => {
    const controller = new AbortController()
    const pending = nodeFetch(base + '/slow', { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await assert.rejects(pending, /aborted/)
    const already = new AbortController()
    already.abort()
    await assert.rejects(nodeFetch(base + '/plain', { signal: already.signal }), /aborted/)
  })

  test('bad URLs and protocols are rejected', async () => {
    await assert.rejects(nodeFetch('not a url'), TypeError)
    await assert.rejects(nodeFetch('ftp://example.com/file'), TypeError)
  })
})

describe('cookie jars', () => {
  test('Set-Cookie parsing: values, deletion and domain', () => {
    assert.deepEqual(parseSetCookie('SID=abc=def; Path=/; Domain=.youtube.com; Secure'), { name: 'SID', value: 'abc=def', remove: false, domain: 'youtube.com' })
    assert.equal(parseSetCookie('A=; Max-Age=0')?.remove, true)
    assert.equal(parseSetCookie('A=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT')?.remove, true)
    assert.equal(parseSetCookie('A=1; Expires=Thu, 01 Jan 2099 00:00:00 GMT')?.remove, false)
    assert.equal(parseSetCookie('=1'), null)
    assert.equal(parseSetCookie('garbage'), null)
  })

  test('the account jar only answers / learns for youtube.com hosts', () => {
    const jar = new CookieJar({ SID: 's', HSID: 'h', 'bad;name': 'x' })
    assert.equal(jar.size, 2)
    assert.equal(jar.header('www.youtube.com'), 'SID=s; HSID=h')
    assert.equal(jar.header('youtube.com'), 'SID=s; HSID=h')
    assert.equal(jar.header('m.youtube.com'), 'SID=s; HSID=h')
    for (const host of ['rr1---sn-abc.googlevideo.com', 'sponsor.ajay.app', 'api.github.com', 'youtube.com.evil.example', 'notyoutube.com', '127.0.0.1']) {
      assert.equal(jar.header(host), null, host)
    }
    let changes = 0
    jar.onChange = () => changes++
    jar.absorb('evil.example', ['SID=stolen'])
    jar.absorb('www.youtube.com', ['SID=x; Domain=evil.example'])
    assert.equal(jar.snapshot().SID, 's')
    assert.equal(changes, 0)
    jar.absorb('www.youtube.com', ['SID=rotated; Domain=.youtube.com', '__Secure-3PSIDTS=new'])
    assert.deepEqual(jar.snapshot(), { SID: 'rotated', HSID: 'h', '__Secure-3PSIDTS': 'new' })
    assert.equal(changes, 1)
    jar.absorb('www.youtube.com', 'SID=rotated')
    assert.equal(changes, 1, 'unchanged values do not count as rotation')
    jar.absorb('www.youtube.com', ['HSID=; Max-Age=0'])
    assert.equal(jar.snapshot().HSID, undefined)
    jar.clear()
    assert.equal(jar.header('www.youtube.com'), null)
  })

  test('the visitor jar keeps only visitor cookies', () => {
    const jar = new VisitorJar()
    jar.absorb('www.youtube.com', ['VISITOR_INFO1_LIVE=v; Domain=.youtube.com', 'YSC=y', 'SID=never', 'LOGIN_INFO=never', 'PREF=f6=40000000'])
    assert.deepEqual(jar.snapshot(), { VISITOR_INFO1_LIVE: 'v', YSC: 'y', PREF: 'f6=40000000' })
  })

  test('core requests through createFetcher never carry account cookies to other hosts', async () => {
    const auth = new CookieJar({ SID: 'account-secret' })
    const anon = new VisitorJar({ VISITOR_INFO1_LIVE: 'visitor' })
    setFetcher(createFetcher({ auth, anon }))
    try {
      for (const transport of ['auth', 'anon', 'plain'] as const) {
        const r = await requestText(base + '/echo', { transport, headers: { 'User-Agent': 'core' } })
        assert.equal(r.status, 200)
        const echo = JSON.parse(r.text) as { cookie: string | null; ua: string }
        assert.equal(echo.cookie, null, transport)
        assert.equal(echo.ua, 'core')
      }
      // Set-Cookie answers of a non-YouTube host never reach the jars.
      await requestText(base + '/cookies', { transport: 'auth' })
      await requestText(base + '/cookies', { transport: 'anon' })
      assert.deepEqual(auth.snapshot(), { SID: 'account-secret' })
      assert.deepEqual(anon.snapshot(), { VISITOR_INFO1_LIVE: 'visitor' })
      // HTTP errors come back as statuses, network failures as Vietnamese messages.
      assert.equal((await requestText(base + '/status/404')).status, 404)
      await assert.rejects(requestText('http://127.0.0.1:1/', { retry: false, timeoutMs: 3000 }), (e: Error) => /kết nối|mạng/i.test(e.message))
    } finally {
      setFetcher((_t, url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body as RequestInit['body'], signal: init.signal }))
    }
  })
})
