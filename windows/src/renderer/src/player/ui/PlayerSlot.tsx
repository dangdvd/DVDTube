// Where the main player's stage (video + controls) is shown: the watch page, the mini player
// and the always-on-top mini window each render one.

import { useLayoutEffect, useRef } from 'react'
import { attachStage, releaseStage } from '../stage'

export function PlayerSlot({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const slot = ref.current
    if (!slot) return
    attachStage(slot)
    return () => releaseStage(slot)
  }, [])
  return <div ref={ref} className={className} />
}
