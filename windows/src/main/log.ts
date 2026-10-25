// Main-process log: `userData/logs/main.log` (capped at 1 MB, one previous file kept) and, in
// smoke mode, a copy in the smoke folder. Endpoints, status codes and errors only — never
// cookies, auth headers, account data or the pairing key.

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 1_048_576

let mainFile: string | null = null
let extraFile: string | null = null
let writes = 0

export function initLog(userDataPath: string, smokeDir: string | null): void {
  const dir = join(userDataPath, 'logs')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // logging is best effort
  }
  mainFile = join(dir, 'main.log')
  extraFile = smokeDir ? join(smokeDir, 'main.log') : null
  rotate()
}

function rotate(): void {
  if (!mainFile) return
  try {
    if (statSync(mainFile).size > MAX_BYTES) {
      const old = mainFile.replace(/\.log$/, '.old.log')
      rmSync(old, { force: true })
      renameSync(mainFile, old)
    }
  } catch {
    // no file yet
  }
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function write(level: string, message: string): void {
  const line = `${stamp()} ${level} ${message}\n`
  if (process.env.DVDTUBE_LOG_STDOUT || !mainFile) process.stdout.write(line)
  if (mainFile) {
    try {
      appendFileSync(mainFile, line)
    } catch {
      // ignore
    }
    if (++writes % 200 === 0) rotate()
  }
  if (extraFile) {
    try {
      appendFileSync(extraFile, line)
    } catch {
      // ignore
    }
  }
}

/** The persistent log files, newest last (main.old.log, main.log). */
export function logFiles(): string[] {
  if (!mainFile) return []
  return [mainFile.replace(/\.log$/, '.old.log'), mainFile]
}

export const log = {
  info: (message: string) => write('INFO', message),
  warn: (message: string) => write('WARN', message),
  error: (message: string) => write('ERROR', message),
}
