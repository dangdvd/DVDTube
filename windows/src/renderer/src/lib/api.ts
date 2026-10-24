// Typed access to the main process. Outside Electron (plain browser / `vite` dev server) the
// mock implementation in `./mock.ts` answers instead, so the UI can be developed and
// screenshotted without network access to YouTube.

import type { DvdApi, DvdEventName, DvdEvents } from '@shared/api'
import { mockApi, mockOn } from './mock'

export const isElectron = typeof window !== 'undefined' && !!window.dvd

/** `api.search('lofi')` → `ipcMain.handle('dvd:search')` in the main process. */
export const api: DvdApi = new Proxy({} as DvdApi, {
  get(_target, method: string) {
    if (window.dvd) return (...args: unknown[]) => (window.dvd!.invoke as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args)
    const fn = (mockApi as unknown as Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>)[method]
    return fn ? fn : () => Promise.reject(new Error(`Chưa hỗ trợ: ${method}`))
  },
})

/** Subscribes to an event from the main process; returns the unsubscribe function. */
export function onEvent<K extends DvdEventName>(event: K, handler: (payload: DvdEvents[K]) => void): () => void {
  if (window.dvd) return window.dvd.on(event, handler)
  return mockOn(event, handler)
}

/** User-facing message of an error thrown by `api`. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Đã xảy ra lỗi'
  return String(error)
}
