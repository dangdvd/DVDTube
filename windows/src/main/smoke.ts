// CI smoke mode (`--smoke=<dir>`): fresh profile in `<dir>/userdata`, the renderer runs its
// scenario and reports each step with `smokeStep()`; steps (with timestamps) go to
// `<dir>/report.json`, screenshots to `<dir>/<name>.png`, renderer console output to
// `<dir>/renderer.log` (the main log is copied to `<dir>/main.log` by log.ts). The last step
// (`finish: true`) quits with code 0 when every step passed, else 1. After 5 minutes the report
// is written and the app quits with code 1.
//
// The main process adds a few informational `core-*` steps of its own (IPC, network, player
// client) to help diagnose CI runs; they do not change the exit code.

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { SmokeStep } from '@shared/api'
import { describeError } from './core/errors'
import { log } from './log'
import { getMainWindow } from './windows'

interface ReportEntry {
  name: string
  ok: boolean
  detail?: string
  screenshot?: string
  informational?: boolean
  skipped?: boolean
  time: string
  elapsedMs: number
}

const GLOBAL_TIMEOUT_MS = 5 * 60_000

let dir: string | null = null
let startedAt = 0
const report: ReportEntry[] = []
let finished = false

export function parseSmokeDir(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--smoke='))
  if (!arg) return null
  const value = arg.slice('--smoke='.length).replace(/^"|"$/g, '')
  return value ? resolve(value) : null
}

export function isSmoke(): boolean {
  return dir !== null
}

export function smokeDir(): string | null {
  return dir
}

export function initSmoke(smokeDirectory: string): void {
  dir = smokeDirectory
  startedAt = Date.now()
  // A fresh profile on every run (only our own sub-folder is removed).
  rmSync(join(dir, 'userdata'), { recursive: true, force: true })
  mkdirSync(join(dir, 'userdata'), { recursive: true })
  writeFileSync(join(dir, 'renderer.log'), '')
  writeReport()
  const timer = setTimeout(() => {
    log.error('smoke: global timeout (5 min)')
    record({ name: 'timeout', ok: false, detail: 'Kịch bản không kết thúc trong 5 phút' })
    void finish()
  }, GLOBAL_TIMEOUT_MS)
  timer.unref?.()
}

function writeReport(): void {
  if (!dir) return
  try {
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2))
  } catch (error) {
    log.error(`smoke: report not written: ${describeError(error)}`)
  }
}

function record(entry: Omit<ReportEntry, 'time' | 'elapsedMs'>): void {
  report.push({ ...entry, time: new Date().toISOString(), elapsedMs: Date.now() - startedAt })
  writeReport()
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'step'
}

async function screenshot(name: string): Promise<string | undefined> {
  const window = getMainWindow()
  if (!dir || !window) return undefined
  try {
    const image = await window.webContents.capturePage()
    const file = `${safeName(name)}.png`
    writeFileSync(join(dir, file), image.toPNG())
    return file
  } catch (error) {
    log.warn(`smoke: screenshot ${name} failed: ${describeError(error)}`)
    return undefined
  }
}

export async function smokeStep(step: SmokeStep): Promise<void> {
  if (!dir || finished) return
  const name = typeof step?.name === 'string' && step.name ? step.name : 'step'
  const shot = step.screenshot ? await screenshot(name) : undefined
  const skipped = !!step.skipped
  record({
    name,
    ok: !!step.ok,
    skipped: skipped || undefined,
    detail: step.detail ? String(step.detail).slice(0, 2000) : undefined,
    screenshot: shot,
  })
  const status = skipped ? 'SKIPPED' : step.ok ? 'ok' : 'FAILED'
  log.info(`smoke: ${name} ${status}${step.detail ? ` — ${String(step.detail).slice(0, 300)}` : ''}`)
  if (step.finish) await finish()
}

async function finish(): Promise<void> {
  if (finished) return
  finished = true
  const failed = report.filter((e) => !e.ok && !e.informational && !e.skipped)
  const code = failed.length === 0 && report.some((e) => !e.informational) ? 0 : 1
  log.info(`smoke: finished, ${report.length} steps, ${failed.length} failed → exit ${code}`)
  writeReport()
  setTimeout(() => app.exit(code), 300)
}

/** Renderer console → `<dir>/renderer.log`; a crashed renderer ends the run. */
export function attachSmokeWindow(window: BrowserWindow): void {
  if (!dir) return
  const file = join(dir, 'renderer.log')
  window.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event
    const source = sourceId ? ` (${sourceId.split('/').pop()}:${lineNumber})` : ''
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${message}${source}\n`)
    } catch {
      // ignore
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    record({ name: 'renderer-crash', ok: false, detail: `${details.reason} (${details.exitCode})` })
    void finish()
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    record({ name: 'renderer-load', ok: false, detail: `${code} ${description} ${url}` })
  })
}

/** Informational checks of the core, run next to the renderer's scenario. */
export async function runCoreDiagnostics(checks: { name: string; run: () => Promise<string> }[]): Promise<void> {
  for (const check of checks) {
    if (finished) return
    try {
      const detail = await check.run()
      record({ name: check.name, ok: true, detail, informational: true })
      log.info(`smoke: ${check.name} ok — ${detail}`)
    } catch (error) {
      record({ name: check.name, ok: false, detail: describeError(error), informational: true })
      log.warn(`smoke: ${check.name} failed — ${describeError(error)}`)
    }
  }
}
