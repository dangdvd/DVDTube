// The methods the TV interface calls over `POST /api/call?m=<method>` (the subset of the
// desktop `DvdApi` a TV needs, plus `stream()`, which prepares playback through the local relay).
// Arguments are validated here like in the desktop main process; errors are thrown with the
// user-facing Vietnamese message.

import type { PairingInfo, SyncInfo } from '../../../windows/src/shared/api'
import { parseLibraryExport, type LibraryExport } from '../../../windows/src/shared/library'
import {
  DEFAULT_SEARCH_FILTERS,
  MUSIC_SEARCH_KINDS,
  isAudioFormat,
  type CaptionTrack,
  type ChannelTab,
  type ContinuationKind,
  type HomeCategory,
  type MusicSearchKind,
  type PlayerInfo,
  type SearchFilters,
  type StreamFormat,
} from '../../../windows/src/shared/models'
import { AuthSession } from '../../../windows/src/main/core/auth'
import { refreshRemoteConfig } from '../../../windows/src/main/core/clients'
import { coreState, debug } from '../../../windows/src/main/core/config'
import { DeArrow } from '../../../windows/src/main/core/dearrow'
import { Errors, describeError } from '../../../windows/src/main/core/errors'
import { dislikes, loadCaptions, sponsorSegments } from '../../../windows/src/main/core/extras'
import { requestText } from '../../../windows/src/main/core/http'
import * as innertube from '../../../windows/src/main/core/innertube'
import { lyrics, musicBrowse, musicSearch } from '../../../windows/src/main/core/music'
import * as service from '../../../windows/src/main/core/services'
import { compareVersions } from '../../../windows/src/main/core/versions'
import type { TvCast } from './cast'
import type { EventBus } from './events'
import { analyzeMaster, audioTracksOf, fetchPlaylist, qualitiesOf, relayUrl, type AudioTrackOption, type RelayContext } from './hls'
import { TvPairingServer, TvSyncServer } from './lanservers'
import type { Session } from './session'

export const RELEASES_URL = 'https://api.github.com/repos/dangdvd/DVDTube/releases/latest'
export const RELEASE_PAGE = 'https://github.com/dangdvd/DVDTube/releases/latest'
export const IPK_ASSET = 'DVDTube-webOS.ipk'

const CHANNEL_TABS: ChannelTab[] = ['videos', 'shorts', 'streams', 'playlists', 'posts', 'about']
const HOME: HomeCategory[] = ['all', 'music', 'gaming', 'live', 'podcasts', 'news', 'sports', 'learning', 'movies']
const KINDS: ContinuationKind[] = ['browse', 'search', 'next']

function str(value: unknown, what = 'Giá trị'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100_000) throw new Error(`${what} không hợp lệ.`)
  return value
}

function videoId(value: unknown): string {
  const id = str(value, 'Mã video')
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new Error('Mã video không hợp lệ.')
  return id
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export interface StreamOptions {
  /** Highest quality (shorter side), 0 = "Tự động". */
  quality?: number
  audioLanguage?: string | null
  audioOnly?: boolean
}

/** What the player needs to start a video (all URLs point at the local relay). */
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
  /** HLS master through the relay (with the chosen quality / audio language), or null. */
  hls: string | null
  /** The same without `q` / `a` (the UI appends them when the user changes quality or audio). */
  hlsBase: string | null
  /** Muxed MP4 fallback (itag 18 …) through the relay. */
  mp4: string | null
  mp4Quality: number | null
  /** Audio only (M4A, AAC) through the relay: music mode. */
  audio: string | null
  qualities: number[]
  audioTracks: AudioTrackOption[]
}

export interface UpdateCheck {
  current: string
  latest: string | null
  newer: boolean
  url: string
  downloadUrl: string | null
  notes: string | null
}

export interface ApiContext {
  version: string
  relay: RelayContext
  session: Session
  events: EventBus
  cast: TvCast
  identity(): { id: string; name: string }
  setIdentity(identity: { id?: string | null; name?: string | null }): void
  logLines(): string[]
  /** Tests: LAN servers on other ports / addresses. */
  lan?: { pairingPort?: number; syncPort?: number; address?: string }
}

export type ApiMethod = (...args: unknown[]) => Promise<unknown>

function bestMuxed(info: PlayerInfo, maxQuality: number): StreamFormat | null {
  const mp4 = info.muxedFormats.filter((f) => f.mimeType.startsWith('video/mp4'))
  if (mp4.length === 0) return null
  const limit = maxQuality > 0 ? maxQuality : 720
  const fitting = mp4.filter((f) => Math.min(f.width ?? 0, f.height ?? 0) <= limit || !f.height)
  const list = (fitting.length ? fitting : mp4).slice().sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bitrate - a.bitrate)
  return list[0]
}

function bestAudio(info: PlayerInfo, language: string | null): StreamFormat | null {
  const aac = info.adaptiveFormats.filter((f) => isAudioFormat(f) && f.mimeType.startsWith('audio/mp4'))
  if (aac.length === 0) return null
  const lang = language?.toLowerCase().split('-')[0] ?? null
  const preferred = (lang ? aac.filter((f) => (f.audioLanguage ?? '').toLowerCase().split('-')[0] === lang) : []).concat()
  const pool = preferred.length ? preferred : aac.filter((f) => f.isDefaultAudio).length ? aac.filter((f) => f.isDefaultAudio) : aac
  return pool.slice().sort((a, b) => b.bitrate - a.bitrate)[0]
}

function audioTracksFromFormats(info: PlayerInfo): AudioTrackOption[] {
  const out: AudioTrackOption[] = []
  for (const f of info.adaptiveFormats) {
    if (!isAudioFormat(f) || !f.audioLanguage) continue
    if (out.some((t) => t.id === f.audioLanguage)) continue
    out.push({ id: f.audioLanguage, name: f.audioTrackName ?? f.audioLanguage, language: f.audioLanguage, isDefault: f.isDefaultAudio })
  }
  return out.length > 1 ? out : []
}

export function createApi(ctx: ApiContext): Record<string, ApiMethod> {
  const dearrow = new DeArrow()
  const players = new Map<string, { at: number; info: PlayerInfo }>()
  let pairing: TvPairingServer | null = null
  let sync: TvSyncServer | null = null
  const pendingSync = new Map<string, { resolve: (v: { merged: LibraryExport; summary: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let syncCounter = 0
  let lastRemoteConfigUrl: string | null = null

  async function requireSignedIn(): Promise<void> {
    if (!ctx.session.signedIn || !(await AuthSession.isAuthenticated())) throw Errors.signedOut()
  }

  async function playerInfo(id: string, fresh = false): Promise<PlayerInfo> {
    const cached = players.get(id)
    // googlevideo URLs live for hours; a few minutes of reuse covers quality / audio changes.
    if (!fresh && cached && Date.now() - cached.at < 5 * 60_000) return cached.info
    const info = await service.player(id)
    if (players.size > 30) players.clear()
    players.set(id, { at: Date.now(), info })
    return info
  }

  const api: Record<string, (...args: never[]) => Promise<unknown>> = {
    // App / configuration

    async appInfo() {
      const identity = ctx.identity()
      return {
        version: ctx.version,
        platform: 'webos',
        node: process.version,
        deviceName: identity.name,
        deviceId: identity.id,
        castPort: ctx.cast.port,
        castRunning: ctx.cast.running,
        signedIn: ctx.session.signedIn,
      }
    },

    async configure(config: Record<string, unknown>) {
      if (!config || typeof config !== 'object') return
      coreState.hl = typeof config.language === 'string' && config.language ? config.language : 'vi'
      coreState.gl = typeof config.region === 'string' && config.region ? config.region : 'VN'
      coreState.incognito = !!config.incognito
      coreState.restrictedMode = !!config.restrictedMode
      coreState.remoteConfigUrl = typeof config.remoteConfigUrl === 'string' ? config.remoteConfigUrl : ''
      ctx.setIdentity({ id: optionalString(config.deviceId), name: optionalString(config.deviceName) })
      if (lastRemoteConfigUrl !== null && lastRemoteConfigUrl !== coreState.remoteConfigUrl) void refreshRemoteConfig()
      lastRemoteConfigUrl = coreState.remoteConfigUrl
      if (config.castReceiver !== undefined) void ctx.cast.configure(config.castReceiver !== false, ctx.identity())
    },

    async log(level: string, message: string) {
      debug(`ui ${level === 'error' ? 'error' : 'warn'}: ${String(message).slice(0, 500).replace(/[\r\n]+/g, ' ')}`)
    },

    async diagnostics() {
      return { version: ctx.version, node: process.version, lines: ctx.logLines().slice(-200) }
    },

    // Feeds and pages

    async home(category: HomeCategory) {
      return service.home(HOME.includes(category) ? category : 'all', coreState.incognito)
    },
    async more(token: string, kind: ContinuationKind) {
      return service.more(str(token, 'Mã trang'), KINDS.includes(kind) ? kind : 'browse')
    },
    async search(query: string, filters?: SearchFilters) {
      return service.search(str(query, 'Từ khóa').slice(0, 500), { ...DEFAULT_SEARCH_FILTERS, ...(filters ?? {}) })
    },
    async suggestions(query: string) {
      if (typeof query !== 'string' || !query.trim()) return []
      return service.suggestions(query.slice(0, 200))
    },
    async watchInfo(id: string, playlistId?: string | null) {
      return service.watchInfo(videoId(id), optionalString(playlistId))
    },
    async channel(id: string, tab?: ChannelTab) {
      return service.channel(str(id, 'Mã kênh'), tab && CHANNEL_TABS.includes(tab) ? tab : 'videos')
    },
    async channelTab(id: string, tab: ChannelTab, params?: string | null) {
      return service.channelTab(str(id, 'Mã kênh'), CHANNEL_TABS.includes(tab) ? tab : 'videos', optionalString(params))
    },
    async playlist(id: string) {
      return service.playlist(str(id, 'Mã danh sách phát'))
    },
    async playlistVideos(id: string, limit?: number) {
      const max = typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), 2000) : 200
      return service.playlistVideos(str(id, 'Mã danh sách phát'), max)
    },
    async resolveLink(text: string) {
      if (typeof text !== 'string' || !text.trim()) return null
      return service.resolveLink(text.slice(0, 2000))
    },
    async latestVideos(channelIds: string[]) {
      if (!Array.isArray(channelIds)) return []
      return service.latestVideos(channelIds.filter((id): id is string => typeof id === 'string').slice(0, 300))
    },

    // Playback

    async player(id: string) {
      return playerInfo(videoId(id))
    },

    async stream(id: string, options?: StreamOptions) {
      const vid = videoId(id)
      const quality = typeof options?.quality === 'number' && options.quality > 0 ? Math.floor(options.quality) : 0
      const audioLanguage = optionalString(options?.audioLanguage)
      const info = await playerInfo(vid, !!(options as { fresh?: boolean } | undefined)?.fresh)
      let qualities: number[] = []
      let audioTracks: AudioTrackOption[] = []
      let hls: string | null = null
      let hlsBase: string | null = null
      if (info.hlsUrl) {
        hlsBase = relayUrl(ctx.relay, 'master', info.hlsUrl)
        hls = relayUrl(ctx.relay, 'master', info.hlsUrl, { q: quality || null, a: audioLanguage })
        try {
          const master = await fetchPlaylist(info.hlsUrl)
          if (master.status === 200) {
            const analyzed = analyzeMaster(master.text, master.finalUrl || info.hlsUrl)
            qualities = qualitiesOf(analyzed)
            audioTracks = audioTracksOf(analyzed)
            if (audioTracks.length < 2) audioTracks = []
          } else {
            debug(`stream ${vid}: master playlist -> HTTP ${master.status}`)
          }
        } catch (error) {
          debug(`stream ${vid}: master playlist failed (${describeError(error)})`)
        }
      }
      if (audioTracks.length === 0) audioTracks = audioTracksFromFormats(info)
      const muxed = bestMuxed(info, quality)
      const audio = bestAudio(info, audioLanguage)
      const result: StreamInfo = {
        videoId: vid,
        title: info.title,
        author: info.author ?? null,
        channelId: info.channelId ?? null,
        lengthSeconds: info.lengthSeconds ?? null,
        isLive: info.isLive,
        thumbnail: info.thumbnail ?? null,
        client: info.client ?? null,
        availableAt: info.availableAt,
        captions: info.captions,
        loudnessDb: info.loudnessDb ?? null,
        hls,
        hlsBase,
        mp4: muxed ? relayUrl(ctx.relay, 'media', muxed.url, { len: muxed.contentLength ?? null, t: 'video/mp4' }) : null,
        mp4Quality: muxed ? Math.min(muxed.width ?? muxed.height ?? 0, muxed.height ?? 0) || null : null,
        audio: audio ? relayUrl(ctx.relay, 'media', audio.url, { len: audio.contentLength ?? null, t: 'audio/mp4' }) : null,
        qualities,
        audioTracks,
      }
      debug(`stream ${vid}: client=${info.client ?? '?'} hls=${!!hls} mp4=${!!muxed} audio=${!!audio} qualities=${qualities.join('/')}`)
      return result
    },

    async sponsorSegments(id: string, categories: string[]) {
      return sponsorSegments(videoId(id), Array.isArray(categories) ? categories.filter((c) => typeof c === 'string' && /^[a-z_]+$/.test(c)) : [])
    },
    async captions(track: CaptionTrack, translateTo?: string | null) {
      if (!track || typeof track.baseUrl !== 'string' || !/^https:\/\/([a-z0-9-]+\.)*youtube\.com\//i.test(track.baseUrl)) {
        throw new Error('Phụ đề không hợp lệ.')
      }
      return loadCaptions(track, optionalString(translateTo))
    },
    async dislikes(id: string) {
      return dislikes(videoId(id))
    },
    async dearrow(ids: string[]) {
      if (!Array.isArray(ids)) return {}
      return dearrow.branding(ids.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id)).slice(0, 200))
    },
    async markWatched(id: string, duration: number) {
      if (coreState.incognito || !ctx.session.signedIn) return
      await innertube.markWatched(videoId(id), typeof duration === 'number' && Number.isFinite(duration) ? duration : 0)
    },

    // Account

    async account() {
      return ctx.session.state()
    },
    async setSession(stored: unknown) {
      return ctx.session.setSession(stored)
    },
    async exportSession() {
      return ctx.session.exportSession()
    },
    async refreshAccount() {
      await ctx.session.refresh()
      return ctx.session.state()
    },
    async signOut() {
      return ctx.session.signOut()
    },
    async switchIdentity(id: string) {
      return ctx.session.switchIdentity(str(id, 'Tài khoản'))
    },
    async accountFeed(kind: string) {
      await requireSignedIn()
      const ids: Record<string, string> = {
        subscriptions: 'FEsubscriptions',
        history: 'FEhistory',
        watchLater: 'VLWL',
        liked: 'VLLL',
        playlists: 'FEplaylist_aggregation',
      }
      const browseId = ids[kind]
      if (!browseId) throw new Error('Mục không hợp lệ.')
      return service.accountFeed(browseId)
    },
    async accountSubscriptions() {
      await requireSignedIn()
      return service.accountSubscriptions()
    },
    async rate(id: string, action: 'like' | 'dislike' | 'remove') {
      await requireSignedIn()
      const map = { like: 'like', dislike: 'dislike', remove: 'removelike' } as const
      if (!(action in map)) throw new Error('Thao tác không hợp lệ.')
      await innertube.like(videoId(id), map[action])
    },
    async subscribe(channelId: string, subscribe: boolean) {
      await requireSignedIn()
      await innertube.subscription(str(channelId, 'Mã kênh'), !!subscribe)
    },

    // Sign in from the phone

    async startPairing(): Promise<PairingInfo> {
      pairing?.stop()
      const server = new TvPairingServer(
        {
          signIn: (cookies) => ctx.session.completePairing(cookies),
          onStatus: (status) => ctx.events.emit('pairing', status),
        },
        { deviceName: ctx.identity().name, port: ctx.lan?.pairingPort, address: ctx.lan?.address, log: debug },
      )
      pairing = server
      return server.start()
    },
    async stopPairing() {
      pairing?.stop()
      pairing = null
    },

    // Cast receiver

    async castReceiverStatus(status: unknown) {
      ctx.cast.setStatus(status)
    },

    // Library sync (receiving side)

    async startSyncReceiver(): Promise<SyncInfo> {
      sync?.stop()
      const server = new TvSyncServer(
        {
          merge: (library, device) =>
            new Promise((resolve, reject) => {
              const requestId = `s${Date.now().toString(36)}${++syncCounter}`
              const timer = setTimeout(() => {
                pendingSync.delete(requestId)
                reject(new Error('TV không gộp kịp thư viện. Vui lòng thử lại.'))
              }, 30_000)
              pendingSync.set(requestId, { resolve, reject, timer })
              ctx.events.emit('syncIncoming', { requestId, device, library })
            }),
          onStatus: (status) => ctx.events.emit('syncStatus', status),
        },
        { deviceName: ctx.identity().name, port: ctx.lan?.syncPort, address: ctx.lan?.address, log: debug },
      )
      sync = server
      return server.start()
    },
    async stopSyncReceiver() {
      sync?.stop()
      sync = null
    },
    async syncReply(requestId: string, merged: LibraryExport | null, summary: string) {
      const pending = pendingSync.get(requestId)
      if (!pending) return
      pendingSync.delete(requestId)
      clearTimeout(pending.timer)
      const library = merged ? parseLibraryExport(merged) : null
      if (!library) pending.reject(new Error(typeof summary === 'string' && summary ? summary : 'Không gộp được thư viện.'))
      else pending.resolve({ merged: library, summary: String(summary ?? '') })
    },

    // Music

    async musicSearch(query: string, kind: MusicSearchKind, continuation?: string | null) {
      const k = MUSIC_SEARCH_KINDS.some((x) => x.id === kind) ? kind : 'songs'
      return musicSearch(str(query, 'Từ khóa').slice(0, 300), k, optionalString(continuation))
    },
    async musicBrowse(browseId: string) {
      const id = str(browseId, 'Mã trang')
      if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) throw new Error('Mã trang không hợp lệ.')
      return musicBrowse(id)
    },
    async lyrics(id: string) {
      return lyrics(videoId(id))
    },

    // Updates

    async checkUpdate(): Promise<UpdateCheck> {
      let response
      try {
        response = await requestText(RELEASES_URL, {
          transport: 'plain',
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'DVDTube-webOS' },
          timeoutMs: 15_000,
        })
      } catch {
        throw new Error('Không kiểm tra được bản cập nhật. Kiểm tra mạng và thử lại.')
      }
      if (response.status === 404) return { current: ctx.version, latest: null, newer: false, url: RELEASE_PAGE, downloadUrl: null, notes: null }
      if (response.status !== 200) throw new Error(`Không kiểm tra được bản cập nhật (HTTP ${response.status}).`)
      let release: { tag_name?: string; html_url?: string; body?: string; assets?: { name?: string; browser_download_url?: string }[] }
      try {
        release = JSON.parse(response.text)
      } catch {
        throw new Error('Không kiểm tra được bản cập nhật.')
      }
      const latest = (release.tag_name ?? '').replace(/^v/i, '') || null
      const asset = release.assets?.find((a) => a.name === IPK_ASSET)
      return {
        current: ctx.version,
        latest,
        newer: !!latest && compareVersions(latest, ctx.version) > 0,
        url: release.html_url ?? RELEASE_PAGE,
        downloadUrl: asset?.browser_download_url ?? null,
        notes: release.body?.trim().slice(0, 4000) || null,
      }
    },
  }
  return api as unknown as Record<string, ApiMethod>
}
