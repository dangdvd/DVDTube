// Google Takeout `subscriptions.csv` (columns Channel Id, Channel Url, Channel Title — the
// header is localised, so rows are recognised by their UC… id) and the matching export.

import type { ChannelItem } from '@shared/models'

function parseLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells.map((c) => c.trim())
}

export function parseSubscriptionsCsv(text: string): ChannelItem[] {
  const channels: ChannelItem[] = []
  const seen = new Set<string>()
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = parseLine(line)
    const idIndex = cells.findIndex((c) => /^UC[\w-]{22}$/.test(c))
    const id = idIndex >= 0 ? cells[idIndex] : cells.map((c) => c.match(/channel\/(UC[\w-]{22})/)?.[1]).find(Boolean)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name =
      cells[2] && !/^https?:/.test(cells[2])
        ? cells[2]
        : (cells.find((c, i) => i !== idIndex && c && !/^https?:/.test(c) && !/^UC[\w-]{22}$/.test(c)) ?? id)
    channels.push({ id, name, avatar: null })
  }
  return channels
}

export function subscriptionsCsv(channels: ChannelItem[]): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const rows = channels.map((c) => [c.id, `http://www.youtube.com/channel/${c.id}`, c.name].map(quote).join(','))
  return ['Channel Id,Channel Url,Channel Title', ...rows].join('\n') + '\n'
}

/** Saves text as a file through the browser download flow (Electron shows a save dialog). */
export function saveTextFile(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
