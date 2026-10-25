// "Gửi nhật ký lỗi": one text file with what is needed to understand a problem — app and OS
// versions, a settings summary (nothing personal), the network type, the last ~2000 log lines,
// recent renderer / player errors and the list of crash reports — scrubbed of every secret.

import { readdir, readFile, stat } from 'node:fs/promises'
import { arch, cpus, homedir, networkInterfaces, release, totalmem, type as osType, version as osVersion } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { LogContext } from '@shared/api'
import { scrub } from './core/scrub'
import { logFiles } from './log'

const MAX_LINES = 2000

export function logFileName(platform: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux' : 'windows'
  return `DVDTube-log-${name}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.txt`
}

async function tail(files: string[], count: number): Promise<string[]> {
  const lines: string[] = []
  for (const file of files) {
    try {
      lines.push(...(await readFile(file, 'utf8')).split(/\r?\n/).filter((l) => l.length > 0))
    } catch {
      // missing file
    }
  }
  return lines.slice(-count)
}

function networkSummary(): string {
  const kinds = new Set<string>()
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (!(entries ?? []).some((e) => !e.internal && e.family === 'IPv4')) continue
    if (/wi-?fi|wlan|wireless|^wl/i.test(name)) kinds.add('Wi-Fi')
    else if (/ethernet|^eth|^en\d/i.test(name)) kinds.add(process.platform === 'darwin' && name === 'en0' ? 'Wi-Fi/Ethernet' : 'Ethernet')
    else if (/cellular|wwan|mobile/i.test(name)) kinds.add('Di động')
    else if (/vpn|tap|tun|utun|tailscale|zerotier/i.test(name)) kinds.add('VPN')
    else kinds.add('Khác')
  }
  return kinds.size ? [...kinds].join(', ') : 'Không có kết nối'
}

async function crashReports(): Promise<string[]> {
  let dir: string
  try {
    dir = app.getPath('crashDumps')
  } catch {
    return []
  }
  const found: string[] = []
  const walk = async (path: string, depth: number) => {
    if (depth > 2) return
    let names: string[]
    try {
      names = await readdir(path)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(path, name)
      try {
        const info = await stat(full)
        if (info.isDirectory()) await walk(full, depth + 1)
        else if (/\.dmp$|\.crash$/i.test(name)) found.push(`${info.mtime.toISOString()}  ${name}  ${Math.round(info.size / 1024)} KB`)
      } catch {
        // ignore
      }
    }
  }
  await walk(dir, 0)
  return found.sort().slice(-20)
}

export async function buildLog(context: LogContext): Promise<{ fileName: string; text: string }> {
  const now = new Date()
  const cpu = cpus()
  const crashes = await crashReports()
  const lines: string[] = [
    'DVDTube — nhật ký lỗi',
    `Thời gian: ${now.toISOString()}`,
    `Phiên bản: ${app.getVersion()} (Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, Node ${process.versions.node})`,
    `Hệ điều hành: ${osType()} ${release()} ${typeof osVersion === 'function' ? osVersion() : ''} (${arch()})`,
    `Thiết bị: ${cpu[0]?.model?.trim() ?? 'CPU'} × ${cpu.length}, RAM ${Math.round(totalmem() / 1024 ** 3)} GB`,
    `Mạng: ${networkSummary()}`,
    `Đăng nhập YouTube: ${context?.signedIn ? 'có' : 'không'}`,
    `Bản đóng gói: ${app.isPackaged ? 'có' : 'không (bản phát triển)'}`,
    '',
    '== Cài đặt ==',
    ...Object.entries(context?.settings ?? {}).map(([k, v]) => `${String(k).slice(0, 60)}: ${String(v).slice(0, 200)}`),
    '',
    '== Lỗi gần đây (giao diện, trình phát) ==',
    ...(Array.isArray(context?.rendererLines) && context.rendererLines.length ? context.rendererLines.slice(-300).map((l) => String(l).slice(0, 2000)) : ['(không có)']),
    '',
    '== Báo cáo sự cố ==',
    ...(crashes.length ? crashes : ['(không có)']),
    '',
    `== Nhật ký (tối đa ${MAX_LINES} dòng cuối) ==`,
    ...(await tail(logFiles(), MAX_LINES)),
    '',
  ]
  return { fileName: logFileName(process.platform, now), text: scrub(lines.join('\n'), { home: homedir() }) }
}
