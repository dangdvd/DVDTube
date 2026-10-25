// Versions and release assets of "Cập nhật" (no Electron here, so it can be unit tested). CI
// sets the app version to 1.0.<run number>; a development build ("1.0", "1.0.0") is older than
// any release.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { UpdateInfo } from '@shared/api'

const RELEASE_PAGE = 'https://github.com/dangdvd/DVDTube/releases/latest'

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

export type InstallKind = 'nsis' | 'portable' | 'mac' | 'appimage' | 'deb'

/** How this copy was installed (decides which release asset matches). */
export function installKind(platform = process.platform, execPath = process.execPath, env = process.env): InstallKind {
  if (platform === 'darwin') return 'mac'
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'deb'
  // electron-builder's NSIS installer puts its uninstaller next to the exe; the zip has none.
  return existsSync(join(dirname(execPath), 'Uninstall DVDTube.exe')) ? 'nsis' : 'portable'
}

/** Release asset names (the same names the CI uploads). */
export function assetName(kind: InstallKind, arch = process.arch): string {
  switch (kind) {
    case 'nsis':
      return 'DVDTube-Setup.exe'
    case 'portable':
      return 'DVDTube-Windows-portable.zip'
    case 'mac':
      return `DVDTube-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`
    case 'appimage':
      return 'DVDTube-linux-x86_64.AppImage'
    case 'deb':
      return 'DVDTube-linux-amd64.deb'
  }
}

export interface Release {
  tag_name?: string
  html_url?: string
  body?: string
  assets?: { name?: string; browser_download_url?: string; size?: number }[]
}

/** The update offered by `release` for this installation, or null when it is not newer. */
export function updateFrom(release: Release, currentVersion: string, kind: InstallKind, arch = process.arch): UpdateInfo | null {
  const version = (release.tag_name ?? '').replace(/^v/i, '')
  if (!version || compareVersions(version, currentVersion) <= 0) return null
  const name = assetName(kind, arch)
  const asset = release.assets?.find((a) => a.name === name)
  return {
    version,
    url: release.html_url ?? RELEASE_PAGE,
    notes: release.body?.trim() || null,
    downloadUrl: asset?.browser_download_url ?? null,
    assetName: asset ? name : null,
    size: typeof asset?.size === 'number' ? asset.size : null,
    installable: kind === 'nsis' && !!asset?.browser_download_url,
  }
}

