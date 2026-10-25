// The stream relay: playlist parsing / rewriting, the relay URL encoding, Range handling and a
// full round trip through the local server against a fake googlevideo.

import assert from 'node:assert/strict'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { VISIONOS, ANDROID_VR, resolvedUserAgent } from '../../windows/src/main/core/clients'
import { EventBus } from '../service/src/events'
import {
  analyzeMaster,
  audioTracksOf,
  chooseAudio,
  decodeTarget,
  encodeTarget,
  parseAttributes,
  parseRange,
  playableVariants,
  qualitiesOf,
  relayUrl,
  rewriteMaster,
  rewriteMedia,
  setChunkBytes,
  streamUserAgent,
  variantsUpTo,
  withRangeParam,
  type RelayContext,
} from '../service/src/hls'
import { LocalServer } from '../service/src/server'

const BASE = 'https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1/id/abc/c/VISIONOS/file/index.m3u8'

const MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/233/c/VISIONOS/index.m3u8",TYPE=AUDIO,GROUP-ID="233",NAME="English (United States) original",LANGUAGE="en-US",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/233/lang/vi/c/VISIONOS/index.m3u8",TYPE=AUDIO,GROUP-ID="233",NAME="Tiếng Việt",LANGUAGE="vi",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/234/c/VISIONOS/index.m3u8",TYPE=AUDIO,GROUP-ID="234",NAME="English (United States) original",LANGUAGE="en-US",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/234/lang/vi/c/VISIONOS/index.m3u8",TYPE=AUDIO,GROUP-ID="234",NAME="Tiếng Việt",LANGUAGE="vi",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS="avc1.4D400C,mp4a.40.5",RESOLUTION=256x144,FRAME-RATE=30,AUDIO="233",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/269/c/VISIONOS/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=30,AUDIO="234",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/232/c/VISIONOS/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="234",CLOSED-CAPTIONS=NONE
hls_playlist/itag/270/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="vp09.00.40.08,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="234"
https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/616/c/VISIONOS/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,CODECS="av01.0.12M.08,mp4a.40.2",RESOLUTION=3840x2160,FRAME-RATE=60,AUDIO="234"
https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/701/c/VISIONOS/index.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="https://manifest.googlevideo.com/iframes.m3u8"
`

const MEDIA = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="https://rr1---sn-abc.googlevideo.com/key",IV=0x01
#EXTINF:5.005,
https://rr1---sn-abc.googlevideo.com/videoplayback/id/abc/itag/232/c/VISIONOS/sq/0/file/seg.ts
#EXTINF:5.005,
seg/1.ts
#EXT-X-ENDLIST
`

const ctx: RelayContext = { port: 8770, token: 'tok123' }
const map = (absolute: string, kind: 'playlist' | 'segment') => relayUrl(ctx, kind, absolute)

function relayTarget(url: string): string | null {
  return decodeTarget(new URL(url).searchParams.get('u'))
}

describe('playlist parsing', () => {
  test('attributes with quoted commas', () => {
    const a = parseAttributes('#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,AUDIO="234"')
    assert.equal(a.BANDWIDTH, '1')
    assert.equal(a.CODECS, 'avc1.4D401F,mp4a.40.2')
    assert.equal(a.RESOLUTION, '1280x720')
    assert.equal(a.AUDIO, '234')
  })

  test('master analysis: variants, qualities, audio languages', () => {
    const info = analyzeMaster(MASTER, BASE)
    assert.equal(info.isMaster, true)
    assert.equal(info.variants.length, 5)
    assert.equal(info.audio.length, 4)
    // Relative URIs are resolved against the playlist.
    assert.equal(info.variants[2].uri, 'https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1/id/abc/c/VISIONOS/file/hls_playlist/itag/270/index.m3u8')
    assert.deepEqual(
      playableVariants(info).map((v) => v.quality),
      [144, 720, 1080],
    )
    assert.deepEqual(qualitiesOf(info), [1080, 720, 144])
    assert.deepEqual(
      variantsUpTo(playableVariants(info), 720).map((v) => v.quality),
      [144, 720],
    )
    // Below every variant: the lowest one remains.
    assert.deepEqual(
      variantsUpTo(playableVariants(info), 100).map((v) => v.quality),
      [144],
    )
    const tracks = audioTracksOf(info)
    assert.deepEqual(
      tracks.map((t) => [t.id, t.isDefault]),
      [
        ['en-US', true],
        ['vi', false],
      ],
    )
    assert.equal(chooseAudio(info, 'vi').get('234')?.language, 'vi')
    assert.equal(chooseAudio(info, null).get('233')?.language, 'en-US')
    assert.equal(chooseAudio(info, 'fr').get('233')?.language, 'en-US')
  })

  test('master rewrite: H.264 only, quality cap, one audio language, relay URIs', () => {
    const out = rewriteMaster(MASTER, BASE, { maxQuality: 720, audioLanguage: 'vi' }, map)
    assert.ok(!out.includes('I-FRAME'))
    assert.ok(!out.includes('vp09') && !out.includes('av01'))
    assert.ok(!out.includes('RESOLUTION=1920x1080'))
    assert.equal((out.match(/#EXT-X-STREAM-INF/g) ?? []).length, 2)
    const media = out.split('\n').filter((l) => l.startsWith('#EXT-X-MEDIA'))
    assert.equal(media.length, 2)
    for (const line of media) {
      assert.match(line, /LANGUAGE="vi"/)
      assert.match(line, /DEFAULT=YES/)
      const uri = /URI="([^"]+)"/.exec(line)![1]
      assert.ok(uri.startsWith('http://127.0.0.1:8770/hls/playlist.m3u8?k=tok123&u='))
      assert.match(relayTarget(uri)!, /\/lang\/vi\//)
    }
    const uris = out.split('\n').filter((l) => l && !l.startsWith('#'))
    assert.equal(uris.length, 2)
    assert.deepEqual(
      uris.map((u) => relayTarget(u)),
      [
        'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/269/c/VISIONOS/index.m3u8',
        'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/232/c/VISIONOS/index.m3u8',
      ],
    )
  })

  test('master rewrite "Tự động" keeps every H.264 variant and the default audio', () => {
    const out = rewriteMaster(MASTER, BASE, { maxQuality: 0, audioLanguage: null }, map)
    assert.equal((out.match(/#EXT-X-STREAM-INF/g) ?? []).length, 3)
    const media = out.split('\n').filter((l) => l.startsWith('#EXT-X-MEDIA'))
    assert.equal(media.length, 2)
    assert.ok(media.every((l) => l.includes('LANGUAGE="en-US"')))
  })

  test('media rewrite: segments, map and key go through the relay', () => {
    const base = 'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/232/c/VISIONOS/index.m3u8'
    const out = rewriteMedia(MEDIA, base, map)
    const lines = out.trim().split('\n')
    const mapLine = lines.find((l) => l.startsWith('#EXT-X-MAP'))!
    assert.equal(relayTarget(/URI="([^"]+)"/.exec(mapLine)![1]), 'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/232/c/VISIONOS/init.mp4')
    const keyLine = lines.find((l) => l.startsWith('#EXT-X-KEY'))!
    assert.match(keyLine, /METHOD=AES-128,URI="http:\/\/127\.0\.0\.1:8770\/hls\/segment\?/)
    assert.match(keyLine, /,IV=0x01$/)
    const segments = lines.filter((l) => !l.startsWith('#'))
    assert.equal(segments.length, 2)
    assert.ok(segments.every((s) => s.startsWith('http://127.0.0.1:8770/hls/segment?k=tok123&u=')))
    assert.equal(relayTarget(segments[1]), 'https://manifest.googlevideo.com/api/manifest/hls_playlist/itag/232/c/VISIONOS/seg/1.ts')
    assert.ok(lines.includes('#EXTINF:5.005,'))
    assert.ok(lines.includes('#EXT-X-ENDLIST'))
  })
})

describe('relay URLs and ranges', () => {
  test('target encoding round trip (base64url, no padding)', () => {
    const url = 'https://rr2---sn-x.googlevideo.com/videoplayback?expire=1&sig=AB+/=&title=Nhạc trẻ'
    const encoded = encodeTarget(url)
    assert.match(encoded, /^[A-Za-z0-9_-]+$/)
    assert.equal(decodeTarget(encoded), url)
    assert.equal(decodeTarget('not base64!'), null)
    assert.equal(decodeTarget(encodeTarget('file:///etc/passwd')), null)
    assert.equal(decodeTarget(''), null)
  })

  test('relay URL carries the token and options', () => {
    const url = relayUrl(ctx, 'master', 'https://manifest.googlevideo.com/x.m3u8', { q: 720, a: 'vi', skip: null })
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'http://127.0.0.1:8770')
    assert.equal(parsed.pathname, '/hls/master.m3u8')
    assert.equal(parsed.searchParams.get('k'), 'tok123')
    assert.equal(parsed.searchParams.get('q'), '720')
    assert.equal(parsed.searchParams.get('a'), 'vi')
    assert.equal(parsed.searchParams.has('skip'), false)
    assert.equal(relayUrl(ctx, 'media', 'https://x.googlevideo.com/v').startsWith('http://127.0.0.1:8770/media?'), true)
  })

  test('Range header parsing', () => {
    assert.equal(parseRange(undefined, 100), null)
    assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 })
    assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 })
    assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 })
    assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
    assert.equal(parseRange('bytes=100-', 100), 'invalid')
    assert.equal(parseRange('bytes=5-1', 100), 'invalid')
    assert.equal(parseRange('items=1-2', 100), 'invalid')
  })

  test('range= parameter replaces an existing one', () => {
    assert.equal(withRangeParam('https://a.googlevideo.com/videoplayback?x=1&range=0-1', 5, 9), 'https://a.googlevideo.com/videoplayback?x=1&range=5-9')
  })

  test('user agent of the client a stream was issued to', () => {
    assert.equal(streamUserAgent('https://rr1---sn.googlevideo.com/videoplayback/id/x/c/VISIONOS/file/seg.ts'), resolvedUserAgent(VISIONOS, 'VN'))
    assert.equal(streamUserAgent('https://rr1---sn.googlevideo.com/videoplayback?c=ANDROID_VR&itag=18'), resolvedUserAgent(ANDROID_VR, 'VN'))
    assert.equal(streamUserAgent('https://rr1---sn.googlevideo.com/videoplayback?itag=18'), null)
  })
})

// MARK: Round trip through the local server

interface Seen {
  path: string
  ua: string | undefined
  range: string | undefined
}

describe('relay round trip', () => {
  let upstream: Server
  let upstreamPort = 0
  const seen: Seen[] = []
  const FILE = Buffer.alloc(10_000)
  for (let i = 0; i < FILE.length; i++) FILE[i] = i % 251
  let server: LocalServer
  const relay: RelayContext = { port: 0, token: 'secret-token', allowHost: (host, protocol) => host === '127.0.0.1' && protocol === 'http:' }

  before(async () => {
    upstream = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      seen.push({ path: url.pathname + url.search, ua: req.headers['user-agent'], range: req.headers.range })
      if (url.pathname.endsWith('master.m3u8')) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
        res.end(
          `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720\nmedia/c/VISIONOS/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080\nmedia1080.m3u8\n`,
        )
      } else if (url.pathname.endsWith('index.m3u8')) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
        res.end('#EXTM3U\n#EXTINF:5,\nseg0.ts\n#EXTINF:5,\nseg1.ts\n#EXT-X-ENDLIST\n')
      } else if (url.pathname.endsWith('.ts')) {
        const body = Buffer.alloc(376, 0x47)
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length })
        res.end(body)
      } else if (url.pathname === '/redirect') {
        res.writeHead(302, { Location: '/file.mp4' + url.search })
        res.end()
      } else if (url.pathname === '/file.mp4') {
        const range = url.searchParams.get('range')
        if (range) {
          const [a, b] = range.split('-').map(Number)
          const part = FILE.subarray(a, b + 1)
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': part.length })
          res.end(part)
        } else {
          res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': FILE.length })
          res.end(FILE)
        }
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()))
    upstreamPort = (upstream.address() as AddressInfo).port
    server = new LocalServer({ port: 0, token: 'secret-token', version: '1.0.0', events: new EventBus(), relay, methods: {} })
    await server.start()
  })

  after(() => {
    server.stop()
    upstream.close()
    setChunkBytes(0)
  })

  function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = request(url, { headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      })
      req.on('error', reject)
      req.end()
    })
  }

  test('master → media playlist → segment, with the client user agent and CORS', async () => {
    const master = relayUrl(relay, 'master', `http://127.0.0.1:${upstreamPort}/c/VISIONOS/master.m3u8`, { q: 720 })
    const m = await get(master)
    assert.equal(m.status, 200)
    assert.equal(m.headers['content-type'], 'application/vnd.apple.mpegurl')
    assert.equal(m.headers['access-control-allow-origin'], '*')
    const text = m.body.toString()
    assert.ok(!text.includes('1920x1080'), 'quality cap applied')
    const mediaUrl = text.split('\n').find((l) => l.startsWith('http://127.0.0.1:'))!
    assert.ok(mediaUrl.includes('/hls/playlist.m3u8?k=secret-token&u='))
    const media = await get(mediaUrl)
    assert.equal(media.status, 200)
    const segUrl = media.body.toString().split('\n').find((l) => l.startsWith('http://'))!
    const seg = await get(segUrl)
    assert.equal(seg.status, 200)
    assert.equal(seg.body.length, 376)
    // octet-stream from upstream → the real container type from the first bytes.
    assert.equal(seg.headers['content-type'], 'video/mp2t')
    const ua = resolvedUserAgent(VISIONOS, 'VN')
    assert.ok(seen.filter((s) => s.path.includes('/c/VISIONOS/')).every((s) => s.ua === ua), 'VISIONOS user agent upstream')
  })

  test('progressive file: Range → 206 assembled from range= chunks (redirect followed)', async () => {
    setChunkBytes(1000)
    const url = relayUrl(relay, 'media', `http://127.0.0.1:${upstreamPort}/redirect?c=ANDROID_VR&itag=18`, { len: FILE.length, t: 'video/mp4' })
    const part = await get(url, { Range: 'bytes=1500-4499' })
    assert.equal(part.status, 206)
    assert.equal(part.headers['content-range'], `bytes 1500-4499/${FILE.length}`)
    assert.equal(part.headers['content-length'], '3000')
    assert.ok(part.body.equals(FILE.subarray(1500, 4500)))
    const chunkRequests = seen.filter((s) => s.path.startsWith('/file.mp4?') && s.path.includes('range='))
    assert.ok(chunkRequests.length >= 3, 'fetched in 1000-byte chunks')
    const whole = await get(url)
    assert.equal(whole.status, 200)
    assert.ok(whole.body.equals(FILE))
    const bad = await get(url, { Range: `bytes=${FILE.length}-` })
    assert.equal(bad.status, 416)
  })

  test('token and host checks', async () => {
    const good = relayUrl(relay, 'segment', `http://127.0.0.1:${upstreamPort}/seg0.ts`)
    assert.equal((await get(good.replace('k=secret-token', 'k=wrong'))).status, 403)
    const foreign = relayUrl(relay, 'segment', 'http://example.com/seg0.ts')
    assert.equal((await get(foreign)).status, 403)
    const garbage = `http://127.0.0.1:${relay.port}/hls/segment?k=secret-token&u=%%%`
    assert.equal((await get(garbage)).status, 400)
  })
})
