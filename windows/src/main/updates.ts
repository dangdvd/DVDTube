// "Kiểm tra cập nhật": the latest GitHub release vs. the running version (CI sets it to
// 1.0.<run number>); the Windows installer asset is `DVDTube-Setup.exe`.

import { app } from 'electron'
import type { UpdateInfo } from '@shared/api'
import { requestText } from './core/http'

const RELEASES_URL = 'https://api.github.com/repos/dangdvd/DVDTube/releases/latest'

/** Compares dotted versions ("1.0.42" vs "v1.0.7"); positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((part) => parseInt(part, 10) || 0)
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

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
  let release: { tag_name?: string; html_url?: string; body?: string; assets?: { name?: string; browser_download_url?: string }[] }
  try {
    release = JSON.parse(response.text)
  } catch {
    throw new Error('Không kiểm tra được bản cập nhật.')
  }
  const version = (release.tag_name ?? '').replace(/^v/i, '')
  if (!version || compareVersions(version, app.getVersion()) <= 0) return null
  const installer = release.assets?.find((asset) => asset.name === 'DVDTube-Setup.exe')
  return {
    version,
    url: release.html_url ?? 'https://github.com/dangdvd/DVDTube/releases/latest',
    notes: release.body ?? null,
    downloadUrl: installer?.browser_download_url ?? null,
  }
}
