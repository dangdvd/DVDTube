// "Đồng bộ & sao lưu": export / import of the library file (`DVDTube-thu-vien-YYYYMMDD.json`)
// and the merge of a library a phone sends over the local network (the main process runs the
// encrypted endpoint; the merge happens here because the library lives here).

import { create } from 'zustand'
import type { SyncInfo, SyncStatus } from '@shared/api'
import {
  libraryFileName,
  makeLibraryExport,
  mergeLibraries,
  mergeSummaryText,
  parseLibraryExport,
  platformName,
  type LibraryContent,
  type LibraryExport,
} from '@shared/library'
import { MAX_HISTORY, useLibrary } from '@/state/library'
import { api, errorMessage, onEvent } from './api'
import { toast } from './toast'

let device: { name: string; platform: string } | null = null

async function thisDevice(): Promise<{ name: string; platform: string }> {
  if (!device) {
    const info = await api.appInfo().catch(() => null)
    device = { name: info?.deviceName || 'Máy tính', platform: info?.platform ?? 'win32' }
  }
  return device
}

export function libraryContent(): LibraryContent {
  const l = useLibrary.getState()
  return { subscriptions: l.subscriptions, history: l.history, watchLater: l.watchLater, liked: l.liked, playlists: l.playlists, searchHistory: l.searchHistory }
}

export async function libraryExport(): Promise<LibraryExport> {
  const d = await thisDevice()
  return makeLibraryExport(libraryContent(), d.name, platformName(d.platform))
}

/** Merges another device's library into ours; returns the summary text. */
export function mergeIntoLibrary(remote: LibraryExport): string {
  const result = mergeLibraries(libraryContent(), remote, MAX_HISTORY)
  useLibrary.getState().applySync(result.library, result.progress)
  return mergeSummaryText(result.added)
}

export async function exportLibraryFile(): Promise<void> {
  try {
    const path = await api.saveTextFile(libraryFileName(), JSON.stringify(await libraryExport(), null, 1), 'json')
    if (path) toast('Đã xuất thư viện', { action: { label: 'Mở thư mục', run: () => void api.showFile(path) } })
  } catch (error) {
    toast('Không xuất được thư viện: ' + errorMessage(error))
  }
}

export async function importLibraryFile(): Promise<void> {
  try {
    const file = await api.openTextFile('json')
    if (!file) return
    let parsed: LibraryExport | null = null
    try {
      parsed = parseLibraryExport(JSON.parse(file.text))
    } catch {
      parsed = null
    }
    if (!parsed) {
      toast('Tệp này không phải thư viện DVDTube.')
      return
    }
    toast(mergeIntoLibrary(parsed), { durationMs: 6000 })
  } catch (error) {
    toast('Không nhập được thư viện: ' + errorMessage(error))
  }
}

// MARK: LAN sync (this computer shows the QR code)

interface SyncDialogStore {
  open: boolean
  info: SyncInfo | null
  status: SyncStatus | null
  error: string | null
  start(): Promise<void>
  close(): void
}

export const useSyncDialog = create<SyncDialogStore>((set) => ({
  open: false,
  info: null,
  status: null,
  error: null,
  async start() {
    set({ open: true, info: null, status: null, error: null })
    try {
      const info = await api.startSyncReceiver()
      set({ info })
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },
  close() {
    set({ open: false, info: null, status: null, error: null })
    api.stopSyncReceiver().catch(() => {})
  },
}))

let started = false

export function startSyncListener(): void {
  if (started) return
  started = true
  onEvent('syncStatus', (status) => {
    useSyncDialog.setState({ status })
    if (status.state === 'success') toast(`Đồng bộ với ${status.device}: ${status.summary}`, { durationMs: 7000 })
  })
  onEvent('syncIncoming', (incoming) => {
    void (async () => {
      try {
        const summary = mergeIntoLibrary(incoming.library)
        await api.syncReply(incoming.requestId, await libraryExport(), summary)
      } catch (error) {
        await api.syncReply(incoming.requestId, null, errorMessage(error)).catch(() => {})
      }
    })()
  })
}
