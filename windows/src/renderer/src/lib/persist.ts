// Saves a store's state through `api.storeWrite` (debounced) and loads it at startup.

import { api } from './api'

const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function saveSoon(name: string, data: unknown, delayMs = 400): void {
  const pending = timers.get(name)
  if (pending) clearTimeout(pending)
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name)
      api.storeWrite(name, data).catch((error) => console.warn('save failed', name, error))
    }, delayMs),
  )
}

export async function load<T>(name: string): Promise<T | null> {
  try {
    return ((await api.storeRead(name)) as T | null) ?? null
  } catch (error) {
    console.warn('load failed', name, error)
    return null
  }
}
