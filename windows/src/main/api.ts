// The main-process implementation of every `DvdApi` method.

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, dialog, Notification, powerSaveBlocker, shell, nativeImage } from 'electron'
import type { DvdApi, FileKind, PairingInfo, SyncInfo } from '@shared/api'
import { parseLibraryExport, type LibraryExport } from '@shared/library'
import {
  DEFAULT_SEARCH_FILTERS,
  MUSIC_SEARCH_KINDS,
  cleanVideoItem,
  type CaptionTrack,
  type CastAction,
  type CastDevice,
  type ChannelTab,
  type ContinuationKind,
  type HomeCategory,
  type LiveChatPage,
  type SearchFilters,
  type VideoItem,
} from '@shared/models'
import type { CoreConfig } from '@shared/settings'
import * as accounts from './accounts'
import { runAutoDownloads, configureAutoDownload } from './autodownload'
import type { CastService } from './cast'
import { CAST_ACTIONS } from './cast/receiver'
import { AuthSession } from './core/auth'
import { DeArrow } from './core/dearrow'
import { lyrics, musicBrowse, musicSearch } from './core/music'
import { dislikes, loadCaptions, sponsorSegments } from './core/extras'
import { refreshRemoteConfig } from './core/clients'
import { coreState } from './core/config'
import { Errors } from './core/errors'
import { requestBytes } from './core/http'
import * as innertube from './core/innertube'
import { JNode } from './core/json'
import { parseCreatedComment } from './core/parsers/comments'
import { parseLiveChat } from './core/parsers/livechat'
import * as service from './core/services'
import * as downloads from './downloads'
import { emit } from './ipc'
import { setRecentVideos } from './jumplist'
import { deviceName } from './lan'
import { log } from './log'
import { buildLog } from './logexport'
import { PairingServer } from './pairing'
import { openStudio, signIn } from './signin'
import { smokeStep } from './smoke'
import { storeRead, storeWrite, userDataFile, writeFileAtomic } from './store'
import { SyncServer } from './sync'
import { markQuitting, setThumbar, setTrayEnabled } from './tray'
import { checkUpdate, installUpdate } from './updates'
import { webPlayerSource } from './webplayer'
import { getMainWindow, setWindowMode, showMainWindow } from './windows'

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

async function requireSignedIn(): Promise<void> {
  if (!accounts.isSignedIn() || !(await AuthSession.isAuthenticated())) throw Errors.signedOut()
}

export interface ApiContext {
  smoke: boolean
  hidden: boolean
  cast: CastService
}

const FILE_FILTERS: Record<FileKind, Electron.FileFilter[]> = {
  json: [{ name: 'Thư viện DVDTube (JSON)', extensions: ['json'] }],
  txt: [{ name: 'Tệp văn bản', extensions: ['txt'] }],
}

function castDevice(value: unknown): CastDevice {
  const d = value as CastDevice | null
  if (!d || typeof d.host !== 'string' || typeof d.port !== 'number') throw new Error('Thiết bị không hợp lệ.')
  return d
}

/** Renderer warnings kept in the persistent log: at most 30 a minute. */
const rendererLogBudget = { minute: 0, count: 0 }

// MARK: Live chat

/** Tokens handed out by the chat endpoints (anything else comes from the watch page). */
const chatTokens = new Set<string>()

function rememberChatToken(token: string | null): void {
  if (!token) return
  if (chatTokens.size > 2000) chatTokens.clear()
  chatTokens.add(token)
}

async function liveChat(continuation: string, replay: boolean, offsetMs?: number): Promise<LiveChatPage> {
  // Like youtube.com, the first request opens the chat frame; later ones poll the API.
  const fromPage = !chatTokens.has(continuation)
  let json: JNode
  if (fromPage) {
    try {
      json = await innertube.liveChatPage(continuation, replay)
    } catch (error) {
      log.warn(`live chat page failed, trying the API: ${error instanceof Error ? error.message : String(error)}`)
      json = replay ? await innertube.liveChatReplay(continuation, offsetMs ?? 0) : await innertube.liveChat(continuation)
    }
  } else {
    json = replay ? await innertube.liveChatReplay(continuation, offsetMs ?? 0) : await innertube.liveChat(continuation)
  }
  const chunk = parseLiveChat(json)
  let next = chunk.continuation
  // The replay frame starts at 0:00: jump to the playback position with the seek token.
  if (replay && fromPage && chunk.seekContinuation && offsetMs !== undefined) {
    const lastOffset = chunk.messages[chunk.messages.length - 1]?.offsetMs ?? 0
    if (lastOffset < offsetMs - 10_000) next = chunk.seekContinuation
  }
  rememberChatToken(next)
  rememberChatToken(chunk.seekContinuation)
  return {
    messages: chunk.messages,
    continuation: next,
    timeoutMs: Math.min(Math.max(chunk.timeoutMs ?? 5000, 1000), 8000),
    sendParams: chunk.sendParams,
  }
}

// MARK: Notifications

async function notificationIcon(icon: string | null | undefined): Promise<Electron.NativeImage | undefined> {
  if (!icon || !/^https:\/\/([a-z0-9-]+\.)*(ytimg\.com|ggpht\.com|googleusercontent\.com)\//i.test(icon)) return undefined
  try {
    const response = await requestBytes(icon, { transport: 'plain', timeoutMs: 8000 })
    if (response.status !== 200) return undefined
    const image = nativeImage.createFromBuffer(Buffer.from(response.bytes))
    return image.isEmpty() ? undefined : image
  } catch {
    return undefined
  }
}

export function createApi(context: ApiContext): DvdApi {
  let pairing: PairingServer | null = null
  let sync: SyncServer | null = null
  const pendingSync = new Map<string, { resolve: (value: { merged: LibraryExport; summary: string }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let sleepBlocker: number | null = null
  let lastRemoteConfigUrl: string | null = null
  const dearrow = new DeArrow({
    load: () => {
      try {
        return readFileSync(userDataFile('dearrow-cache.json'), 'utf8')
      } catch {
        return null
      }
    },
    save: (text) => void writeFileAtomic(userDataFile('dearrow-cache.json'), text).catch(() => {}),
  })

  return {
    // App / configuration

    async appInfo() {
      return {
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        userDataPath: app.getPath('userData'),
        smoke: context.smoke,
        hidden: context.hidden,
        deviceName: deviceName(),
        arch: process.arch,
      }
    },

    async configure(config: CoreConfig) {
      if (!config || typeof config !== 'object') return
      coreState.hl = typeof config.language === 'string' && config.language ? config.language : 'vi'
      coreState.gl = typeof config.region === 'string' && config.region ? config.region : 'VN'
      coreState.incognito = !!config.incognito
      coreState.remoteConfigUrl = typeof config.remoteConfigUrl === 'string' ? config.remoteConfigUrl : ''
      coreState.restrictedMode = !!config.restrictedMode
      downloads.configureDownloads(
        config.downloadFolder ?? null,
        Number(config.downloadQuality) || 1080,
        !!config.downloadSubtitles,
        typeof config.captionLanguage === 'string' ? config.captionLanguage : null,
      )
      configureAutoDownload(config.autoDownload)
      if (!context.smoke) void context.cast.setReceiverEnabled(config.castReceiver !== false)
      setTrayEnabled(!!config.minimizeToTray || context.hidden)
      if (lastRemoteConfigUrl !== null && lastRemoteConfigUrl !== coreState.remoteConfigUrl) void refreshRemoteConfig()
      lastRemoteConfigUrl = coreState.remoteConfigUrl
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

    async player(id: string) {
      return service.player(videoId(id))
    },

    async watchInfo(id: string, playlistId?: string | null) {
      return service.watchInfo(videoId(id), optionalString(playlistId))
    },

    async comments(token: string) {
      return service.comments(str(token, 'Mã bình luận'))
    },

    async channel(id: string, tab?: ChannelTab) {
      return service.channel(str(id, 'Mã kênh'), tab && CHANNEL_TABS.includes(tab) ? tab : 'videos')
    },

    async channelTab(id: string, tab: ChannelTab, params?: string | null) {
      return service.channelTab(str(id, 'Mã kênh'), CHANNEL_TABS.includes(tab) ? tab : 'videos', optionalString(params))
    },

    async channelPosts(id: string, params?: string | null) {
      return service.channelPosts(str(id, 'Mã kênh'), optionalString(params))
    },

    async channelPostsMore(token: string) {
      return service.channelPostsMore(str(token, 'Mã trang'))
    },

    async channelAbout(id: string, aboutToken?: string | null, params?: string | null) {
      return service.channelAbout(str(id, 'Mã kênh'), optionalString(aboutToken), optionalString(params))
    },

    async channelSearch(id: string, query: string) {
      return service.channelSearch(str(id, 'Mã kênh'), str(query, 'Từ khóa'))
    },

    async playlist(id: string) {
      return service.playlist(str(id, 'Mã danh sách phát'))
    },

    async playlistVideos(id: string, limit?: number) {
      const max = typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), 5000) : 200
      return service.playlistVideos(str(id, 'Mã danh sách phát'), max)
    },

    async resolveLink(text: string) {
      if (typeof text !== 'string' || !text.trim()) return null
      return service.resolveLink(text.slice(0, 2000))
    },

    async latestVideos(channelIds: string[]) {
      if (!Array.isArray(channelIds)) return []
      return service.latestVideos(channelIds.filter((id): id is string => typeof id === 'string').slice(0, 500))
    },

    // Extras

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

    // Account

    async account() {
      return accounts.accountState()
    },

    async signIn(addAccount?: boolean) {
      return signIn(getMainWindow(), !!addAccount)
    },

    async signOut() {
      return accounts.signOut()
    },

    async switchIdentity(identityId: string) {
      return accounts.switchIdentity(str(identityId, 'Tài khoản'))
    },

    async accountFeed(kind) {
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

    async accountNotifications() {
      await requireSignedIn()
      return service.accountNotifications()
    },

    async unseenNotificationCount() {
      if (!accounts.isSignedIn()) return 0
      try {
        return await innertube.unseenNotificationCount()
      } catch {
        return 0
      }
    },

    async rate(id: string, action) {
      await requireSignedIn()
      const map = { like: 'like', dislike: 'dislike', remove: 'removelike' } as const
      if (!(action in map)) throw new Error('Thao tác không hợp lệ.')
      await innertube.like(videoId(id), map[action])
    },

    async subscribe(channelId: string, subscribe: boolean) {
      await requireSignedIn()
      await innertube.subscription(str(channelId, 'Mã kênh'), !!subscribe)
    },

    async playlistOptions(id: string) {
      await requireSignedIn()
      return service.accountPlaylistOptions(videoId(id))
    },

    async editPlaylist(playlistId: string, add?: string | null, remove?: string | null) {
      await requireSignedIn()
      const added = optionalString(add)
      const removed = optionalString(remove)
      if (!added && !removed) return
      await innertube.editPlaylist(str(playlistId, 'Mã danh sách phát'), added ? videoId(added) : null, removed ? videoId(removed) : null)
    },

    async createPlaylist(title: string, video?: string | null) {
      await requireSignedIn()
      const id = optionalString(video)
      const json = await innertube.createPlaylist(str(title, 'Tên danh sách phát').slice(0, 150), id ? videoId(id) : null)
      return json.get('playlistId').string ?? json.findFirst('playlistId').string
    },

    async postComment(text: string, params: string) {
      await requireSignedIn()
      const json = await innertube.createComment(str(text, 'Bình luận').slice(0, 10_000), str(params, 'Tham số'))
      return parseCreatedComment(json)
    },

    async postReply(text: string, params: string) {
      await requireSignedIn()
      const json = await innertube.createReply(str(text, 'Phản hồi').slice(0, 10_000), str(params, 'Tham số'))
      return parseCreatedComment(json)
    },

    async commentAction(token: string) {
      await requireSignedIn()
      await innertube.performCommentAction(str(token, 'Thao tác'))
    },

    async markWatched(id: string, duration: number) {
      if (coreState.incognito || !accounts.isSignedIn()) return
      await innertube.markWatched(videoId(id), typeof duration === 'number' && Number.isFinite(duration) ? duration : 0)
    },

    // Live chat

    async liveChat(continuation: string, replay: boolean, offsetMs?: number) {
      return liveChat(str(continuation, 'Mã trò chuyện'), !!replay, typeof offsetMs === 'number' && Number.isFinite(offsetMs) ? offsetMs : undefined)
    },

    async sendLiveChat(text: string, params: string) {
      await requireSignedIn()
      await innertube.sendLiveChatMessage(str(text, 'Tin nhắn').slice(0, 200), str(params, 'Tham số'))
    },

    // Sign in from the phone

    async startPairing(): Promise<PairingInfo> {
      pairing?.stop()
      const server = new PairingServer({
        signIn: (cookies) => accounts.completePairing(cookies),
        onStatus: (status) => {
          emit('pairing', status)
          if (status.state === 'success') showMainWindow()
        },
        log: (message) => log.info(message),
      })
      pairing = server
      return server.start()
    },

    async stopPairing() {
      pairing?.stop()
      pairing = null
    },

    // Downloads

    async download(video: VideoItem, options: { audioOnly: boolean; quality?: number | null }) {
      downloads.startDownload(video, { audioOnly: !!options?.audioOnly, quality: typeof options?.quality === 'number' ? options.quality : null })
    },

    async cancelDownload(id: string) {
      downloads.cancelDownload(videoId(id))
    },

    async deleteDownload(id: string) {
      await downloads.deleteDownload(videoId(id))
    },

    async downloads() {
      const list = downloads.listDownloads()
      setTimeout(downloads.replayStates, 50)
      return list
    },

    async downloadFileUrl(id: string) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null
      return downloads.downloadFileUrl(id)
    },

    async showDownload(id: string) {
      downloads.showDownload(videoId(id))
    },

    async chooseDownloadFolder() {
      return downloads.chooseDownloadFolder(getMainWindow())
    },

    // Renderer-owned state

    async storeRead(name: string) {
      return storeRead(name)
    },

    async storeWrite(name: string, data: unknown) {
      await storeWrite(name, data)
    },

    // System integration

    async openExternal(url: string) {
      if (typeof url !== 'string' || !/^(https?|mailto):/i.test(url)) throw new Error('Liên kết không hợp lệ.')
      await shell.openExternal(url)
    },

    async setWindowMode(mode) {
      if (!['normal', 'fullscreen', 'mini', 'alwaysOnTop'].includes(mode)) return
      setWindowMode(mode)
    },

    async setThumbar(state, title) {
      if (!state || typeof state !== 'object') return
      setThumbar({ playing: !!state.playing, hasPrevious: !!state.hasPrevious, hasNext: !!state.hasNext }, optionalString(title))
    },

    async notify(title: string, body: string, link?: string | null, icon?: string | null) {
      if (!Notification.isSupported()) return
      const notification = new Notification({
        title: String(title ?? 'DVDTube').slice(0, 200),
        body: String(body ?? '').slice(0, 500),
        icon: (await notificationIcon(icon)) ?? undefined,
        silent: false,
      })
      const target = optionalString(link)
      notification.on('click', () => {
        showMainWindow()
        if (target) emit('openLink', target)
      })
      notification.show()
    },

    async checkUpdate() {
      return checkUpdate()
    },

    async openStudio() {
      await requireSignedIn()
      openStudio()
    },

    async setStartWithWindows(enabled: boolean) {
      // Login items exist on Windows and macOS only.
      if (context.smoke || !app.isPackaged || (process.platform !== 'win32' && process.platform !== 'darwin')) return
      app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] })
    },

    async setPreventSleep(enabled: boolean) {
      if (enabled && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
      else if (!enabled && sleepBlocker !== null) {
        if (powerSaveBlocker.isStarted(sleepBlocker)) powerSaveBlocker.stop(sleepBlocker)
        sleepBlocker = null
      }
    },

    async smokeStep(step) {
      await smokeStep(step)
    },

    async showWindow() {
      showMainWindow()
    },

    async installUpdate(info) {
      await installUpdate(info, (progress) => emit('updateProgress', progress), () => {
        markQuitting()
        app.quit()
      })
    },

    async setRecentVideos(videos) {
      setRecentVideos(videos, (link) => {
        showMainWindow()
        emit('openLink', link)
      })
    },

    // Files

    async saveTextFile(defaultName: string, text: string, kind: FileKind) {
      if (typeof text !== 'string') throw new Error('Dữ liệu không hợp lệ.')
      const name = basename(String(defaultName || 'DVDTube.txt')).replace(/[/\\?%*|"<>:]/g, '-')
      const options: Electron.SaveDialogOptions = {
        title: kind === 'json' ? 'Xuất thư viện' : 'Lưu nhật ký lỗi',
        defaultPath: join(app.getPath('documents'), name),
        filters: FILE_FILTERS[kind] ?? FILE_FILTERS.txt,
      }
      const parent = getMainWindow()
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, text, 'utf8')
      return result.filePath
    },

    async openTextFile(kind: FileKind) {
      const options: Electron.OpenDialogOptions = {
        title: kind === 'json' ? 'Nhập thư viện' : 'Mở tệp',
        properties: ['openFile'],
        filters: FILE_FILTERS[kind] ?? FILE_FILTERS.txt,
      }
      const parent = getMainWindow()
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file) return null
      if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error('Tệp quá lớn.')
      return { name: basename(file), text: await readFile(file, 'utf8') }
    },

    async showFile(path: string) {
      if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path)
    },

    // Error log

    async buildLog(logContext) {
      return buildLog(logContext)
    },

    async logRenderer(level, message) {
      const minute = Math.floor(Date.now() / 60_000)
      if (rendererLogBudget.minute !== minute) {
        rendererLogBudget.minute = minute
        rendererLogBudget.count = 0
      }
      if (++rendererLogBudget.count > 30) return
      const text = `renderer: ${String(message).slice(0, 1000).replace(/[\r\n]+/g, ' ')}`
      if (level === 'error') log.error(text)
      else log.warn(text)
    },

    // Cast to DVDTube

    async castDevices() {
      return context.cast.devices()
    },

    async castScan() {
      await context.cast.scan()
    },

    async castAddDevice(address: string) {
      return context.cast.addManual(str(address, 'Địa chỉ').slice(0, 100))
    },

    async castForgetDevice(id: string) {
      context.cast.forget(str(id, 'Thiết bị'))
    },

    async castPlay(device, request) {
      const video = cleanVideoItem(request?.video)
      if (!video) throw new Error('Video không hợp lệ.')
      const queue = Array.isArray(request.queue) ? request.queue.map(cleanVideoItem).filter((v): v is NonNullable<typeof v> => v !== null).slice(0, 500) : null
      await context.cast.play(castDevice(device), {
        video,
        startSeconds: typeof request.startSeconds === 'number' && request.startSeconds > 0 ? request.startSeconds : null,
        queue,
        index: typeof request.index === 'number' ? request.index : null,
        playlistId: optionalString(request.playlistId),
        sender: deviceName(),
      })
    },

    async castQueue(device, video, next) {
      const item = cleanVideoItem(video)
      if (!item) throw new Error('Video không hợp lệ.')
      await context.cast.queue(castDevice(device), item, !!next)
    },

    async castControl(device, action: CastAction, value?: number | null) {
      if (!CAST_ACTIONS.includes(action)) throw new Error('Lệnh điều khiển không hợp lệ.')
      await context.cast.control(castDevice(device), action, typeof value === 'number' && Number.isFinite(value) ? value : null)
    },

    async castStatus(device) {
      return context.cast.remoteStatus(castDevice(device))
    },

    async castReceiverStatus(status) {
      context.cast.setStatus(status)
    },

    // Library sync (receiving side)

    async startSyncReceiver(): Promise<SyncInfo> {
      sync?.stop()
      const server = new SyncServer({
        merge: (library, device) =>
          new Promise((resolve, reject) => {
            const requestId = randomUUID()
            const timer = setTimeout(() => {
              pendingSync.delete(requestId)
              reject(new Error('Máy tính không gộp kịp thư viện. Vui lòng thử lại.'))
            }, 30_000)
            pendingSync.set(requestId, { resolve, reject, timer })
            emit('syncIncoming', { requestId, device, library })
          }),
        onStatus: (status) => emit('syncStatus', status),
        log: (message) => log.info(message),
      })
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

    async musicSearch(query: string, kind, continuation?: string | null) {
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

    // DeArrow

    async dearrow(videoIds: string[]) {
      if (!Array.isArray(videoIds)) return {}
      const ids = videoIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id)).slice(0, 200)
      return dearrow.branding(ids)
    },

    // Automatic downloads

    async runAutoDownloads() {
      await runAutoDownloads()
    },

    // Web player fallback

    async webPlayerSource(id: string, startSeconds: number, loop: boolean) {
      const start = typeof startSeconds === 'number' && Number.isFinite(startSeconds) ? startSeconds : 0
      return webPlayerSource(videoId(id), start, !!loop, accounts.isSignedIn() && !coreState.incognito)
    },
  }
}
