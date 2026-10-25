// Event bus of the mock API (the stand-in for main-process events outside Electron).

import type { DvdEventName, DvdEvents } from '@shared/api'

type Handler = (payload: unknown) => void
const handlers = new Map<string, Set<Handler>>()

export function mockOn<K extends DvdEventName>(event: K, handler: (payload: DvdEvents[K]) => void): () => void {
  const set = handlers.get(event) ?? new Set<Handler>()
  set.add(handler as Handler)
  handlers.set(event, set)
  return () => set.delete(handler as Handler)
}

export function mockEmit<K extends DvdEventName>(event: K, payload: DvdEvents[K]): void {
  handlers.get(event)?.forEach((h) => h(payload))
}
