// Mock implementation of the main-process API for running the UI in a plain browser
// (no Electron, no network). Returns believable sample data.
// TODO(ui): fill in every DvdApi method used by the UI.

import type { DvdApi, DvdEventName, DvdEvents } from '@shared/api'
import { mockPlayerApi } from '@/player/mock'

export const mockApi: Partial<DvdApi> = {
  ...mockPlayerApi,
  storeRead: async (name) => {
    try {
      const text = localStorage.getItem('dvd-store-' + name)
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  },
  storeWrite: async (name, data) => {
    try {
      localStorage.setItem('dvd-store-' + name, JSON.stringify(data))
    } catch {
      // Ignore quota errors in the mock.
    }
  },
}

export function mockOn<K extends DvdEventName>(_event: K, _handler: (payload: DvdEvents[K]) => void): () => void {
  return () => {}
}
