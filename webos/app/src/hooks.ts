// Data loading hooks: one-shot loads and paged feeds (continuations), cached per key so a screen
// that comes back (Back) shows its data at once.

import type { FeedItem, FeedPage } from '@shared/models'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from './api'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload(): void
}

const cache = new Map<string, { at: number; value: unknown }>()

export function cached<T>(key: string): T | null {
  const entry = cache.get(key)
  return entry && Date.now() - entry.at < 10 * 60_000 ? (entry.value as T) : null
}

export function setCached(key: string, value: unknown): void {
  if (cache.size > 80) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), value })
}

export function clearCache(prefix = ''): void {
  for (const key of Array.from(cache.keys())) if (key.startsWith(prefix)) cache.delete(key)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useAsync<T>(key: string | null, load: () => Promise<T>): AsyncState<T> {
  // `key` tells which request the state belongs to: right after the key changes (before the
  // effect ran) the old state must not show, e.g. as a flash of "Không tìm thấy kết quả".
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null; loading: boolean }>(() => {
    const hit = key ? cached<T>(key) : null
    return { key, data: hit, error: null, loading: !!key && hit === null }
  })
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!key) {
      setState({ key, data: null, error: null, loading: false })
      return
    }
    const hit = nonce === 0 ? cached<T>(key) : null
    if (hit !== null) {
      setState({ key, data: hit, error: null, loading: false })
      return
    }
    let alive = true
    setState((s) => ({ key, data: nonce === 0 || s.key !== key ? null : s.data, error: null, loading: true }))
    loadRef.current().then(
      (data) => {
        if (!alive) return
        setCached(key, data)
        setState({ key, data, error: null, loading: false })
      },
      (error) => {
        if (!alive) return
        setState({ key, data: null, error: message(error), loading: false })
      },
    )
    return () => {
      alive = false
    }
  }, [key, nonce])
  const reload = () => setNonce((n) => n + 1)
  if (state.key !== key) {
    const hit = key ? cached<T>(key) : null
    return { data: hit, error: null, loading: !!key && hit === null, reload }
  }
  return { data: state.data, error: state.error, loading: state.loading, reload }
}

export interface PagedFeed {
  items: FeedItem[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  message: string | null
  canLoadMore: boolean
  loadMore(): void
  reload(): void
}

interface FeedState {
  items: FeedItem[]
  continuation: string | null
  kind: FeedPage['kind']
  message: string | null
}

/** A feed with continuations; `load` gives the first page. */
export function usePagedFeed(key: string | null, load: () => Promise<FeedPage>): PagedFeed {
  const initial = key ? cached<FeedState>(key) : null
  const [feed, setFeed] = useState<FeedState | null>(initial)
  const [loading, setLoading] = useState(!!key && !initial)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const busy = useRef(false)
  const current = useRef<FeedState | null>(feed)
  current.current = feed

  useEffect(() => {
    if (!key) return
    const hit = nonce === 0 ? cached<FeedState>(key) : null
    if (hit) {
      setFeed(hit)
      setLoading(false)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    if (nonce === 0) setFeed(null)
    loadRef.current().then(
      (page) => {
        if (!alive) return
        const state: FeedState = { items: page.items, continuation: page.continuation ?? null, kind: page.kind, message: page.message ?? null }
        setCached(key, state)
        setFeed(state)
        setLoading(false)
      },
      (e) => {
        if (!alive) return
        setError(message(e))
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [key, nonce])

  const loadMore = () => {
    const state = current.current
    if (!key || !state?.continuation || busy.current) return
    busy.current = true
    setLoadingMore(true)
    api.more(state.continuation, state.kind).then(
      (page) => {
        busy.current = false
        setLoadingMore(false)
        const seen = new Set(state.items.map(itemKey))
        const fresh = page.items.filter((i) => !seen.has(itemKey(i)))
        const next: FeedState = { ...state, items: [...state.items, ...fresh], continuation: fresh.length ? page.continuation ?? null : null }
        setCached(key, next)
        setFeed(next)
      },
      () => {
        busy.current = false
        setLoadingMore(false)
      },
    )
  }

  return {
    items: feed?.items ?? [],
    loading,
    loadingMore,
    error,
    message: feed?.message ?? null,
    canLoadMore: !!feed?.continuation,
    loadMore,
    reload: () => setNonce((n) => n + 1),
  }
}

export function itemKey(item: FeedItem): string {
  switch (item.type) {
    case 'video':
      return 'v-' + item.video.id
    case 'channel':
      return 'c-' + item.channel.id
    case 'playlist':
      return 'p-' + item.playlist.id
    case 'shorts':
      return 's-' + (item.items[0]?.id ?? '')
  }
}
