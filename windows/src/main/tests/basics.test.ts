// Search params, link resolution, SAPISIDHASH, storyboards, version comparison.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { DEFAULT_SEARCH_FILTERS, parseStoryboard, storyboardFrame, type SearchFilters } from '@shared/models'
import { authHeaders, authorization, hasAuthCookies, parseCookieText } from '../core/auth'
import { searchParams } from '../core/filters'
import { looksLikeVideoId, parseLink, parseStartTime } from '../core/links'

const filters = (patch: Partial<SearchFilters>): SearchFilters => ({ ...DEFAULT_SEARCH_FILTERS, ...patch })

describe('search filter params', () => {
  it('matches the params of YouTube links', () => {
    assert.equal(searchParams(DEFAULT_SEARCH_FILTERS), null)
    assert.equal(searchParams(filters({ type: 'video' })), 'EgIQAQ%3D%3D')
    assert.equal(searchParams(filters({ type: 'shorts' })), 'EgIQCQ%3D%3D')
    assert.equal(searchParams(filters({ type: 'channel' })), 'EgIQAg%3D%3D')
    assert.equal(searchParams(filters({ type: 'playlist' })), 'EgIQAw%3D%3D')
    assert.equal(searchParams(filters({ features: ['live'] })), 'EgJAAQ%3D%3D')
    assert.equal(searchParams(filters({ sort: 'date' })), 'CAI%3D')
    // This week + videos: the "recent" home queries use exactly this.
    assert.equal(searchParams(filters({ uploadDate: 'week', type: 'video' })), 'EgQIAxAB')
  })

  it('combines sort, filters and features in field order', () => {
    const params = searchParams(filters({ sort: 'views', uploadDate: 'today', duration: 'long', features: ['hdr', '4k', 'hd'] }))!
    const bytes = Buffer.from(decodeURIComponent(params), 'base64')
    // {1: 3, 2: {1: 2, 3: 2, 4: 1, 14: 1, 25: 1}}
    assert.deepEqual([...bytes], [0x08, 0x03, 0x12, 0x0b, 0x08, 0x02, 0x18, 0x02, 0x20, 0x01, 0x70, 0x01, 0xc8, 0x01, 0x01])
  })
})

describe('links', () => {
  it('understands watch, short, live, embed, music and dvdtube links', () => {
    assert.deepEqual(parseLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90'), {
      type: 'video', videoId: 'dQw4w9WgXcQ', playlistId: null, startSeconds: 90,
    })
    assert.deepEqual(parseLink('youtu.be/dQw4w9WgXcQ?si=abc&t=1m30s'), {
      type: 'video', videoId: 'dQw4w9WgXcQ', playlistId: null, startSeconds: 90,
    })
    assert.deepEqual(parseLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&index=3'), {
      type: 'video', videoId: 'dQw4w9WgXcQ', playlistId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', startSeconds: null,
    })
    assert.deepEqual(parseLink('https://youtube.com/shorts/abcdefghijk?feature=share'), { type: 'shorts', videoId: 'abcdefghijk' })
    assert.equal((parseLink('https://www.youtube.com/live/abcdefghijk') as { videoId: string }).videoId, 'abcdefghijk')
    assert.equal((parseLink('https://www.youtube-nocookie.com/embed/abcdefghijk?start=12') as { startSeconds: number }).startSeconds, 12)
    assert.equal((parseLink('https://music.youtube.com/watch?v=abcdefghijk') as { videoId: string }).videoId, 'abcdefghijk')
    assert.deepEqual(parseLink('dvdtube://watch?v=dQw4w9WgXcQ'), { type: 'video', videoId: 'dQw4w9WgXcQ', playlistId: null, startSeconds: null })
    assert.equal(parseLink('dvdtube://tv-login?h=192.168.1.2:8765&t=a&k=b'), null)
  })

  it('understands playlists, channels, handles and custom urls', () => {
    assert.deepEqual(parseLink('https://www.youtube.com/playlist?list=PLabc123def456ghi'), { type: 'playlist', playlistId: 'PLabc123def456ghi' })
    assert.deepEqual(parseLink('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos'), {
      type: 'channel', channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
    })
    assert.deepEqual(parseLink('https://www.youtube.com/@SonTungMTP/videos'), { type: 'resolve', url: 'https://www.youtube.com/@SonTungMTP' })
    assert.deepEqual(parseLink('https://www.youtube.com/c/GoogleDevelopers'), { type: 'resolve', url: 'https://www.youtube.com/c/GoogleDevelopers' })
    assert.deepEqual(parseLink('https://www.youtube.com/user/nqtfan'), { type: 'resolve', url: 'https://www.youtube.com/user/nqtfan' })
    assert.deepEqual(parseLink('@mkbhd'), { type: 'resolve', url: 'https://www.youtube.com/@mkbhd' })
    assert.deepEqual(parseLink('https://www.youtube.com/results?search_query=nh%E1%BA%A1c+tr%E1%BA%BB'), { type: 'search', query: 'nhạc trẻ' })
  })

  it('accepts bare ids but keeps plain words as searches', () => {
    assert.deepEqual(parseLink('dQw4w9WgXcQ'), { type: 'video', videoId: 'dQw4w9WgXcQ' })
    assert.deepEqual(parseLink('UC_x5XG1OV2P6uZZ5FSM9Ttw'), { type: 'channel', channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' })
    assert.deepEqual(parseLink('nhạc trẻ remix'), { type: 'search', query: 'nhạc trẻ remix' })
    assert.deepEqual(parseLink('lofihiphops'), { type: 'search', query: 'lofihiphops' })
    assert.deepEqual(parseLink('Lofihiphops'), { type: 'search', query: 'Lofihiphops' })
    assert.deepEqual(parseLink('https://example.com/watch?v=dQw4w9WgXcQ'), { type: 'search', query: 'https://example.com/watch?v=dQw4w9WgXcQ' })
    assert.equal(parseLink('   '), null)
    assert.equal(looksLikeVideoId('jNQXAC9IVRw'), true)
  })

  it('parses start times', () => {
    assert.equal(parseStartTime('42'), 42)
    assert.equal(parseStartTime('42s'), 42)
    assert.equal(parseStartTime('1h2m3s'), 3723)
    assert.equal(parseStartTime('2m'), 120)
    assert.equal(parseStartTime('1:02:03'), 3723)
    assert.equal(parseStartTime('abc'), null)
  })
})

describe('SAPISIDHASH', () => {
  const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')
  const cookies = { SAPISID: 'sapi/abc', '__Secure-1PAPISID': 'one', '__Secure-3PAPISID': 'three', SID: 'x', LOGIN_INFO: 'y' }

  it('hashes "<ts> <SAPISID> <origin>" like the website', () => {
    const value = authorization(cookies, 'https://www.youtube.com', 1700000000)
    assert.equal(
      value,
      `SAPISIDHASH 1700000000_${sha1('1700000000 sapi/abc https://www.youtube.com')} ` +
        `SAPISID1PHASH 1700000000_${sha1('1700000000 one https://www.youtube.com')} ` +
        `SAPISID3PHASH 1700000000_${sha1('1700000000 three https://www.youtube.com')}`,
    )
    assert.match(value!, /^SAPISIDHASH \d+_[0-9a-f]{40}( SAPISID[13]PHASH \d+_[0-9a-f]{40}){2}$/)
  })

  it('falls back to __Secure-3PAPISID and builds the account headers', () => {
    const only3p = authorization({ '__Secure-3PAPISID': 'three' }, 'https://www.youtube.com', 5)!
    assert.ok(only3p.startsWith(`SAPISIDHASH 5_${sha1('5 three https://www.youtube.com')} SAPISID3PHASH 5_`))
    const headers = authHeaders('https://www.youtube.com/youtubei/v1/browse', cookies, { authUser: 1, pageId: '12345' }, undefined, 1_700_000_000_500)!
    assert.equal(headers['X-Goog-AuthUser'], '1')
    assert.equal(headers['X-Goog-PageId'], '12345')
    assert.equal(headers['X-Origin'], 'https://www.youtube.com')
    assert.ok(headers['Authorization'].startsWith('SAPISIDHASH 1700000000_'))
    assert.equal(headers['Cookie'], undefined, 'cookies come from the jar, never a header')
  })

  it('never signs requests to other hosts or without a session', () => {
    assert.equal(authHeaders('https://sponsor.ajay.app/api', cookies, { authUser: 0, pageId: null }), null)
    assert.equal(authHeaders('https://www.youtube.com.evil.com/', cookies, { authUser: 0, pageId: null }), null)
    assert.equal(authHeaders('https://www.youtube.com/', { SID: 'x' }, { authUser: 0, pageId: null }), null)
    assert.equal(hasAuthCookies({ LOGIN_INFO: 'a' }), false)
    assert.equal(hasAuthCookies({ '__Secure-3PAPISID': 'a' }), true)
  })

  it('imports cookies.txt and header strings', () => {
    const netscape = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tabc\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tdef\n.google.com\tTRUE\t/\tTRUE\t0\tNID\tzzz\n'
    assert.deepEqual(parseCookieText(netscape), { SAPISID: 'abc', SID: 'def' })
    assert.deepEqual(parseCookieText('Cookie: a=1; b=x=y; c'), { a: '1', b: 'x=y' })
  })
})

describe('storyboard', () => {
  const spec =
    'https://i.ytimg.com/sb/abc/storyboard3_L$L/$N.jpg?sqp=xyz|48#27#100#10#10#0#default#rs$AOn4|80#45#101#10#10#2000#M$M#rs$BBB|160#90#101#5#5#2000#M$M#rs$CCC'

  it('parses the largest level', () => {
    const sb = parseStoryboard(spec)!
    assert.equal(sb.level, 2)
    assert.equal(sb.width, 160)
    assert.equal(sb.height, 90)
    assert.equal(sb.count, 101)
    assert.equal(sb.columns, 5)
    assert.equal(sb.rows, 5)
    assert.equal(sb.intervalMs, 2000)
    assert.equal(sb.name, 'M$M')
    assert.equal(sb.signature, 'rs$CCC')
    assert.equal(parseStoryboard('no levels'), null)
    assert.equal(parseStoryboard('base|1#2#3'), null)
  })

  it('maps a time to a sprite sheet cell', () => {
    const sb = parseStoryboard(spec)!
    // 61 s → frame 30 → sheet 1 (25 per sheet), cell 5 → column 0, row 1.
    const frame = storyboardFrame(sb, 61, 202)
    assert.equal(frame.url, 'https://i.ytimg.com/sb/abc/storyboard3_L2/M1.jpg?sqp=xyz&sigh=rs$CCC')
    assert.equal(frame.x, 0)
    assert.equal(frame.y, 90)
    assert.equal(storyboardFrame(sb, 10_000, 202).url.includes('/M4.jpg'), true, 'clamped to the last frame')
  })
})
