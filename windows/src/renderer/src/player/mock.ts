// Mock answers for the player-related API methods (player, watchInfo, comments, captions…)
// used when the UI runs without Electron. OWNED BY THE PLAYER MODULE.
//
// Real playback in mock mode: `bash scripts/make-test-media.sh` writes YouTube-like DASH files
// (fragmented MP4 with sidx, WebM with Cues) and `dev/media.json` with their byte ranges into
// src/renderer/public/dev/; `player()` points the adaptive formats at them, so the in-memory
// DASH manifest + shaka path runs exactly as with googlevideo URLs.
//
// Dev toggles (localStorage): mockAdWait=1 (3 s "Đang chuẩn bị video…"), mockBroken=dash
// (DASH fails → fallback to HLS) or =all (every source fails → error overlay),
// mockDownloaded=<id,id…> (plays the "downloaded" file).

import type { DvdApi } from '@shared/api'
import type {
  CaptionCue,
  CaptionTrack,
  ChannelItem,
  Chapter,
  Comment,
  CommentsPage,
  FeedItem,
  HeatMarker,
  LiveChatMessage,
  PlayerInfo,
  StreamFormat,
  VideoItem,
  WatchInfo,
} from '@shared/models'

interface MediaFormat extends Partial<StreamFormat> {
  file: string
  itag: number
  mimeType: string
  bitrate: number
}

interface MediaSet {
  duration: number
  formats: MediaFormat[]
  muxed: MediaFormat[]
}

interface MediaJson extends MediaSet {
  shorts: MediaSet
  storyboard: { path: string; width: number; height: number; count: number; columns: number; rows: number; intervalMs: number }
}

const notes = new Map<string, VideoItem>()

/** The player tells the mock what it is about to play, so answers match the card clicked. */
export function noteMockVideo(video: VideoItem): void {
  const known = notes.get(video.id)
  notes.set(video.id, { ...known, ...video, title: video.title || known?.title || '' })
}

const flag = (name: string) => {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const abs = (path: string) => new URL(path, document.baseURI).href

let mediaPromise: Promise<MediaJson | null> | null = null
function media(): Promise<MediaJson | null> {
  mediaPromise ??= fetch(abs('dev/media.json'))
    .then((r) => (r.ok ? (r.json() as Promise<MediaJson>) : null))
    .catch(() => null)
  return mediaPromise
}

// MARK: Sample data

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export function mockThumbnail(title: string, seed = title, vertical = false): string {
  const hue = hash(seed) % 360
  const [w, h] = vertical ? [270, 480] : [480, 270]
  const words = title.split(/\s+/).slice(0, 6).join(' ')
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/>` +
      `<stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,22%)"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `<circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.32}" fill="hsla(${(hue + 180) % 360},80%,70%,0.25)"/>` +
      `<text x="24" y="${h - 36}" font-family="Segoe UI, Arial" font-size="${vertical ? 22 : 26}" font-weight="700" fill="#fff">${escapeXml(words)}</text>` +
      `</svg>`,
  )
}

function avatar(name: string): string {
  const hue = hash(name) % 360
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" rx="44" fill="hsl(${hue},55%,45%)"/>` +
      `<text x="44" y="57" text-anchor="middle" font-family="Segoe UI, Arial" font-size="38" font-weight="600" fill="#fff">${escapeXml(name.charAt(0).toUpperCase())}</text></svg>`,
  )
}

const CHANNELS: ChannelItem[] = [
  { id: 'UCmockNhacTre', name: 'Nhạc Trẻ Hay Nhất', subscriberText: '2,4 Tr người đăng ký' },
  { id: 'UCmockAmThuc', name: 'Ẩm Thực Miền Tây', subscriberText: '856 N người đăng ký' },
  { id: 'UCmockCongNghe', name: 'Công Nghệ Mỗi Ngày', subscriberText: '1,1 Tr người đăng ký' },
  { id: 'UCmockDuLich', name: 'Đi Đâu Đây', subscriberText: '432 N người đăng ký' },
  { id: 'UCmockHocTap', name: 'Học Cùng DVD', subscriberText: '98,5 N người đăng ký' },
].map((c) => ({ ...c, avatar: avatar(c.name), handle: '@' + c.name.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase() }))

const TITLES = [
  'Lofi chill nhẹ nhàng giúp tập trung học bài',
  'Top 20 bài hát nhạc trẻ remix hay nhất 2025',
  'Cách làm bánh xèo miền Tây giòn rụm',
  'Đánh giá chi tiết laptop mỏng nhẹ cho sinh viên',
  'Một ngày khám phá Đà Lạt mộng mơ',
  'Học tiếng Anh giao tiếp qua phim – Bài 12',
  'Nhạc Bolero trữ tình tuyển chọn hay nhất',
  'Vlog: chợ nổi Cái Răng lúc bình minh',
  'Hướng dẫn lập trình TypeScript cho người mới',
  'Tin tức công nghệ nổi bật trong tuần',
  'Bản tin thời tiết và giao thông cuối tuần',
  'Review phở Hà Nội ngon nhất phố cổ',
  'Mẹo tiết kiệm pin điện thoại hiệu quả',
  'Live acoustic: những bản tình ca bất hủ',
  'Phim ngắn: Mùa hè năm ấy',
  'Bí quyết nấu cơm tấm sườn bì chả chuẩn vị',
]

const AGES = ['2 giờ trước', '1 ngày trước', '3 ngày trước', '1 tuần trước', '2 tuần trước', '1 tháng trước', '5 tháng trước', '1 năm trước']

export function mockVideo(seed: number, options: { short?: boolean; live?: boolean } = {}): VideoItem {
  const title = (options.short ? '#shorts ' : '') + TITLES[seed % TITLES.length] + (seed >= TITLES.length ? ` (phần ${Math.floor(seed / TITLES.length) + 1})` : '')
  const channel = CHANNELS[seed % CHANNELS.length]
  const id = (options.short ? 'mShort' : options.live ? 'mLive' : 'mVid') + String(seed).padStart(5, '0')
  const duration = options.live ? null : options.short ? 20 : 90 + ((seed * 37) % 1100)
  return {
    id,
    title,
    channelName: channel.name,
    channelId: channel.id,
    channelAvatar: channel.avatar,
    thumbnail: mockThumbnail(title, id, options.short),
    durationSeconds: duration,
    durationText: duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : null,
    viewCountText: options.live ? `${(seed % 9) + 1},${seed % 10} N người đang xem` : `${((seed * 13) % 900) + 12} N lượt xem`,
    publishedText: options.live ? null : AGES[seed % AGES.length],
    isLive: !!options.live,
    isShort: !!options.short,
  }
}

function known(videoId: string): VideoItem {
  const note = notes.get(videoId)
  if (note && note.title) return note
  const seed = hash(videoId) % 200
  return { ...mockVideo(seed, { short: note?.isShort, live: note?.isLive }), ...note, id: videoId, title: note?.title || mockVideo(seed).title }
}

function channelFor(video: VideoItem): ChannelItem {
  return CHANNELS.find((c) => c.id === video.channelId) ?? { ...CHANNELS[hash(video.id) % CHANNELS.length], ...(video.channelName ? { name: video.channelName } : {}) }
}

const CAPTIONS: CaptionTrack[] = [
  { name: 'Tiếng Việt', languageCode: 'vi', baseUrl: 'mock://captions/vi', isAutoGenerated: false, isTranslatable: true },
  { name: 'Tiếng Anh (tự động tạo)', languageCode: 'en', baseUrl: 'mock://captions/en', isAutoGenerated: true, isTranslatable: true },
]

const CAPTION_LINES: Record<string, string[]> = {
  vi: [
    'Xin chào các bạn, chào mừng trở lại kênh!',
    'Hôm nay chúng ta sẽ cùng thử một điều thú vị.',
    'Hãy để ý phần hình ở giữa màn hình nhé.',
    'Đây là đoạn video thử nghiệm của DVDTube.',
    'Phụ đề hiển thị theo thời gian của video.',
    'Bạn có thể đổi cỡ chữ và độ đậm nền trong cài đặt.',
  ],
  en: [
    'Hello everyone, welcome back to the channel!',
    'Today we are going to try something fun.',
    'Keep an eye on the middle of the screen.',
    'This is a DVDTube test video.',
    'Captions follow the video timeline.',
    'Font size and background can be changed in settings.',
  ],
}

function chaptersFor(duration: number): Chapter[] {
  const parts: [number, string][] = [
    [0, 'Mở đầu'],
    [0.16, 'Giới thiệu nội dung'],
    [0.38, 'Phần chính'],
    [0.66, 'Mẹo hay'],
    [0.85, 'Tổng kết'],
  ]
  return parts.map(([at, title]) => ({ title, startSeconds: Math.round(at * duration) }))
}

function heatmapFor(duration: number): HeatMarker[] {
  const count = 50
  return Array.from({ length: count }, (_, i) => {
    const x = i / count
    const peak = Math.exp(-((x - 0.62) ** 2) / 0.004)
    const base = 0.18 + 0.12 * Math.sin(x * 9) ** 2 + (i === 0 ? 0.4 : 0)
    return { start: (duration * i) / count, duration: duration / count, intensity: Math.min(1, base + 0.8 * peak) }
  })
}

const COMMENT_TEXTS = [
  'Video hay quá, cảm ơn bạn đã chia sẻ! ❤️',
  'Đoạn 0:45 đỉnh thật sự 😂',
  'Ai nghe tới đây vào năm 2025 điểm danh nào',
  'Mình đã thử làm theo và thành công rồi, cảm ơn kênh nhiều.',
  'Chất lượng hình ảnh ngày càng tốt hơn, ủng hộ kênh 👍',
  'Có ai biết bài nhạc nền ở 1:10 tên gì không ạ?',
  'Xem lần thứ 3 rồi vẫn thấy hay. Xem thêm ở https://example.com/bai-viet',
  'Mong kênh ra thêm nhiều video như thế này #DVDTube',
]
const AUTHORS = ['Minh Anh', 'Trần Hoàng', 'Lê Thu Hà', 'Phạm Quốc Bảo', 'Ngọc Trâm', 'Đức Huy', 'Bảo Ngọc', 'Tuấn Kiệt']

function comment(page: number, i: number, reply = false): Comment {
  const n = page * 20 + i
  const author = AUTHORS[n % AUTHORS.length]
  const creator = !reply && page === 0 && i === 0
  return {
    id: `c-${reply ? 'r' : ''}${n}`,
    authorName: creator ? CHANNELS[0].name : '@' + author.replace(/\s/g, '').toLowerCase(),
    authorAvatar: avatar(creator ? CHANNELS[0].name : author),
    authorChannelId: creator ? CHANNELS[0].id : `UCmockUser${n}`,
    text: creator ? 'Cảm ơn mọi người đã xem! Chương mới ở 0:15, phần hay nhất ở 0:55 nhé 🎉' : COMMENT_TEXTS[n % COMMENT_TEXTS.length],
    publishedText: AGES[n % AGES.length],
    likeCountText: n % 3 === 0 ? `${(n % 7) + 1},${n % 10} N` : String((n * 17) % 900),
    replyCountText: !reply && n % 4 === 1 ? `${(n % 5) + 2}` : null,
    repliesToken: !reply && n % 4 === 1 ? `mock-replies-${n}` : null,
    isPinned: creator,
    isCreator: creator,
    isHearted: n % 5 === 2,
    likeState: 'INDIFFERENT',
  }
}

function captionCues(lang: string, duration: number, translateTo?: string | null): CaptionCue[] {
  const lines = CAPTION_LINES[translateTo ?? lang] ?? CAPTION_LINES[lang] ?? CAPTION_LINES.vi
  const cues: CaptionCue[] = []
  for (let t = 1, i = 0; t < duration; t += 3.5, i++) cues.push({ start: t, end: t + 3, text: lines[i % lines.length] })
  return cues
}

const LIVE_AUTHORS = ['Hùng', 'Lan Anh', 'Khoa Nguyễn', 'Mai Phương', 'Sơn Tùng fan', 'Thảo My']
const LIVE_TEXTS = ['Chào mọi người!', 'Hay quá 🔥', 'Âm thanh rõ lắm', 'Xem từ Hà Nội nè', 'Bài tiếp theo là gì vậy?', '❤️❤️❤️', 'Ủng hộ kênh!']

function chatMessage(n: number, offsetMs: number | null): LiveChatMessage {
  const author = LIVE_AUTHORS[n % LIVE_AUTHORS.length]
  return {
    id: `chat-${n}`,
    author,
    authorPhoto: avatar(author),
    message: LIVE_TEXTS[n % LIVE_TEXTS.length],
    amount: n % 17 === 5 ? '₫50.000' : null,
    isModerator: n % 11 === 3,
    isOwner: n % 23 === 7,
    isMember: n % 6 === 1,
    offsetMs,
  }
}

function relatedItems(videoId: string, page: number): FeedItem[] {
  const base = (hash(videoId) % 97) + page * 20
  return Array.from({ length: 20 }, (_, i) => ({ type: 'video' as const, video: mockVideo(base + i, { live: i === 6 }) }))
}

// MARK: The mock API

export const mockPlayerApi: Partial<DvdApi> = {
  async player(videoId): Promise<PlayerInfo> {
    await wait(120)
    const item = known(videoId)
    const data = await media()
    const set = item.isShort ? data?.shorts : data
    const duration = set?.duration ?? item.durationSeconds ?? 90
    const broken = flag('mockBroken')
    const missing = (file: string, adaptive: boolean) => (broken === 'all' || (broken === 'dash' && adaptive) ? 'missing-' : '') + file
    const format = (f: MediaFormat, i: number): StreamFormat => ({
      itag: f.itag,
      url: abs('dev/' + missing(f.file, !!f.initRange)) + `?itag=${f.itag}&i=${i}`,
      mimeType: f.mimeType,
      bitrate: f.bitrate,
      width: f.width ?? null,
      height: f.height ?? null,
      fps: f.fps ?? null,
      contentLength: f.contentLength ?? null,
      qualityLabel: f.qualityLabel ?? null,
      audioTrackName: f.audioTrackName ?? null,
      isDefaultAudio: f.isDefaultAudio ?? false,
      audioLanguage: f.audioLanguage ?? null,
      initRange: f.initRange ?? null,
      indexRange: f.indexRange ?? null,
      approxDurationMs: duration * 1000,
      audioSampleRate: f.audioSampleRate ?? null,
      audioChannels: f.audioChannels ?? null,
      colorInfo: null,
    })
    const sb = data?.storyboard
    return {
      videoId,
      title: item.title,
      author: item.channelName ?? null,
      channelId: item.channelId ?? null,
      lengthSeconds: item.isLive ? null : duration,
      viewCount: 1234567,
      shortDescription: 'Video thử nghiệm của DVDTube.',
      isLive: !!item.isLive,
      isLiveDvr: !!item.isLive,
      thumbnail: item.thumbnail ?? null,
      hlsUrl: data ? abs('dev/hls/' + missing('index.m3u8', false)) : null,
      dashUrl: null,
      adaptiveFormats: item.isLive ? [] : (set?.formats ?? []).map(format),
      muxedFormats: (set?.muxed ?? []).map(format),
      captions: item.isShort ? [] : CAPTIONS,
      availableAt: flag('mockAdWait') === '1' ? Date.now() + 3000 : 0,
      storyboard:
        sb && !item.isShort
          ? {
              baseUrl: abs('dev/' + sb.path) + '?level=$L',
              level: 0,
              width: sb.width,
              height: sb.height,
              count: sb.count,
              columns: sb.columns,
              rows: sb.rows,
              intervalMs: sb.intervalMs,
              name: 'M$M',
              signature: 'mock',
            }
          : null,
      loudnessDb: 2.5,
      client: 'MOCK',
    }
  },

  async watchInfo(videoId, playlistId): Promise<WatchInfo> {
    await wait(180)
    const item = known(videoId)
    const data = await media()
    const duration = (item.isShort ? data?.shorts.duration : data?.duration) ?? item.durationSeconds ?? 90
    const channel = channelFor(item)
    const playlistVideos = playlistId ? Array.from({ length: 12 }, (_, i) => mockVideo(40 + i)) : []
    if (playlistId && !playlistVideos.some((v) => v.id === videoId)) playlistVideos.splice(2, 0, item)
    return {
      videoId,
      title: item.title,
      viewCountText: item.isLive ? '1.234 người đang xem' : '1.234.567 lượt xem',
      shortViewCountText: item.isLive ? '1,2 N người đang xem' : '1,2 Tr lượt xem',
      dateText: '12 thg 3, 2025',
      relativeDateText: item.isLive ? 'Đang phát trực tiếp' : '7 tháng trước',
      likeCountText: '45 N',
      description:
        `${item.title}\n\nVideo thử nghiệm để kiểm tra trình phát DVDTube trên Windows.\n\n` +
        `Mục lục:\n0:00 Mở đầu\n0:15 Giới thiệu nội dung\n0:34 Phần chính\n0:59 Mẹo hay\n1:16 Tổng kết\n\n` +
        `Theo dõi kênh: https://www.youtube.com/@dvdtube\n#DVDTube #nhạctrẻ #lofi`,
      channel,
      related: { items: relatedItems(videoId, 0), continuation: null, kind: 'next' },
      commentsToken: 'mock-comments',
      commentCountText: '1.234',
      chapters: item.isShort || item.isLive ? [] : chaptersFor(duration),
      likeStatus: null,
      isSubscribed: null,
      liveChat: item.isLive ? { modes: [{ title: 'Tin nhắn hàng đầu', continuation: 'mock-chat-top' }, { title: 'Trò chuyện trực tiếp', continuation: 'mock-chat-all' }], isReplay: false } : null,
      heatmap: item.isShort || item.isLive ? [] : heatmapFor(duration),
      playlist: playlistId
        ? { id: playlistId, title: 'Danh sách phát thử nghiệm', videos: playlistVideos, currentIndex: playlistVideos.findIndex((v) => v.id === videoId) }
        : null,
    }
  },

  async comments(token) {
    await wait(200)
    const replies = token.startsWith('mock-replies-')
    const page = Number(/-p(\d+)$/.exec(token)?.[1] ?? 0)
    const count = replies ? 4 : 20
    const result: CommentsPage = {
      comments: Array.from({ length: count }, (_, i) => comment(page, i, replies)),
      continuation: !replies && page < 2 ? `mock-comments-p${page + 1}` : null,
      countText: '1.234',
    }
    return {
      page: result,
      sortOptions: replies
        ? []
        : [
            { title: 'Bình luận hàng đầu', token: 'mock-comments' },
            { title: 'Mới nhất xếp trước', token: 'mock-comments-new' },
          ],
    }
  },

  async captions(track, translateTo) {
    await wait(80)
    const data = await media()
    return captionCues(track.languageCode, data?.duration ?? 90, translateTo)
  },

  async sponsorSegments(_videoId, categories) {
    const segments = [
      { start: 12, end: 19, category: 'sponsor' },
      { start: 48, end: 53, category: 'selfpromo' },
    ]
    return segments.filter((s) => categories.includes(s.category))
  },

  async dislikes() {
    return 1320
  },

  async liveChat(continuation, replay, offsetMs) {
    await wait(150)
    const n = Number(/-(\d+)$/.exec(continuation)?.[1] ?? 0)
    const base = replay ? Math.floor((offsetMs ?? 0) / 1000) : n
    return {
      messages: Array.from({ length: replay ? 10 : 3 }, (_, i) => chatMessage(base + i, replay ? (base + i) * 1000 : null)),
      continuation: `${continuation.replace(/-\d+$/, '')}-${base + (replay ? 10 : 3)}`,
      timeoutMs: replay ? 5000 : 2000,
      sendParams: null,
    }
  },

  async downloadFileUrl(videoId) {
    const ids = (flag('mockDownloaded') ?? '').split(',').map((s) => s.trim())
    return ids.includes(videoId) ? abs('dev/muxed_360.mp4') : null
  },
}
