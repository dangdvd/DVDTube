// Logic of the TV interface that does not need a browser: the PIN hash (pure-JS SHA-256 — the
// TV's file:// page has no crypto.subtle), parental controls, settings sanitising and the local
// library in the shared sync format.

import { memoryStorage } from './helpers/storage-stub'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import { parseLibraryExport, makeLibraryExport } from '../../windows/src/shared/library'
import type { VideoItem } from '../../windows/src/shared/models'
import { sha256Hex } from '../app/src/sha256'
import { flushSaves } from '../app/src/store'
import { library, libraryStore } from '../app/src/state/library'
import { DEFAULT_PARENTAL, blockedByKeywords, foldText, insideWindow, keywordList, localDay, lockReason, parental, parentalStore, restrictedMode } from '../app/src/state/parental'
import { DEFAULT_SETTINGS, settings, updateSettings } from '../app/src/state/settings'
import { editQueue, enqueue, extendQueue, playerStore } from '../app/src/player/controller'

const video = (id: string, title = 'Video', channelName = 'Kênh'): VideoItem =>
  ({ id, title, channelName, channelId: 'UC' + id.padEnd(22, 'x'), channelAvatar: null, thumbnail: `https://i.ytimg.com/vi/${id}/hq720.jpg`, durationSeconds: 100 }) as VideoItem

describe('SHA-256 (PIN hash)', () => {
  test('matches node:crypto', () => {
    for (const text of ['', 'abc', 'muối:1234', 'Tiếng Việt có dấu đầy đủ', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'ư'.repeat(1000)]) {
      assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 20)))
    }
  })
})

describe('parental controls', () => {
  test('folding and keyword lists ignore case and diacritics', () => {
    assert.equal(foldText('Đà Lạt ĐẸP Quá'), 'da lat dep qua')
    assert.deepEqual(keywordList('Bạo lực, kinh dị\nbạo LỰC;  ;'), ['bao luc', 'kinh di'])
  })

  test('time windows, including over midnight', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 25, h, m)
    assert.equal(insideWindow('07:00', '21:00', at(7)), true)
    assert.equal(insideWindow('07:00', '21:00', at(21)), false)
    assert.equal(insideWindow('07:00', '21:00', at(6, 59)), false)
    assert.equal(insideWindow('20:00', '06:00', at(23)), true)
    assert.equal(insideWindow('20:00', '06:00', at(5, 59)), true)
    assert.equal(insideWindow('20:00', '06:00', at(12)), false)
    assert.equal(insideWindow('08:00', '08:00', at(3)), true)
  })

  test('lock reasons: daily limit, bonus time, whole day, time window', () => {
    const now = new Date(2026, 9, 25, 22, 0)
    const usage = { day: localDay(now), seconds: 3600, bonusSeconds: 0, unlimitedDay: null as string | null, windowUntil: 0 }
    const config = { ...DEFAULT_PARENTAL, enabled: true, dailyLimitMinutes: 60 }
    assert.equal(lockReason({ ...config, enabled: false }, usage, now), null)
    assert.equal(lockReason(config, usage, now), 'limit')
    assert.equal(lockReason(config, { ...usage, bonusSeconds: 900 }, now), null)
    assert.equal(lockReason(config, { ...usage, unlimitedDay: localDay(now) }, now), null)
    const windowed = { ...config, dailyLimitMinutes: 0, windowEnabled: true, windowFrom: '07:00', windowTo: '21:00' }
    assert.equal(lockReason(windowed, usage, now), 'window')
    assert.equal(lockReason(windowed, { ...usage, windowUntil: now.getTime() + 60_000 }, now), null)
  })

  test('PIN: salted hash only, verification, keywords and restricted mode', () => {
    parental.enable('2468')
    assert.equal(parental.verifyPin('2468'), true)
    assert.equal(parental.verifyPin('1357'), false)
    flushSaves()
    const stored = memoryStorage.getItem('dvd.parental')!
    assert.ok(stored && !stored.includes('2468'), 'the PIN itself is never stored')
    const { config } = JSON.parse(stored)
    assert.match(config.pinHash, /^[0-9a-f]{64}$/)
    assert.equal(config.pinHash, sha256Hex(`${config.pinSalt}:2468`))
    assert.equal(restrictedMode(), true)

    parental.update({ keywords: 'kinh dị, bạo lực' })
    assert.equal(blockedByKeywords({ title: 'Phim KINH DI hay nhất', channelName: 'A' }), true)
    assert.equal(blockedByKeywords({ title: 'Nhạc thiếu nhi', channelName: 'Kênh Bạo Lực' }), true)
    assert.equal(blockedByKeywords({ title: 'Nhạc thiếu nhi', channelName: 'Kênh vui' }), false)
    assert.equal(library.isHidden(video('kinhdi0001', 'Truyện kinh dị')), true)

    parental.update({ dailyLimitMinutes: 15 })
    parentalStore.set({ usage: { ...parentalStore.get().usage, seconds: 15 * 60 - 1 } })
    assert.equal(parental.tick(), 'limit')
    parental.grant(15)
    assert.equal(parental.tick(), null)
    parental.resetAll()
    assert.equal(restrictedMode(), false)
    assert.equal(parental.verifyPin('2468'), false)
  })
})

describe('settings', () => {
  test('defaults and persisted changes', () => {
    assert.equal(settings().language, 'vi')
    assert.equal(settings().defaultQuality, DEFAULT_SETTINGS.defaultQuality)
    updateSettings({ defaultQuality: 720, captionsEnabled: true })
    flushSaves()
    const saved = JSON.parse(memoryStorage.getItem('dvd.settings')!)
    assert.equal(saved.defaultQuality, 720)
    assert.equal(saved.captionsEnabled, true)
  })
})

describe('library', () => {
  test('history with resume positions, watch later, search history', () => {
    library.recordWatch(video('aaaaaaaaaaa', 'Một'), 30, 100)
    library.recordWatch(video('bbbbbbbbbbb', 'Hai'), 50, 200)
    library.recordWatch(video('aaaaaaaaaaa', 'Một'), 40, 100)
    assert.deepEqual(libraryStore.get().history.map((h) => h.video.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    assert.equal(library.progressFor('aaaaaaaaaaa')?.position, 40)
    assert.equal(library.toggleWatchLater(video('ccccccccccc')), true)
    assert.equal(library.isWatchLater('ccccccccccc'), true)
    library.addSearch('nhạc trẻ')
    library.addSearch('Nhạc Trẻ')
    assert.deepEqual(libraryStore.get().searchHistory, ['Nhạc Trẻ'])
    updateSettings({ incognito: true })
    library.addSearch('bí mật')
    library.recordWatch(video('ddddddddddd'), 1, 2)
    assert.equal(libraryStore.get().searchHistory.includes('bí mật'), false)
    assert.equal(libraryStore.get().history.some((h) => h.video.id === 'ddddddddddd'), false)
    updateSettings({ incognito: false })
  })

  test('sync: export in the shared format, merge a phone library', () => {
    const exported = library.exportLibrary('Phòng khách TV')
    const parsed = parseLibraryExport(JSON.parse(JSON.stringify(exported)))
    assert.ok(parsed)
    assert.equal(parsed!.platform, 'tv')
    assert.equal(parsed!.history.length, 2)

    const phone = makeLibraryExport(
      {
        subscriptions: [{ id: 'UCphone00000000000000001', name: 'Kênh Điện Thoại', avatar: null } as never],
        history: [{ video: video('eeeeeeeeeee', 'Từ điện thoại'), watchedAt: Date.now() + 1000, position: 70, duration: 300 }],
        watchLater: [],
        liked: [video('fffffffffff', 'Đã thích')],
        playlists: [],
        searchHistory: ['tin tức'],
      },
      'Điện thoại',
      'android',
    )
    const { merged, summary } = library.mergeFrom(phone, 'Phòng khách TV')
    assert.equal(typeof summary, 'string')
    assert.ok(summary.length > 0)
    const s = libraryStore.get()
    assert.equal(s.history[0].video.id, 'eeeeeeeeeee')
    assert.equal(library.progressFor('eeeeeeeeeee')?.position, 70, 'resume position comes along')
    assert.ok(library.isSubscribed('UCphone00000000000000001'))
    assert.ok(library.isLiked('fffffffffff'))
    assert.ok(s.searchHistory.includes('tin tức'))
    assert.equal(merged.device, 'Phòng khách TV')
    assert.equal(merged.history.length, 3)
    flushSaves()
    const stored = JSON.parse(memoryStorage.getItem('dvd.library')!)
    assert.equal(stored.history.length, 3)
  })
})

describe('cast queue on the TV', () => {
  const ids = () => playerStore.get().queue.map((v) => v.id.slice(0, 1)).join('')
  const v = (letter: string) => video(letter.padEnd(11, letter))
  const start = () => {
    playerStore.set({ video: v('a'), queue: [v('a'), v('b')], index: 0, autoIds: [] })
    extendQueue([v('x'), v('y')], true)
  }

  test('phones queue ahead of the videos autoplay added', () => {
    start()
    assert.equal(ids(), 'abxy')
    enqueue(v('c'), false)
    enqueue(v('d'), false)
    assert.equal(ids(), 'abcdxy')
    enqueue(v('e'), true)
    assert.equal(ids(), 'aebcdxy')
    // Queuing a suggestion makes it a chosen video.
    enqueue(v('y'), false)
    assert.equal(ids(), 'aebcdyx')
  })

  test('applies edits from phones', () => {
    start()
    editQueue({ op: 'move', index: 2, videoId: v('x').id, to: 1 })
    assert.equal(ids(), 'axby')
    editQueue({ op: 'remove', index: 3, videoId: v('y').id, to: null })
    assert.equal(ids(), 'axb')
    assert.deepEqual(playerStore.get().autoIds, [v('x').id])
    editQueue({ op: 'remove', index: 0, videoId: v('a').id, to: null })
    assert.equal(ids(), 'axb', 'what plays stays')
    editQueue({ op: 'play', index: 2, videoId: v('b').id, to: null })
    assert.equal(playerStore.get().index, 2)
    assert.equal(playerStore.get().video?.id, v('b').id)
    editQueue({ op: 'clear', index: 0, videoId: null, to: null })
    assert.equal(ids(), 'b')
  })
})
