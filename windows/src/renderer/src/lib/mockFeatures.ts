// Mock answers of the newer API methods (cast, sync, music, lyrics, DeArrow, files, log,
// updates, web player) so every screen renders without Electron.
// Dev toggles (localStorage): `mockCast = 'none'` finds no device; `mockSync = 'success'` lets a
// "phone" sync after a few seconds; `mockDearrow = '0'` returns no branding.

import QRCode from 'qrcode'
import type { DvdApi, SyncInfo } from '@shared/api'
import { makeLibraryExport } from '@shared/library'
import type { CastDevice, CastStatus, LyricLine, Lyrics, MusicBrowsePage, MusicItem, MusicSearchKind, VideoItem } from '@shared/models'
import { MOCK_CHANNELS, avatarArt, hashString, idFromSeed, mockVideo, mockVideos, random, thumbnailArt } from './mockData'
import { mockEmit as emit } from './mockEvents'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const flag = (name: string) => {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

// MARK: Cast

const KNOWN: CastDevice[] = [
  { id: 'b2f0c1aa-0000-4000-8000-tv0000000001', name: 'TCL Smart TV Pro', kind: 'tv', host: '192.168.1.50', port: 8766, online: true },
  { id: 'b2f0c1aa-0000-4000-8000-pc0000000002', name: 'LAPTOP-PHONGKHACH', kind: 'desktop', host: '192.168.1.31', port: 8766, online: true },
]
let manual: CastDevice[] = []
let remote: CastStatus = { state: 'idle', video: null, position: 0, duration: 0, volume: 0.8, muted: false, queue: [], index: 0, error: null }
let remoteTimer: ReturnType<typeof setInterval> | null = null

function devices(): CastDevice[] {
  return flag('mockCast') === 'none' ? manual : [...KNOWN, ...manual]
}

function runRemote(): void {
  if (remoteTimer) return
  remoteTimer = setInterval(() => {
    if (remote.state === 'playing') remote = { ...remote, position: Math.min(remote.duration, remote.position + 1) }
  }, 1000)
}

// MARK: Music

const ARTISTS = ['Sơn Tùng M-TP', 'Hoàng Thùy Linh', 'Đen Vâu', 'Mỹ Tâm', 'Vũ.', 'MONO', 'Hà Anh Tuấn', 'Bích Phương', 'Noo Phước Thịnh', 'Tlinh']
const SONGS = [
  'Chúng Ta Của Tương Lai',
  'Để Mị Nói Cho Mà Nghe',
  'Mang Tiền Về Cho Mẹ',
  'Đừng Hỏi Em',
  'Lạ Lùng',
  'Waiting For You',
  'Tháng Tư Là Lời Nói Dối Của Em',
  'Bùa Yêu',
  'Cause I Love You',
  'Nữ Siêu Anh Hùng',
  'Hãy Trao Cho Anh',
  'Ngày Đầu Tiên',
  'See Tình',
  'Có Hẹn Với Thanh Xuân',
]

function cover(title: string, seed: string): string {
  const hue = hashString(seed) % 360
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="544" height="544" viewBox="0 0 544 544">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},75%,22%)"/></linearGradient></defs>` +
    `<rect width="544" height="544" fill="url(#g)"/><circle cx="272" cy="272" r="150" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="40"/>` +
    `<circle cx="272" cy="272" r="26" fill="#fff" fill-opacity="0.85"/>` +
    `<text x="32" y="500" font-family="Segoe UI, Arial" font-size="40" font-weight="800" fill="#fff">${title.replace(/[&<>]/g, '').slice(0, 22)}</text></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function song(seed: string, i: number, kind: 'song' | 'video' = 'song'): MusicItem {
  const r = random('song:' + seed + i)
  const title = SONGS[(hashString(seed) + i) % SONGS.length]
  const artist = ARTISTS[Math.floor(r() * ARTISTS.length)]
  const seconds = 150 + Math.floor(r() * 150)
  const durationText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const id = idFromSeed('music:' + seed + ':' + i)
  const art = kind === 'song' ? cover(title, id) : thumbnailArt(title, artist, hashString(artist) % 360, { category: 'music', seed: id })
  const video: VideoItem = { id, title, channelName: artist, thumbnail: art, durationText, durationSeconds: seconds }
  return { type: kind, id, title, subtitle: `${artist} • ${title} (Single) • ${durationText}`, artists: artist, durationText, thumbnail: art, video }
}

function searchItems(query: string, kind: MusicSearchKind, page: number): MusicItem[] {
  const seed = `${query}:${kind}:${page}`
  switch (kind) {
    case 'songs':
      return Array.from({ length: 12 }, (_, i) => song(seed, i))
    case 'videos':
      return Array.from({ length: 10 }, (_, i) => song(seed, i, 'video'))
    case 'albums':
      return Array.from({ length: 10 }, (_, i) => {
        const artist = ARTISTS[(hashString(seed) + i) % ARTISTS.length]
        const title = `${SONGS[(i * 3) % SONGS.length]}`
        return { type: 'album' as const, id: 'MPREb_' + idFromSeed(seed + i, 12), title, subtitle: `Album • ${artist} • ${2016 + (i % 9)}`, artists: artist, thumbnail: cover(title, seed + i) }
      })
    case 'artists':
      return ARTISTS.slice(0, 8).map((name, i) => ({
        type: 'artist' as const,
        id: 'UC' + idFromSeed('artist:' + name, 22),
        title: name,
        subtitle: `Nghệ sĩ • ${(1 + i * 0.7).toFixed(1).replace('.', ',')} Tr người đăng ký`,
        thumbnail: avatarArt(name, hashString(name) % 360),
      }))
    case 'playlists':
      return Array.from({ length: 8 }, (_, i) => {
        const title = ['Nhạc Trẻ Hay Nhất', 'V-Pop Thịnh Hành', 'Chill Cuối Tuần', 'Bolero Bất Hủ', 'Rap Việt Cực Cháy', 'Acoustic Nhẹ Nhàng', 'Nhạc Tập Gym', 'Lofi Học Bài'][i]
        return { type: 'playlist' as const, id: 'VLPL' + idFromSeed(seed + i, 30), title, subtitle: `Danh sách phát • DVDTube • ${20 + i * 7} bài hát`, thumbnail: cover(title, seed + 'p' + i) }
      })
  }
}

function browsePage(browseId: string): MusicBrowsePage {
  if (browseId.startsWith('UC')) {
    const name = ARTISTS[hashString(browseId) % ARTISTS.length]
    return {
      kind: 'artist',
      title: name,
      subtitle: '3,2 Tr người đăng ký',
      description: `${name} là một trong những nghệ sĩ được yêu thích nhất của nhạc Việt.`,
      thumbnail: avatarArt(name, hashString(name) % 360),
      shelves: [
        { title: 'Bài hát hàng đầu', items: Array.from({ length: 5 }, (_, i) => song(browseId, i)) },
        { title: 'Album', items: searchItems(name, 'albums', 0).slice(0, 6) },
        { title: 'Video', items: Array.from({ length: 6 }, (_, i) => song(browseId + 'v', i, 'video')) },
      ],
    }
  }
  const title = browseId.startsWith('VL') ? 'Nhạc Trẻ Hay Nhất' : SONGS[hashString(browseId) % SONGS.length]
  const artist = ARTISTS[hashString(browseId) % ARTISTS.length]
  const art = cover(title, browseId)
  return {
    kind: browseId.startsWith('VL') ? 'playlist' : 'album',
    title,
    subtitle: browseId.startsWith('VL') ? 'Danh sách phát • 24 bài hát' : `Album • ${artist} • 2024`,
    thumbnail: art,
    playlistId: 'OLAK5uy_' + idFromSeed(browseId, 30),
    shelves: [{ title: '', items: Array.from({ length: 11 }, (_, i) => ({ ...song(browseId, i), thumbnail: art, artists: artist, subtitle: artist })) }],
  }
}

const LYRIC_LINES = [
  'Em ơi, có biết đêm nay trăng sáng',
  'Gió nhẹ đưa câu hát qua phố vắng',
  'Mình đi chung đường, chung một giấc mơ',
  'Ngày mai nắng lên, ta vẫn đợi chờ',
  '',
  'Hát lên đi, cho tim thôi bối rối',
  'Hát lên đi, cho nhau thêm một lời',
  'Dù mai có xa, vẫn nhớ nụ cười',
  'Và câu hát này, là của đôi ta',
  '',
  'Em ơi, có biết đêm nay trăng sáng',
  'Gió nhẹ đưa câu hát qua phố vắng',
]

function mockLyrics(videoId: string): Lyrics | null {
  const h = hashString(videoId)
  if (h % 5 === 4) return null
  if (h % 2 === 0) {
    const lines: LyricLine[] = LYRIC_LINES.map((text, i) => ({ startMs: 2000 + i * 3500, endMs: 2000 + (i + 1) * 3500, text }))
    return { videoId, text: LYRIC_LINES.join('\n'), source: 'Nguồn: LyricFind', lines }
  }
  return { videoId, text: LYRIC_LINES.join('\n'), source: 'Nguồn: Musixmatch', lines: null }
}

// MARK: The API

let syncTimer: ReturnType<typeof setTimeout> | null = null

export const mockFeatureApi: Partial<DvdApi> = {
  // Cast
  castDevices: async () => devices(),
  castScan: async () => {
    await wait(300)
    setTimeout(() => emit('castDevices', devices()), 600)
  },
  castAddDevice: async (address) => {
    await wait(500)
    const match = /^\s*(\d+\.\d+\.\d+\.\d+)(?::(\d+))?\s*$/.exec(address)
    if (!match) throw new Error('Địa chỉ không hợp lệ. Nhập dạng 192.168.1.20 hoặc 192.168.1.20:8766.')
    const device: CastDevice = { id: 'manual-' + match[1], name: `Máy tính ${match[1]}`, kind: 'desktop', host: match[1], port: Number(match[2] ?? 8766), manual: true, online: true }
    manual = [device, ...manual.filter((d) => d.id !== device.id)]
    return device
  },
  castForgetDevice: async (id) => {
    manual = manual.filter((d) => d.id !== id)
  },
  castPlay: async (_device, request) => {
    await wait(300)
    const queue = request.queue?.length ? request.queue : [request.video]
    remote = {
      ...remote,
      state: 'playing',
      video: request.video,
      position: request.startSeconds ?? 0,
      duration: request.video.durationSeconds ?? 245,
      queue,
      index: request.index ?? Math.max(0, queue.findIndex((v) => v.id === request.video.id)),
      error: null,
    }
    runRemote()
  },
  castQueue: async (_device, video, next) => {
    await wait(150)
    const queue = [...remote.queue]
    queue.splice(next ? remote.index + 1 : queue.length, 0, video)
    remote = { ...remote, queue }
  },
  castControl: async (_device, action, value) => {
    await wait(80)
    switch (action) {
      case 'play':
        remote = { ...remote, state: 'playing' }
        break
      case 'pause':
        remote = { ...remote, state: 'paused' }
        break
      case 'toggle':
        remote = { ...remote, state: remote.state === 'playing' ? 'paused' : 'playing' }
        break
      case 'seek':
        remote = { ...remote, position: value ?? 0 }
        break
      case 'skip':
        remote = { ...remote, position: Math.max(0, remote.position + (value ?? 0)) }
        break
      case 'volume':
        remote = { ...remote, volume: value ?? remote.volume, muted: false }
        break
      case 'mute':
        remote = { ...remote, muted: value == null ? !remote.muted : value >= 1 }
        break
      case 'stop':
        remote = { ...remote, state: 'idle', video: null, position: 0 }
        break
      case 'next':
      case 'previous': {
        const index = Math.min(Math.max(0, remote.index + (action === 'next' ? 1 : -1)), Math.max(0, remote.queue.length - 1))
        const video = remote.queue[index] ?? remote.video
        remote = { ...remote, index, video, position: 0, duration: video?.durationSeconds ?? remote.duration }
      }
    }
  },
  castStatus: async () => ({ ...remote }),
  castReceiverStatus: async () => {},

  // Sync
  startSyncReceiver: async (): Promise<SyncInfo> => {
    const token = idFromSeed('sync-token:' + Date.now(), 22)
    const key = idFromSeed('sync-key:' + Date.now(), 43)
    const host = '192.168.1.24:8768'
    const deviceName = 'DESKTOP-MINHANH'
    const qrText = `dvdtube://sync?h=${host}&t=${token}&k=${key}&n=${encodeURIComponent(deviceName)}`
    const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 2, width: 360 })
    setTimeout(() => emit('syncStatus', { state: 'waiting' }), 100)
    if (syncTimer) clearTimeout(syncTimer)
    if (flag('mockSync') === 'success') {
      syncTimer = setTimeout(() => {
        emit('syncStatus', { state: 'merging', device: 'iPhone của An' })
        const phone = makeLibraryExport(
          { subscriptions: MOCK_CHANNELS.slice(0, 4).map((c) => ({ id: c.id, name: c.name })), history: [], watchLater: mockVideos('phone-wl', 6), liked: mockVideos('phone-liked', 4), playlists: [], searchHistory: ['bolero', 'rap việt'] },
          'iPhone của An',
          'ios',
        )
        emit('syncIncoming', { requestId: 'mock', device: 'iPhone của An', library: phone })
        setTimeout(() => emit('syncStatus', { state: 'success', device: 'iPhone của An', summary: 'Đã thêm 4 kênh, 10 video, 2 nội dung tìm kiếm' }), 900)
      }, 3000)
    }
    return { qrText, qrDataUrl, host, deviceName, expiresAt: Date.now() + 10 * 60_000 }
  },
  stopSyncReceiver: async () => {
    if (syncTimer) clearTimeout(syncTimer)
  },
  syncReply: async () => {},

  // Music
  musicSearch: async (query, kind, continuation) => {
    await wait(350)
    const page = continuation ? Number(continuation.split(':').pop()) || 1 : 0
    return { items: searchItems(query, kind, page), continuation: page < 2 ? `music:${kind}:${page + 1}` : null }
  },
  musicBrowse: async (browseId) => {
    await wait(350)
    return browsePage(browseId)
  },
  lyrics: async (videoId) => {
    await wait(250)
    return mockLyrics(videoId)
  },

  // DeArrow: about a third of the videos get a calmer community title / thumbnail.
  dearrow: async (ids) => {
    await wait(200)
    if (flag('mockDearrow') === '0') return {}
    const result: Record<string, { title?: string; thumbnail?: string }> = {}
    for (const id of ids) {
      const h = hashString('dearrow:' + id)
      if (h % 3 !== 0) {
        result[id] = {}
        continue
      }
      const video = mockVideo('dearrow:' + id)
      const title = `${video.title.replace(/[!?]+$/g, '').replace(/\s*\(.*?\)\s*/g, ' ').trim()} – tóm tắt nội dung`
      result[id] = { title, thumbnail: h % 2 === 0 ? thumbnailArt('Khung hình trong video', 'DeArrow', h % 360, { seed: 'dearrow-thumb:' + id }) : undefined }
    }
    return result
  },

  // Downloads / updates / system
  runAutoDownloads: async () => {
    await wait(400)
  },
  installUpdate: async () => {
    let progress = 0
    const timer = setInterval(() => {
      progress = Math.min(1, progress + 0.08)
      emit('updateProgress', { state: 'downloading', progress })
      if (progress >= 1) {
        clearInterval(timer)
        emit('updateProgress', { state: 'installing' })
      }
    }, 200)
  },
  showWindow: async () => {},
  setRecentVideos: async () => {},
  webPlayerSource: async (videoId) => ({ url: `about:blank#${videoId}`, partition: 'yt-anon' }),

  // Files and log
  saveTextFile: async (defaultName, text) => {
    console.info('[mock] saveTextFile', defaultName, `${text.length} chars`)
    return `C:\\Users\\MinhAnh\\Documents\\${defaultName}`
  },
  openTextFile: async () => {
    await wait(200)
    const library = makeLibraryExport(
      {
        subscriptions: MOCK_CHANNELS.slice(2, 8).map((c) => ({ id: c.id, name: c.name })),
        history: mockVideos('import-history', 12).map((video, i) => ({ video, watchedAt: Date.now() - i * 3_600_000, position: 30, duration: 300 })),
        watchLater: mockVideos('import-wl', 5),
        liked: mockVideos('import-liked', 3),
        playlists: [{ id: 'import-pl', name: 'Nhạc từ điện thoại', videos: mockVideos('import-pl', 7, { category: 'music' }), createdAt: Date.now() }],
        searchHistory: ['nhạc trịnh', 'mukbang'],
      },
      'Pixel 8',
      'android',
    )
    return { name: 'DVDTube-thu-vien-20261020.json', text: JSON.stringify(library) }
  },
  showFile: async () => {},
  buildLog: async (context) => {
    const text = ['DVDTube — nhật ký lỗi (mô phỏng)', ...Object.entries(context.settings).map(([k, v]) => `${k}: ${v}`), ...context.rendererLines].join('\n')
    return { fileName: 'DVDTube-log-windows-20261025-1200.txt', text }
  },
  logRenderer: async () => {},
}
