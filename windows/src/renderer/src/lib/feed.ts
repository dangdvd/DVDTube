// Loading state of a paged feed (home, search, channel tabs, playlists…): first page, infinite
// continuations, retry and F5 reload. Pages are cached per history entry so going back shows
// the same items instantly (and the scroll position can be restored).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { ContinuationKind, FeedItem, FeedPage } from '@shared/models'
import { feedItemKey } from '@shared/models'
import { api, errorMessage } from './api'
import { useUi } from './ui'

export interface FeedState {
  items: FeedItem[]
  continuation: string | null
  kind: ContinuationKind
  message: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  moreError: string | null
}

export interface Feed extends FeedState {
  more(): void
  reload(): void
}

interface CachedFeed {
  items: FeedItem[]
  continuation: string | null
  kind: ContinuationKind
  message: string | null
}

const MAX_CACHE = 40
const cache = new Map<string, CachedFeed>()

function remember(key: string, value: CachedFeed) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string)
}

const EMPTY: FeedState = {
  items: [],
  continuation: null,
  kind: 'browse',
  message: null,
  loading: true,
  loadingMore: false,
  error: null,
  moreError: null,
}

function fromCache(c: CachedFeed): FeedState {
  return { ...EMPTY, ...c, loading: false }
}

/** Removes items already present (continuations sometimes repeat a few). */
export function mergeItems(existing: FeedItem[], added: FeedItem[]): FeedItem[] {
  const seen = new Set(existing.map(feedItemKey))
  return [...existing, ...added.filter((item) => !seen.has(feedItemKey(item)) && seen.add(feedItemKey(item)))]
}

/**
 * `key` identifies what is loaded (null = nothing yet); `load` fetches the first page.
 * `loadMore` overrides `api.more` for continuations.
 */
export function useFeed(
  key: string | null,
  load: () => Promise<FeedPage>,
  loadMore?: (token: string, kind: ContinuationKind) => Promise<FeedPage>,
): Feed {
  const location = useLocation()
  const cacheKey = key == null ? null : location.key + '|' + key
  const reloadTick = useUi((s) => s.reloadTick)
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<FeedState>(() => (cacheKey && cache.has(cacheKey) ? fromCache(cache.get(cacheKey)!) : EMPTY))
  const stateRef = useRef(state)
  stateRef.current = state
  const request = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const moreRef = useRef(loadMore)
  moreRef.current = loadMore
  const seenTick = useRef(reloadTick)
  const seenNonce = useRef(nonce)

  useEffect(() => {
    if (cacheKey == null) return
    const forced = seenTick.current !== reloadTick || seenNonce.current !== nonce
    seenTick.current = reloadTick
    seenNonce.current = nonce
    const cached = cache.get(cacheKey)
    const id = ++request.current
    if (cached && !forced) {
      setState(fromCache(cached))
      return
    }
    setState({ ...EMPTY, loading: true })
    loadRef
      .current()
      .then((page) => {
        if (id !== request.current) return
        const value: CachedFeed = {
          items: mergeItems([], page.items),
          continuation: page.continuation ?? null,
          kind: page.kind,
          message: page.message ?? null,
        }
        remember(cacheKey, value)
        setState(fromCache(value))
      })
      .catch((error) => {
        if (id !== request.current) return
        setState({ ...EMPTY, loading: false, error: errorMessage(error) })
      })
  }, [cacheKey, reloadTick, nonce])

  const more = useCallback(() => {
    const s = stateRef.current
    if (!s.continuation || s.loading || s.loadingMore || !cacheKey) return
    const id = request.current
    const token = s.continuation
    setState({ ...s, loadingMore: true, moreError: null })
    ;(moreRef.current ?? api.more)(token, s.kind)
      .then((page) => {
        if (id !== request.current) return
        const current = stateRef.current
        const items = mergeItems(current.items, page.items)
        const continuation = page.continuation && page.continuation !== token ? page.continuation : null
        const value: CachedFeed = { items, continuation, kind: page.kind ?? current.kind, message: current.message }
        remember(cacheKey, value)
        setState({ ...current, ...value, loadingMore: false })
      })
      .catch((error) => {
        if (id !== request.current) return
        setState({ ...stateRef.current, loadingMore: false, moreError: errorMessage(error) })
      })
  }, [cacheKey])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, more, reload }
}

/** Generic one-shot loader with the same cache / reload behaviour (non-feed data). */
export function useLoad<T>(
  key: string | null,
  load: () => Promise<T>,
): { data: T | null; loading: boolean; error: string | null; reload(): void; set(data: T): void } {
  const reloadTick = useUi((s) => s.reloadTick)
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: key != null, error: null })
  const loadRef = useRef(load)
  loadRef.current = load
  const request = useRef(0)
  const lastKey = useRef(key)

  useEffect(() => {
    if (key == null) return
    const id = ++request.current
    // Keep showing the data while refreshing the same thing; clear it for something else.
    const same = lastKey.current === key
    lastKey.current = key
    setState((s) => ({ data: same ? s.data : null, loading: true, error: null }))
    loadRef
      .current()
      .then((data) => id === request.current && setState({ data, loading: false, error: null }))
      .catch((error) => id === request.current && setState({ data: null, loading: false, error: errorMessage(error) }))
  }, [key, reloadTick, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const set = useCallback((data: T) => setState({ data, loading: false, error: null }), [])
  return { ...state, reload, set }
}
