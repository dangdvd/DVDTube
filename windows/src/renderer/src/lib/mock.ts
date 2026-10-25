// Mock implementation of the main-process API for running the UI in a plain browser
// (no Electron, no network). Returns believable Vietnamese sample data (see `mockData.ts`).
// Dev toggles (localStorage): `mockSignedIn = '1'` signed-in account, `mockSmoke = '1'` runs the
// smoke scenario, `mockUpdate = '1'` offers an update, `mockPairing = 'success'` completes the
// phone sign-in after a few seconds, `mockDemo = '1'` starts with a filled local library
// (history, playlists, subscriptions…) for screenshots.

import QRCode from 'qrcode'
import type { DvdApi, PairingInfo } from '@shared/api'
import type {
  AccountIdentity,
  AccountState,
  AccountNotification,
  ChannelPage,
  ChannelTab,
  DownloadedVideo,
  FeedItem,
  FeedPage,
  HomeCategory,
  ResolvedLink,
  SearchFilters,
  VideoItem,
} from '@shared/models'
import { CHANNEL_TABS, DEFAULT_SEARCH_FILTERS } from '@shared/models'
import { mockPlayerApi } from '@/player/mock'
import {
  MOCK_CHANNELS,
  agoText,
  avatarArt,
  bannerArt,
  channelItem,
  hashString,
  idFromSeed,
  mockChannel,
  mockMix,
  mockPlaylist,
  mockPosts,
  mockVideo,
  mockVideos,
  homeItems,
  random,
  searchItems,
} from './mockData'
import { mockEmit as emit } from './mockEvents'
import { mockFeatureApi } from './mockFeatures'

// MARK: Events

export { mockOn } from './mockEvents'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const flag = (name: string) => {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}
const setFlag = (name: string, value: string | null) => {
  try {
    if (value == null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    // Private storage: the toggle just does not persist.
  }
}

// MARK: Account

let selectedIdentity = '0|'

function identities(): AccountIdentity[] {
  const base = [
    { id: '0|', authUser: 0, pageId: null, name: 'Minh Anh', byline: '@minhanh.vn', email: 'minhanh@example.com', hue: 200, hasChannel: true },
    {
      id: '0|110428',
      authUser: 0,
      pageId: '110428',
      name: 'Minh Anh Vlog',
      byline: 'Kênh thương hiệu • 12,4 N người đăng ký',
      email: null,
      hue: 330,
      hasChannel: true,
    },
    {
      id: '1|',
      authUser: 1,
      pageId: null,
      name: 'Minh Anh (Công việc)',
      byline: null,
      email: 'minhanh.work@example.com',
      hue: 140,
      hasChannel: false,
    },
  ]
  return base.map(({ hue, ...i }) => ({ ...i, avatar: avatarArt(i.name, hue), isSelected: i.id === selectedIdentity }))
}

function accountState(): AccountState {
  if (flag('mockSignedIn') !== '1') return { signedIn: false, profile: null, identities: [] }
  const list = identities()
  const current = list.find((i) => i.isSelected) ?? list[0]
  return {
    signedIn: true,
    profile: {
      name: current.name,
      handle: current.id === '0|' ? '@minhanh.vn' : current.pageId ? '@minhanhvlog' : null,
      email: current.email ?? 'minhanh@example.com',
      avatar: current.avatar,
      channelId: current.hasChannel ? 'UC' + idFromSeed('me:' + current.id, 22) : null,
    },
    identities: list,
  }
}

let unseen = 3

function notifications(): AccountNotification[] {
  const templates = [
    (c: string, t: string) => `${c} đã tải lên: ${t}`,
    (c: string, t: string) => `${c} đang phát trực tiếp: ${t}`,
    (c: string) => `${c} đã đăng một bài viết mới`,
    (c: string, t: string) => `Được đề xuất: ${t}`,
  ]
  return Array.from({ length: 14 }, (_, i) => {
    const video = mockVideo('notif:' + i, { ageMs: (i * 3 + 1) * 3_600_000 })
    const kind = i % 7 === 3 ? 2 : i % 5 === 1 ? 1 : i % 6 === 5 ? 3 : 0
    return {
      id: 'n' + i,
      message: templates[kind](video.channelName ?? '', video.title),
      timeText: agoText((i * 3 + 1) * 3_600_000),
      avatar: video.channelAvatar,
      thumbnail: kind === 2 ? null : video.thumbnail,
      videoId: kind === 2 ? null : video.id,
      isRead: i >= 3,
    }
  })
}

// MARK: Downloads

const downloadsList: DownloadedVideo[] = [0, 1, 2, 3, 4].map((i) => {
  const video = mockVideo('download:' + i, { category: i % 2 ? 'music' : 'general' })
  const audioOnly = i === 2
  return {
    video,
    fileName: `${video.title} [${video.id}].${audioOnly ? 'm4a' : 'mp4'}`,
    filePath: `C:\\Users\\MinhAnh\\Videos\\DVDTube\\${video.title} [${video.id}].${audioOnly ? 'm4a' : 'mp4'}`,
    fileSize: audioOnly ? 6_400_000 + i * 900_000 : 84_000_000 + i * 61_000_000,
    qualityLabel: audioOnly ? null : ['1080p', '720p', '', '1080p', '480p'][i],
    downloadedAt: Date.now() - (i + 1) * 26 * 3_600_000,
    isAudioOnly: audioOnly,
    isAuto: i === 1 || i === 3,
  }
})
const timers = new Map<string, ReturnType<typeof setInterval>>()
let demoStarted = false

function simulateDownload(video: VideoItem, audioOnly: boolean, options?: { durationMs?: number; failAt?: number }) {
  const id = video.id
  clearInterval(timers.get(id))
  emit('download', { videoId: id, status: { state: 'queued' }, video })
  const total = options?.durationMs ?? 9000
  let progress = 0
  setTimeout(() => {
    emit('download', { videoId: id, status: { state: 'preparing' }, video })
    const timer = setInterval(() => {
      progress = Math.min(1, progress + 250 / total)
      if (options?.failAt && progress >= options.failAt) {
        clearInterval(timer)
        timers.delete(id)
        emit('download', { videoId: id, status: { state: 'failed', message: 'Mất kết nối tới máy chủ video. Kiểm tra mạng và thử lại.' }, video })
        return
      }
      if (progress < 1) {
        emit('download', { videoId: id, status: { state: 'downloading', progress }, video })
        return
      }
      clearInterval(timer)
      timers.delete(id)
      emit('download', { videoId: id, status: { state: 'merging' } })
      setTimeout(() => {
        const entry: DownloadedVideo = {
          video,
          fileName: `${video.title} [${id}].${audioOnly ? 'm4a' : 'mp4'}`,
          filePath: `C:\\Users\\MinhAnh\\Videos\\DVDTube\\${video.title} [${id}].${audioOnly ? 'm4a' : 'mp4'}`,
          fileSize: audioOnly ? 5_200_000 : 142_000_000,
          qualityLabel: audioOnly ? null : '1080p',
          downloadedAt: Date.now(),
          isAudioOnly: audioOnly,
        }
        downloadsList.unshift(entry)
        emit('download', { videoId: id, status: { state: 'done', entry } })
      }, 1200)
    }, 250)
    timers.set(id, timer)
  }, 700)
}

/** A slow download and a failed one, so the downloads page shows every state. */
function startDemoDownloads() {
  if (demoStarted) return
  demoStarted = true
  setTimeout(() => {
    simulateDownload(mockVideo('demo-download', { category: 'music' }), false, { durationMs: 90_000 })
    simulateDownload(mockVideo('demo-failed', { category: 'learning' }), false, { durationMs: 2000, failAt: 0.35 })
  }, 300)
}

// MARK: Demo library

function demoLibrary() {
  const now = Date.now()
  const history = mockVideos('demo-history', 28).map((video, i) => {
    const duration = video.durationSeconds ?? 600
    const watchedAt = now - Math.floor(i / 3) * 86_400_000 - (i % 3) * 3_600_000 - 600_000
    const position = i % 4 === 0 ? duration : Math.floor(duration * (0.15 + ((i * 37) % 70) / 100))
    return { video, watchedAt, position, duration }
  })
  const progress = Object.fromEntries(history.map((h) => [h.video.id, { position: h.position, duration: h.duration, updatedAt: h.watchedAt }]))
  const playlist = (name: string, seed: string, count: number, days: number) => ({
    id: 'local-' + seed,
    name,
    videos: mockVideos(seed, count, { category: 'music' }),
    createdAt: now - days * 86_400_000,
  })
  return {
    history,
    progress,
    watchLater: mockVideos('demo-wl', 9),
    liked: mockVideos('demo-liked', 12),
    playlists: [
      playlist('Nhạc nghe khi làm việc', 'demo-pl-1', 14, 20),
      playlist('Nhạc chill cuối tuần', 'demo-pl-2', 8, 45),
      { ...playlist('Công thức nấu ăn', 'demo-pl-3', 6, 70), videos: mockVideos('demo-pl-3', 6, { category: 'general' }) },
    ],
    subscriptions: MOCK_CHANNELS.filter((_, i) => i % 3 === 0)
      .map(channelItem)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    searchHistory: ['nhạc trẻ remix', 'lofi chill học bài', 'bóng đá việt nam', 'du lịch đà lạt', 'học tiếng anh giao tiếp', 'review điện thoại'],
    notInterested: [],
    blockedChannels: [MOCK_CHANNELS[10].id],
    blockedChannelNames: { [MOCK_CHANNELS[10].id]: MOCK_CHANNELS[10].name },
  }
}

// MARK: Feeds

function page(items: FeedItem[], continuation: string | null, kind: FeedPage['kind']): FeedPage {
  return { items, continuation, kind }
}

function searchKind(filters?: SearchFilters): 'all' | 'video' | 'shorts' | 'channel' | 'playlist' | 'live' {
  const f = filters ?? DEFAULT_SEARCH_FILTERS
  if (f.type === 'channel') return 'channel'
  if (f.type === 'playlist') return 'playlist'
  if (f.type === 'shorts') return 'shorts'
  if (f.features.includes('live')) return 'live'
  if (f.type === 'video' || f.type === 'movie') return 'video'
  return 'all'
}

function sortItems(items: FeedItem[], filters?: SearchFilters): FeedItem[] {
  if (filters?.sort !== 'date') return items
  return [...items].sort((a, b) => (b.type === 'video' ? (b.video.publishedDate ?? 0) : 0) - (a.type === 'video' ? (a.video.publishedDate ?? 0) : 0))
}

function channelTabPage(id: string, tab: ChannelTab, pageIndex: number): FeedPage {
  const c = mockChannel(id)
  const seed = `channel:${c.id}:${tab}:${pageIndex}`
  const next = pageIndex < 3 ? `channel:${c.id}:${tab}:${pageIndex + 1}` : null
  switch (tab) {
    case 'shorts':
      return page(
        mockVideos(seed, 24, { channel: c, short: true }).map((video) => ({ type: 'video', video })),
        next,
        'browse',
      )
    case 'streams':
      return page(
        mockVideos(seed, 18, { channel: c }).map((video, i) => ({
          type: 'video',
          video:
            i === 0 && pageIndex === 0
              ? { ...video, isLive: true, durationText: null, publishedText: null, viewCountText: '1,8 N người đang xem' }
              : { ...video, publishedText: 'Đã phát trực tiếp ' + video.publishedText },
        })),
        next,
        'browse',
      )
    case 'playlists':
      return page(
        Array.from({ length: 12 }, (_, i) => ({ type: 'playlist', playlist: mockPlaylist(`${seed}:${i}`, c) })),
        null,
        'browse',
      )
    default: {
      const videos = mockVideos(seed, 30, { channel: c }).sort((a, b) => (b.publishedDate ?? 0) - (a.publishedDate ?? 0))
      return page(
        videos.map((video) => ({ type: 'video', video })),
        next,
        'browse',
      )
    }
  }
}

function playlistInfo(id: string) {
  const r = random('playlist-info:' + id)
  const c = MOCK_CHANNELS[hashString(id) % MOCK_CHANNELS.length]
  const base = mockPlaylist(id, c)
  const total = 18 + Math.floor(r() * 40)
  return { playlist: { ...base, id, videoCountText: `${total} video` }, channel: c, total }
}

function playlistPage(id: string, pageIndex: number): FeedPage {
  const { channel, total } = playlistInfo(id)
  const start = pageIndex * 20
  const count = Math.max(0, Math.min(20, total - start))
  const videos = Array.from({ length: count }, (_, i) =>
    mockVideo(`playlist:${id}:${start + i}`, {
      channel: (start + i) % 4 === 3 ? undefined : channel,
      category: channel.category,
      titleIndex: hashString(id) + start + i,
    }),
  )
  return page(
    videos.map((video) => ({ type: 'video', video })),
    start + count < total ? `playlist:${id}:${pageIndex + 1}` : null,
    'browse',
  )
}

function accountVideos(kind: string, count: number, pageIndex: number): FeedPage {
  const videos = mockVideos(`account:${kind}:${pageIndex}`, count)
  if (kind === 'subscriptions') videos.sort((a, b) => (b.publishedDate ?? 0) - (a.publishedDate ?? 0))
  return page(
    videos.map((video) => ({ type: 'video', video })),
    pageIndex < 2 ? `account:${kind}:${pageIndex + 1}` : null,
    'browse',
  )
}

/** Continuation tokens of the mock are "<what>:<args…>:<page>". */
async function more(token: string): Promise<FeedPage> {
  await wait(450)
  const parts = token.split(':')
  const pageIndex = Number(parts[parts.length - 1]) || 1
  switch (parts[0]) {
    case 'home': {
      const category = parts[1] as HomeCategory
      return page(homeItems(category, pageIndex), pageIndex < 6 ? `home:${category}:${pageIndex + 1}` : null, 'browse')
    }
    case 'search': {
      const kind = parts[1] as ReturnType<typeof searchKind>
      const query = decodeURIComponent(parts[2])
      return page(
        searchItems(query, pageIndex, kind),
        pageIndex < 5 ? `search:${kind}:${encodeURIComponent(query)}:${pageIndex + 1}` : null,
        'search',
      )
    }
    case 'channel':
      return channelTabPage(parts[1], parts[2] as ChannelTab, pageIndex)
    case 'playlist':
      return playlistPage(parts[1], pageIndex)
    case 'account':
      return accountVideos(parts[1], 18, pageIndex)
    default:
      return page([], null, 'browse')
  }
}

const SUGGESTION_WORDS = [
  'remix',
  'hay nhất',
  '2026',
  'lofi',
  'karaoke',
  'tiktok',
  'mới nhất',
  'live',
  'cover',
  'không quảng cáo',
  'acoustic',
  'nhạc chill',
]
const POPULAR = [
  'nhạc trẻ remix',
  'nhạc lofi chill',
  'bolero trữ tình',
  'tin tức hôm nay',
  'bóng đá việt nam',
  'học tiếng anh giao tiếp',
  'phim hay',
  'nấu ăn ngon',
  'du lịch đà lạt',
  'review điện thoại',
  'liên quân mobile',
  'minecraft sinh tồn',
  'podcast chữa lành',
  'nhạc không lời piano',
  'rap việt',
]

function resolve(text: string): ResolvedLink | null {
  const t = text.trim()
  if (!t) return null
  const id = '[A-Za-z0-9_-]{11}'
  let m = t.match(new RegExp(`youtu\\.be/(${id})`)) ?? t.match(new RegExp(`[?&]v=(${id})`)) ?? t.match(new RegExp(`/(?:embed|live|v)/(${id})`))
  const list = t.match(/[?&]list=([A-Za-z0-9_-]+)/)?.[1] ?? null
  const time = t.match(/[?&](?:t|start)=(\d+)/)?.[1]
  if (m) return { type: 'video', videoId: m[1], playlistId: list, startSeconds: time ? Number(time) : null }
  m = t.match(new RegExp(`/shorts/(${id})`))
  if (m) return { type: 'shorts', videoId: m[1] }
  if (list) return { type: 'playlist', playlistId: list }
  m = t.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/)
  if (m) return { type: 'channel', channelId: m[1] }
  m = t.match(/(?:youtube\.com\/)?(@[A-Za-z0-9._-]+)/)
  if (m && (t.startsWith('@') || /youtube\.com/.test(t))) return { type: 'channel', channelId: mockChannel(m[1]).id }
  if (new RegExp(`^${id}$`).test(t)) return { type: 'video', videoId: t }
  return { type: 'search', query: t }
}

// MARK: The API

export const mockApi: Partial<DvdApi> = {
  ...mockPlayerApi,
  ...mockFeatureApi,

  appInfo: async () => ({
    version: '1.0.0',
    platform: 'win32',
    electron: '43.7.7',
    chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '',
    userDataPath: 'C:\\Users\\MinhAnh\\AppData\\Roaming\\DVDTube',
    smoke: flag('mockSmoke') === '1',
    hidden: false,
    deviceName: 'DESKTOP-MINHANH',
    arch: 'x64',
  }),
  configure: async () => {},

  home: async (category) => {
    await wait(500)
    return page(homeItems(category, 0), `home:${category}:1`, 'browse')
  },
  more: (token) => more(token),
  search: async (query, filters) => {
    await wait(450)
    const kind = searchKind(filters)
    return page(sortItems(searchItems(query, 0, kind), filters), `search:${kind}:${encodeURIComponent(query)}:1`, 'search')
  },
  suggestions: async (query) => {
    await wait(60)
    const q = query.trim().toLowerCase()
    if (!q) return []
    const fromPopular = POPULAR.filter((p) => p.startsWith(q) && p !== q)
    const extended = SUGGESTION_WORDS.map((w) => `${q} ${w}`)
    return [...new Set([...fromPopular, ...extended])].slice(0, 10)
  },
  resolveLink: async (text) => resolve(text),

  channel: async (id, tab) => {
    await wait(450)
    const c = mockChannel(id)
    const initialTab: ChannelTab = tab && tab !== 'posts' && tab !== 'about' ? tab : 'videos'
    const result: ChannelPage = {
      channel: channelItem(c),
      banner: bannerArt(c.name, c.tagline, c.hue),
      description: `${c.tagline}. Chào mừng bạn đến với kênh ${c.name}! Video mới mỗi tuần vào tối thứ Tư và thứ Bảy. Đăng ký kênh và bật chuông thông báo để không bỏ lỡ video nào nhé.`,
      tabParams: Object.fromEntries(CHANNEL_TABS.map((t) => [t.tab, t.defaultParams])),
      initialTab,
      initialPage: channelTabPage(c.id, initialTab, 0),
      aboutToken: 'about:' + c.id,
      isSubscribed: null,
    }
    return result
  },
  channelTab: async (id, tab) => {
    await wait(400)
    return channelTabPage(id, tab, 0)
  },
  channelPosts: async (id) => {
    await wait(400)
    const c = mockChannel(id)
    return { posts: mockPosts(c, 0), continuation: `posts:${c.id}:1` }
  },
  channelPostsMore: async (token) => {
    await wait(400)
    const [, id, p] = token.split(':')
    const pageIndex = Number(p) || 1
    return { posts: mockPosts(mockChannel(id), pageIndex), continuation: pageIndex < 3 ? `posts:${id}:${pageIndex + 1}` : null }
  },
  channelAbout: async (id) => {
    await wait(300)
    const c = mockChannel(id)
    const r = random('about:' + c.id)
    return {
      description: `${c.tagline}.\n\nChào mừng bạn đến với kênh ${c.name}! Ở đây có video mới mỗi tuần vào tối thứ Tư và thứ Bảy.\n\nLiên hệ công việc: contact@example.com`,
      country: 'Việt Nam',
      subscriberCountText: channelItem(c).subscriberText,
      viewCountText: `${Math.floor(c.subscribers * (80 + r() * 300)).toLocaleString('vi-VN')} lượt xem`,
      videoCountText: `${c.videoCount.toLocaleString('vi-VN')} video`,
      joinedDateText: `Đã tham gia ${1 + Math.floor(r() * 28)} thg ${1 + Math.floor(r() * 12)}, ${2010 + Math.floor(r() * 12)}`,
      channelUrl: `https://www.youtube.com/${c.handle}`,
      links: [
        { title: 'Facebook', displayUrl: `facebook.com/${c.handle.slice(1)}`, url: `https://facebook.com/${c.handle.slice(1)}` },
        { title: 'Instagram', displayUrl: `instagram.com/${c.handle.slice(1)}`, url: `https://instagram.com/${c.handle.slice(1)}` },
        { title: 'TikTok', displayUrl: `tiktok.com/${c.handle}`, url: `https://tiktok.com/${c.handle}` },
      ],
    }
  },
  channelSearch: async (id, query) => {
    await wait(400)
    const c = mockChannel(id)
    return page(
      mockVideos(`channel-search:${c.id}:${query}`, 12, { channel: c, query }).map((video) => ({ type: 'video', video })),
      null,
      'browse',
    )
  },

  playlist: async (id) => {
    await wait(400)
    if (id === 'WL' || id === 'LL') {
      return {
        playlist: {
          id,
          title: id === 'WL' ? 'Xem sau' : 'Video đã thích',
          channelName: accountState().profile?.name ?? null,
          videoCountText: '36 video',
        },
        page: accountVideos(id, 18, 0),
      }
    }
    return { playlist: playlistInfo(id).playlist, page: playlistPage(id, 0) }
  },
  playlistVideos: async (id, limit) => {
    await wait(300)
    const { total } = playlistInfo(id)
    const all: VideoItem[] = []
    for (let p = 0; p * 20 < Math.min(total, limit ?? 500); p++) {
      for (const item of playlistPage(id, p).items) if (item.type === 'video') all.push(item.video)
    }
    return all.slice(0, limit ?? 500)
  },
  latestVideos: async (channelIds) => {
    await wait(500)
    const videos = channelIds.flatMap((id, i) => {
      const c = mockChannel(id)
      return [0, 1, 2, 3].map((n) => mockVideo(`latest:${c.id}:${n}`, { channel: c, ageMs: ((i % 5) * 0.7 + n * 3.3 + 0.1) * 86_400_000 }))
    })
    return videos.sort((a, b) => (b.publishedDate ?? 0) - (a.publishedDate ?? 0))
  },

  // Watch-page extras: the player module's mocks win when they exist.
  dislikes: mockPlayerApi.dislikes ?? (async (videoId) => 200 + (hashString(videoId) % 9000)),
  rate: mockPlayerApi.rate ?? (async () => {}),
  markWatched: mockPlayerApi.markWatched ?? (async () => {}),

  account: async () => accountState(),
  signIn: async () => {
    await wait(800)
    setFlag('mockSignedIn', '1')
    const state = accountState()
    emit('account', state)
    return state
  },
  signOut: async () => {
    setFlag('mockSignedIn', null)
    selectedIdentity = '0|'
    const state = accountState()
    emit('account', state)
    return state
  },
  switchIdentity: async (id) => {
    await wait(300)
    selectedIdentity = id
    const state = accountState()
    emit('account', state)
    return state
  },
  accountFeed: async (kind) => {
    await wait(500)
    if (kind === 'playlists') {
      return page(
        [
          ...Array.from({ length: 7 }, (_, i) => ({
            type: 'playlist' as const,
            playlist: { ...mockPlaylist('mine:' + i), channelName: accountState().profile?.name ?? null },
          })),
          { type: 'playlist', playlist: mockMix('mine') },
        ],
        null,
        'browse',
      )
    }
    return accountVideos(kind, kind === 'subscriptions' ? 24 : 18, 0)
  },
  accountSubscriptions: async () => {
    await wait(500)
    return MOCK_CHANNELS.filter((_, i) => i % 2 === 0).map(channelItem)
  },
  accountNotifications: async () => {
    await wait(350)
    unseen = 0
    return notifications()
  },
  unseenNotificationCount: async () => unseen,
  subscribe: async () => {
    await wait(200)
  },
  playlistOptions: async () => {
    await wait(400)
    return ['Nhạc nghe khi làm việc', 'Công thức nấu ăn', 'Học lập trình', 'Du lịch 2027', 'Phim hay'].map((title, i) => ({
      id: 'PLmine' + i,
      title,
      containsVideo: i === 1,
    }))
  },
  editPlaylist: async () => {
    await wait(200)
  },
  createPlaylist: async (title) => {
    await wait(400)
    return 'PL' + idFromSeed('new:' + title, 32)
  },

  startPairing: async () => {
    const token = idFromSeed('token:' + Date.now(), 22)
    const key = idFromSeed('key:' + Date.now(), 43)
    const host = '192.168.1.24:8765'
    const deviceName = 'DESKTOP-MINHANH'
    const qrText = `dvdtube://tv-login?h=${host}&t=${token}&k=${key}&n=${encodeURIComponent(deviceName)}`
    const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 2, width: 360 })
    const info: PairingInfo = { qrText, qrDataUrl, host, deviceName, expiresAt: Date.now() + 10 * 60_000 }
    setTimeout(() => emit('pairing', { state: 'waiting' }), 100)
    if (flag('mockPairing') === 'success') {
      setTimeout(() => {
        setFlag('mockSignedIn', '1')
        emit('pairing', { state: 'success', accountName: 'Minh Anh' })
        emit('account', accountState())
      }, 4000)
    }
    return info
  },
  stopPairing: async () => {},

  download: async (video, options) => {
    simulateDownload(video, options.audioOnly)
  },
  cancelDownload: async (videoId) => {
    clearInterval(timers.get(videoId))
    timers.delete(videoId)
    emit('download', { videoId, status: { state: 'cancelled' } })
  },
  deleteDownload: async (videoId) => {
    const index = downloadsList.findIndex((d) => d.video.id === videoId)
    if (index >= 0) downloadsList.splice(index, 1)
  },
  downloads: async () => {
    startDemoDownloads()
    return [...downloadsList]
  },
  downloadFileUrl: mockPlayerApi.downloadFileUrl ?? (async () => null),
  showDownload: async () => {},
  chooseDownloadFolder: async () => 'D:\\Video\\DVDTube',

  storeRead: async (name) => {
    try {
      const text = localStorage.getItem('dvd-store-' + name)
      if (!text && name === 'library' && flag('mockDemo') === '1') return demoLibrary()
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  },
  storeWrite: async (name, data) => {
    try {
      localStorage.setItem('dvd-store-' + name, JSON.stringify(data))
    } catch {
      // Ignore quota errors in the mock.
    }
  },

  openExternal: async (url) => {
    console.info('[mock] openExternal', url)
  },
  setWindowMode: async (mode) => {
    emit('windowMode', mode)
  },
  setThumbar: async () => {},
  notify: async (title, body) => {
    console.info('[mock] notify', title, '-', body)
  },
  checkUpdate: async () => {
    if (flag('mockUpdate') !== '1') return null
    return {
      version: '1.0.42',
      url: 'https://github.com/dangdvd/DVDTube/releases/latest',
      notes: 'Truyền tới TV, nghe nhạc có lời bài hát, đồng bộ thư viện',
      downloadUrl: 'https://github.com/dangdvd/DVDTube/releases/latest/download/DVDTube-Setup.exe',
      assetName: 'DVDTube-Setup.exe',
      size: 98_000_000,
      installable: true,
    }
  },
  openStudio: async () => {
    console.info('[mock] openStudio')
  },
  setStartWithWindows: async () => {},
  setPreventSleep: async () => {},
  smokeStep: async (step) => {
    console.info('[smoke]', JSON.stringify(step))
  },
}
