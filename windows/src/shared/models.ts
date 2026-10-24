// Data types shared by the main process (core, networking) and the renderer (UI).
// They mirror the Android app's `core/Models.kt`. Everything here must stay plain JSON
// (no classes, no Dates, no Maps) because it crosses the IPC bridge.

export interface VideoItem {
  id: string
  title: string
  channelName?: string | null
  channelId?: string | null
  channelAvatar?: string | null
  thumbnail?: string | null
  durationText?: string | null
  durationSeconds?: number | null
  viewCountText?: string | null
  publishedText?: string | null
  /** Epoch milliseconds. */
  publishedDate?: number | null
  isLive?: boolean
  isShort?: boolean
}

export interface ChannelItem {
  id: string
  name: string
  avatar?: string | null
  handle?: string | null
  subscriberText?: string | null
  videoCountText?: string | null
}

export interface PlaylistItem {
  id: string
  title: string
  thumbnail?: string | null
  channelName?: string | null
  videoCountText?: string | null
}

export type FeedItem =
  | { type: 'video'; video: VideoItem }
  | { type: 'channel'; channel: ChannelItem }
  | { type: 'playlist'; playlist: PlaylistItem }
  | { type: 'shorts'; items: VideoItem[] }

/** Which endpoint a continuation token belongs to. */
export type ContinuationKind = 'browse' | 'search' | 'next'

export interface FeedPage {
  items: FeedItem[]
  continuation?: string | null
  kind: ContinuationKind
  /** YouTube's own explanation when a page has no items. */
  message?: string | null
}

export interface Chapter {
  title: string
  startSeconds: number
  thumbnail?: string | null
}

/** One slice of YouTube's "Most replayed" graph: how often that part is rewatched (0…1). */
export interface HeatMarker {
  start: number
  duration: number
  intensity: number
}

/** Where the watch page's chat starts ("Top chat" / "Live chat", or their replays). */
export interface LiveChatInfo {
  modes: { title: string; continuation: string }[]
  isReplay: boolean
}

/** Everything shown below the player on the watch page (from the `next` endpoint). */
export interface WatchInfo {
  videoId: string
  title: string
  viewCountText?: string | null
  shortViewCountText?: string | null
  dateText?: string | null
  relativeDateText?: string | null
  likeCountText?: string | null
  description?: string | null
  channel?: ChannelItem | null
  related: FeedPage
  commentsToken?: string | null
  commentCountText?: string | null
  chapters: Chapter[]
  /** Signed-in state from YouTube: "LIKE", "DISLIKE" or "INDIFFERENT". */
  likeStatus?: string | null
  isSubscribed?: boolean | null
  liveChat?: LiveChatInfo | null
  heatmap: HeatMarker[]
  /** Present when opened with a playlist (or a mix): its videos and where this one is. */
  playlist?: { id: string; title: string; videos: VideoItem[]; currentIndex: number } | null
}

export interface AccountPlaylistOption {
  id: string
  title: string
  containsVideo: boolean
}

export interface AccountNotification {
  id: string
  message: string
  timeText?: string | null
  avatar?: string | null
  thumbnail?: string | null
  videoId?: string | null
  isRead: boolean
}

export interface AccountProfile {
  name: string
  handle?: string | null
  email?: string | null
  avatar?: string | null
  /** The account's own channel (UC…), when it has one. */
  channelId?: string | null
}

/** One entry of the account switcher: a Google account or one of its brand channels. */
export interface AccountIdentity {
  /** `${authUser}|${pageId ?? ''}` */
  id: string
  authUser: number
  pageId?: string | null
  name: string
  byline?: string | null
  email?: string | null
  avatar?: string | null
  isSelected: boolean
  hasChannel: boolean
}

export interface AccountState {
  signedIn: boolean
  profile?: AccountProfile | null
  identities: AccountIdentity[]
}

export interface Comment {
  id: string
  authorName: string
  authorAvatar?: string | null
  authorChannelId?: string | null
  text: string
  publishedText?: string | null
  likeCountText?: string | null
  replyCountText?: string | null
  repliesToken?: string | null
  isPinned: boolean
  isCreator: boolean
  isHearted: boolean
  /** Present when signed in: lets the account reply to this comment. */
  replyParams?: string | null
  /** Present when signed in: `comment/perform_comment_action` tokens. */
  likeToken?: string | null
  unlikeToken?: string | null
  dislikeToken?: string | null
  undislikeToken?: string | null
  /** "LIKED", "DISLIKED" or "INDIFFERENT" for the signed-in account. */
  likeState: string
  /** Like count as YouTube shows it once the account has liked the comment. */
  likeCountLikedText?: string | null
}

export interface CommentsPage {
  comments: Comment[]
  continuation?: string | null
  countText?: string | null
  /** Present when signed in: lets the account post a new comment. */
  createParams?: string | null
}

export interface CommentSortOption {
  title: string
  token: string
}

export type ChannelTab = 'videos' | 'shorts' | 'streams' | 'playlists' | 'posts' | 'about'

export const CHANNEL_TABS: { tab: ChannelTab; title: string; defaultParams: string }[] = [
  { tab: 'videos', title: 'Video', defaultParams: 'EgZ2aWRlb3PyBgQKAjoA' },
  { tab: 'shorts', title: 'Shorts', defaultParams: 'EgZzaG9ydHPyBgUKA5oBAA%3D%3D' },
  { tab: 'streams', title: 'Trực tiếp', defaultParams: 'EgdzdHJlYW1z8gYECgJ6AA%3D%3D' },
  { tab: 'playlists', title: 'Danh sách phát', defaultParams: 'EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA' },
  { tab: 'posts', title: 'Bài đăng', defaultParams: 'Egljb21tdW5pdHnyBgQKAkoA' },
  { tab: 'about', title: 'Giới thiệu', defaultParams: 'EgVhYm91dPIGBAoCEgA%3D' },
]

/** Browse params of a channel's own search. */
export const CHANNEL_SEARCH_PARAMS = 'EgZzZWFyY2jyBgQKAloA'

export interface ChannelPage {
  channel: ChannelItem
  banner?: string | null
  description?: string | null
  /** Browse params per tab, as found on the channel page. */
  tabParams: Partial<Record<ChannelTab, string>>
  initialTab: ChannelTab
  initialPage: FeedPage
  /** Continuation that loads the channel's "About" panel (from the header's description). */
  aboutToken?: string | null
  /** Subscription state when signed in. */
  isSubscribed?: boolean | null
}

/** What a community post shows below its text. */
export type PostAttachment =
  | { type: 'images'; urls: string[] }
  | { type: 'video'; video: VideoItem }
  | { type: 'poll'; choices: string[]; totalVotes?: string | null }

/** A post on a channel's "Posts" (community) tab. */
export interface CommunityPost {
  id: string
  authorName: string
  authorAvatar?: string | null
  text: string
  publishedText?: string | null
  likeCountText?: string | null
  commentCountText?: string | null
  attachment?: PostAttachment | null
}

export interface PostsPage {
  posts: CommunityPost[]
  continuation?: string | null
}

export interface ChannelLink {
  title: string
  displayUrl?: string | null
  url: string
}

/** The channel's "About" panel. */
export interface ChannelAbout {
  description?: string | null
  country?: string | null
  subscriberCountText?: string | null
  viewCountText?: string | null
  videoCountText?: string | null
  joinedDateText?: string | null
  channelUrl?: string | null
  links: ChannelLink[]
}

export interface PlaylistPage {
  playlist: PlaylistItem
  page: FeedPage
}

export interface CaptionTrack {
  name: string
  languageCode: string
  baseUrl: string
  isAutoGenerated: boolean
  isTranslatable: boolean
}

export function captionTrackId(track: CaptionTrack): string {
  return track.languageCode + (track.isAutoGenerated ? '-asr' : '')
}

export interface CaptionCue {
  start: number
  end: number
  text: string
}

export interface ByteRange {
  start: number
  end: number
}

export interface StreamFormat {
  itag: number
  url: string
  /** Full mime type with codecs, e.g. `video/webm; codecs="vp9"`. */
  mimeType: string
  bitrate: number
  width?: number | null
  height?: number | null
  fps?: number | null
  contentLength?: number | null
  qualityLabel?: string | null
  audioTrackName?: string | null
  isDefaultAudio: boolean
  /** Language of a dubbed / alternative audio track ("en", "vi"…), from `audioTrack.id`. */
  audioLanguage?: string | null
  /** Byte ranges of the init segment and the segment index (sidx / cues), for DASH. */
  initRange?: ByteRange | null
  indexRange?: ByteRange | null
  approxDurationMs?: number | null
  audioSampleRate?: number | null
  audioChannels?: number | null
  /** "HDR" etc. when the format is not SDR. */
  colorInfo?: string | null
}

export function isVideoFormat(f: StreamFormat): boolean {
  return f.mimeType.startsWith('video/')
}

export function isAudioFormat(f: StreamFormat): boolean {
  return f.mimeType.startsWith('audio/')
}

/**
 * Sprite sheets of small frames used for the preview while scrubbing.
 * Spec format: `baseURL|w#h#count#cols#rows#intervalMs#name#sigh|…` (one entry per level).
 */
export interface Storyboard {
  baseUrl: string
  level: number
  width: number
  height: number
  count: number
  columns: number
  rows: number
  intervalMs: number
  name: string
  signature: string
}

export interface StoryboardFrame {
  url: string
  x: number
  y: number
  width: number
  height: number
}

export function storyboardFrame(sb: Storyboard, seconds: number, duration: number): StoryboardFrame {
  const interval = sb.intervalMs > 0 ? sb.intervalMs : Math.max((duration * 1000) / sb.count, 1)
  const index = Math.min(Math.max(Math.floor((seconds * 1000) / interval), 0), sb.count - 1)
  const perSheet = sb.columns * sb.rows
  const sheet = Math.floor(index / perSheet)
  const position = index % perSheet
  const sheetName = sb.name.replace('$M', String(sheet))
  const url = sb.baseUrl.replace('$L', String(sb.level)).replace('$N', sheetName) + '&sigh=' + sb.signature
  return {
    url,
    x: (position % sb.columns) * sb.width,
    y: Math.floor(position / sb.columns) * sb.height,
    width: sb.width,
    height: sb.height,
  }
}

export function parseStoryboard(spec: string): Storyboard | null {
  const parts = spec.split('|')
  if (parts.length <= 1) return null
  // The last level has the largest frames.
  const fields = parts[parts.length - 1].split('#')
  if (fields.length < 8) return null
  const [width, height, count, columns, rows, interval] = fields.slice(0, 6).map((v) => parseInt(v, 10))
  if (![width, height, count, columns, rows, interval].every(Number.isFinite)) return null
  if (width <= 0 || height <= 0 || count <= 0 || columns <= 0 || rows <= 0) return null
  return {
    baseUrl: parts[0],
    level: parts.length - 2,
    width,
    height,
    count,
    columns,
    rows,
    intervalMs: interval,
    name: fields[6],
    signature: fields[7],
  }
}

/** Result of the player endpoint: what can actually be played. */
export interface PlayerInfo {
  videoId: string
  title: string
  author?: string | null
  channelId?: string | null
  lengthSeconds?: number | null
  viewCount?: number | null
  shortDescription?: string | null
  isLive: boolean
  /** Live stream that can be played from the start (DVR). */
  isLiveDvr?: boolean
  thumbnail?: string | null
  hlsUrl?: string | null
  dashUrl?: string | null
  adaptiveFormats: StreamFormat[]
  muxedFormats: StreamFormat[]
  captions: CaptionTrack[]
  /** Streams only work after this moment (server-side pre-roll ad wait), epoch ms. */
  availableAt: number
  storyboard?: Storyboard | null
  /** How much louder than YouTube's reference level the audio is (dB), for "Stable volume". */
  loudnessDb?: number | null
  /** Which InnerTube client produced the streams (for diagnostics). */
  client?: string | null
}

export interface SponsorSegment {
  start: number
  end: number
  category: string
}

export const SPONSOR_CATEGORIES: { id: string; title: string }[] = [
  { id: 'sponsor', title: 'Nhà tài trợ' },
  { id: 'selfpromo', title: 'Tự quảng cáo' },
  { id: 'interaction', title: 'Nhắc đăng ký / tương tác' },
  { id: 'intro', title: 'Đoạn mở đầu' },
  { id: 'outro', title: 'Đoạn kết' },
  { id: 'preview', title: 'Xem trước / tóm tắt' },
  { id: 'music_offtopic', title: 'Đoạn không có nhạc' },
  { id: 'filler', title: 'Lạc đề' },
]

export interface HistoryEntry {
  video: VideoItem
  watchedAt: number
  position: number
  duration: number
}

export interface LocalPlaylist {
  id: string
  name: string
  videos: VideoItem[]
  createdAt: number
}

export interface LiveChatMessage {
  id: string
  author: string
  authorPhoto?: string | null
  message: string
  /** Super Chat amount, e.g. "₫50.000". */
  amount?: string | null
  isOwner?: boolean
  isModerator?: boolean
  isMember?: boolean
  /** Replay only: position in the video (ms). */
  offsetMs?: number | null
}

export interface LiveChatPage {
  messages: LiveChatMessage[]
  continuation?: string | null
  /** Suggested wait before the next poll (ms). */
  timeoutMs: number
  /** Present when signed in and chat is open: lets the account send messages. */
  sendParams?: string | null
}

export interface DownloadedVideo {
  video: VideoItem
  fileName: string
  filePath: string
  fileSize: number
  qualityLabel?: string | null
  downloadedAt: number
  /** Only the sound, as an `.m4a` file. */
  isAudioOnly: boolean
}

export type DownloadState =
  | { state: 'queued' }
  | { state: 'preparing' }
  | { state: 'downloading'; progress: number }
  | { state: 'merging' }
  | { state: 'done'; entry: DownloadedVideo }
  | { state: 'failed'; message: string }
  | { state: 'cancelled' }

export interface DownloadEvent {
  videoId: string
  status: DownloadState
}

// MARK: Search filters (mirrors core/services/SearchFilters.kt)

export type UploadDateFilter = 'any' | 'hour' | 'today' | 'week' | 'month' | 'year'
export type TypeFilter = 'all' | 'video' | 'shorts' | 'channel' | 'playlist' | 'movie'
export type DurationFilter = 'any' | 'short' | 'medium' | 'long'
export type FeatureFilter = 'live' | '4k' | 'hd' | 'subtitles' | 'creativeCommons' | '360' | 'hdr' | 'vr180'
export type SortOrder = 'relevance' | 'date' | 'views' | 'rating'

export interface SearchFilters {
  uploadDate: UploadDateFilter
  type: TypeFilter
  duration: DurationFilter
  features: FeatureFilter[]
  sort: SortOrder
}

export const UPLOAD_DATE_FILTERS: { id: UploadDateFilter; title: string }[] = [
  { id: 'any', title: 'Bất kỳ lúc nào' },
  { id: 'hour', title: 'Trong 1 giờ qua' },
  { id: 'today', title: 'Hôm nay' },
  { id: 'week', title: 'Tuần này' },
  { id: 'month', title: 'Tháng này' },
  { id: 'year', title: 'Năm nay' },
]

export const TYPE_FILTERS: { id: TypeFilter; title: string }[] = [
  { id: 'all', title: 'Tất cả' },
  { id: 'video', title: 'Video' },
  { id: 'shorts', title: 'Shorts' },
  { id: 'channel', title: 'Kênh' },
  { id: 'playlist', title: 'Danh sách phát' },
  { id: 'movie', title: 'Phim' },
]

export const DURATION_FILTERS: { id: DurationFilter; title: string }[] = [
  { id: 'any', title: 'Bất kỳ' },
  { id: 'short', title: 'Dưới 4 phút' },
  { id: 'medium', title: '4–20 phút' },
  { id: 'long', title: 'Trên 20 phút' },
]

export const FEATURE_FILTERS: { id: FeatureFilter; title: string }[] = [
  { id: 'live', title: 'Trực tiếp' },
  { id: '4k', title: '4K' },
  { id: 'hd', title: 'HD' },
  { id: 'subtitles', title: 'Phụ đề' },
  { id: 'creativeCommons', title: 'Creative Commons' },
  { id: '360', title: '360°' },
  { id: 'hdr', title: 'HDR' },
  { id: 'vr180', title: 'VR180' },
]

export const SORT_ORDERS: { id: SortOrder; title: string }[] = [
  { id: 'relevance', title: 'Mức độ liên quan' },
  { id: 'date', title: 'Ngày tải lên' },
  { id: 'views', title: 'Lượt xem' },
  { id: 'rating', title: 'Xếp hạng' },
]

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  uploadDate: 'any',
  type: 'all',
  duration: 'any',
  features: [],
  sort: 'relevance',
}

/** Home feed chips (same as the mobile apps). "all" is the personalised home when signed in, else trending. */
export type HomeCategory = 'all' | 'music' | 'gaming' | 'live' | 'podcasts' | 'news' | 'sports' | 'learning' | 'movies'

export const HOME_CATEGORIES: { id: HomeCategory; title: string }[] = [
  { id: 'all', title: 'Tất cả' },
  { id: 'music', title: 'Âm nhạc' },
  { id: 'gaming', title: 'Trò chơi' },
  { id: 'live', title: 'Trực tiếp' },
  { id: 'podcasts', title: 'Podcast' },
  { id: 'news', title: 'Tin tức' },
  { id: 'sports', title: 'Thể thao' },
  { id: 'learning', title: 'Học tập' },
  { id: 'movies', title: 'Phim' },
]

/** What a pasted link or `dvdtube://` / youtube.com URL points to. */
export type ResolvedLink =
  | { type: 'video'; videoId: string; playlistId?: string | null; startSeconds?: number | null }
  | { type: 'shorts'; videoId: string }
  | { type: 'channel'; channelId: string }
  | { type: 'playlist'; playlistId: string }
  | { type: 'search'; query: string }

// MARK: Formatting helpers (same output as the mobile apps)

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export function formatTime(seconds: number): string {
  return Number.isFinite(seconds) && seconds >= 0 ? formatDuration(seconds) : '0:00'
}

/** Parses "1:02:03" / "12:16" into seconds. */
export function parseDuration(text?: string | null): number | null {
  if (!text) return null
  const parts = text.split(':').map((p) => p.trim())
  if (parts.length === 0 || parts.length > 3) return null
  let total = 0
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    total = total * 60 + parseInt(p, 10)
  }
  return total
}

/** A good-looking 16:9 thumbnail even when the API only returned a 4:3 one. */
export function displayThumbnail(video: VideoItem): string {
  return video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
}

export function shortsThumbnail(video: VideoItem): string {
  return video.isShort && video.thumbnail ? video.thumbnail : `https://i.ytimg.com/vi/${video.id}/oardefault.jpg`
}

export function shareUrl(video: VideoItem): string {
  return video.isShort ? `https://youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`
}

/** "Channel • 1,2 Tr lượt xem • 2 ngày trước" */
export function metadataLine(video: VideoItem): string {
  return [video.channelName, video.viewCountText, video.publishedText]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v)
    .join(' • ')
}

export function feedVideos(page: FeedPage): VideoItem[] {
  return page.items.flatMap((item) => (item.type === 'video' ? [item.video] : item.type === 'shorts' ? item.items : []))
}

export function feedItemKey(item: FeedItem): string {
  switch (item.type) {
    case 'video':
      return 'v-' + item.video.id
    case 'channel':
      return 'c-' + item.channel.id
    case 'playlist':
      return 'p-' + item.playlist.id
    case 'shorts':
      return 's-' + (item.items[0]?.id ?? 'empty')
  }
}

/** Mixes ("RD…") are endless radio playlists generated per video. */
export function isMix(playlistId: string): boolean {
  return playlistId.startsWith('RD') && !playlistId.startsWith('RDCLAK')
}
