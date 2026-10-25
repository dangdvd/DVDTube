// "Đồng bộ thư viện": the shared file format, the merge rules, and the LAN protocol (a phone
// encrypts its library like the TV sign-in, the server merges and answers with the merged
// library encrypted with the same key / token).

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { describe, it } from 'node:test'
import type { SyncStatus } from '@shared/api'
import { libraryFileName, makeLibraryExport, mergeLibraries, mergeSummaryText, parseLibraryExport, type LibraryContent } from '@shared/library'
import type { VideoItem } from '@shared/models'
import { decode, decrypt, encode, encrypt } from '../core/tvlogin'
import { SyncServer } from '../sync'

const v = (id: string, title = id): VideoItem => ({ id, title })
const empty: LibraryContent = { subscriptions: [], history: [], watchLater: [], liked: [], playlists: [], searchHistory: [] }

describe('library merge', () => {
  it('unions subscriptions keeping the fuller entry', () => {
    const local = { ...empty, subscriptions: [{ id: 'UCa', name: 'A' }, { id: 'UCb', name: 'B', avatar: 'https://yt3.ggpht.com/b' }] }
    const remote = { ...empty, subscriptions: [{ id: 'UCa', name: 'A', avatar: 'https://yt3.ggpht.com/a', handle: '@a' }, { id: 'UCb', name: 'B' }, { id: 'UCc', name: 'C' }] }
    const { library, added } = mergeLibraries(local, remote)
    assert.deepEqual(library.subscriptions.map((c) => c.id), ['UCa', 'UCb', 'UCc'])
    assert.equal(library.subscriptions[0].handle, '@a')
    assert.equal(library.subscriptions[1].avatar, 'https://yt3.ggpht.com/b')
    assert.equal(added.channels, 1)
  })

  it('keeps the latest history entry per video, newest first, capped, and reports newer positions', () => {
    const local = {
      ...empty,
      history: [
        { video: v('aaaaaaaaaaa'), watchedAt: 300, position: 30, duration: 100 },
        { video: v('bbbbbbbbbbb'), watchedAt: 100, position: 10, duration: 100 },
      ],
    }
    const remote = {
      ...empty,
      history: [
        { video: v('bbbbbbbbbbb'), watchedAt: 400, position: 80, duration: 100 },
        { video: v('aaaaaaaaaaa'), watchedAt: 200, position: 5, duration: 100 },
        { video: v('ccccccccccc'), watchedAt: 50, position: 1, duration: 9 },
      ],
    }
    const { library, added, progress } = mergeLibraries(local, remote)
    assert.deepEqual(library.history.map((h) => [h.video.id, h.watchedAt, h.position]), [
      ['bbbbbbbbbbb', 400, 80],
      ['aaaaaaaaaaa', 300, 30],
      ['ccccccccccc', 50, 1],
    ])
    assert.equal(added.history, 1)
    assert.deepEqual(progress.map((p) => p.videoId).sort(), ['bbbbbbbbbbb', 'ccccccccccc'])
    assert.equal(mergeLibraries(local, remote, 2).library.history.length, 2)
  })

  it('orders watch later / liked: local first, then remote-only in remote order', () => {
    const local = { ...empty, watchLater: [v('a1aaaaaaaaa'), v('a2aaaaaaaaa')], liked: [v('l1lllllllll')] }
    const remote = { ...empty, watchLater: [v('r1rrrrrrrrr'), v('a1aaaaaaaaa'), v('r2rrrrrrrrr')], liked: [v('l1lllllllll')] }
    const { library, added } = mergeLibraries(local, remote)
    assert.deepEqual(library.watchLater.map((x) => x.id), ['a1aaaaaaaaa', 'a2aaaaaaaaa', 'r1rrrrrrrrr', 'r2rrrrrrrrr'])
    assert.equal(added.watchLater, 2)
    assert.equal(added.liked, 0)
  })

  it('matches playlists by id, else by trimmed case-insensitive name; adds remote-only ones', () => {
    const local = {
      ...empty,
      playlists: [
        { id: 'p1', name: 'Nhạc chill', videos: [v('a1aaaaaaaaa')], createdAt: 1 },
        { id: 'p2', name: 'Học tập', videos: [], createdAt: 2 },
      ],
    }
    const remote = {
      ...empty,
      playlists: [
        { id: 'p1', name: 'Renamed', videos: [v('r1rrrrrrrrr'), v('a1aaaaaaaaa')], createdAt: 1 },
        { id: 'other-id', name: '  học TẬP ', videos: [v('r2rrrrrrrrr')], createdAt: 5 },
        { id: 'p3', name: 'Mới', videos: [v('r3rrrrrrrrr')], createdAt: 9 },
      ],
    }
    const { library, added } = mergeLibraries(local, remote)
    assert.deepEqual(library.playlists.map((p) => [p.id, p.name, p.videos.map((x) => x.id)]), [
      ['p1', 'Nhạc chill', ['a1aaaaaaaaa', 'r1rrrrrrrrr']],
      ['p2', 'Học tập', ['r2rrrrrrrrr']],
      ['p3', 'Mới', ['r3rrrrrrrrr']],
    ])
    assert.equal(added.playlists, 1)
    assert.equal(added.playlistVideos, 2)
  })

  it('merges search history local first, capped at 50', () => {
    const local = { ...empty, searchHistory: ['lofi', 'Bolero'] }
    const remote = { ...empty, searchHistory: ['bolero', 'rap việt', ...Array.from({ length: 60 }, (_, i) => `q${i}`)] }
    const { library } = mergeLibraries(local, remote)
    assert.deepEqual(library.searchHistory.slice(0, 3), ['lofi', 'Bolero', 'rap việt'])
    assert.equal(library.searchHistory.length, 50)
  })

  it('reads files from other platforms (unknown keys, missing arrays) and writes the canonical format', () => {
    const parsed = parseLibraryExport({
      format: 'dvdtube-library',
      version: 1,
      exportedAt: 1700000000000,
      device: 'iPhone của An',
      platform: 'ios',
      subscriptions: [{ id: 'UCx', name: 'X', unknown: 1 }],
      history: [{ video: { id: 'aaaaaaaaaaa', title: 'T', isShort: true }, watchedAt: 5, position: 2, duration: 9 }, { video: { title: 'no id' } }],
      somethingNew: { x: 1 },
    })!
    assert.equal(parsed.device, 'iPhone của An')
    assert.equal(parsed.history.length, 1)
    assert.equal(parsed.history[0].video.isShort, true)
    assert.deepEqual(parsed.watchLater, [])
    assert.deepEqual(parsed.playlists, [])
    assert.equal(parseLibraryExport({ format: 'something-else' }), null)
    const exported = makeLibraryExport({ ...empty, searchHistory: ['x'] }, 'DESKTOP-ABC', 'windows', 42)
    assert.deepEqual(Object.keys(exported), ['format', 'version', 'exportedAt', 'device', 'platform', 'subscriptions', 'history', 'watchLater', 'liked', 'playlists', 'searchHistory'])
    assert.equal(exported.format, 'dvdtube-library')
    assert.equal(libraryFileName(new Date(2026, 9, 5)), 'DVDTube-thu-vien-20261005.json')
  })

  it('summarises what was added', () => {
    assert.equal(mergeSummaryText({ channels: 12, history: 300, watchLater: 20, liked: 20, playlists: 2, playlistVideos: 0, searches: 0 }), 'Đã thêm 12 kênh, 340 video, 2 danh sách phát')
    assert.match(mergeSummaryText({ channels: 0, history: 0, watchLater: 0, liked: 0, playlists: 0, playlistVideos: 0, searches: 0 }), /giống nhau/)
  })
})

function post(host: string, body: string) {
  const [hostname, port] = host.split(':')
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname, port: Number(port), path: '/sync', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('LAN sync protocol', () => {
  it('decrypts the phone library, merges and answers the merged library encrypted', async () => {
    const statuses: SyncStatus[] = []
    const local = { ...empty, watchLater: [v('a1aaaaaaaaa')] }
    const server = new SyncServer(
      {
        merge: async (library, device) => {
          const { library: merged, added } = mergeLibraries(local, library)
          return { merged: makeLibraryExport(merged, 'DESKTOP-ABC', 'windows'), summary: `${device}: ${mergeSummaryText(added)}` }
        },
        onStatus: (s) => statuses.push(s),
      },
      { port: 0, address: '127.0.0.1', deviceName: 'DESKTOP-ABC' },
    )
    const info = await server.start()
    try {
      assert.match(info.qrText, /^dvdtube:\/\/sync\?h=127\.0\.0\.1:\d+&t=[A-Za-z0-9_-]{22}&k=[A-Za-z0-9_-]{43}&n=DESKTOP-ABC$/)
      const params = new URL(info.qrText.replace('dvdtube://sync', 'https://x/')).searchParams
      const token = decode(params.get('t'))!
      const key = decode(params.get('k'))!
      assert.equal(token.length, 16)
      assert.equal(key.length, 32)

      // Wrong token first: refused.
      const phoneLibrary = makeLibraryExport({ ...empty, watchLater: [v('r1rrrrrrrrr')], searchHistory: ['bolero'] }, 'iPhone của An', 'ios')
      const sealedWith = (t: Uint8Array) => {
        const { nonce, sealed } = encrypt(key, t, Buffer.from(JSON.stringify(phoneLibrary), 'utf8'))
        return JSON.stringify({ t: encode(t), n: encode(nonce), c: encode(sealed) })
      }
      const bad = await post(info.host, sealedWith(Buffer.alloc(16, 1)))
      assert.equal(bad.status, 403)
      assert.equal(bad.json.ok, false)

      const res = await post(info.host, sealedWith(token))
      assert.equal(res.status, 200)
      assert.equal(res.json.ok, true)
      const plain = decrypt(key, token, decode(res.json.n)!, decode(res.json.c)!)
      assert.ok(plain, 'reply decrypts with the same key and token')
      const merged = parseLibraryExport(JSON.parse(plain!.toString('utf8')))!
      assert.deepEqual(merged.watchLater.map((x) => x.id), ['a1aaaaaaaaa', 'r1rrrrrrrrr'])
      assert.deepEqual(merged.searchHistory, ['bolero'])
      assert.deepEqual(statuses.map((s) => s.state), ['waiting', 'merging', 'success'])
      const success = statuses.at(-1) as Extract<SyncStatus, { state: 'success' }>
      assert.equal(success.device, 'iPhone của An')

      // Single use.
      const again = await post(info.host, sealedWith(token))
      assert.equal(again.status, 403)
    } finally {
      server.stop()
    }
  })
})
