// Stand-in for windows/src/main/store.ts inside the webOS service bundle (the build redirects
// that module here). The TV interface owns every persistent value (localStorage), and an
// installed webOS service has no writable folder of its own, so these "files" live in memory
// for the lifetime of the service process.

const files = new Map<string, string>()

let root = '/tmp/dvdtube'

export function initStore(userDataPath: string): void {
  root = userDataPath
}

export function userDataFile(...parts: string[]): string {
  return [root, ...parts].join('/')
}

export function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  files.set(file, typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
  return Promise.resolve()
}

export async function readJson<T>(file: string): Promise<T | null> {
  return readJsonSync<T>(file)
}

export function readJsonSync<T>(file: string): T | null {
  const text = files.get(file)
  if (text === undefined) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function writeJson(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(value))
}

export async function storeRead(name: string): Promise<unknown | null> {
  return readJsonSync(userDataFile('store', `${name}.json`))
}

export async function storeWrite(name: string, data: unknown): Promise<void> {
  await writeJson(userDataFile('store', `${name}.json`), data)
}

export async function flushStore(): Promise<void> {}

export function ensureDir(_dir: string): void {}
