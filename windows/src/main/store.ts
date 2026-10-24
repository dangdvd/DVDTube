// JSON files in the user data folder: the renderer's stores (`userData/store/<name>.json`) and
// the main process' own files. Writes are atomic (temporary file + rename) and serialised per file.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const NAME_PATTERN = /^[a-z0-9-]+$/
const MAX_STORE_BYTES = 64 * 1024 * 1024

let root = ''
const queues = new Map<string, Promise<void>>()

export function initStore(userDataPath: string): void {
  root = userDataPath
}

export function userDataFile(...parts: string[]): string {
  return join(root, ...parts)
}

function storePath(name: string): string {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new Error('Tên dữ liệu không hợp lệ.')
  return join(root, 'store', `${name}.json`)
}

/** Writes `data` to `file` atomically; concurrent writes to the same file run in order. */
export function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const previous = queues.get(file) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      try {
        await writeFile(tmp, data)
        await rename(tmp, file)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw error
      }
    })
  queues.set(file, next)
  void next.finally(() => {
    if (queues.get(file) === next) queues.delete(file)
  })
  return next
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Synchronous read for the few values needed before the app is ready. */
export function readJsonSync<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function writeJson(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(value))
}

export async function storeRead(name: string): Promise<unknown | null> {
  return readJson<unknown>(storePath(name))
}

export async function storeWrite(name: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data ?? null)
  if (text.length > MAX_STORE_BYTES) throw new Error('Dữ liệu quá lớn để lưu.')
  await writeFileAtomic(storePath(name), text)
}

/** Waits for pending writes (before quitting). */
export async function flushStore(): Promise<void> {
  await Promise.all([...queues.values()].map((p) => p.catch(() => {})))
}

export function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // ignore
  }
}
