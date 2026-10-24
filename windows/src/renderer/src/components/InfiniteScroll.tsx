// Sentinel that asks for the next page when it gets near the visible part of the scrolling
// content area. Re-armed after every load (IntersectionObserver only fires on changes, so a
// sentinel that stays visible after a short page would otherwise never fire again).

import { createContext, useContext, useEffect, useRef } from 'react'
import { Spinner } from './States'

/** The element that scrolls the page content (set by the app layout). */
export const ScrollRootContext = createContext<HTMLElement | null>(null)

export function useScrollRoot(): HTMLElement | null {
  return useContext(ScrollRootContext)
}

export function InfiniteSentinel({
  onMore,
  enabled,
  loading,
  rearmKey,
}: {
  onMore: () => void
  /** False when there is nothing more to load. */
  enabled: boolean
  loading?: boolean
  /** Changes whenever new items arrive (usually the item count). */
  rearmKey?: unknown
}) {
  const ref = useRef<HTMLDivElement>(null)
  const root = useScrollRoot()
  const onMoreRef = useRef(onMore)
  onMoreRef.current = onMore

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onMoreRef.current()
      },
      { root, rootMargin: '0px 0px 900px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [root, enabled, loading, rearmKey])

  if (!enabled && !loading) return null
  return (
    <div ref={ref} className="infinite-sentinel" data-testid="infinite-sentinel">
      {loading && <Spinner size={32} />}
    </div>
  )
}
