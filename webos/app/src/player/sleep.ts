// "Hẹn giờ tắt": stops playback after N minutes or at the end of the current video (kept across
// videos, like the Android TV app).

import { createStore } from '../store'
import { sleepDurationTitle } from '../state/settings'

export const sleepStore = createStore<{ until: number | null; endOfVideo: boolean; now: number }>({ until: null, endOfVideo: false, now: Date.now() })

setInterval(() => {
  if (sleepStore.get().until) sleepStore.set({ now: Date.now() })
}, 15_000)

export function setSleepTimer(minutes: number | null): void {
  if (minutes === null) sleepStore.set({ until: null, endOfVideo: false })
  else if (minutes === 0) sleepStore.set({ until: null, endOfVideo: true })
  else sleepStore.set({ until: Date.now() + minutes * 60_000, endOfVideo: false, now: Date.now() })
}

export function extendSleepTimer(minutes: number): void {
  const s = sleepStore.get()
  if (s.until) sleepStore.set({ until: s.until + minutes * 60_000, now: Date.now() })
}

export function sleepLabel(): string | null {
  const s = sleepStore.get()
  if (s.endOfVideo) return 'Khi hết video này'
  if (!s.until) return null
  const minutes = Math.max(1, Math.ceil((s.until - Date.now()) / 60_000))
  return `còn ${sleepDurationTitle(minutes)}`
}

/** True when the timer ran out (and clears it). */
export function sleepDue(): boolean {
  const s = sleepStore.get()
  if (s.until && Date.now() >= s.until) {
    sleepStore.set({ until: null })
    return true
  }
  return false
}
