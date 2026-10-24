// Request building of the InnerTube client against a fake transport: client contexts, headers,
// the visionOS visitor-id flow, the bot check → signed-in WEB fallback and incognito.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setSessionSource } from '../core/auth'
import { coreState } from '../core/config'
import { setFetcher, type Transport } from '../core/http'
import * as innertube from '../core/innertube'
import * as service from '../core/services'

interface Call {
  transport: Transport
  url: URL
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

const calls: Call[] = []
type Handler = (call: Call) => { status?: number; json: unknown }
let handler: Handler = () => ({ json: {} })

setFetcher(async (transport, url, init) => {
  const call: Call = {
    transport,
    url: new URL(url),
    headers: init.headers ?? {},
    body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
  }
  calls.push(call)
  const { status = 200, json } = handler(call)
  return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
})

let signedIn = false
setSessionSource({
  cookies: async (): Promise<Record<string, string>> => (signedIn ? { SAPISID: 'sid', SID: 'x', LOGIN_INFO: 'y' } : {}),
  identity: () => ({ authUser: 2, pageId: 'PAGE' }),
})

const playable = (videoId: string) => ({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId, title: 'T' },
  streamingData: { hlsManifestUrl: 'https://manifest.googlevideo.com/x' },
})

function context(call: Call): Record<string, unknown> {
  return ((call.body?.context as Record<string, unknown>).client ?? {}) as Record<string, unknown>
}

describe('innertube client', () => {
  it('plays through the visionOS client with a visitor id', async () => {
    coreState.hl = 'vi'
    coreState.gl = 'vn'
    calls.length = 0
    handler = (call) =>
      call.url.pathname.endsWith('/visitor_id') ? { json: { responseContext: { visitorData: 'VISITOR_1' } } } : { json: playable('jNQXAC9IVRw') }
    const info = await innertube.player('jNQXAC9IVRw')
    assert.equal(info.client, 'VISIONOS')
    assert.equal(calls.length, 2)

    const [visitor, player] = calls
    assert.equal(visitor.url.href, 'https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false')
    assert.equal(visitor.transport, 'anon')
    assert.equal(visitor.headers['User-Agent'], 'com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; VN)')
    assert.equal(visitor.headers['X-YouTube-Client-Name'], undefined, 'visionOS sends no client headers')
    assert.equal(visitor.headers['X-Goog-Api-Format-Version'], '2')

    assert.equal(player.url.origin + player.url.pathname, 'https://youtubei.googleapis.com/youtubei/v1/player')
    assert.deepEqual([...player.url.searchParams.keys()], ['prettyPrint', 'id', 't'])
    assert.equal(player.url.searchParams.get('id'), 'jNQXAC9IVRw')
    assert.equal(player.headers['X-Goog-Visitor-Id'], 'VISITOR_1')
    assert.equal(player.headers['Authorization'], undefined, 'anonymous')
    assert.equal(player.headers['Content-Type'], 'application/json')
    assert.equal(player.headers['Accept-Language'], 'vi,en;q=0.9')
    assert.equal(player.body?.videoId, 'jNQXAC9IVRw')
    assert.equal(String(player.body?.cpn).length, 16)
    assert.equal(player.body?.contentCheckOk, true)
    assert.deepEqual(context(player), {
      clientName: 'VISIONOS', clientVersion: '1.04', hl: 'vi', gl: 'vn', utcOffsetMinutes: -new Date().getTimezoneOffset() || 0,
      clientScreen: 'WATCH', platform: 'MOBILE', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS',
      osVersion: '26.6.0.23O770', visitorData: 'VISITOR_1',
    })
  })

  it('retries an unplayable answer once with a fresh visitor id', async () => {
    calls.length = 0
    let players = 0
    handler = (call) => {
      if (call.url.pathname.endsWith('/visitor_id')) return { json: { responseContext: { visitorData: 'VISITOR_2' } } }
      players++
      return { json: players === 1 ? { playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video này không có sẵn' } } : playable('dQw4w9WgXcQ') }
    }
    await innertube.player('dQw4w9WgXcQ')
    assert.deepEqual(calls.map((c) => c.url.pathname.split('/').pop()), ['player', 'visitor_id', 'player'], 'cached visitor first, then a fresh one')
    assert.equal(calls[2].headers['X-Goog-Visitor-Id'], 'VISITOR_2')
  })

  it('falls back to the signed-in WEB client after a bot check, then goes there first', async () => {
    signedIn = true
    calls.length = 0
    handler = (call) => {
      if (call.url.host === 'youtubei.googleapis.com') {
        return { json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Đăng nhập để xác nhận bạn không phải là bot' } } }
      }
      return { json: playable('abcdefghijk') }
    }
    const info = await innertube.player('abcdefghijk')
    assert.equal(info.client, 'WEB (signed in)')
    assert.equal(calls.length, 2, 'a bot check is never retried')
    const web = calls[1]
    assert.equal(web.url.origin + web.url.pathname, 'https://www.youtube.com/youtubei/v1/player')
    assert.equal(web.transport, 'auth')
    assert.match(web.headers['Authorization'], /^SAPISIDHASH \d+_[0-9a-f]{40}$/)
    assert.equal(web.headers['X-Goog-AuthUser'], '2')
    assert.equal(web.headers['X-Goog-PageId'], 'PAGE')
    assert.equal(web.headers['X-YouTube-Client-Name'], '1')
    assert.equal(web.headers['Origin'], 'https://www.youtube.com')
    assert.match(web.headers['User-Agent'], /Safari/)
    assert.deepEqual(web.body?.playbackContext, { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } })
    assert.equal(context(web).originalUrl, 'https://www.youtube.com')

    calls.length = 0
    await innertube.player('abcdefghijk')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.host, 'www.youtube.com', 'recent bot check: signed-in request first')
  })

  it('tries the Android VR client after a bot check when signed out', async () => {
    signedIn = false
    calls.length = 0
    handler = (call) => {
      if (call.url.pathname.endsWith('/visitor_id')) return { json: { responseContext: { visitorData: 'VR_VISITOR' } } }
      if (call.url.host === 'youtubei.googleapis.com') {
        return { json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Đăng nhập để xác nhận bạn không phải là bot' } } }
      }
      return { json: playable('abcdefghijk') }
    }
    const info = await innertube.player('abcdefghijk')
    assert.equal(info.client, 'ANDROID_VR')
    const vr = calls[calls.length - 1]
    assert.equal(vr.url.origin + vr.url.pathname, 'https://www.youtube.com/youtubei/v1/player')
    assert.equal(vr.transport, 'anon')
    assert.equal(context(vr).clientName, 'ANDROID_VR')
    assert.equal(context(vr).androidSdkVersion, 32)
    assert.match(vr.headers['User-Agent'], /^com\.google\.android\.apps\.youtube\.vr\.oculus\//)
  })

  it('browses as the account unless incognito', async () => {
    signedIn = true
    coreState.incognito = false
    calls.length = 0
    handler = () => ({ json: { responseContext: { visitorData: 'WEBVISITOR' }, contents: {} } })
    await service.search('nhạc trẻ remix')
    assert.equal(calls[0].transport, 'auth')
    assert.ok(calls[0].headers['Authorization'])
    assert.equal(calls[0].body?.query, 'nhạc trẻ remix')
    assert.equal(calls[0].body?.params, undefined)

    coreState.incognito = true
    await service.search('abc', { uploadDate: 'any', type: 'video', duration: 'any', features: [], sort: 'relevance' })
    assert.equal(calls[1].transport, 'anon')
    assert.equal(calls[1].headers['Authorization'], undefined)
    assert.equal(calls[1].body?.params, 'EgIQAQ%3D%3D')
    assert.equal(calls[1].headers['X-Goog-Visitor-Id'], 'WEBVISITOR', 'visitor data of the first answer is reused')

    // Account pages keep running as the account in incognito.
    await service.accountFeed('FEhistory')
    assert.equal(calls[2].transport, 'auth')
    assert.equal(calls[2].body?.browseId, 'FEhistory')
    coreState.incognito = false
  })

  it('turns HTTP errors into Vietnamese messages', async () => {
    handler = () => ({ status: 429, json: { error: { message: 'quota' } } })
    await assert.rejects(service.search('x'), /YouTube tạm thời giới hạn yêu cầu \(429\)/)
    handler = () => ({ status: 500, json: {} })
    await assert.rejects(service.search('x'), /Lỗi kết nối tới YouTube \(HTTP 500\)/)
    signedIn = false
    await assert.rejects(service.accountFeed('FEhistory'), /cần đăng nhập/)
  })

  it('resolves @handles through navigation/resolve_url', async () => {
    calls.length = 0
    handler = () => ({ json: { endpoint: { browseEndpoint: { browseId: 'UCresolved00000000000001' } } } })
    assert.deepEqual(await service.resolveLink('https://www.youtube.com/@kenh'), { type: 'channel', channelId: 'UCresolved00000000000001' })
    assert.equal(calls[0].url.pathname, '/youtubei/v1/navigation/resolve_url')
    assert.equal(calls[0].body?.url, 'https://www.youtube.com/@kenh')
    handler = () => ({ json: { endpoint: { watchEndpoint: { videoId: 'dQw4w9WgXcQ', startTimeSeconds: 5 } } } })
    assert.deepEqual(await service.resolveLink('https://www.youtube.com/weird-path'), { type: 'video', videoId: 'dQw4w9WgXcQ', playlistId: null, startSeconds: 5 })
  })
})
