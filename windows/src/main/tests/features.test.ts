// DeArrow parsing / caching, SRT conversion, log scrubbing, update versions and assets, the
// YouTube Music parsers (lyrics, search, album), download format plans and auto downloads.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DownloadedVideo, PlayerInfo, StreamFormat, VideoItem } from '@shared/models'
import { candidates, surplus, unmeteredNetwork } from '../core/autopick'
import { DeArrow, hashPrefix, parseBranding, thumbnailUrl } from '../core/dearrow'
import { JNode } from '../core/json'
import { parseLink } from '../core/links'
import { lyricsBrowseId, parseLyrics, parseMusicBrowse, parseMusicSearch, timedLines } from '../core/parsers/music'
import { downloadPlan } from '../core/parsers/player'
import { scrub } from '../core/scrub'
import { cuesToSrt, srtTimestamp } from '../core/srt'
import { assetName, compareVersions, installKind, updateFrom } from '../core/versions'

describe('DeArrow', () => {
  const answer = {
    abcdefghijk: {
      titles: [
        { title: 'Original title', original: true, votes: 5, locked: false },
        { title: 'Downvoted', original: false, votes: -2, locked: false },
        { title: '>Cách làm bánh xèo giòn', original: false, votes: 0, locked: false },
      ],
      thumbnails: [
        { original: true, votes: 3, locked: false },
        { timestamp: 12.5, original: false, votes: -1, locked: true },
      ],
      randomTime: 0.4,
    },
    zzzzzzzzzzz: { titles: [], thumbnails: [{ timestamp: 3, original: false, votes: -1, locked: false }] },
  }

  it('picks the first accepted title / thumbnail', () => {
    assert.deepEqual(parseBranding(answer, 'abcdefghijk'), {
      title: 'Cách làm bánh xèo giòn',
      thumbnail: 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=abcdefghijk&time=12.5',
    })
    assert.deepEqual(parseBranding(answer, 'zzzzzzzzzzz'), {})
    assert.deepEqual(parseBranding(answer, 'missingmiss'), {})
    assert.deepEqual(parseBranding(null, 'abcdefghijk'), {})
    assert.equal(thumbnailUrl('a_b-c', 1), 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=a_b-c&time=1')
  })

  it('sends only hash prefixes, one request per prefix, and caches', async () => {
    const urls: string[] = []
    const dearrow = new DeArrow(undefined, async (url) => {
      urls.push(url)
      return answer
    })
    const first = await dearrow.branding(['abcdefghijk', 'zzzzzzzzzzz', 'abcdefghijk'])
    assert.equal(first.abcdefghijk.title, 'Cách làm bánh xèo giòn')
    assert.ok(urls.every((u) => /\/api\/branding\/[0-9a-f]{4}$/.test(u)))
    assert.ok(!urls.some((u) => u.includes('abcdefghijk')))
    assert.equal(urls.length, new Set(['abcdefghijk', 'zzzzzzzzzzz'].map(hashPrefix)).size)
    await dearrow.branding(['abcdefghijk'])
    assert.equal(urls.length, new Set(['abcdefghijk', 'zzzzzzzzzzz'].map(hashPrefix)).size)
  })

  it('does not cache network failures and limits concurrency to 4', async () => {
    let running = 0
    let peak = 0
    let fail = true
    const dearrow = new DeArrow(undefined, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 10))
      running--
      return fail ? null : {}
    })
    const ids = Array.from({ length: 30 }, (_, i) => `video${String(i).padStart(6, '0')}`)
    assert.deepEqual(Object.values(await dearrow.branding(ids)).filter((b) => b.title).length, 0)
    assert.ok(peak <= 4, `peak ${peak}`)
    fail = false
    await dearrow.branding(ids.slice(0, 1))
  })
})

describe('SRT', () => {
  it('formats timestamps', () => {
    assert.equal(srtTimestamp(0), '00:00:00,000')
    assert.equal(srtTimestamp(3723.4567), '01:02:03,457')
  })

  it('converts cues, trimming overlaps and keeping line breaks', () => {
    const srt = cuesToSrt([
      { start: 4, end: 6, text: 'Thứ hai' },
      { start: 1, end: 4.5, text: ' Xin chào\nthế giới ' },
      { start: 7, end: 7, text: '   ' },
      { start: 8, end: 8, text: 'Cuối' },
    ])
    assert.equal(
      srt,
      '1\r\n00:00:01,000 --> 00:00:04,000\r\nXin chào\r\nthế giới\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nThứ hai\r\n\r\n3\r\n00:00:08,000 --> 00:00:08,100\r\nCuối\r\n',
    )
  })
})

describe('log scrubbing', () => {
  it('removes cookies, auth headers, session cookies, e-mails, pairing keys and signatures', () => {
    const text = [
      'Cookie: SID=abc; HSID=def; __Secure-3PSID=ghi',
      'authorization: SAPISIDHASH 1700000000_0123abcd SAPISID1PHASH 1700000000_ffff',
      'set SAPISID=s3cr3t and LOGIN_INFO=AFmmF2 then VISITOR_INFO1_LIVE=keepme',
      '{"SSID":"x1","APISID":"x2","__Secure-1PAPISID":"x3","name":"ok"}',
      'user minhanh@example.com signed in',
      'QR dvdtube://tv-login?h=192.168.1.5:8765&t=TOKENTOKEN&k=KEYKEYKEY&n=PC',
      'sync dvdtube://sync?h=10.0.0.2:8768&k=AAAA&t=BBBB&n=An',
      'GET https://rr1---sn.googlevideo.com/videoplayback?expire=1&sig=AOq0&lsig=AG3C&key=yt8&signature=ZZ&itag=18',
      'path C:\\Users\\Minh Anh\\AppData\\Roaming\\DVDTube\\logs',
    ].join('\n')
    const out = scrub(text, { home: 'C:\\Users\\Minh Anh' })
    for (const secret of ['abc', 'def', 'ghi', '0123abcd', 'ffff', 's3cr3t', 'AFmmF2', 'x1', 'x2', 'x3', 'minhanh@example.com', 'TOKENTOKEN', 'KEYKEYKEY', 'AAAA', 'BBBB', 'AOq0', 'AG3C', 'yt8', '=ZZ', 'Minh Anh']) {
      assert.ok(!out.includes(secret), `still contains ${secret}:\n${out}`)
    }
    for (const kept of ['VISITOR_INFO1_LIVE=keepme', '"name":"ok"', 'h=192.168.1.5:8765', 'itag=18', 'expire=1', '~\\AppData']) assert.ok(out.includes(kept), kept)
  })
})

describe('updates', () => {
  it('compares versions numerically', () => {
    assert.ok(compareVersions('1.0.42', '1.0.7') > 0)
    assert.ok(compareVersions('v1.0.10', '1.0.9') > 0)
    assert.equal(compareVersions('1.0.5', 'v1.0.5'), 0)
    // A development build is older than any release.
    assert.ok(compareVersions('1.0.1', '1.0') > 0)
    assert.ok(compareVersions('1.0.1', '1.0.0') > 0)
    assert.ok(compareVersions('1.0.3', '1.0.3-beta') === 0)
  })

  it('offers the asset of this installation', () => {
    const release = {
      tag_name: 'v1.0.42',
      html_url: 'https://github.com/dangdvd/DVDTube/releases/tag/v1.0.42',
      body: 'Sửa lỗi',
      assets: [
        'DVDTube.apk',
        'DVDTube-unsigned.ipa',
        'DVDTube-Setup.exe',
        'DVDTube-Windows-portable.zip',
        'DVDTube-mac-arm64.dmg',
        'DVDTube-mac-x64.dmg',
        'DVDTube-linux-x86_64.AppImage',
        'DVDTube-linux-amd64.deb',
      ].map((name, i) => ({ name, browser_download_url: `https://github.com/dangdvd/DVDTube/releases/download/v1.0.42/${name}`, size: 1000 + i })),
    }
    const nsis = updateFrom(release, '1.0.7', 'nsis')!
    assert.equal(nsis.version, '1.0.42')
    assert.equal(nsis.assetName, 'DVDTube-Setup.exe')
    assert.equal(nsis.installable, true)
    assert.equal(nsis.size, 1002)
    assert.equal(updateFrom(release, '1.0.7', 'portable')!.assetName, 'DVDTube-Windows-portable.zip')
    assert.equal(updateFrom(release, '1.0.7', 'portable')!.installable, false)
    assert.equal(updateFrom(release, '1.0', 'mac', 'arm64')!.assetName, 'DVDTube-mac-arm64.dmg')
    assert.equal(updateFrom(release, '1.0.0', 'mac', 'x64')!.assetName, 'DVDTube-mac-x64.dmg')
    assert.equal(updateFrom(release, '1.0.0', 'appimage')!.assetName, 'DVDTube-linux-x86_64.AppImage')
    assert.equal(updateFrom(release, '1.0.0', 'deb')!.assetName, 'DVDTube-linux-amd64.deb')
    assert.equal(updateFrom(release, '1.0.42', 'nsis'), null)
    assert.equal(assetName('nsis'), 'DVDTube-Setup.exe')
    assert.equal(installKind('linux', '/opt/DVDTube/dvdtube', { APPIMAGE: '/home/a/DVDTube.AppImage' }), 'appimage')
    assert.equal(installKind('linux', '/opt/DVDTube/dvdtube', {}), 'deb')
    assert.equal(installKind('win32', '/nowhere/DVDTube.exe', {}), 'portable')
  })
})

describe('deep links', () => {
  it('opens app pages and videos from dvdtube:// links', () => {
    assert.deepEqual(parseLink('dvdtube://watch?v=dQw4w9WgXcQ&t=42'), { type: 'video', videoId: 'dQw4w9WgXcQ', playlistId: null, startSeconds: 42 })
    assert.deepEqual(parseLink('dvdtube://search?q=nh%E1%BA%A1c%20tr%E1%BA%BB'), { type: 'search', query: 'nhạc trẻ' })
    assert.deepEqual(parseLink('dvdtube://search?q='), { type: 'app', page: 'search' })
    assert.deepEqual(parseLink('dvdtube://shorts'), { type: 'app', page: 'shorts' })
    assert.deepEqual(parseLink('dvdtube://music/'), { type: 'app', page: 'music' })
    assert.equal(parseLink('dvdtube://sync?h=1.2.3.4:8768&t=a&k=b'), null)
    assert.equal(parseLink('dvdtube://tv-login?h=1.2.3.4:8765'), null)
  })
})

describe('YouTube Music parsers', () => {
  const run = (text: string, browseId?: string, pageType?: string) =>
    browseId
      ? { text, navigationEndpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } } }
      : { text }
  const songRow = (videoId: string, title: string) => ({
    musicResponsiveListItemRenderer: {
      thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/abc=w60-h60-l90-rj', width: 60 }, { url: 'https://lh3.googleusercontent.com/abc=w120-h120-l90-rj', width: 120 }] } } },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title, navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } } } } }] } } },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [run('Sơn Tùng M-TP', 'UCartist000000000000000a', 'MUSIC_PAGE_TYPE_ARTIST'), run(' • '), run('Sky Decade', 'MPREb_album1', 'MUSIC_PAGE_TYPE_ALBUM'), run(' • '), run('4:05')] },
          },
        },
      ],
      playlistItemData: { videoId },
    },
  })

  it('reads song search results and their continuation', () => {
    const json = new JNode({
      contents: {
        tabbedSearchResultsRenderer: {
          tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [songRow('song0000001', 'Chúng ta của tương lai'), songRow('song0000002', 'Hãy trao cho anh')], continuations: [{ nextContinuationData: { continuation: 'CONT' } }] } }] } } } }],
        },
      },
    })
    const page = parseMusicSearch(json, 'songs')
    assert.equal(page.continuation, 'CONT')
    assert.equal(page.items.length, 2)
    const [first] = page.items
    assert.equal(first.type, 'song')
    assert.equal(first.id, 'song0000001')
    assert.equal(first.artists, 'Sơn Tùng M-TP')
    assert.equal(first.album, 'Sky Decade')
    assert.equal(first.durationText, '4:05')
    assert.equal(first.thumbnail, 'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj')
    assert.deepEqual(
      { id: first.video!.id, channelName: first.video!.channelName, channelId: first.video!.channelId, durationSeconds: first.video!.durationSeconds },
      { id: 'song0000001', channelName: 'Sơn Tùng M-TP', channelId: 'UCartist000000000000000a', durationSeconds: 245 },
    )
  })

  it('reads artists / albums rows as browse items', () => {
    const artist = {
      musicResponsiveListItemRenderer: {
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Đen Vâu' }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Nghệ sĩ' }, { text: ' • ' }, { text: '4,1 Tr người đăng ký' }] } } },
        ],
        navigationEndpoint: { browseEndpoint: { browseId: 'UCden0000000000000000000', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } },
      },
    }
    const page = parseMusicSearch(new JNode({ contents: { musicShelfRenderer: { contents: [artist] } } }), 'artists')
    assert.equal(page.items[0].type, 'artist')
    assert.equal(page.items[0].id, 'UCden0000000000000000000')
    assert.equal(page.items[0].subtitle, '4,1 Tr người đăng ký')
  })

  it('reads an album page', () => {
    const track = (videoId: string, title: string) => ({
      musicResponsiveListItemRenderer: {
        flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title, navigationEndpoint: { watchEndpoint: { videoId, playlistId: 'OLAK5uy_album' } } }] } } }],
        fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:21' }] } } }],
        playlistItemData: { videoId },
      },
    })
    const json = new JNode({
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: { title: { runs: [{ text: 'Sky Decade' }] }, subtitle: { runs: [{ text: 'Album' }, { text: ' • ' }, { text: '2024' }] }, straplineTextOne: { runs: [{ text: 'Sơn Tùng M-TP' }] }, thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/cover=w226-h226', width: 226 }] } } } } }] } } } }],
          secondaryContents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [track('trk00000001', 'Bài 1'), track('trk00000002', 'Bài 2')] } }] } },
        },
      },
    })
    const page = parseMusicBrowse(json, 'MPREb_album1')
    assert.equal(page.kind, 'album')
    assert.equal(page.title, 'Sky Decade')
    assert.equal(page.subtitle, 'Album • 2024 • Sơn Tùng M-TP')
    assert.equal(page.playlistId, 'OLAK5uy_album')
    assert.equal(page.shelves[0].items.length, 2)
    const first = page.shelves[0].items[0]
    assert.equal(first.durationText, '3:21')
    assert.equal(first.artists, 'Sơn Tùng M-TP')
    assert.equal(first.thumbnail, 'https://lh3.googleusercontent.com/cover=w544-h544-l90-rj')
  })

  it('finds the lyrics tab and reads plain and timed lyrics', () => {
    const next = new JNode({
      contents: {
        singleColumnMusicWatchNextResultsRenderer: {
          tabbedRenderer: {
            watchNextTabbedResultsRenderer: {
              tabs: [
                { tabRenderer: { title: 'Tiếp theo', content: {} } },
                { tabRenderer: { title: 'Lời nhạc', endpoint: { browseEndpoint: { browseId: 'MPLYt_abc123' } } } },
                { tabRenderer: { title: 'Liên quan', endpoint: { browseEndpoint: { browseId: 'MPTRt_x' } } } },
              ],
            },
          },
        },
      },
    })
    assert.equal(lyricsBrowseId(next), 'MPLYt_abc123')
    const browse = new JNode({
      contents: {
        sectionListRenderer: {
          contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: 'Dòng một\r\nDòng hai' }] }, footer: { runs: [{ text: 'Nguồn: LyricFind' }] } } }],
        },
      },
    })
    const lyrics = parseLyrics(browse, 'song0000001')!
    assert.equal(lyrics.text, 'Dòng một\nDòng hai')
    assert.equal(lyrics.source, 'Nguồn: LyricFind')
    assert.equal(lyrics.lines, null)
    const timed = new JNode({ x: { timedLyricsModel: { lyricsData: { timedLyricsData: { lines: [{ lyricLine: 'Hai', cueRange: { startTimeMilliseconds: '3200', endTimeMilliseconds: '5000' } }, { lyricLine: 'Một', cueRange: { startTimeMilliseconds: '1000' } }] } } } } })
    assert.deepEqual(timedLines(timed), [
      { startMs: 1000, endMs: null, text: 'Một' },
      { startMs: 3200, endMs: 5000, text: 'Hai' },
    ])
    assert.equal(parseLyrics(new JNode({ contents: {} }), 'x'), null)
  })
})

describe('download plans', () => {
  const format = (itag: number, mimeType: string, height: number | null, extra: Partial<StreamFormat> = {}): StreamFormat => ({
    itag,
    url: `https://rr.googlevideo.com/videoplayback?itag=${itag}`,
    mimeType,
    bitrate: (height ?? 1) * 1000,
    height,
    width: height ? Math.round((height * 16) / 9) : null,
    isDefaultAudio: true,
    ...extra,
  })
  const info = (formats: StreamFormat[]): PlayerInfo => ({ videoId: 'x', title: 'x', isLive: false, adaptiveFormats: formats, muxedFormats: [], captions: [], availableAt: 0 })
  const aac = format(140, 'audio/mp4; codecs="mp4a.40.2"', null)
  const opus = format(251, 'audio/webm; codecs="opus"', null)
  const h264 = [format(137, 'video/mp4; codecs="avc1.640028"', 1080), format(136, 'video/mp4; codecs="avc1.4d401f"', 720)]
  const vp9 = [format(313, 'video/webm; codecs="vp9"', 2160), format(271, 'video/webm; codecs="vp9"', 1440), format(248, 'video/webm; codecs="vp9"', 1080)]
  const av1 = [format(401, 'video/mp4; codecs="av01.0.12M.08"', 2160), format(701, 'video/mp4; codecs="av01.0.13M.10.0.110.09.16.09.0"', 2160, { colorInfo: 'HDR' })]

  it('prefers AV1 mp4 above 1080p, then VP9 + Opus webm, else H.264', () => {
    const withAv1 = downloadPlan(info([...h264, ...vp9, ...av1, aac, opus]), 2160, false)
    assert.equal(withAv1.container, 'mp4')
    assert.equal(withAv1.video?.itag, 401)
    assert.equal(withAv1.audio?.itag, 140)
    const vp9Only = downloadPlan(info([...h264, ...vp9, aac, opus]), 1440, false)
    assert.equal(vp9Only.container, 'webm')
    assert.equal(vp9Only.video?.itag, 271)
    assert.equal(vp9Only.audio?.itag, 251)
    const noOpus = downloadPlan(info([...h264, ...vp9, aac]), 2160, false)
    assert.equal(noOpus.container, 'mp4')
    assert.equal(noOpus.video?.itag, 137)
    assert.equal(downloadPlan(info([...h264, ...vp9, ...av1, aac, opus]), 1080, false).video?.itag, 137)
    assert.equal(downloadPlan(info([...h264, aac]), 720, false).video?.itag, 136)
    assert.deepEqual(downloadPlan(info([...h264, aac]), 1080, true), { video: null, audio: aac, container: 'm4a' })
  })
})

describe('automatic downloads', () => {
  const now = Date.UTC(2026, 9, 25)
  const video = (id: string, channelId: string, ageDays: number, extra: Partial<VideoItem> = {}): VideoItem => ({ id, title: id, channelId, publishedDate: now - ageDays * 86_400_000, ...extra })

  it('takes the newest regular uploads of each channel', () => {
    const videos = [
      video('a1aaaaaaaaa', 'UCa', 1),
      video('a2aaaaaaaaa', 'UCa', 3),
      video('a3aaaaaaaaa', 'UCa', 2, { isShort: true }),
      video('a4aaaaaaaaa', 'UCa', 0, { isLive: true }),
      video('a5aaaaaaaaa', 'UCa', -1),
      video('a6aaaaaaaaa', 'UCa', 9),
      video('b1bbbbbbbbb', 'UCb', 1),
    ]
    assert.deepEqual(candidates(videos, 'UCa', 2, now).map((v) => v.id), ['a1aaaaaaaaa', 'a2aaaaaaaaa'])
  })

  it('removes only automatic downloads beyond the limit', () => {
    const entry = (id: string, ageDays: number, isAuto: boolean): DownloadedVideo => ({
      video: video(id, 'UCa', ageDays),
      fileName: id,
      filePath: id,
      fileSize: 1,
      downloadedAt: now,
      isAudioOnly: false,
      isAuto,
    })
    const list = [entry('n1nnnnnnnnn', 1, true), entry('n2nnnnnnnnn', 2, true), entry('m1mmmmmmmmm', 9, false), entry('n3nnnnnnnnn', 5, true)]
    assert.deepEqual(surplus(list, 'UCa', 2).map((e) => e.video.id), ['n3nnnnnnnnn'])
  })

  it('treats only cellular connections as metered', () => {
    const up = [{ address: '192.168.1.5', netmask: '255.255.255.0', family: 'IPv4' as const, mac: '', internal: false, cidr: null }]
    assert.equal(unmeteredNetwork({ 'Wi-Fi': up }), true)
    assert.equal(unmeteredNetwork({ Ethernet: up }), true)
    assert.equal(unmeteredNetwork({ Cellular: up }), false)
    assert.equal(unmeteredNetwork({}), false)
  })
})
