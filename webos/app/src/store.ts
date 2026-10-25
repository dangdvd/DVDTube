// A tiny observable store (like the desktop app's zustand stores, without the dependency) and
// localStorage helpers that never throw (private mode, quota, disabled storage).

import { useEffect, useReducer, useRef } from 'preact/hooks'

export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void
  replace(state: T): void
  subscribe(listener: (state: T) => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<(state: T) => void>()
  const notify = () => {
    for (const l of Array.from(listeners)) l(state)
  }
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? (patch as (s: T) => Partial<T>)(state) : patch
      state = { ...state, ...next }
      notify()
    },
    replace(next) {
      state = next
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Re-renders when the selected part of the store changes (shallow compare for arrays / objects). */
export function useStore<T extends object, S = T>(store: Store<T>, select?: (state: T) => S): S {
  const selector = select ?? ((s: T) => s as unknown as S)
  const [, force] = useReducer((n: number) => n + 1, 0)
  const selected = selector(store.get())
  const last = useRef(selected)
  last.current = selected
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  useEffect(() => {
    const check = (state: T) => {
      const next = selectorRef.current(state)
      if (!shallowEqual(next, last.current)) force(0)
    }
    const unsubscribe = store.subscribe(check)
    check(store.get())
    return unsubscribe
  }, [store])
  return selected
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  return true
}

// MARK: localStorage

const PREFIX = 'dvd.'

export function loadJson<T>(name: string): T | null {
  try {
    const text = localStorage.getItem(PREFIX + name)
    return text ? (JSON.parse(text) as T) : null
  } catch {
    return null
  }
}

export function saveJson(name: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + name)
    else localStorage.setItem(PREFIX + name, JSON.stringify(value))
  } catch {
    // Quota / private storage: the value just does not persist.
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingValues = new Map<string, () => unknown>()

/** Saves after `delay` ms (coalesces bursts of changes). */
export function saveSoon(name: string, value: () => unknown, delay = 400): void {
  pendingValues.set(name, value)
  const existing = timers.get(name)
  if (existing) clearTimeout(existing)
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name)
      const get = pendingValues.get(name)
      pendingValues.delete(name)
      if (get) saveJson(name, get())
    }, delay),
  )
}

/** Writes pending values now (before leaving the app). */
export function flushSaves(): void {
  timers.forEach((timer, name) => {
    clearTimeout(timer)
    const get = pendingValues.get(name)
    if (get) saveJson(name, get())
  })
  timers.clear()
  pendingValues.clear()
}
