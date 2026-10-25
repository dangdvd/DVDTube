// Saves a store's state through `api.storeWrite` (debounced) and loads it at startup.

import { api } from './api'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingData = new Map<string, unknown>()

function write(name: string, data: unknown): void {
  api.storeWrite(name, data).catch((error) => console.warn('save failed', name, error))
}

export function saveSoon(name: string, data: unknown, delayMs = 400): void {
  const pending = timers.get(name)
  if (pending) clearTimeout(pending)
  pendingData.set(name, data)
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name)
      pendingData.delete(name)
      write(name, data)
    }, delayMs),
  )
}

/** Writes every pending save now (the app is quitting). */
export function flushSaves(): void {
  for (const [name, timer] of timers) {
    clearTimeout(timer)
    write(name, pendingData.get(name))
  }
  timers.clear()
  pendingData.clear()
}

export async function load<T>(name: string): Promise<T | null> {
  try {
    return ((await api.storeRead(name)) as T | null) ?? null
  } catch (error) {
    console.warn('load failed', name, error)
    return null
  }
}
