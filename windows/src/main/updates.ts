// "Cập nhật": the latest GitHub release vs. the running version (CI sets it to 1.0.<run number>).
// Installed with the Windows installer: "Cập nhật ngay" downloads `DVDTube-Setup.exe` to the temp
// folder and runs it silently (`/S --force-run`, the NSIS installer of electron-builder), then
// quits. Portable zip / macOS / Linux: the download link of the matching asset is opened.

import { spawn } from 'node:child_process'
import { open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, net } from 'electron'
import type { UpdateInfo, UpdateProgress } from '@shared/api'
import { requestText } from './core/http'
import { installKind, updateFrom, type Release } from './core/versions'

export { compareVersions } from './core/versions'

const RELEASES_URL = 'https://api.github.com/repos/dangdvd/DVDTube/releases/latest'

export async function checkUpdate(): Promise<UpdateInfo | null> {
  let response
  try {
    response = await requestText(RELEASES_URL, {
      transport: 'plain',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      timeoutMs: 15_000,
    })
  } catch {
    throw new Error('Không kiểm tra được bản cập nhật. Kiểm tra mạng và thử lại.')
  }
  if (response.status === 404) return null
  if (response.status !== 200) throw new Error(`Không kiểm tra được bản cập nhật (HTTP ${response.status}).`)
  let release: Release
  try {
    release = JSON.parse(response.text)
  } catch {
    throw new Error('Không kiểm tra được bản cập nhật.')
  }
  return updateFrom(release, app.getVersion(), installKind())
}

function trustedDownload(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com'))
  } catch {
    return false
  }
}

let installing = false

/** Downloads the installer (with progress) and runs it silently; the app quits right after. */
export async function installUpdate(info: UpdateInfo, progress: (p: UpdateProgress) => void, quit: () => void): Promise<void> {
  if (process.platform !== 'win32' || installKind() !== 'nsis') throw new Error('Bản cài đặt này không tự cập nhật được. Hãy tải bản mới từ trang phát hành.')
  if (!info?.downloadUrl || !trustedDownload(info.downloadUrl)) throw new Error('Liên kết tải bản cập nhật không hợp lệ.')
  if (installing) return
  installing = true
  const file = join(tmpdir(), `DVDTube-Setup-${String(info.version).replace(/[^0-9.]/g, '')}.exe`)
  try {
    const response = await net.fetch(info.downloadUrl)
    if (!response.ok || !response.body) throw new Error(`Không tải được bản cập nhật (HTTP ${response.status}).`)
    const total = info.size ?? (Number(response.headers.get('content-length')) || 0)
    const out = await open(file, 'w')
    let received = 0
    let lastReport = 0
    try {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await out.write(value)
        received += value.length
        const now = Date.now()
        if (total > 0 && now - lastReport > 250) {
          lastReport = now
          progress({ state: 'downloading', progress: Math.min(1, received / total) })
        }
      }
    } finally {
      await out.close()
    }
    if (received === 0 || (info.size && received !== info.size)) throw new Error('Tệp cập nhật tải về không đầy đủ. Vui lòng thử lại.')
    progress({ state: 'installing' })
    const child = spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    setTimeout(quit, 800)
  } catch (error) {
    installing = false
    await rm(file, { force: true }).catch(() => {})
    const message = error instanceof Error && /[à-ỹ]/i.test(error.message) ? error.message : 'Không tải được bản cập nhật. Kiểm tra mạng và thử lại.'
    progress({ state: 'failed', message })
    throw new Error(message)
  }
}
