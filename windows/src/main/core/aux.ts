// Services outside InnerTube (port of `AuxServices.kt`): channel RSS feeds, SponsorBlock, caption
// tracks and Return YouTube Dislike, plus number / date formatting for values computed here.

import { createHash } from 'node:crypto'
import type { CaptionCue, CaptionTrack, SponsorSegment, VideoItem } from '@shared/models'
import { coreState } from './config'
import { Errors } from './errors'
import { requestText } from './http'
import { JNode } from './json'

// MARK: Formatting

export const NumberText = {
  compact(value: number): string {
    const vi = coreState.hl === 'vi'
    const format = (v: number, suffix: string) =>
      new Intl.NumberFormat(coreState.hl || 'vi', { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v) + suffix
    if (value >= 1_000_000_000) return format(value / 1_000_000_000, vi ? ' T' : 'B')
    if (value >= 1_000_000) return format(value / 1_000_000, vi ? ' Tr' : 'M')
    if (value >= 1_000) return format(value / 1_000, vi ? ' N' : 'K')
    return String(value)
  },

  views(value: number): string {
    return NumberText.compact(value) + (coreState.hl === 'vi' ? ' lượt xem' : ' views')
  },

  /** "2 ngày trước" / "3 weeks ago". */
  relative(epochMs: number, now = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - epochMs) / 1000))
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31_536_000],
      ['month', 2_592_000],
      ['week', 604_800],
      ['day', 86_400],
      ['hour', 3600],
      ['minute', 60],
    ]
    let formatter: Intl.RelativeTimeFormat
    try {
      formatter = new Intl.RelativeTimeFormat(coreState.hl || 'vi', { numeric: 'always' })
    } catch {
      formatter = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
    }
    for (const [unit, size] of units) {
      if (seconds >= size) return formatter.format(-Math.floor(seconds / size), unit)
    }
    return formatter.format(0, 'minute')
  },
}

/** Turns "2 ngày trước" / "3 weeks ago" into an approximate date (epoch ms) for sorting. */
export function relativeDate(text: string | null | undefined, now = Date.now()): number | null {
  const lower = text?.toLowerCase()
  if (!lower) return null
  const match = /\d+/.exec(lower)
  const amount = match ? parseInt(match[0], 10) : 1
  const units: [string[], number][] = [
    [['giây', 'second'], 1],
    [['phút', 'minute'], 60],
    [['giờ', 'hour'], 3600],
    [['ngày', 'day'], 86_400],
    [['tuần', 'week'], 604_800],
    [['tháng', 'month'], 2_592_000],
    [['năm', 'year'], 31_536_000],
  ]
  for (const [keys, seconds] of units) {
    if (keys.some((key) => lower.includes(key))) return now - amount * seconds * 1000
  }
  return null
}

// MARK: RSS

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
    return XML_ENTITIES[entity] ?? whole
  })
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  if (!match) return null
  let value = match[1]
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value)
  if (cdata) value = cdata[1]
  else value = decodeXml(value)
  return value.trim()
}

function attribute(xml: string, element: string, name: string): string | null {
  const match = new RegExp(`<${element}\\s[^>]*?\\b${name}="([^"]*)"`).exec(xml)
  return match ? decodeXml(match[1]) : null
}

/** Channel uploads via the public RSS feed: cheap, stable and has exact publish dates. */
export function parseRss(xml: string, channelId: string, now = Date.now()): VideoItem[] {
  const firstEntry = xml.indexOf('<entry')
  const feedHead = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml
  const channelName = tag(feedHead, 'title')
  const videos: VideoItem[] = []
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? []
  for (const entry of entries) {
    const id = tag(entry, 'yt:videoId')
    if (!id) continue
    const published = tag(entry, 'published')
    const date = published ? Date.parse(published) : NaN
    const views = attribute(entry, 'media:statistics', 'views')
    const viewCount = views !== null && /^\d+$/.test(views) ? parseInt(views, 10) : null
    const author = /<author>([\s\S]*?)<\/author>/.exec(entry)
    const link = attribute(entry, 'link', 'href')
    videos.push({
      id,
      title: tag(entry, 'title') ?? '',
      channelName: (author ? tag(author[1], 'name') : null) ?? channelName,
      channelId,
      thumbnail: attribute(entry, 'media:thumbnail', 'url'),
      viewCountText: viewCount !== null ? NumberText.views(viewCount) : null,
      publishedText: Number.isFinite(date) ? NumberText.relative(date, now) : null,
      publishedDate: Number.isFinite(date) ? date : null,
      isShort: link?.includes('/shorts/') === true,
    })
  }
  return videos
}

export async function rssVideos(channelId: string): Promise<VideoItem[]> {
  const response = await requestText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
    transport: 'anon',
  })
  if (response.status !== 200) throw Errors.invalidResponse()
  return parseRss(response.text, channelId)
}

// MARK: SponsorBlock

/** Crowd-sourced in-video sponsor segments (https://sponsor.ajay.app), hash-prefix API so the exact id is never sent. */
export async function sponsorSegments(videoId: string, categories: string[]): Promise<SponsorSegment[]> {
  if (categories.length === 0) return []
  try {
    const digest = createHash('sha256').update(videoId).digest('hex')
    const url = new URL(`https://sponsor.ajay.app/api/skipSegments/${digest.slice(0, 4)}`)
    url.searchParams.set('categories', '[' + categories.map((c) => `"${c}"`).join(',') + ']')
    const response = await requestText(url.toString(), { transport: 'plain', timeoutMs: 10_000 })
    if (response.status !== 200) return []
    return parseSponsorSegments(JNode.parse(response.text), videoId)
  } catch {
    return []
  }
}

export function parseSponsorSegments(json: JNode, videoId: string): SponsorSegment[] {
  const entry = json.array.find((e) => e.get('videoID').string === videoId)
  if (!entry) return []
  const segments: SponsorSegment[] = []
  for (const segment of entry.get('segments').array) {
    if ((segment.get('actionType').string ?? 'skip') !== 'skip') continue
    const start = segment.get('segment').get(0).double
    const end = segment.get('segment').get(1).double
    if (start === null || end === null || end <= start) continue
    segments.push({ start, end, category: segment.get('category').string ?? 'sponsor' })
  }
  return segments.sort((a, b) => a.start - b.start)
}

// MARK: Captions

/** Downloads a caption track in YouTube's `json3` format, optionally machine translated. */
export async function loadCaptions(track: CaptionTrack, translateTo?: string | null): Promise<CaptionCue[]> {
  const url = new URL(track.baseUrl)
  url.searchParams.delete('fmt')
  url.searchParams.delete('tlang')
  url.searchParams.set('fmt', 'json3')
  if (translateTo && translateTo !== track.languageCode) url.searchParams.set('tlang', translateTo)
  const response = await requestText(url.toString(), { transport: 'anon' })
  if (response.status < 200 || response.status > 299) throw Errors.http(response.status)
  if (!response.text.trim()) return []
  try {
    return parseCaptions(JNode.parse(response.text))
  } catch {
    throw Errors.invalidResponse()
  }
}

export function parseCaptions(json: JNode): CaptionCue[] {
  const cues: CaptionCue[] = []
  for (const event of json.get('events').array) {
    const start = event.get('tStartMs').double
    if (start === null) continue
    const text = event
      .get('segs')
      .array.map((s) => s.get('utf8').string)
      .filter((s): s is string => s !== null)
      .join('')
      .trim()
    if (!text) continue
    const duration = event.get('dDurationMs').double ?? 2000
    cues.push({ start: start / 1000, end: (start + duration) / 1000, text })
  }
  return cues
}

// MARK: Return YouTube Dislike

const dislikeCache = new Map<string, number>()

/** Dislike counts estimated by Return YouTube Dislike (only the video id is sent). */
export async function dislikes(videoId: string): Promise<number | null> {
  const cached = dislikeCache.get(videoId)
  if (cached !== undefined) return cached
  try {
    const response = await requestText(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`, {
      transport: 'plain',
      timeoutMs: 10_000,
    })
    if (response.status < 200 || response.status > 299) return null
    const count = JNode.parse(response.text).get('dislikes').long
    if (count === null) return null
    if (dislikeCache.size > 200) dislikeCache.clear()
    dislikeCache.set(videoId, count)
    return count
  } catch {
    return null
  }
}
