// The TV interface's access to the service (or to the mock data). The service is started and
// kept alive over the luna bus (`start` + a `keepAlive` subscription); everything else is plain
// HTTP to http://127.0.0.1:<port> with the token of that service run.
//
// Mock mode ("Chế độ mẫu", believable Vietnamese sample data, no network): `?mock=1`, or when the
// page does not run on a TV (no PalmServiceBridge) and no service address was given.

import type { PairingInfo, SyncInfo, SyncStatus, PairingStatus } from '@shared/api'
import type { LibraryExport } from '@shared/library'
import type {
  AccountState,
  CaptionCue,
  CaptionTrack,
  CastCommand,
  ChannelItem,
  ChannelPage,
  ChannelTab,
  ContinuationKind,
  DeArrowBranding,
  FeedPage,
  HomeCategory,
  Lyrics,
  MusicBrowsePage,
  MusicSearchKind,
  MusicSearchPage,
  PlaylistPage,
  ResolvedLink,
  SearchFilters,
  SponsorSegment,
  VideoItem,
  WatchInfo,
  AccountProfile,
  AccountIdentity,
} from '@shared/models'
import { isWebOS, lunaCall, lunaRequest } from './platform'

export const SERVICE_URI = 'luna://com.dangdvd.dvdtube.service'

export interface AudioTrackOption {
  id: string
  name: string
  language: string | null
  isDefault: boolean
}

export interface StreamInfo {
  videoId: string
  title: string
  author: string | null
  channelId: string | null
  lengthSeconds: number | null
  isLive: boolean
  thumbnail: string | null
  client: string | null
  availableAt: number
  captions: CaptionTrack[]
  loudnessDb: number | null
  hls: string | null
  hlsBase: string | null
  mp4: string | null
  mp4Quality: number | null
  audio: string | null
  qualities: number[]
  audioTracks: AudioTrackOption[]
}

export interface StoredSession {
  cookies: Record<string, string>
  identity: { authUser: number; pageId: string | null }
  profile?: AccountProfile | null
  identities?: AccountIdentity[] | null
}

export interface UpdateCheck {
  current: string
  latest: string | null
  newer: boolean
  url: string
  downloadUrl: string | null
  notes: string | null
}

export interface ServiceInfo {
  version: string
  platform: string
  node?: string
  deviceName: string
  deviceId: string
  castPort: number
  castRunning: boolean
  signedIn: boolean
}

export interface TvConfig {
  language: string
  region: string
  incognito: boolean
  restrictedMode: boolean
  remoteConfigUrl: string
  castReceiver: boolean
  deviceName: string
  deviceId: string
}

/** Every method the interface uses (the service implements them in service/src/api.ts). */
export interface TvApi {
  appInfo(): Promise<ServiceInfo>
  configure(config: TvConfig): Promise<void>
  log(level: 'warn' | 'error', message: string): Promise<void>
  diagnostics(): Promise<{ version: string; node: string; lines: string[] }>
  home(category: HomeCategory): Promise<FeedPage>
  more(token: string, kind: ContinuationKind): Promise<FeedPage>
  search(query: string, filters?: Partial<SearchFilters>): Promise<FeedPage>
  suggestions(query: string): Promise<string[]>
  watchInfo(videoId: string, playlistId?: string | null): Promise<WatchInfo>
  channel(id: string, tab?: ChannelTab): Promise<ChannelPage>
  channelTab(id: string, tab: ChannelTab, params?: string | null): Promise<FeedPage>
  playlist(id: string): Promise<PlaylistPage>
  playlistVideos(id: string, limit?: number): Promise<VideoItem[]>
  resolveLink(text: string): Promise<ResolvedLink | null>
  latestVideos(channelIds: string[]): Promise<VideoItem[]>
  stream(videoId: string, options?: { quality?: number; audioLanguage?: string | null; audioOnly?: boolean; fresh?: boolean }): Promise<StreamInfo>
  sponsorSegments(videoId: string, categories: string[]): Promise<SponsorSegment[]>
  captions(track: CaptionTrack, translateTo?: string | null): Promise<CaptionCue[]>
  dislikes(videoId: string): Promise<number | null>
  dearrow(videoIds: string[]): Promise<Record<string, DeArrowBranding>>
  markWatched(videoId: string, duration: number): Promise<void>
  account(): Promise<AccountState>
  setSession(session: StoredSession | null): Promise<AccountState>
  exportSession(): Promise<StoredSession | null>
  refreshAccount(): Promise<AccountState>
  signOut(): Promise<AccountState>
  switchIdentity(id: string): Promise<AccountState>
  accountFeed(kind: 'subscriptions' | 'history' | 'watchLater' | 'liked' | 'playlists'): Promise<FeedPage>
  accountSubscriptions(): Promise<ChannelItem[]>
  rate(videoId: string, action: 'like' | 'dislike' | 'remove'): Promise<void>
  subscribe(channelId: string, subscribe: boolean): Promise<void>
  startPairing(): Promise<PairingInfo>
  stopPairing(): Promise<void>
  castReceiverStatus(status: unknown): Promise<void>
  startSyncReceiver(): Promise<SyncInfo>
  stopSyncReceiver(): Promise<void>
  syncReply(requestId: string, merged: LibraryExport | null, summary: string): Promise<void>
  musicSearch(query: string, kind: MusicSearchKind, continuation?: string | null): Promise<MusicSearchPage>
  musicBrowse(browseId: string): Promise<MusicBrowsePage>
  lyrics(videoId: string): Promise<Lyrics | null>
  checkUpdate(): Promise<UpdateCheck>
}

export interface TvEvents {
  pairing: PairingStatus
  syncStatus: SyncStatus
  syncIncoming: { requestId: string; device: string; library: LibraryExport }
  castCommand: CastCommand
  account: AccountState
  session: { changed: boolean }
  /** Client side: the connection to the service changed. */
  connection: { mode: ApiMode; port: number | null }
}

export type ApiMode = 'connecting' | 'service' | 'mock' | 'offline'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Handler = (payload: unknown) => void
const handlers = new Map<string, Set<Handler>>()

export function onEvent<K extends keyof TvEvents>(name: K, handler: (payload: TvEvents[K]) => void): () => void {
  let set = handlers.get(name)
  if (!set) {
    set = new Set()
    handlers.set(name, set)
  }
  set.add(handler as Handler)
  return () => set!.delete(handler as Handler)
}

export function emitEvent<K extends keyof TvEvents>(name: K, payload: TvEvents[K]): void {
  const set = handlers.get(name)
  if (!set) return
  for (const h of Array.from(set)) {
    try {
      h(payload)
    } catch (error) {
      console.error(error)
    }
  }
}

// MARK: Connection

interface Connection {
  base: string
  token: string
}

let mode: ApiMode = 'connecting'
let connection: Connection | null = null
let mockImpl: Partial<TvApi> | null = null
let connecting: Promise<void> | null = null
let keepAliveHandle: { cancel(): void } | null = null
let eventsLoop = 0

export function apiMode(): ApiMode {
  return mode
}

export function servicePort(): number | null {
  if (!connection) return null
  const m = /:(\d+)$/.exec(connection.base)
  return m ? parseInt(m[1], 10) : null
}

function setMode(next: ApiMode): void {
  mode = next
  emitEvent('connection', { mode, port: servicePort() })
}

function query(): URLSearchParams {
  try {
    return new URLSearchParams(location.search)
  } catch {
    return new URLSearchParams('')
  }
}

export function wantsMock(): boolean {
  const q = query()
  if (q.get('mock') === '1') return true
  if (q.get('mock') === '0') return false
  return !isWebOS() && !q.get('port')
}

async function useMock(): Promise<void> {
  const { mockApi } = await import('./mock')
  mockImpl = mockApi
  connection = null
  setMode('mock')
}

function startLuna(): Promise<Connection> {
  return lunaRequest(`${SERVICE_URI}/start`, {}, 20_000).then((payload) => {
    if (typeof payload.port !== 'number' || typeof payload.token !== 'string') throw new Error('Dịch vụ DVDTube trả lời không hợp lệ.')
    return { base: `http://127.0.0.1:${payload.port}`, token: payload.token }
  })
}

/** The subscription that keeps the service process alive while the app runs. */
function holdService(): void {
  keepAliveHandle?.cancel()
  let answered = false
  keepAliveHandle = lunaCall(`${SERVICE_URI}/keepAlive`, { subscribe: true }, (payload) => {
    if (payload.returnValue === false || payload.subscribed === false) {
      // The service ended (or refused): start it again a little later.
      keepAliveHandle = null
      setTimeout(() => void reconnect(), answered ? 1000 : 4000)
      return
    }
    answered = true
    if (typeof payload.port === 'number' && connection && !connection.base.endsWith(`:${payload.port}`)) {
      void reconnect()
    }
  })
}

/** Connects to the service (or decides on the mock). Safe to call repeatedly. */
export function connect(): Promise<void> {
  if (connecting) return connecting
  connecting = (async () => {
    if (wantsMock()) {
      await useMock()
      return
    }
    const q = query()
    if (q.get('port') && q.get('token')) {
      connection = { base: `http://127.0.0.1:${parseInt(q.get('port') ?? '0', 10)}`, token: q.get('token') ?? '' }
      setMode('service')
      startEvents()
      return
    }
    setMode('connecting')
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        connection = await startLuna()
        setMode('service')
        holdService()
        startEvents()
        return
      } catch (error) {
        lastError = error
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      }
    }
    setMode('offline')
    throw new ApiError(`Không khởi động được dịch vụ DVDTube trên TV (${lastError instanceof Error ? lastError.message : String(lastError)}).`)
  })().finally(() => {
    connecting = null
  })
  return connecting
}

let reconnecting: Promise<boolean> | null = null

/** The service went away (crash, killed): start it again through luna. */
function reconnect(): Promise<boolean> {
  if (mode === 'mock') return Promise.resolve(false)
  if (reconnecting) return reconnecting
  reconnecting = (async () => {
    try {
      connection = await startLuna()
      setMode('service')
      if (!keepAliveHandle) holdService()
      startEvents()
      emitEvent('session', { changed: false })
      return true
    } catch {
      setMode('offline')
      return false
    }
  })().finally(() => {
    reconnecting = null
  })
  return reconnecting
}

async function post(conn: Connection, method: string, args: unknown[]): Promise<unknown> {
  const response = await fetch(`${conn.base}/api/call?m=${encodeURIComponent(method)}`, {
    method: 'POST',
    // text/plain keeps it a "simple" CORS request (no preflight from the file:// page).
    body: JSON.stringify({ t: conn.token, args }),
  })
  let json: { ok?: boolean; result?: unknown; error?: string; kind?: string | null }
  try {
    json = await response.json()
  } catch {
    throw new ApiError(`Dịch vụ DVDTube trả lời không hợp lệ (HTTP ${response.status}).`)
  }
  if (response.status === 403) throw new ApiError('stale-token', 'stale')
  if (json.ok !== true) throw new ApiError(json.error || 'Đã xảy ra lỗi.', json.kind ?? null)
  return json.result
}

export async function call(method: string, ...args: unknown[]): Promise<unknown> {
  if (mode === 'connecting' || (!connection && mode !== 'mock')) await connect().catch(() => {})
  if (mode === 'mock') {
    const fn = (mockImpl as Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>)[method]
    if (!fn) throw new ApiError('Chức năng này không có trong chế độ mẫu.')
    return fn(...args)
  }
  const conn = connection
  if (!conn) throw new ApiError('Chưa kết nối được dịch vụ DVDTube.')
  try {
    return await post(conn, method, args)
  } catch (error) {
    const stale = error instanceof ApiError && error.kind === 'stale'
    const network = !(error instanceof ApiError)
    if ((stale || network) && isWebOS() && (await reconnect()) && connection) return post(connection, method, args)
    if (network) throw new ApiError('Mất kết nối với dịch vụ DVDTube trên TV. Vui lòng thử lại.', 'service')
    throw error
  }
}

/** Typed facade: `api.home('all')`. */
export const api: TvApi = new Proxy({} as TvApi, {
  get: (_target, name: string) => (...args: unknown[]) => call(name, ...args),
})

// MARK: Events (long poll)

function startEvents(): void {
  const loop = ++eventsLoop
  let after = -1
  const run = async () => {
    while (loop === eventsLoop && connection && mode === 'service') {
      const conn = connection
      try {
        const wait = after < 0 ? 0 : 25_000
        const response = await fetch(`${conn.base}/api/events?t=${conn.token}&after=${Math.max(after, 0)}&wait=${wait}`)
        const json = (await response.json()) as { ok?: boolean; last?: number; events?: { seq: number; name: string; payload: unknown }[] }
        if (loop !== eventsLoop) return
        if (!json.ok) throw new Error('events')
        if (after < 0) {
          // First answer: only learn where the stream is (old events belong to a previous UI).
          after = json.last ?? 0
          continue
        }
        for (const event of json.events ?? []) {
          after = Math.max(after, event.seq)
          emitEvent(event.name as keyof TvEvents, event.payload as never)
        }
        if (typeof json.last === 'number' && json.last < after) after = json.last
      } catch {
        if (loop !== eventsLoop) return
        await new Promise((r) => setTimeout(r, 2000))
        if (isWebOS() && loop === eventsLoop) {
          const ok = await reconnect()
          if (!ok) await new Promise((r) => setTimeout(r, 5000))
          return
        }
      }
    }
  }
  void run()
}

/** Mock mode emits its events through the same handlers. */
export function mockEmit<K extends keyof TvEvents>(name: K, payload: TvEvents[K]): void {
  setTimeout(() => emitEvent(name, payload), 0)
}
