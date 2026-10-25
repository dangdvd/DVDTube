// A Map-backed localStorage for the interface modules that load their state at import time
// (imported first by the UI tests, before those modules).

const data = new Map<string, string>()

export const memoryStorage = {
  getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
  setItem: (key: string, value: string) => void data.set(key, String(value)),
  removeItem: (key: string) => void data.delete(key),
  clear: () => data.clear(),
  key: (i: number) => Array.from(data.keys())[i] ?? null,
  get length() {
    return data.size
  },
}

;(globalThis as { localStorage?: unknown }).localStorage = memoryStorage
