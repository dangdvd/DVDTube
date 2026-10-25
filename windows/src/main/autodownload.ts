// "Tự động tải video mới": every hour while the app runs (also hidden in the tray), the newest
// uploads of the picked channels (RSS, like the subscriptions feed) are downloaded with the
// download quality setting — no Shorts, live or upcoming videos, nothing already downloaded or
// tried before. Afterwards only the newest N automatic downloads of each channel are kept
// (manual downloads are never removed).

import type { AutoDownloadSettings } from '@shared/settings'
import { candidates, surplus, unmeteredNetwork } from './core/autopick'
import { describeError } from './core/errors'
import { latestVideos } from './core/services'
import { allDownloads, deleteDownload, downloadEntry, isBusy, onDownloadEnded, startDownload } from './downloads'
import { log } from './log'
import { readJsonSync, userDataFile, writeJson } from './store'

const HOUR = 60 * 60_000
const FIRST_RUN_DELAY = 2 * 60_000
const RETRY_FAILED_AFTER = 12 * HOUR
const MAX_ATTEMPTS = 3

interface Attempt {
  at: number
  state: 'started' | 'done' | 'failed'
  attempts: number
}

let settings: AutoDownloadSettings = { enabled: false, channels: [], keep: 3, wifiOnly: true, audioOnly: false }
let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let attempts: Record<string, Attempt> = {}
let loaded = false

function stateFile(): string {
  return userDataFile('auto-downloads.json')
}

function loadAttempts(): void {
  if (loaded) return
  loaded = true
  const saved = readJsonSync<{ attempts?: Record<string, Attempt> }>(stateFile())
  attempts = saved?.attempts && typeof saved.attempts === 'object' ? saved.attempts : {}
}

function saveAttempts(): void {
  // Old entries are of no use once the videos left the channels' feeds.
  const cutoff = Date.now() - 60 * 24 * HOUR
  for (const [id, a] of Object.entries(attempts)) if (a.at < cutoff) delete attempts[id]
  void writeJson(stateFile(), { attempts }).catch(() => {})
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!settings.enabled || settings.channels.length === 0) return
  timer = setTimeout(() => {
    timer = null
    void runAutoDownloads().finally(() => schedule(HOUR))
  }, delay)
  timer.unref?.()
}

export function configureAutoDownload(next: AutoDownloadSettings | null | undefined): void {
  const before = JSON.stringify(settings)
  settings = {
    enabled: !!next?.enabled,
    channels: Array.isArray(next?.channels) ? next!.channels.filter((c) => c && typeof c.id === 'string' && c.id).slice(0, 200) : [],
    keep: Math.min(Math.max(Math.floor(Number(next?.keep) || 3), 1), 50),
    wifiOnly: next?.wifiOnly !== false,
    audioOnly: !!next?.audioOnly,
  }
  if (JSON.stringify(settings) !== before) schedule(running ? HOUR : FIRST_RUN_DELAY)
}

export async function runAutoDownloads(): Promise<void> {
  if (running || !settings.enabled || settings.channels.length === 0) return
  if (settings.wifiOnly && !unmeteredNetwork()) {
    log.info('auto downloads: skipped (no Wi-Fi / wired connection)')
    return
  }
  running = true
  loadAttempts()
  try {
    const ids = settings.channels.map((c) => c.id)
    const videos = await latestVideos(ids)
    let started = 0
    const now = Date.now()
    for (const channelId of ids) {
      for (const video of candidates(videos, channelId, settings.keep, now)) {
        if (downloadEntry(video.id) || isBusy(video.id)) continue
        const previous = attempts[video.id]
        if (previous && (previous.state !== 'failed' || previous.attempts >= MAX_ATTEMPTS || now - previous.at < RETRY_FAILED_AFTER)) continue
        try {
          startDownload(video, { audioOnly: settings.audioOnly, auto: true })
          attempts[video.id] = { at: now, state: 'started', attempts: (previous?.attempts ?? 0) + 1 }
          started++
        } catch (error) {
          attempts[video.id] = { at: now, state: 'failed', attempts: (previous?.attempts ?? 0) + 1 }
          log.warn(`auto downloads: ${video.id} not started (${describeError(error)})`)
        }
      }
    }
    saveAttempts()
    log.info(`auto downloads: ${started} new video(s) from ${ids.length} channel(s)`)
    if (started === 0) await cleanup()
  } catch (error) {
    log.warn(`auto downloads failed: ${describeError(error)}`)
  } finally {
    running = false
  }
}

async function cleanup(): Promise<void> {
  const entries = allDownloads()
  for (const channel of settings.channels) {
    for (const old of surplus(entries, channel.id, settings.keep)) {
      log.info(`auto downloads: removing an older automatic download of ${channel.id}`)
      await deleteDownload(old.video.id).catch(() => {})
    }
  }
}

export function initAutoDownloads(): void {
  onDownloadEnded((videoId, status) => {
    const attempt = attempts[videoId]
    if (!attempt) return
    // Cancelled by the user: not tried again.
    attempt.state = status.state === 'failed' ? 'failed' : 'done'
    attempt.at = Date.now()
    saveAttempts()
    if (status.state === 'done' && status.entry.isAuto) void cleanup()
  })
}
