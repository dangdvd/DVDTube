// Deterministic sample data for the mock API (no network in development): Vietnamese channels
// and videos with generated SVG thumbnails, avatars and banners, so every page looks real in
// screenshots. The same seed always gives the same item. Exported for the player module's mocks.

import type { ChannelItem, CommunityPost, FeedItem, HomeCategory, PlaylistItem, VideoItem } from '@shared/models'

// MARK: Random helpers

export function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 PRNG seeded from a string. */
export function random(seed: string): () => number {
  let a = hashString(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]
const between = (r: () => number, min: number, max: number) => Math.floor(min + r() * (max - min + 1))

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function idFromSeed(seed: string, length = 11): string {
  const r = random('id:' + seed)
  let id = ''
  for (let i = 0; i < length; i++) id += ID_CHARS[Math.floor(r() * 64)]
  return id
}

// MARK: Formatting (same wording as YouTube in Vietnamese)

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)} N`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} Tr`
  return `${(n / 1_000_000_000).toFixed(1).replace('.0', '').replace('.', ',')} T`
}

export const viewsText = (n: number) => `${compact(n)} lượt xem`
export const subscribersText = (n: number) => `${compact(n)} người đăng ký`

export function agoText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ngày trước`
  if (days < 30) return `${Math.round(days / 7)} tuần trước`
  if (days < 365) return `${Math.round(days / 30)} tháng trước`
  return `${Math.round(days / 365)} năm trước`
}

function durationText(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// MARK: SVG artwork

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
const FONT = "'Segoe UI', Inter, Roboto, Arial, sans-serif"

/** Removes emoji and symbols that render poorly inside the thumbnail art. */
function plain(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[|#()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!line) line = word
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word
    else {
      lines.push(line)
      line = word
      if (lines.length === maxLines) break
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

const GLYPHS: Record<string, string> = {
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  gaming:
    'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.54-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z',
  news: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2M18 14h-8M15 18h-5M10 6h8v4h-8z',
  sports: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7l4 3-1.5 5h-5L8 10z',
  learning: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4',
  podcasts: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  movies:
    'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3zM6.2 5.3l3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  live: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19',
  general: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 9v6l5-3z',
}

function motif(r: () => number, w: number, h: number): string {
  switch (Math.floor(r() * 4)) {
    case 0:
      return `<circle cx="${w * 0.82}" cy="${h * 0.78}" r="${h * 0.48}" fill="#fff" fill-opacity="0.08"/><circle cx="${w * 0.9}" cy="${h * 0.2}" r="${h * 0.16}" fill="#fff" fill-opacity="0.1"/>`
    case 1: {
      let lines = ''
      for (let i = -6; i < 14; i++) lines += `<path d="M${i * 40} ${h} L${i * 40 + h} 0" stroke="#fff" stroke-opacity="0.06" stroke-width="14"/>`
      return lines
    }
    case 2: {
      let dots = ''
      for (let x = w * 0.55; x < w; x += 22)
        for (let y = 16; y < h; y += 22) dots += `<circle cx="${x.toFixed(0)}" cy="${y}" r="2.4" fill="#fff" fill-opacity="0.13"/>`
      return dots
    }
    default:
      return `<path d="M0 ${h * 0.72} C ${w * 0.3} ${h * 0.5}, ${w * 0.6} ${h * 0.95}, ${w} ${h * 0.6} L${w} ${h} L0 ${h} Z" fill="#000" fill-opacity="0.2"/><path d="M0 ${h * 0.82} C ${w * 0.35} ${h * 0.65}, ${w * 0.65} ${h}, ${w} ${h * 0.75}" stroke="#fff" stroke-opacity="0.15" stroke-width="3" fill="none"/>`
  }
}

/** 16:9 (or 9:16 when `vertical`) thumbnail art with the title in big letters. */
export function thumbnailArt(title: string, label: string, hue: number, options?: { vertical?: boolean; category?: string; seed?: string }): string {
  const vertical = !!options?.vertical
  const w = vertical ? 270 : 480
  const h = vertical ? 480 : 270
  const r = random('art:' + (options?.seed ?? title))
  const h1 = (hue + between(r, -12, 12) + 360) % 360
  const h2 = (h1 + between(r, 25, 70)) % 360
  const words = plain(title).toUpperCase()
  const lines = vertical ? wrap(words, 11, 4) : wrap(words, 16, 3)
  const size = vertical ? (lines.length > 3 ? 30 : 34) : lines.length >= 3 ? 34 : lines.length === 2 ? 40 : 46
  const lineHeight = size * 1.12
  const blockHeight = lines.length * lineHeight
  const top = vertical ? h * 0.42 - blockHeight / 2 + size : h * 0.56 - blockHeight / 2 + size * 0.85
  const textX = vertical ? w / 2 : 28
  const anchor = vertical ? 'middle' : 'start'
  const glyph = GLYPHS[options?.category ?? 'general'] ?? GLYPHS.general
  const accent = `hsl(${(h1 + 180) % 360},95%,62%)`
  const text = lines
    .map(
      (line, i) =>
        `<text x="${textX}" y="${(top + i * lineHeight).toFixed(1)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="${i === lines.length - 1 && lines.length > 1 ? accent : '#fff'}" stroke="#000" stroke-opacity="0.35" stroke-width="5" paint-order="stroke" letter-spacing="-0.5">${esc(line)}</text>`,
    )
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},72%,50%)"/><stop offset="1" stop-color="hsl(${h2},78%,20%)"/></linearGradient>` +
    `<radialGradient id="l" cx="0.85" cy="0.1" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#l)"/>` +
    motif(r, w, h) +
    `<g transform="translate(${vertical ? w / 2 - 48 : w - 128} ${vertical ? h - 128 : h - 120}) scale(4)" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${glyph}"/></g>` +
    `<text x="${vertical ? w / 2 : 28}" y="${vertical ? 46 : 40}" text-anchor="${anchor}" font-family="${FONT}" font-size="${vertical ? 13 : 14}" font-weight="700" fill="#fff" fill-opacity="0.9" letter-spacing="2.5">${esc(plain(label).toUpperCase())}</text>` +
    `<rect x="${vertical ? w / 2 - 20 : 28}" y="${vertical ? 56 : 50}" width="40" height="4" rx="2" fill="${accent}"/>` +
    text +
    `</svg>`
  return svgUrl(svg)
}

export function avatarArt(name: string, hue: number): string {
  const initials = plain(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176" viewBox="0 0 176 176">` +
    `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},80%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},75%,32%)"/></linearGradient></defs>` +
    `<circle cx="88" cy="88" r="88" fill="url(#a)"/><circle cx="130" cy="40" r="36" fill="#fff" fill-opacity="0.12"/>` +
    `<text x="88" y="106" text-anchor="middle" font-family="${FONT}" font-size="58" font-weight="700" fill="#fff">${esc(initials)}</text></svg>`
  return svgUrl(svg)
}

export function bannerArt(name: string, tagline: string, hue: number): string {
  const r = random('banner:' + name)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="2120" height="351" viewBox="0 0 2120 351">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="hsl(${hue},70%,28%)"/><stop offset="0.55" stop-color="hsl(${(hue + 35) % 360},75%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},70%,25%)"/></linearGradient></defs>` +
    `<rect width="2120" height="351" fill="url(#b)"/>` +
    motif(r, 2120, 351) +
    `<text x="1060" y="180" text-anchor="middle" font-family="${FONT}" font-size="92" font-weight="800" fill="#fff" letter-spacing="2">${esc(plain(name).toUpperCase())}</text>` +
    `<text x="1060" y="250" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="500" fill="#fff" fill-opacity="0.85">${esc(tagline)}</text></svg>`
  return svgUrl(svg)
}

export function postImageArt(text: string, hue: number, seed: string): string {
  const r = random('post:' + seed)
  const lines = wrap(plain(text).toUpperCase(), 14, 4)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},75%,25%)"/></linearGradient></defs>` +
    `<rect width="600" height="600" fill="url(#p)"/>` +
    motif(r, 600, 600) +
    lines
      .map(
        (l, i) =>
          `<text x="300" y="${300 - (lines.length - 1) * 30 + i * 62}" text-anchor="middle" font-family="${FONT}" font-size="54" font-weight="800" fill="#fff">${esc(l)}</text>`,
      )
      .join('') +
    `</svg>`
  return svgUrl(svg)
}

// MARK: Channels

export interface MockChannel {
  id: string
  name: string
  handle: string
  category: Exclude<HomeCategory, 'all' | 'live'> | 'general'
  hue: number
  subscribers: number
  videoCount: number
  tagline: string
}

const CHANNEL_DEFS: [string, string, MockChannel['category'], number, number, string][] = [
  ['Nhạc Trẻ Hay Nhất', 'nhactrehaynhat', 'music', 345, 4_820_000, 'Nhạc trẻ mới nhất mỗi ngày'],
  ['Lofi Chill Việt', 'lofichillviet', 'music', 265, 1_240_000, 'Nhạc chill cho những ngày bình yên'],
  ['Bolero Trữ Tình', 'boleroquehuong', 'music', 25, 2_310_000, 'Những giai điệu quê hương'],
  ['Acoustic Nhà Làm', 'acousticnhalam', 'music', 35, 587_000, 'Cover mộc, hát thật'],
  ['Vinahouse Bay Phòng', 'vinahousebayphong', 'music', 300, 912_000, 'Nonstop cực căng'],
  ['Game Thủ Việt', 'gamethuviet', 'gaming', 210, 3_150_000, 'Leo rank cùng anh em'],
  ['Hà Nội Gaming', 'hanoigaming', 'gaming', 190, 742_000, 'Game hay mỗi tối'],
  ['Mèo Chơi Game', 'meochoigame', 'gaming', 160, 1_080_000, 'Sinh tồn, kinh dị, giải đố'],
  ['Tin Tức 24h', 'tintuc24h', 'news', 210, 5_600_000, 'Cập nhật tin nóng 24/7'],
  ['Thời Sự Sáng', 'thoisusang', 'news', 0, 2_040_000, 'Bản tin mỗi sáng lúc 6h'],
  ['Kinh Tế Tuần Qua', 'kinhtetuanqua', 'news', 140, 398_000, 'Hiểu kinh tế trong 10 phút'],
  ['Bóng Đá Việt', 'bongdaviet', 'sports', 120, 2_870_000, 'Highlight, nhận định, hậu trường'],
  ['Thể Thao 360', 'thethao360', 'sports', 95, 664_000, 'Thể thao từ mọi góc nhìn'],
  ['Học Tiếng Anh Mỗi Ngày', 'hoctienganhmoingay', 'learning', 200, 3_420_000, 'Mỗi ngày 15 phút'],
  ['Khoa Học Vui', 'khoahocvui', 'learning', 170, 1_530_000, 'Khoa học dễ hiểu cho mọi người'],
  ['Lập Trình Không Khó', 'laptrinhkhongkho', 'learning', 230, 486_000, 'Code từ con số 0'],
  ['Chuyện Đêm Khuya', 'chuyendemkhuya', 'podcasts', 255, 1_920_000, 'Podcast cho những đêm mất ngủ'],
  ['Podcast Người Trẻ', 'podcastnguoitre', 'podcasts', 15, 357_000, 'Trò chuyện về sự nghiệp và cuộc sống'],
  ['Phim Hay Cuối Tuần', 'phimhaycuoituan', 'movies', 280, 2_650_000, 'Phim ngắn, review, trailer'],
  ['Điện Ảnh Việt', 'dienanhviet', 'movies', 5, 1_140_000, 'Tin tức điện ảnh Việt Nam'],
  ['Ẩm Thực Ba Miền', 'amthucbamien', 'general', 30, 2_210_000, 'Ăn khắp Việt Nam'],
  ['Du Lịch Cùng Hà', 'dulichcungha', 'general', 185, 846_000, 'Đi để trở về'],
  ['Tech Review VN', 'techreviewvn', 'general', 220, 1_670_000, 'Đánh giá công nghệ thật lòng'],
  ['Vlog Sài Gòn', 'vlogsaigon', 'general', 330, 512_000, 'Chuyện thường ngày ở Sài Gòn'],
  ['Bếp Nhà Mình', 'bepnhaminh', 'general', 40, 1_330_000, 'Món ngon dễ nấu'],
]

export const MOCK_CHANNELS: MockChannel[] = CHANNEL_DEFS.map(([name, handle, category, hue, subscribers, tagline]) => ({
  id: 'UC' + idFromSeed('channel:' + handle, 22),
  name,
  handle: '@' + handle,
  category,
  hue,
  subscribers,
  videoCount: 120 + (hashString(handle) % 1400),
  tagline,
}))

export function mockChannel(id: string): MockChannel {
  const known = MOCK_CHANNELS.find((c) => c.id === id || c.handle === id || c.handle === '@' + id)
  if (known) return known
  return MOCK_CHANNELS[hashString(id) % MOCK_CHANNELS.length]
}

export function channelItem(c: MockChannel): ChannelItem {
  return {
    id: c.id,
    name: c.name,
    handle: c.handle,
    avatar: avatarArt(c.name, c.hue),
    subscriberText: subscribersText(c.subscribers),
    videoCountText: `${c.videoCount.toLocaleString('vi-VN')} video`,
  }
}

// MARK: Titles

const TITLES: Record<MockChannel['category'], string[]> = {
  music: [
    'Nhạc Trẻ Remix 2026 Hay Nhất Hiện Nay - EDM TikTok Gây Nghiện',
    'Lofi Chill Nhẹ Nhàng Cho Ngày Mưa ☔ Nhạc Lofi Việt',
    'Top 30 Bản Ballad Buồn Tâm Trạng Hay Nhất',
    'Liên Khúc Bolero Trữ Tình Hay Nhất Mọi Thời Đại',
    'Mashup Acoustic Cover - Những Bản Hit Triệu View',
    'Nhạc Không Lời Piano Thư Giãn Sâu, Ngủ Ngon',
    'Vinahouse Cực Căng 2026 - Nonstop Bay Phòng',
    'MV Chính Thức | Hẹn Em Ở Cuối Con Đường',
    'Live Session: Mùa Thu Hà Nội (Acoustic Version)',
    'Playlist Nhạc Chill Cuối Tuần Cho Người Cô Đơn',
    'Nhạc Xuân 2027 Remix - Tết Này Con Sẽ Về',
    'Rap Việt Mùa Mới - Những Màn Trình Diễn Bùng Nổ',
    'Ca Khúc Hot Nhất Tháng 10 - Nghe Là Nghiện',
    'Nhạc Hoa Lời Việt Bất Hủ - Tuyển Tập Đặc Biệt',
  ],
  gaming: [
    'Hành Trình Leo Rank Thách Đấu Mùa Mới | Liên Quân',
    'Minecraft Sinh Tồn 100 Ngày Trên Đảo Hoang',
    'Review Game Mới Ra Mắt: Có Đáng Tiền Không?',
    'Top 10 Pha Xử Lý Đỉnh Cao Tuần Này',
    'Chơi Thử Game Kinh Dị Lúc 3 Giờ Sáng 😱',
    'Hướng Dẫn Build Đồ Mạnh Nhất Phiên Bản Mới',
    'Chung Kết Thế Giới - Highlight Trận Quyết Định',
    'Xây Thành Phố Trong Mơ - Tập 12',
    'Thử Thách Phá Đảo Không Chết Lần Nào',
    'Cập Nhật Lớn Nhất Năm: Bản Đồ Mới, Tướng Mới',
  ],
  news: [
    'Bản Tin Sáng: Hà Nội Chuyển Lạnh, Nhiệt Độ Giảm Sâu',
    'Toàn Cảnh Kinh Tế Tuần Qua: Giá Vàng Lập Đỉnh Mới',
    'Tin Nóng: Khánh Thành Tuyến Metro Số 2 TP.HCM',
    'Thời Sự 19h - Tin Tức Trong Nước Và Quốc Tế',
    'Phóng Sự: Làng Nghề Truyền Thống Giữa Lòng Phố Thị',
    'Điểm Tin Công Nghệ: Điện Thoại Gập Giá Rẻ Đổ Bộ',
    'Dự Báo Thời Tiết: Bão Số 7 Đổ Bộ Miền Trung',
    'Giá Xăng Hôm Nay Tiếp Tục Giảm',
  ],
  sports: [
    'Highlight Việt Nam vs Thái Lan | Chung Kết Kịch Tính',
    'Top 10 Bàn Thắng Đẹp Nhất V-League Vòng 8',
    'Nhận Định Trước Trận: Siêu Kinh Điển Cuối Tuần',
    'Hậu Trường Đội Tuyển: Ngày Tập Luyện Đầu Tiên',
    'Cầu Lông: Pha Cứu Bóng Không Tưởng Ở Bán Kết',
    'Toàn Cảnh SEA Games: Bảng Tổng Sắp Huy Chương',
    'Pha Sút Phạt Đẹp Nhất Mùa Giải',
    'Marathon Hà Nội 2026: Hơn 15.000 Người Tham Gia',
  ],
  learning: [
    'Học Tiếng Anh Giao Tiếp Mỗi Ngày - Bài 45: Đi Du Lịch',
    'Lập Trình Python Cho Người Mới Bắt Đầu (Full Khóa)',
    'Vì Sao Bầu Trời Có Màu Xanh? | Khoa Học Vui',
    'Bí Quyết Ôn Thi Đại Học Đạt 27+ Điểm',
    'Lịch Sử Việt Nam: Triều Đại Nhà Lý Trong 15 Phút',
    'Excel Từ Cơ Bản Đến Nâng Cao Trong 1 Giờ',
    'Toán Lớp 12: Tích Phân Dễ Hiểu Nhất',
    '1000 Từ Vựng Tiếng Anh Thông Dụng Nhất',
    'Hố Đen Vũ Trụ Hoạt Động Như Thế Nào?',
  ],
  podcasts: [
    'Chuyện Đêm Khuya #128: Khi Người Lớn Cô Đơn',
    'Tài Chính Cá Nhân: Tiết Kiệm Thế Nào Khi Lương 10 Triệu?',
    'Trò Chuyện Với Người Trẻ Khởi Nghiệp Ở Tuổi 25',
    'Đọc Sách Cùng Nhau: Nhà Giả Kim',
    'Sống Chậm Giữa Thành Phố Vội Vã | Tập 34',
    'Tuổi 30 Có Gì Đáng Sợ? | Podcast',
    'Làm Sao Để Bớt Lo Âu Mỗi Ngày',
  ],
  movies: [
    'Phim Ngắn: Người Cha Thầm Lặng | Lấy Đi Nước Mắt Người Xem',
    'Trailer Chính Thức - Bom Tấn Điện Ảnh Việt Tết 2027',
    'Review Phim Hay: Cái Kết Không Ai Ngờ Tới',
    'Phim Hài Tết: Gia Đình Là Số 1 - Tập Đặc Biệt',
    'Hậu Trường Quay Phim: Cảnh Hành Động Mạo Hiểm',
    'Tóm Tắt Phim: Hành Trình Về Phương Nam',
    'Phim Hoạt Hình Việt: Cậu Bé Rồng',
  ],
  general: [
    'Một Ngày Ăn Sập Phố Cổ Hà Nội Chỉ Với 200K',
    'Review Chi Tiết Điện Thoại Mới: Có Nên Nâng Cấp?',
    'Du Lịch Đà Lạt Tự Túc 3 Ngày 2 Đêm Siêu Tiết Kiệm',
    'Nấu Phở Bò Chuẩn Vị Hà Nội Tại Nhà',
    'Vlog: Cuộc Sống Sinh Viên Năm Nhất Ở Sài Gòn',
    'Khám Phá Hang Sơn Đoòng - Kỳ Quan Thiên Nhiên',
    'Dựng PC Gaming 30 Triệu Mạnh Nhất 2026',
    'Thử Thách 24 Giờ Chỉ Ăn Đồ Ăn Đường Phố',
    'Bánh Mì Sài Gòn - Đi Tìm Ổ Bánh Ngon Nhất',
    'Đi Thử Xe Điện Mới 500km: Có Hết Pin Giữa Đường?',
    'Chợ Nổi Cái Răng Lúc 5 Giờ Sáng',
    'Mâm Cơm Nhà Mình: 5 Món Dưới 100 Nghìn',
  ],
}

const LIVE_TITLES = [
  '🔴 Trực Tiếp: Lofi Radio 24/7 - Nhạc Chill Học Bài',
  '🔴 Trực Tiếp Bóng Đá: Hà Nội FC vs Công An Hà Nội',
  '🔴 LIVE: Leo Rank Đêm Khuya Cùng Anh Em',
  '🔴 Trực Tiếp: Lễ Hội Ánh Sáng Hội An',
  '🔴 Thời Sự Trực Tiếp 24/7',
  '🔴 Trực Tiếp: Đêm Nhạc Acoustic Cuối Tuần',
]

const SHORT_TITLES = [
  'Mẹo nấu cơm ngon như nhà hàng 🍚',
  'Khi bạn đi học muộn 😂',
  'Cover 30 giây cực cuốn 🎤',
  'Pha sút xa không tưởng ⚽',
  'Thử món lạ ở chợ đêm Đà Lạt',
  'Biến hình trong 1 phút ✨',
  'Mèo nhà tôi khi thấy dưa leo 🐱',
  'Mẹo Excel bạn chưa biết',
  'Bình minh trên đồi chè Mộc Châu',
  'Nhảy theo trend mới nhất 💃',
  'Làm bánh flan chỉ 3 nguyên liệu',
  'Phản ứng khi mở được skin hiếm 🎮',
  'Hà Nội mùa hoa sữa',
  'Một ngày làm barista',
]

const QUERY_TEMPLATES = [
  '{Q} - Tuyển Tập Hay Nhất 2026',
  '{Q} | Bản Đầy Đủ Không Quảng Cáo',
  'Top 20 {Q} Được Nghe Nhiều Nhất',
  '{Q} Cực Hay 🔥 Nghe Là Nghiện',
  'Tổng Hợp {Q} Mới Nhất Tháng 10',
  '{Q} (Official Video)',
  'Nonstop {Q} - Không Hay Không Lấy Tiền',
  '{Q} Live Version | Đêm Nhạc Đặc Biệt',
  'Review {Q}: Những Điều Bạn Cần Biết',
  '{Q} - Hướng Dẫn Chi Tiết Cho Người Mới',
  'Thử Thách {Q} Trong 24 Giờ',
  '{Q} Phiên Bản Lofi Chill',
  '{Q} 1 Giờ Liên Tục - Nghe Khi Làm Việc',
  'Những Khoảnh Khắc {Q} Đáng Nhớ Nhất',
]

export function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toLocaleUpperCase('vi') + w.slice(1) : w))
    .join(' ')
}

// MARK: Videos

export interface VideoOptions {
  channel?: MockChannel
  category?: MockChannel['category']
  query?: string
  short?: boolean
  live?: boolean
  /** Upload age in ms (else random). */
  ageMs?: number
  /** Picks the title by position (so a list has no duplicates) instead of at random. */
  titleIndex?: number
}

const DAY = 86_400_000

/** One deterministic video for this seed. */
export function mockVideo(seed: string, options: VideoOptions = {}): VideoItem {
  const r = random('video:' + seed)
  const category = options.channel?.category ?? options.category ?? pick(r, Object.keys(TITLES) as MockChannel['category'][])
  const pool = MOCK_CHANNELS.filter((c) => c.category === category)
  const channel = options.channel ?? pick(r, pool.length ? pool : MOCK_CHANNELS)
  const short = !!options.short
  const live = !!options.live && !short
  const choose = (list: readonly string[]) => (options.titleIndex != null ? list[options.titleIndex % list.length] : pick(r, list))
  let title: string
  if (options.query) title = choose(QUERY_TEMPLATES).replace('{Q}', titleCase(options.query))
  else if (short) title = choose(SHORT_TITLES)
  else if (live) title = choose(LIVE_TITLES)
  else title = choose(TITLES[channel.category])
  if (short && !title.includes('#shorts') && r() < 0.4) title += ' #shorts'

  const duration = short
    ? between(r, 12, 58)
    : category === 'podcasts'
      ? between(r, 1800, 6400)
      : category === 'music'
        ? between(r, 160, r() < 0.3 ? 3800 : 330)
        : category === 'learning' || category === 'gaming'
          ? between(r, 420, 3200)
          : between(r, 180, 1500)
  const ageMs = options.ageMs ?? Math.floor((r() < 0.35 ? r() * 7 : r() * 400) * DAY + r() * DAY)
  const views = Math.floor(Math.pow(10, 3 + r() * 4.2))
  const id = idFromSeed(seed)
  return {
    id,
    title,
    channelName: channel.name,
    channelId: channel.id,
    channelAvatar: avatarArt(channel.name, channel.hue),
    thumbnail: thumbnailArt(title, channel.name, channel.hue, { vertical: short, category: live ? 'live' : channel.category, seed }),
    durationText: live ? null : durationText(duration),
    durationSeconds: live ? null : duration,
    viewCountText: live ? `${compact(between(r, 300, 25000))} người đang xem` : viewsText(views),
    publishedText: live ? null : agoText(ageMs),
    publishedDate: live ? Date.now() : Date.now() - ageMs,
    isLive: live,
    isShort: short,
  }
}

export function mockVideos(seed: string, count: number, options: VideoOptions = {}): VideoItem[] {
  const base = hashString(seed) % 97
  return Array.from({ length: count }, (_, i) => mockVideo(`${seed}:${i}`, { titleIndex: base + i, ...options }))
}

export function mockShorts(seed: string, count: number): VideoItem[] {
  return mockVideos('shorts:' + seed, count, { short: true })
}

export function mockPlaylist(seed: string, channel?: MockChannel): PlaylistItem {
  const r = random('playlist:' + seed)
  const c = channel ?? pick(r, MOCK_CHANNELS)
  const names: Record<MockChannel['category'], string[]> = {
    music: ['Nhạc Trẻ Hot Nhất', 'Lofi Học Bài', 'Ballad Buồn', 'Bolero Chọn Lọc', 'Nhạc Tết'],
    gaming: ['Hướng Dẫn Cho Người Mới', 'Series Sinh Tồn', 'Highlight Giải Đấu'],
    news: ['Bản Tin Mỗi Ngày', 'Phóng Sự Đặc Biệt'],
    sports: ['Highlight V-League', 'Đội Tuyển Quốc Gia'],
    learning: ['Tiếng Anh Giao Tiếp', 'Python Cơ Bản', 'Khoa Học Thường Thức'],
    podcasts: ['Tuyển Tập Chuyện Đêm Khuya', 'Podcast Hay Nhất'],
    movies: ['Phim Ngắn Cảm Động', 'Trailer Mới'],
    general: ['Ẩm Thực Đường Phố', 'Du Lịch Việt Nam', 'Review Công Nghệ'],
  }
  const title = pick(r, names[c.category])
  return {
    id: 'PL' + idFromSeed('pl:' + seed, 32),
    title,
    thumbnail: thumbnailArt(title, c.name, c.hue, { category: c.category, seed: 'pl:' + seed }),
    channelName: c.name,
    videoCountText: `${between(r, 12, 180)} video`,
  }
}

export function mockMix(seed: string): PlaylistItem {
  const video = mockVideo('mix:' + seed, { category: 'music' })
  return {
    id: 'RD' + video.id,
    title: 'Danh sách kết hợp – ' + video.channelName,
    thumbnail: video.thumbnail,
    channelName: 'Nhạc Trẻ Hay Nhất, Lofi Chill Việt và nhiều nghệ sĩ khác',
    videoCountText: 'Danh sách kết hợp',
  }
}

/** A page of the home feed for a chip (`all` mixes every category). */
export function homeItems(category: HomeCategory, page: number): FeedItem[] {
  const seed = `home:${category}:${page}`
  const r = random(seed)
  const items: FeedItem[] = []
  const count = 24
  for (let i = 0; i < count; i++) {
    const s = `${seed}:${i}`
    const titleIndex = page * count + i
    if (category === 'live')
      items.push({
        type: 'video',
        video: mockVideo(s, { live: true, titleIndex, category: pick(r, ['music', 'gaming', 'sports', 'news'] as const) }),
      })
    else if (category === 'all') items.push({ type: 'video', video: mockVideo(s, { live: r() < 0.06 }) })
    else items.push({ type: 'video', video: mockVideo(s, { category: category as MockChannel['category'], live: r() < 0.05, titleIndex }) })
  }
  if (page === 0 && category !== 'live') items.splice(6, 0, { type: 'shorts', items: mockShorts(seed, 12) })
  if (category === 'all' || category === 'music') items.splice(page === 0 ? 11 : 4, 0, { type: 'playlist', playlist: mockMix(seed) })
  return items
}

/** Search results: a matching channel, videos about the query, a Shorts shelf, a playlist. */
export function searchItems(query: string, page: number, kind: 'all' | 'video' | 'shorts' | 'channel' | 'playlist' | 'live'): FeedItem[] {
  const q = query.trim() || 'video hay'
  const seed = `search:${q.toLowerCase()}:${kind}:${page}`
  const r = random(seed)
  const lower = q.toLowerCase()
  const category: MockChannel['category'] = /nhạc|remix|lofi|bolero|ca khúc|mv|cover|acoustic|rap|karaoke/.test(lower)
    ? 'music'
    : /game|liên quân|minecraft/.test(lower)
      ? 'gaming'
      : /bóng|thể thao|v-league/.test(lower)
        ? 'sports'
        : /học|tiếng anh|python|toán/.test(lower)
          ? 'learning'
          : /tin|thời sự/.test(lower)
            ? 'news'
            : /phim|trailer/.test(lower)
              ? 'movies'
              : /podcast/.test(lower)
                ? 'podcasts'
                : 'general'
  const channels = MOCK_CHANNELS.filter((c) => c.category === category)
  if (kind === 'channel') {
    const list =
      page === 0 ? [...channels, ...MOCK_CHANNELS.filter((c) => c.category !== category)].slice(0, 12) : MOCK_CHANNELS.slice(page * 5, page * 5 + 8)
    return list.map((c) => ({ type: 'channel', channel: channelItem(c) }))
  }
  if (kind === 'playlist')
    return Array.from({ length: 12 }, (_, i) => ({ type: 'playlist', playlist: mockPlaylist(`${seed}:${i}`, pick(r, channels)) }))
  if (kind === 'shorts') return mockShorts(seed, 20).map((video) => ({ type: 'video', video }))
  const items: FeedItem[] = []
  for (let i = 0; i < 20; i++) {
    const useQuery = r() < 0.75
    items.push({
      type: 'video',
      video: mockVideo(`${seed}:${i}`, {
        channel: r() < 0.7 ? pick(r, channels.length ? channels : MOCK_CHANNELS) : undefined,
        category,
        query: useQuery ? q : undefined,
        live: kind === 'live' || (kind === 'all' && r() < 0.05),
        titleIndex: page * 20 + i,
      }),
    })
  }
  if (page === 0 && kind === 'all') {
    const match = MOCK_CHANNELS.find((c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())) ?? channels[0]
    if (match) items.unshift({ type: 'channel', channel: channelItem(match) })
    items.splice(5, 0, { type: 'shorts', items: mockShorts(seed, 10) })
    items.splice(10, 0, { type: 'playlist', playlist: mockPlaylist(seed, pick(r, channels.length ? channels : MOCK_CHANNELS)) })
  }
  return items
}

const POST_TEXTS = [
  'Cảm ơn mọi người đã ủng hộ kênh suốt thời gian qua! Video mới sẽ lên sóng vào tối thứ Bảy này, mọi người nhớ đón xem nhé 💖',
  'Mọi người muốn xem chủ đề gì trong video tiếp theo? Bình chọn bên dưới nhé!',
  'Hậu trường buổi quay hôm qua. Cả đoạn làm từ 6 giờ sáng đến tận khuya nhưng ai cũng vui 😄',
  'Video mới đã lên rồi đây! Lần này mình thử một thứ hoàn toàn khác, xem xong cho mình xin ý kiến nhé.',
  'Chúc mọi người một tuần làm việc thật hiệu quả! Đừng quên nghỉ ngơi và uống đủ nước nha.',
  '1 triệu người đăng ký! Không thể tin được. Cảm ơn tất cả mọi người rất nhiều 🎉🎉🎉',
]

export function mockPosts(channel: MockChannel, page: number): CommunityPost[] {
  return Array.from({ length: 6 }, (_, i) => {
    const seed = `post:${channel.id}:${page}:${i}`
    const r = random(seed)
    const text = POST_TEXTS[(i + page * 2) % POST_TEXTS.length]
    const kind = i % 4
    const post: CommunityPost = {
      id: idFromSeed(seed, 20),
      authorName: channel.name,
      authorAvatar: avatarArt(channel.name, channel.hue),
      text,
      publishedText: agoText((i + 1 + page * 6) * DAY * between(r, 1, 3)),
      likeCountText: compact(between(r, 120, 48000)),
      commentCountText: compact(between(r, 5, 2400)),
      attachment: null,
    }
    if (kind === 1)
      post.attachment = {
        type: 'poll',
        choices: ['Ẩm thực đường phố', 'Du lịch bụi', 'Review công nghệ', 'Một ngày của mình'],
        totalVotes: `${compact(between(r, 800, 30000))} phiếu bầu`,
      }
    else if (kind === 2)
      post.attachment = {
        type: 'images',
        urls: [postImageArt('Hậu trường', channel.hue, seed + 'a'), postImageArt('Cảm ơn mọi người', (channel.hue + 40) % 360, seed + 'b')],
      }
    else if (kind === 3) post.attachment = { type: 'video', video: mockVideo(seed + 'v', { channel }) }
    return post
  })
}
