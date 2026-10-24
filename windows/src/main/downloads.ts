// Offline downloads (port of `DownloadManager.kt`): one at a time from a queue, the H.264 video
// (≤ the download quality) + AAC audio streams fetched in 10 MB `&range=` chunks, then merged into
// a regular `.mp4` by the TypeScript muxer; "audio only" keeps just the AAC track as `.m4a`.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { formatDuration, type DownloadState, type DownloadedVideo, type PlayerInfo, type StreamFormat, type VideoItem } from '@shared/models'
import { describeError, Errors, isCoreError } from './core/errors'
import { requestBytes } from './core/http'
import { player } from './core/innertube'
import { bestAudio, bestVideo } from './core/parsers/player'
import { emit } from './ipc'
import { log } from './log'
import { muxMp4 } from './mp4mux'
import { streamHeaders } from './net'
import { readJson, userDataFile, writeJson } from './store'

interface Job {
  video: VideoItem
  audioOnly: boolean
  quality: number | null
  controller: AbortController
}

const CHUNK = 10 * 1024 * 1024

let entries: DownloadedVideo[] = []
const queue: Job[] = []
let running: Job | null = null
const states = new Map<string, DownloadState>()
/** The videos of unfinished downloads (sent with every event). */
const videos = new Map<string, VideoItem>()
let folderSetting: string | null = null
let qualitySetting = 1080

function indexFile(): string {
  return userDataFile('downloads.json')
}

export function configureDownloads(folder: string | null, quality: number): void {
  folderSetting = folder && folder.trim() ? folder : null
  qualitySetting = quality > 0 ? quality : 1080
}

export function defaultDownloadFolder(): string {
  return join(app.getPath('videos'), 'DVDTube')
}

export async function initDownloads(): Promise<void> {
  const saved = (await readJson<DownloadedVideo[]>(indexFile())) ?? []
  entries = Array.isArray(saved) ? saved.filter((e) => e && e.video && typeof e.filePath === 'string' && existsSync(e.filePath)) : []
}

function save(): void {
  void writeJson(indexFile(), entries).catch((error) => log.warn(`downloads: index not saved (${describeError(error)})`))
}

function setState(videoId: string, status: DownloadState): void {
  const video = status.state === 'done' ? status.entry.video : (videos.get(videoId) ?? null)
  if (status.state === 'done' || status.state === 'cancelled') {
    states.delete(videoId)
    videos.delete(videoId)
  } else {
    states.set(videoId, status)
  }
  emit('download', { videoId, status, video })
}

export function listDownloads(): DownloadedVideo[] {
  entries = entries.filter((e) => existsSync(e.filePath))
  return entries
}

/** Re-sends the state of every unfinished download (the downloads page may have been reloaded). */
export function replayStates(): void {
  for (const [videoId, status] of states) emit('download', { videoId, status, video: videos.get(videoId) ?? null })
}

export function downloadEntry(videoId: string): DownloadedVideo | null {
  return entries.find((e) => e.video.id === videoId && existsSync(e.filePath)) ?? null
}

export function downloadFileUrl(videoId: string): string | null {
  const entry = downloadEntry(videoId)
  return entry ? pathToFileURL(entry.filePath).href : null
}

export function showDownload(videoId: string): void {
  const entry = downloadEntry(videoId)
  if (entry) shell.showItemInFolder(entry.filePath)
}

export async function chooseDownloadFolder(parent: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: 'Chọn thư mục tải xuống',
    defaultPath: folderSetting ?? defaultDownloadFolder(),
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

function isBusy(videoId: string): boolean {
  return running?.video.id === videoId || queue.some((j) => j.video.id === videoId)
}

export function startDownload(video: VideoItem, options: { audioOnly: boolean; quality?: number | null }): void {
  if (!video || typeof video.id !== 'string' || !/^[A-Za-z0-9_-]{6,20}$/.test(video.id)) throw new Error('Video không hợp lệ.')
  if (isBusy(video.id)) return
  const existing = downloadEntry(video.id)
  if (existing && existing.isAudioOnly === !!options.audioOnly) {
    setState(video.id, { state: 'done', entry: existing })
    return
  }
  if (video.isLive) throw new Error('Không thể tải xuống video trực tiếp.')
  videos.set(video.id, video)
  queue.push({ video, audioOnly: !!options.audioOnly, quality: options.quality ?? null, controller: new AbortController() })
  setState(video.id, { state: 'queued' })
  void drain()
}

export function cancelDownload(videoId: string): void {
  const index = queue.findIndex((j) => j.video.id === videoId)
  if (index >= 0) {
    queue.splice(index, 1)
    setState(videoId, { state: 'cancelled' })
  }
  if (running?.video.id === videoId) running.controller.abort()
  else if (states.get(videoId)?.state === 'failed') setState(videoId, { state: 'cancelled' })
}

export async function deleteDownload(videoId: string): Promise<void> {
  cancelDownload(videoId)
  const entry = entries.find((e) => e.video.id === videoId)
  if (entry) await rm(entry.filePath, { force: true }).catch(() => {})
  entries = entries.filter((e) => e.video.id !== videoId)
  save()
}

async function drain(): Promise<void> {
  if (running) return
  while (queue.length > 0) {
    const job = queue.shift()!
    running = job
    try {
      await run(job)
    } finally {
      running = null
    }
  }
}

function sanitize(title: string): string {
  return title
    .replace(/[/\\?%*|"<>:\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
}

function fileName(video: VideoItem, extension: string): string {
  const title = sanitize(video.title)
  return (title ? `${title} [${video.id}]` : video.id) + '.' + extension
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(Errors.cancelled())
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(Errors.cancelled())
    }, { once: true })
  })
}

function withRange(url: string, start: number, end: number): string {
  const parsed = new URL(url)
  parsed.searchParams.delete('range')
  parsed.searchParams.set('range', `${start}-${end}`)
  return parsed.toString()
}

/** Downloads in 10 MB `range=` chunks (googlevideo throttles single large requests), 3 retries each. */
async function fetchFormat(format: StreamFormat, destination: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
  const length = format.contentLength ?? 0
  const out = await open(destination, 'w')
  try {
    let offset = 0
    let failures = 0
    for (;;) {
      if (signal.aborted) throw Errors.cancelled()
      if (length > 0 && offset >= length) break
      const end = length > 0 ? Math.min(offset + CHUNK, length) - 1 : offset + CHUNK - 1
      const requested = end - offset + 1
      try {
        const response = await requestBytes(withRange(format.url, offset, end), {
          transport: 'plain',
          headers: streamHeaders(format.url),
          timeoutMs: 90_000,
          retry: false,
          signal,
        })
        if (response.status === 416 && length <= 0 && offset > 0) break
        if (response.status < 200 || response.status > 299) throw Errors.http(response.status)
        if (response.bytes.length === 0) {
          if (length <= 0 && offset > 0) break
          throw Errors.invalidResponse()
        }
        await out.write(response.bytes, 0, response.bytes.length, offset)
        offset += response.bytes.length
        failures = 0
        progress(offset)
        // Unknown length: a short chunk is the last one.
        if (length <= 0 && response.bytes.length < requested) break
      } catch (error) {
        if (isCoreError(error, 'cancelled') || signal.aborted) throw Errors.cancelled()
        failures++
        if (failures > 3) throw error
        log.warn(`download chunk failed (${describeError(error)}), retry ${failures}`)
        await wait(failures * 1000, signal)
      }
    }
  } finally {
    await out.close()
  }
}

function enrich(video: VideoItem, info: PlayerInfo): VideoItem {
  const item: VideoItem = { ...video }
  if (!item.title) item.title = info.title
  item.channelName = item.channelName ?? info.author ?? null
  item.channelId = item.channelId ?? info.channelId ?? null
  item.thumbnail = item.thumbnail ?? info.thumbnail ?? null
  if (item.durationSeconds == null && info.lengthSeconds != null) {
    item.durationSeconds = info.lengthSeconds
    item.durationText = formatDuration(info.lengthSeconds)
  }
  return item
}

async function run(job: Job): Promise<void> {
  const { video, audioOnly, controller } = job
  const signal = controller.signal
  const temp = userDataFile('downloads-tmp', `${video.id}-${randomBytes(3).toString('hex')}`)
  let lastEmit = 0
  const report = (fraction: number) => {
    const now = Date.now()
    if (now - lastEmit < 250 && fraction < 1) return
    lastEmit = now
    setState(video.id, { state: 'downloading', progress: Math.max(0, Math.min(1, fraction)) })
  }
  try {
    setState(video.id, { state: 'preparing' })
    const info = await player(video.id)
    if (info.isLive) throw new Error('Không thể tải xuống video trực tiếp.')
    const waitMs = info.availableAt - Date.now()
    if (waitMs > 0) await wait(waitMs, signal)

    const item = enrich(video, info)
    videos.set(video.id, item)
    const folder = folderSetting ?? defaultDownloadFolder()
    await mkdir(folder, { recursive: true })
    await mkdir(temp, { recursive: true })
    const output = join(folder, fileName(item, audioOnly ? 'm4a' : 'mp4'))
    await rm(output, { force: true })
    const maxHeight = job.quality && job.quality > 0 ? job.quality : qualitySetting
    // itag 140 (AAC 128 kbps) in the original language plays everywhere.
    const audio = info.adaptiveFormats.find((f) => f.itag === 140 && f.isDefaultAudio) ?? bestAudio(info)
    let qualityLabel: string | null

    if (audioOnly) {
      if (!audio) throw Errors.noStreams()
      const raw = join(temp, 'audio.m4a')
      const total = Math.max(audio.contentLength ?? 1, 1)
      await fetchFormat(audio, raw, signal, (done) => report(done / total))
      setState(video.id, { state: 'merging' })
      try {
        await muxMp4([raw], output, { audioOnly: true, signal })
      } catch (error) {
        if (signal.aborted) throw Errors.cancelled()
        log.warn(`downloads: audio remux failed (${describeError(error)}), keeping the DASH file`)
        await copyFile(raw, output)
      }
      qualityLabel = `Âm thanh ${Math.round(audio.bitrate / 1000)} kbps`
    } else {
      const videoFormat = bestVideo(info, maxHeight)
      if (videoFormat && audio) {
        const videoFile = join(temp, 'video.mp4')
        const audioFile = join(temp, 'audio.m4a')
        const videoLength = videoFormat.contentLength ?? 0
        const total = Math.max(videoLength + (audio.contentLength ?? 0), 1)
        await fetchFormat(videoFormat, videoFile, signal, (done) => report(done / total))
        await fetchFormat(audio, audioFile, signal, (done) => report((videoLength + done) / total))
        setState(video.id, { state: 'merging' })
        await muxMp4([videoFile, audioFile], output, { signal })
        qualityLabel = videoFormat.qualityLabel ?? (videoFormat.height ? `${videoFormat.height}p` : null)
      } else {
        const muxed = [...info.muxedFormats].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
        if (!muxed) {
          throw new Error(info.hlsUrl ? 'Video này chỉ có luồng phát trực tuyến (HLS), không tải xuống được.' : Errors.noStreams().message)
        }
        const total = Math.max(muxed.contentLength ?? 1, 1)
        await fetchFormat(muxed, output, signal, (done) => report(done / total))
        qualityLabel = muxed.qualityLabel ?? null
      }
    }

    const size = (await stat(output)).size
    const entry: DownloadedVideo = {
      video: item,
      fileName: output.split(/[\\/]/).pop() ?? output,
      filePath: output,
      fileSize: size,
      qualityLabel,
      downloadedAt: Date.now(),
      isAudioOnly: audioOnly,
    }
    // A video downloaded again in the other mode (video ↔ audio) replaces the previous file.
    for (const previous of entries.filter((e) => e.video.id === video.id && e.filePath !== output)) {
      await rm(previous.filePath, { force: true }).catch(() => {})
    }
    entries = [entry, ...entries.filter((e) => e.video.id !== video.id)]
    save()
    log.info(`downloads: finished ${video.id} (${Math.round(size / 1024)} KB)`)
    setState(video.id, { state: 'done', entry })
  } catch (error) {
    if (signal.aborted || isCoreError(error, 'cancelled')) {
      setState(video.id, { state: 'cancelled' })
    } else {
      log.warn(`downloads: ${video.id} failed: ${describeError(error)}`)
      setState(video.id, { state: 'failed', message: describeError(error) || 'Lỗi tải xuống' })
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}
