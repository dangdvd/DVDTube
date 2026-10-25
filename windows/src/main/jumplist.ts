// Taskbar Jump List (Windows, right-click on the taskbar icon) and Dock menu (macOS): "Tiếp tục
// xem" with recent unfinished videos plus the tasks Tìm kiếm / Shorts / Nghe nhạc. Every entry is a
// `dvdtube://` link handled like any link opened from outside.

import { resolve } from 'node:path'
import { app, Menu, type JumpListCategory, type JumpListItem } from 'electron'
import type { RecentVideo } from '@shared/api'
import { log } from './log'

const TASKS: { title: string; link: string }[] = [
  { title: 'Tìm kiếm', link: 'dvdtube://search' },
  { title: 'Shorts', link: 'dvdtube://shorts' },
  { title: 'Nghe nhạc', link: 'dvdtube://music' },
]

export function watchLink(video: RecentVideo): string {
  const t = video.position && video.position > 1 ? `&t=${Math.floor(video.position)}` : ''
  return `dvdtube://watch?v=${encodeURIComponent(video.id)}${t}`
}

/** Arguments that make the exe open `link` (the development build also needs the app path). */
function argsFor(link: string): string {
  return process.defaultApp && process.argv.length >= 2 ? `"${resolve(process.argv[1])}" ${link}` : link
}

function task(title: string, link: string, description: string): JumpListItem {
  return { type: 'task', title: title.slice(0, 120), description, program: process.execPath, args: argsFor(link), iconPath: process.execPath, iconIndex: 0 }
}

let lastKey = ''

export function setRecentVideos(videos: RecentVideo[], openLink: (link: string) => void): void {
  const list = (Array.isArray(videos) ? videos : [])
    .filter((v) => v && typeof v.id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(v.id))
    .slice(0, 6)
    .map((v) => ({ id: v.id, title: String(v.title || 'Video').replace(/\s+/g, ' ').trim().slice(0, 100), position: typeof v.position === 'number' ? v.position : null }))
  const key = JSON.stringify(list)
  if (key === lastKey) return
  lastKey = key

  if (process.platform === 'win32') {
    const tasks: JumpListCategory = { type: 'tasks', items: TASKS.map((t) => task(t.title, t.link, t.title)) }
    const recent: JumpListCategory = { type: 'custom', name: 'Tiếp tục xem', items: list.map((v) => task(v.title, watchLink(v), 'Tiếp tục xem')) }
    let result = app.setJumpList(list.length ? [recent, tasks] : [tasks])
    // Recent items can be turned off in Windows settings: keep at least the tasks.
    if (result !== 'ok' && list.length) result = app.setJumpList([tasks])
    if (result !== 'ok') log.warn(`jump list: ${result}`)
  } else if (process.platform === 'darwin' && app.dock) {
    const menu = Menu.buildFromTemplate([
      ...(list.length ? [{ label: 'Tiếp tục xem', enabled: false }, ...list.map((v) => ({ label: v.title, click: () => openLink(watchLink(v)) }))] : []),
      ...(list.length ? [{ type: 'separator' as const }] : []),
      ...TASKS.map((t) => ({ label: t.title, click: () => openLink(t.link) })),
    ])
    app.dock.setMenu(menu)
  }
}
