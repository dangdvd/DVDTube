// Recent renderer warnings and errors (console, uncaught errors, player failures with their
// source and client) for "Gửi nhật ký lỗi". Kept in memory (last 500) and forwarded to the main
// process' persistent log file (rate limited there).

import { api } from './api'

const MAX_LINES = 500
const lines: string[] = []

function stamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function text(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function noteRendererLine(level: 'warn' | 'error', message: string): void {
  const line = message.slice(0, 2000)
  lines.push(`${stamp()} ${level.toUpperCase()} ${line}`)
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
  api.logRenderer(level, line).catch(() => {})
}

export function recentRendererLines(): string[] {
  return [...lines]
}

let installed = false

export function installRendererLog(): void {
  if (installed) return
  installed = true
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      try {
        noteRendererLine(level, args.map(text).join(' '))
      } catch {
        // never break logging
      }
    }
  }
  window.addEventListener('error', (event) => noteRendererLine('error', `uncaught: ${text(event.error ?? event.message)}`))
  window.addEventListener('unhandledrejection', (event) => noteRendererLine('error', `unhandled rejection: ${text(event.reason)}`))
}
