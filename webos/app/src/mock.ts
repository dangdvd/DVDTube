// "Chế độ mẫu": believable Vietnamese sample data for every screen without the service or the
// network (development in a desktop browser, screenshots). The channels, videos and generated
// thumbnails come from the desktop app's sample data (windows/src/renderer/src/lib/mockData.ts).
// Playback uses `mock:` sources, which the player simulates with a timer.

import type { LibraryExport } from '@shared/library'
import type {
  AccountIdentity,
  AccountState,
  CaptionCue,
  ChannelPage,
  ChannelTab,
  FeedItem,
  FeedPage,
  LyricLine,
  Lyrics,
  MusicBrowsePage,
  MusicItem,
  MusicSearchKind,
  VideoItem,
  WatchInfo,
} from '@shared/models'
import { CHANNEL_TABS } from '@shared/models'
import {
  MOCK_CHANNELS,
  avatarArt,
  bannerArt,
  channelItem,
  hashString,
  homeItems,
  idFromSeed,
  mockChannel,
  mockMix,
  mockPlaylist,
  mockShorts,
  mockVideo,
  mockVideos,
  random,
  searchItems,
  thumbnailArt,
} from '../../../windows/src/renderer/src/lib/mockData'
import { mockEmit, type StoredSession, type TvApi } from './api'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function flag(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name) ?? localStorage.getItem('mock.' + name)
  } catch {
    return null
  }
}

function page(items: FeedItem[], continuation: string | null, kind: FeedPage['kind'] = 'browse'): FeedPage {
  return { items, continuation, kind }
}

// MARK: Account

let signedIn = flag('signedIn') === '1'
let selected = '0|'

function identities(): AccountIdentity[] {
  const base = [
    { id: '0|', authUser: 0, pageId: null, name: 'Minh Anh', byline: '@minhanh.vn', email: 'minhanh@example.com', hue: 200, hasChannel: true },
    { id: '0|110428', authUser: 0, pageId: '110428', name: 'Minh Anh Vlog', byline: '12,4 N người đăng ký', email: null, hue: 330, hasChannel: true },
    { id: '1|', authUser: 1, pageId: null, name: 'Minh Anh (Công việc)', byline: null, email: 'minhanh.work@example.com', hue: 140, hasChannel: false },
  ]
  return base.map(({ hue, ...i }) => ({ ...i, avatar: avatarArt(i.name, hue), isSelected: i.id === selected }))
}

function accountState(): AccountState {
  if (!signedIn) return { signedIn: false, profile: null, identities: [] }
  const list = identities()
  const current = list.find((i) => i.isSelected) ?? list[0]
  return {
    signedIn: true,
    profile: { name: current.name, handle: current.byline?.startsWith('@') ? current.byline : null, email: current.email ?? null, avatar: current.avatar, channelId: null },
    identities: list,
  }
}

function mockSession(): StoredSession {
  return { cookies: { SAPISID: 'mock', SID: 'mock' }, identity: { authUser: 0, pageId: null }, profile: accountState().profile }
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
    `<text x="32" y="500" font-family="Arial, sans-serif" font-size="40" font-weight="800" fill="#fff">${title.replace(/[&<>]/g, '').slice(0, 22)}</text></svg>`
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

function musicItems(query: string, kind: MusicSearchKind, pageIndex: number): MusicItem[] {
  const seed = `${query}:${kind}:${pageIndex}`
  switch (kind) {
    case 'songs':
      return Array.from({ length: 12 }, (_, i) => song(seed, i))
    case 'videos':
      return Array.from({ length: 10 }, (_, i) => song(seed, i, 'video'))
    case 'albums':
      return Array.from({ length: 10 }, (_, i) => {
        const artist = ARTISTS[(hashString(seed) + i) % ARTISTS.length]
        const title = SONGS[(i * 3) % SONGS.length]
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
        { title: 'Album', items: musicItems(name, 'albums', 0).slice(0, 6) },
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
  const lines: LyricLine[] = LYRIC_LINES.map((text, i) => ({ startMs: 2000 + i * 3500, endMs: 2000 + (i + 1) * 3500, text }))
  return { videoId, text: LYRIC_LINES.join('\n'), source: 'Nguồn: LyricFind', lines: h % 2 === 0 ? lines : null }
}

// MARK: Channels

function channelTabPage(id: string, tab: ChannelTab): FeedPage {
  const c = mockChannel(id)
  if (tab === 'shorts') return page(mockShorts(`channel:${c.id}`, 18).map((video) => ({ type: 'video', video: { ...video, channelName: c.name, channelId: c.id } })), null)
  if (tab === 'playlists') return page(Array.from({ length: 10 }, (_, i) => ({ type: 'playlist' as const, playlist: mockPlaylist(`${c.id}:${i}`, c) })), null)
  if (tab === 'streams') return page(mockVideos(`streams:${c.id}`, 8, { channel: c, live: true }).map((video) => ({ type: 'video', video })), null)
  return page(mockVideos(`channel:${c.id}:${tab}`, 24, { channel: c }).map((video) => ({ type: 'video', video })), `channel:${c.id}:${tab}:1`)
}

function watchInfo(videoId: string): WatchInfo {
  const video = mockVideo('watch:' + videoId)
  const c = mockChannel(video.channelId ?? '')
  return {
    videoId,
    title: video.title,
    viewCountText: video.viewCountText,
    dateText: video.publishedText,
    relativeDateText: video.publishedText,
    likeCountText: `${(hashString(videoId) % 900) + 12} N`,
    description: `${c.tagline}.\n\nCảm ơn các bạn đã xem video! Đừng quên đăng ký kênh ${c.name} để xem video mới mỗi tuần.\n\n00:00 Mở đầu\n01:30 Nội dung chính\n08:45 Kết thúc`,
    channel: channelItem(c),
    related: page(mockVideos('related:' + videoId, 16).map((v) => ({ type: 'video', video: v })), null, 'next'),
    chapters: [],
    heatmap: [],
  }
}

// MARK: The API

let unseenPairing: ReturnType<typeof setTimeout> | null = null

export const mockApi: Partial<TvApi> = {
  appInfo: async () => ({
    version: '1.0.0',
    platform: 'webos',
    node: 'v12.22.12',
    deviceName: 'LG OLED55C1 (Phòng khách)',
    deviceId: 'b2f0c1aa-0000-4000-8000-000000000tv1',
    castPort: 8766,
    castRunning: true,
    signedIn,
  }),
  configure: async () => {},
  log: async () => {},
  diagnostics: async () => ({ version: '1.0.0', node: 'mock', lines: [] }),

  home: async (category) => {
    await wait(350)
    return page(homeItems(category, 0), `home:${category}:1`)
  },
  more: async (token) => {
    await wait(350)
    const [kind, a, b, c] = token.split(':')
    const n = parseInt(c ?? b ?? '1', 10) || 1
    if (kind === 'home') {
      const category = a as Parameters<typeof homeItems>[0]
      return page(homeItems(category, n), n < 4 ? `home:${category}:${n + 1}` : null)
    }
    if (kind === 'search') return page(searchItems(decodeURIComponent(a), n, 'all'), n < 3 ? `search:${a}:${n + 1}` : null, 'search')
    if (kind === 'channel') return page(mockVideos(`channel:${a}:${b}:${n}`, 24, { channel: mockChannel(a) }).map((video) => ({ type: 'video', video })), null)
    return page([], null)
  },
  search: async (query, filters) => {
    await wait(350)
    const kind = filters?.type === 'channel' ? 'channel' : filters?.type === 'playlist' ? 'playlist' : filters?.type === 'shorts' ? 'shorts' : 'all'
    return page(searchItems(query, 0, kind), `search:${encodeURIComponent(query)}:1`, 'search')
  },
  suggestions: async (query) => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const words = ['remix', 'lofi', 'karaoke', 'live', 'mới nhất', 'hay nhất', 'tiktok', '2026']
    return words.map((w) => `${q} ${w}`).slice(0, 8)
  },
  watchInfo: async (videoId) => {
    await wait(250)
    return watchInfo(videoId)
  },
  channel: async (id, tab) => {
    await wait(350)
    const c = mockChannel(id)
    const initialTab: ChannelTab = tab && tab !== 'posts' && tab !== 'about' ? tab : 'videos'
    const result: ChannelPage = {
      channel: channelItem(c),
      banner: bannerArt(c.name, c.tagline, c.hue),
      description: `${c.tagline}. Chào mừng bạn đến với kênh ${c.name}!`,
      tabParams: Object.fromEntries(CHANNEL_TABS.map((t) => [t.tab, t.defaultParams])),
      initialTab,
      initialPage: channelTabPage(c.id, initialTab),
      aboutToken: null,
      isSubscribed: null,
    }
    return result
  },
  channelTab: async (id, tab) => {
    await wait(300)
    return channelTabPage(id, tab)
  },
  playlist: async (id) => {
    await wait(300)
    const info = id.startsWith('RD') ? mockMix(id) : mockPlaylist(id)
    return { playlist: { ...info, id }, page: page(mockVideos('playlist:' + id, 20).map((video) => ({ type: 'video', video })), null) }
  },
  playlistVideos: async (id) => mockVideos('playlist:' + id, 20),
  resolveLink: async (text) => {
    const m = /(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(text)
    return m ? { type: 'video', videoId: m[1] } : { type: 'search', query: text.trim() }
  },
  latestVideos: async (channelIds) => {
    await wait(300)
    const videos = channelIds.flatMap((id, i) => {
      const c = mockChannel(id)
      return [0, 1, 2].map((n) => mockVideo(`latest:${c.id}:${n}`, { channel: c, ageMs: ((i % 5) * 0.7 + n * 3.3 + 0.1) * 86_400_000 }))
    })
    return videos.sort((a, b) => (b.publishedDate ?? 0) - (a.publishedDate ?? 0))
  },

  stream: async (videoId) => {
    await wait(200)
    const video = mockVideo('watch:' + videoId)
    return {
      videoId,
      title: video.title,
      author: video.channelName ?? null,
      channelId: video.channelId ?? null,
      lengthSeconds: null,
      isLive: false,
      thumbnail: video.thumbnail ?? null,
      client: 'MOCK',
      availableAt: 0,
      captions: [
        { name: 'Tiếng Việt', languageCode: 'vi', baseUrl: 'https://www.youtube.com/api/timedtext?mock=vi', isAutoGenerated: false, isTranslatable: true },
        { name: 'Tiếng Anh (tạo tự động)', languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?mock=en', isAutoGenerated: true, isTranslatable: true },
      ],
      loudnessDb: null,
      hls: `mock:${videoId}`,
      hlsBase: `mock:${videoId}`,
      mp4: null,
      mp4Quality: null,
      audio: `mock:${videoId}`,
      qualities: [1080, 720, 480, 360, 240, 144],
      audioTracks: [
        { id: 'vi', name: 'Tiếng Việt (gốc)', language: 'vi', isDefault: true },
        { id: 'en', name: 'Tiếng Anh (lồng tiếng)', language: 'en', isDefault: false },
      ],
    }
  },
  sponsorSegments: async () => [{ start: 30, end: 42, category: 'sponsor' }],
  captions: async (track): Promise<CaptionCue[]> => {
    const lines =
      track.languageCode === 'en'
        ? ['Hello everyone and welcome back', 'Today we are going to try something new', 'Let me know what you think in the comments']
        : ['Xin chào các bạn, chào mừng quay trở lại kênh', 'Hôm nay chúng ta sẽ thử một điều hoàn toàn mới', 'Nhớ để lại bình luận cho mình biết ý kiến nhé']
    return Array.from({ length: 120 }, (_, i) => ({ start: i * 4, end: i * 4 + 3.6, text: lines[i % lines.length] }))
  },
  dislikes: async (videoId) => 200 + (hashString(videoId) % 9000),
  dearrow: async () => ({}),
  markWatched: async () => {},

  account: async () => accountState(),
  setSession: async (session) => {
    if (session && Object.keys(session.cookies ?? {}).length > 0) signedIn = true
    return accountState()
  },
  exportSession: async () => (signedIn ? mockSession() : null),
  refreshAccount: async () => accountState(),
  signOut: async () => {
    signedIn = false
    selected = '0|'
    const state = accountState()
    mockEmit('account', state)
    return state
  },
  switchIdentity: async (id) => {
    await wait(250)
    selected = id
    const state = accountState()
    mockEmit('session', { changed: true })
    mockEmit('account', state)
    return state
  },
  accountFeed: async (kind) => {
    await wait(350)
    if (kind === 'playlists') return page(Array.from({ length: 6 }, (_, i) => ({ type: 'playlist' as const, playlist: mockPlaylist('mine:' + i) })), null)
    return page(mockVideos('account:' + kind, 18).map((video) => ({ type: 'video', video })), null)
  },
  accountSubscriptions: async () => MOCK_CHANNELS.filter((_, i) => i % 2 === 0).map(channelItem),
  rate: async () => {},
  subscribe: async () => {},

  startPairing: async () => {
    const host = '192.168.1.50:8765'
    const qrText = `dvdtube://tv-login?h=${host}&t=${idFromSeed('t' + Date.now(), 22)}&k=${idFromSeed('k' + Date.now(), 43)}&n=${encodeURIComponent('LG OLED55C1')}`
    const { qrDataUrl } = await import('./qr')
    if (unseenPairing) clearTimeout(unseenPairing)
    mockEmit('pairing', { state: 'waiting' })
    if (flag('pairing') === 'success') {
      unseenPairing = setTimeout(() => {
        signedIn = true
        mockEmit('session', { changed: true })
        mockEmit('pairing', { state: 'success', accountName: 'Minh Anh' })
        mockEmit('account', accountState())
      }, 4000)
    }
    return { qrText, qrDataUrl: qrDataUrl(qrText), host, deviceName: 'LG OLED55C1', expiresAt: Date.now() + 10 * 60_000 }
  },
  stopPairing: async () => {
    if (unseenPairing) clearTimeout(unseenPairing)
  },
  castReceiverStatus: async () => {},
  startSyncReceiver: async () => {
    const host = '192.168.1.50:8768'
    const qrText = `dvdtube://sync?h=${host}&t=${idFromSeed('st' + Date.now(), 22)}&k=${idFromSeed('sk' + Date.now(), 43)}&n=${encodeURIComponent('LG OLED55C1')}`
    const { qrDataUrl } = await import('./qr')
    mockEmit('syncStatus', { state: 'waiting' })
    if (flag('sync') === 'success') {
      setTimeout(() => {
        const library: LibraryExport = {
          format: 'dvdtube-library',
          version: 1,
          exportedAt: Date.now(),
          device: 'iPhone của Minh Anh',
          platform: 'ios',
          subscriptions: MOCK_CHANNELS.slice(0, 5).map(channelItem),
          history: mockVideos('sync-history', 8).map((video, i) => ({ video, watchedAt: Date.now() - i * 3_600_000, position: 60 + i * 30, duration: video.durationSeconds ?? 600 })),
          watchLater: mockVideos('sync-later', 4),
          liked: mockVideos('sync-liked', 3),
          playlists: [{ id: 'p-sync-1', name: 'Nhạc chill', videos: mockVideos('sync-pl', 6), createdAt: Date.now() }],
          searchHistory: ['nhạc lofi', 'review điện thoại'],
        }
        mockEmit('syncIncoming', { requestId: 'mock-sync', device: library.device, library })
      }, 3000)
    }
    return { qrText, qrDataUrl: qrDataUrl(qrText), host, deviceName: 'LG OLED55C1', expiresAt: Date.now() + 10 * 60_000 }
  },
  stopSyncReceiver: async () => {},
  syncReply: async (_requestId, _merged, summary) => {
    mockEmit('syncStatus', { state: 'success', device: 'iPhone của Minh Anh', summary })
  },

  musicSearch: async (query, kind) => {
    await wait(300)
    return { items: musicItems(query, kind, 0), continuation: null }
  },
  musicBrowse: async (browseId) => {
    await wait(300)
    return browsePage(browseId)
  },
  lyrics: async (videoId) => {
    await wait(200)
    return mockLyrics(videoId)
  },
  checkUpdate: async () => ({
    current: '1.0.0',
    latest: '1.0.42',
    newer: true,
    url: 'https://github.com/dangdvd/DVDTube/releases/latest',
    downloadUrl: 'https://github.com/dangdvd/DVDTube/releases/latest/download/DVDTube-webOS.ipk',
    notes: 'Truyền tới TV, nghe nhạc có lời bài hát, đồng bộ thư viện',
  }),
}

/** Sample shorts for the Shorts section in mock mode. */
export function mockShortsFeed(seed: string): VideoItem[] {
  return mockShorts(seed, 12)
}

/** Screenshots / smoke in mock mode: a filled local library (history with progress, lists, channels). */
export function demoLibrary(): Record<string, unknown> {
  const history = mockVideos('demo-history', 14).map((video, i) => {
    const duration = video.durationSeconds ?? 600
    return { video, watchedAt: Date.now() - i * 3_600_000, position: Math.floor(duration * (0.15 + ((i * 7) % 70) / 100)), duration }
  })
  const progress: Record<string, { position: number; duration: number; updatedAt: number }> = {}
  for (const h of history) progress[h.video.id] = { position: h.position, duration: h.duration, updatedAt: h.watchedAt }
  return {
    history,
    progress,
    watchLater: mockVideos('demo-later', 9),
    liked: mockVideos('demo-liked', 7),
    playlists: [
      { id: 'demo-pl-1', name: 'Nhạc nghe khi làm việc', videos: mockVideos('demo-pl-1', 8, { category: 'music' }), createdAt: Date.now() - 86_400_000 },
      { id: 'demo-pl-2', name: 'Công thức nấu ăn', videos: mockVideos('demo-pl-2', 5), createdAt: Date.now() - 2 * 86_400_000 },
      { id: 'demo-pl-3', name: 'Học lập trình', videos: mockVideos('demo-pl-3', 6, { category: 'learning' }), createdAt: Date.now() - 3 * 86_400_000 },
    ],
    subscriptions: MOCK_CHANNELS.filter((_, i) => i % 3 === 0).map(channelItem),
    searchHistory: ['nhạc lofi chill', 'review điện thoại 2026', 'bóng đá việt nam', 'công thức phở bò', 'học tiếng anh giao tiếp'],
    notInterested: [],
    blockedChannels: [],
    blockedChannelNames: {},
  }
}
