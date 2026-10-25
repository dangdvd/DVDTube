// The contract between the renderer (UI) and the main process (YouTube access, accounts,
// downloads, storage, windows). The main process implements every method of `DvdApi` with
// `ipcMain.handle(name, …)`; the renderer calls them through `window.dvd.invoke(name, …args)`
// (wrapped by `src/renderer/src/lib/api.ts`). Errors are thrown as `Error(message)` where the
// message is already user-facing Vietnamese text.

import type {
  AccountNotification,
  AccountPlaylistOption,
  AccountState,
  CaptionCue,
  CaptionTrack,
  CastAction,
  CastCommand,
  CastDevice,
  CastPlayRequest,
  CastStatus,
  ChannelAbout,
  ChannelItem,
  ChannelPage,
  ChannelTab,
  Comment,
  CommentSortOption,
  CommentsPage,
  ContinuationKind,
  DeArrowBranding,
  DownloadEvent,
  DownloadedVideo,
  FeedPage,
  HomeCategory,
  LiveChatPage,
  Lyrics,
  MusicBrowsePage,
  MusicSearchKind,
  MusicSearchPage,
  PlayerInfo,
  PlaylistPage,
  PostsPage,
  ResolvedLink,
  SearchFilters,
  SponsorSegment,
  VideoItem,
  WatchInfo,
} from './models'
import type { LibraryExport } from './library'
import type { CoreConfig } from './settings'

export interface AppInfo {
  version: string
  platform: string
  electron: string
  chrome: string
  userDataPath: string
  /** Set when started with `--smoke=<dir>`: the renderer runs the smoke scenario. */
  smoke: boolean
  /** Started minimised to the tray (e.g. "start with Windows"). */
  hidden: boolean
  /** This computer's name as other devices see it (cast receiver, sync). */
  deviceName?: string
  arch?: string
}

export interface UpdateInfo {
  version: string
  url: string
  notes?: string | null
  /** Direct link of the asset for this platform / installation (installer, zip, dmg, AppImage, deb). */
  downloadUrl?: string | null
  assetName?: string | null
  /** Bytes of the asset (to check the download). */
  size?: number | null
  /** Installed with the Windows installer: "Cập nhật ngay" downloads it and installs silently. */
  installable?: boolean
}

export type UpdateProgress =
  | { state: 'downloading'; progress: number }
  | { state: 'installing' }
  | { state: 'failed'; message: string }

/** LAN sync ("Đồng bộ thư viện"): this computer is the receiving side and shows a QR code. */
export interface SyncInfo {
  /** `dvdtube://sync?h=<ip:port>&t=…&k=…&n=<name>` */
  qrText: string
  qrDataUrl: string
  host: string
  deviceName: string
  expiresAt: number
}

export type SyncStatus =
  | { state: 'waiting' }
  | { state: 'merging'; device: string }
  | { state: 'success'; device: string; summary: string }
  | { state: 'failed'; message: string }
  | { state: 'expired' }

/** A library sent by a phone: the renderer merges it and answers with `syncReply`. */
export interface SyncIncoming {
  requestId: string
  device: string
  library: LibraryExport
}

/** One unfinished video for the taskbar Jump List / Dock menu ("Tiếp tục xem"). */
export interface RecentVideo {
  id: string
  title: string
  position?: number | null
}

/** Shown in the log file instead of the real settings (nothing personal). */
export interface LogContext {
  settings: Record<string, string>
  /** Recent renderer warnings / errors (player errors with client and stage). */
  rendererLines: string[]
  signedIn: boolean
}

export type FileKind = 'json' | 'txt'

/** "Sign in from the phone": the phone app scans a QR code and sends its YouTube session. */
export interface PairingInfo {
  /** `dvdtube://tv-login?h=<ip:port>&t=…&k=…&n=<name>` — same format as the Android TV app. */
  qrText: string
  /** PNG data URL of the QR code. */
  qrDataUrl: string
  host: string
  deviceName: string
  expiresAt: number
}

export type PairingStatus =
  | { state: 'waiting' }
  | { state: 'success'; accountName: string }
  | { state: 'failed'; message: string }
  | { state: 'expired' }

export type AccountFeedKind = 'subscriptions' | 'history' | 'watchLater' | 'liked' | 'playlists'

export type WindowMode = 'normal' | 'fullscreen' | 'mini' | 'alwaysOnTop'

export interface ThumbarState {
  playing: boolean
  hasPrevious: boolean
  hasNext: boolean
}

/** One step of the CI smoke scenario, reported by the renderer. */
export interface SmokeStep {
  name: string
  ok: boolean
  detail?: string
  /**
   * The step could not run in this environment (YouTube's bot check on CI machines' IP
   * addresses); reported, but not counted as a failure.
   */
  skipped?: boolean
  /** Take a screenshot of the window named `<name>.png`. */
  screenshot?: boolean
  /** Last step: write the report and quit (exit code 1 when any step failed). */
  finish?: boolean
}

export interface DvdApi {
  // App / configuration
  appInfo(): Promise<AppInfo>
  configure(config: CoreConfig): Promise<void>

  // Feeds and pages
  home(category: HomeCategory): Promise<FeedPage>
  more(token: string, kind: ContinuationKind): Promise<FeedPage>
  search(query: string, filters?: SearchFilters): Promise<FeedPage>
  suggestions(query: string): Promise<string[]>
  player(videoId: string): Promise<PlayerInfo>
  watchInfo(videoId: string, playlistId?: string | null): Promise<WatchInfo>
  comments(token: string): Promise<{ page: CommentsPage; sortOptions: CommentSortOption[] }>
  channel(id: string, tab?: ChannelTab): Promise<ChannelPage>
  channelTab(id: string, tab: ChannelTab, params?: string | null): Promise<FeedPage>
  channelPosts(id: string, params?: string | null): Promise<PostsPage>
  channelPostsMore(token: string): Promise<PostsPage>
  channelAbout(id: string, aboutToken?: string | null, params?: string | null): Promise<ChannelAbout | null>
  channelSearch(id: string, query: string): Promise<FeedPage>
  playlist(id: string): Promise<PlaylistPage>
  /** All videos of a playlist (follows continuations up to `limit`). */
  playlistVideos(id: string, limit?: number): Promise<VideoItem[]>
  /** Understands youtube.com / youtu.be / music.youtube.com / dvdtube:// links, @handles and bare ids. */
  resolveLink(text: string): Promise<ResolvedLink | null>
  /** Newest uploads of these channels (RSS), newest first — the signed-out subscriptions feed. */
  latestVideos(channelIds: string[]): Promise<VideoItem[]>

  // Extras
  sponsorSegments(videoId: string, categories: string[]): Promise<SponsorSegment[]>
  captions(track: CaptionTrack, translateTo?: string | null): Promise<CaptionCue[]>
  dislikes(videoId: string): Promise<number | null>

  // Account
  account(): Promise<AccountState>
  /** Opens the Google sign-in window; resolves when it closes. */
  signIn(addAccount?: boolean): Promise<AccountState>
  signOut(): Promise<AccountState>
  switchIdentity(identityId: string): Promise<AccountState>
  accountFeed(kind: AccountFeedKind): Promise<FeedPage>
  accountSubscriptions(): Promise<ChannelItem[]>
  accountNotifications(): Promise<AccountNotification[]>
  unseenNotificationCount(): Promise<number>
  /** `like`, `dislike` or `remove` (clears like / dislike). */
  rate(videoId: string, action: 'like' | 'dislike' | 'remove'): Promise<void>
  subscribe(channelId: string, subscribe: boolean): Promise<void>
  playlistOptions(videoId: string): Promise<AccountPlaylistOption[]>
  editPlaylist(playlistId: string, add?: string | null, remove?: string | null): Promise<void>
  createPlaylist(title: string, videoId?: string | null): Promise<string | null>
  postComment(text: string, params: string): Promise<Comment | null>
  postReply(text: string, params: string): Promise<Comment | null>
  commentAction(token: string): Promise<void>
  /** Adds the video to the account's YouTube watch history (signed in, not incognito). */
  markWatched(videoId: string, duration: number): Promise<void>

  // Live chat
  liveChat(continuation: string, replay: boolean, offsetMs?: number): Promise<LiveChatPage>
  sendLiveChat(text: string, params: string): Promise<void>

  // Sign in from the phone (QR pairing over the local network)
  startPairing(): Promise<PairingInfo>
  stopPairing(): Promise<void>

  // Downloads
  download(video: VideoItem, options: { audioOnly: boolean; quality?: number | null }): Promise<void>
  cancelDownload(videoId: string): Promise<void>
  deleteDownload(videoId: string): Promise<void>
  downloads(): Promise<DownloadedVideo[]>
  /** `file://` URL of a finished download (plays offline), or null. */
  downloadFileUrl(videoId: string): Promise<string | null>
  /** Shows the file in Explorer. */
  showDownload(videoId: string): Promise<void>
  chooseDownloadFolder(): Promise<string | null>

  // Renderer-owned state (settings, library…) persisted as JSON files in the user data folder.
  storeRead(name: string): Promise<unknown | null>
  storeWrite(name: string, data: unknown): Promise<void>

  // System integration
  openExternal(url: string): Promise<void>
  setWindowMode(mode: WindowMode): Promise<void>
  /** Taskbar thumbnail buttons (⏮ ⏯ ⏭) and the window title. */
  setThumbar(state: ThumbarState, title?: string | null): Promise<void>
  notify(title: string, body: string, link?: string | null, icon?: string | null): Promise<void>
  checkUpdate(): Promise<UpdateInfo | null>
  /** YouTube Studio in its own window (upload, manage videos), signed in with the same account. */
  openStudio(): Promise<void>
  setStartWithWindows(enabled: boolean): Promise<void>
  /** Keeps the PC awake while a video plays. */
  setPreventSleep(enabled: boolean): Promise<void>
  smokeStep(step: SmokeStep): Promise<void>
  /** Shows / focuses the main window (alarms). */
  showWindow(): Promise<void>
  /** "Cập nhật ngay": downloads the installer and runs it silently (Windows installer only). */
  installUpdate(info: UpdateInfo): Promise<void>
  /** Recent unfinished videos for the Jump List (Windows) / Dock menu (macOS). */
  setRecentVideos(videos: RecentVideo[]): Promise<void>

  // Files (library export / import, log file)
  /** Save dialog; returns the chosen path or null. */
  saveTextFile(defaultName: string, text: string, kind: FileKind): Promise<string | null>
  /** Open dialog; the chosen file's name and text, or null. */
  openTextFile(kind: FileKind): Promise<{ name: string; text: string } | null>
  /** Shows a file in Explorer / Finder. */
  showFile(path: string): Promise<void>

  // Error log ("Gửi nhật ký lỗi")
  /** `DVDTube-log-<platform>-<yyyyMMdd-HHmm>.txt` with secrets scrubbed. */
  buildLog(context: LogContext): Promise<{ fileName: string; text: string }>
  /** Renderer warnings / errors kept in the persistent log (rate limited). */
  logRenderer(level: 'warn' | 'error', message: string): Promise<void>

  // Cast to DVDTube — sender
  /** Receivers found on the network plus the ones added by IP. */
  castDevices(): Promise<CastDevice[]>
  /** Asks the network again (while the device picker is open). */
  castScan(): Promise<void>
  /** "Thêm thiết bị bằng địa chỉ IP": `IP` or `IP:port`; checked with /api/info and remembered. */
  castAddDevice(address: string): Promise<CastDevice>
  castForgetDevice(id: string): Promise<void>
  castPlay(device: CastDevice, request: CastPlayRequest): Promise<void>
  castQueue(device: CastDevice, video: VideoItem, next: boolean): Promise<void>
  castControl(device: CastDevice, action: CastAction, value?: number | null): Promise<void>
  castStatus(device: CastDevice): Promise<CastStatus>
  // Cast to DVDTube — receiver (this computer)
  /** The renderer's playback state, answered to `GET /api/status`. */
  castReceiverStatus(status: CastStatus): Promise<void>

  // Library sync over the local network (receiving side)
  startSyncReceiver(): Promise<SyncInfo>
  stopSyncReceiver(): Promise<void>
  /** Answer to a `syncIncoming` event: the merged library (encrypted back to the phone) or null on failure. */
  syncReply(requestId: string, merged: LibraryExport | null, summary: string): Promise<void>

  // Music mode (YouTube Music client)
  musicSearch(query: string, kind: MusicSearchKind, continuation?: string | null): Promise<MusicSearchPage>
  musicBrowse(browseId: string): Promise<MusicBrowsePage>
  lyrics(videoId: string): Promise<Lyrics | null>

  // DeArrow
  /** Replacement titles / thumbnails of these videos (missing = keep the original). */
  dearrow(videoIds: string[]): Promise<Record<string, DeArrowBranding>>

  // Automatic downloads
  /** Checks the picked channels for new videos now (otherwise hourly). */
  runAutoDownloads(): Promise<void>

  // Web player fallback
  /** Where the YouTube embed is hosted (a page on this computer that gives it a proper origin / Referer). */
  webPlayerSource(videoId: string, startSeconds: number, loop: boolean): Promise<{ url: string; partition: string }>
}

/** Events pushed from the main process: `window.dvd.on(name, handler)`. */
export interface DvdEvents {
  download: DownloadEvent
  account: AccountState
  pairing: PairingStatus
  /** A link opened from outside (dvdtube://, a youtube.com URL passed to the exe, a notification click). */
  openLink: string
  /** Taskbar thumbnail button or global media key. */
  mediaCommand: 'play' | 'pause' | 'playPause' | 'next' | 'previous' | 'stop'
  windowMode: WindowMode
  /** The window was hidden to the tray / shown again. */
  visibility: boolean
  /** A DVDTube sender (phone, PC) controls this computer. */
  castCommand: CastCommand
  /** The list of receivers changed (discovery). */
  castDevices: CastDevice[]
  syncIncoming: SyncIncoming
  syncStatus: SyncStatus
  updateProgress: UpdateProgress
  /** The app is about to quit: save pending state now. */
  beforeQuit: true
}

export type DvdMethod = keyof DvdApi
export type DvdEventName = keyof DvdEvents

/** What the preload script exposes as `window.dvd`. */
export interface DvdBridge {
  invoke<K extends DvdMethod>(method: K, ...args: Parameters<DvdApi[K]>): ReturnType<DvdApi[K]>
  on<K extends DvdEventName>(event: K, handler: (payload: DvdEvents[K]) => void): () => void
}

/** IPC channel names. */
export const IPC_INVOKE_PREFIX = 'dvd:'
export const IPC_EVENT_PREFIX = 'dvd-event:'
