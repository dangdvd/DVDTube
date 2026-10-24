// Mounted once by the app layout, outside the routes. Owns the main player's stage (the one
// <video> + its controls): shown in the watch page's slot on /watch, in the floating mini
// player elsewhere, or in the always-on-top mini window. Also binds the keyboard shortcuts.

import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { watchPath } from '@/lib/nav'
import { usePlayer, type PlayerMode } from '@/state/player'
import { getStage } from './stage'
import { MiniPlayer } from './ui/MiniPlayer'
import { PlayerOverlay } from './ui/PlayerOverlay'
import { PlayerSlot } from './ui/PlayerSlot'
import { PIcon } from './ui/icons'
import { usePlayerShortcuts } from './ui/shortcuts'
import './player.css'

/** The watch URL of what plays now (to expand the mini player back to it). */
export function currentWatchPath(): string | null {
  const s = usePlayer.getState()
  if (!s.current) return null
  return watchPath(s.current.id, { list: s.playlistId, index: s.playlistId ? s.queueIndex : null })
}

function WindowMiniPlayer() {
  return (
    <div className="dp-window-mini" data-testid="window-mini">
      <PlayerSlot className="dp-window-mini-slot" />
      <button type="button" className="dp-window-mini-exit" aria-label="Thoát cửa sổ nhỏ" title="Thoát cửa sổ nhỏ" onClick={() => api.setWindowMode('normal').catch(() => {})}>
        <PIcon name="expand" size={18} />
      </button>
    </div>
  )
}

export function PlayerHost() {
  const location = useLocation()
  const navigate = useNavigate()
  const hasCurrent = usePlayer((s) => !!s.current)
  const windowMini = usePlayer((s) => s.windowMini)
  const onWatch = location.pathname === '/watch'
  const onShorts = location.pathname.startsWith('/shorts')
  const mode: PlayerMode = !hasCurrent ? 'hidden' : onWatch ? 'page' : 'mini'
  const stage = getStage()

  useLayoutEffect(() => {
    usePlayer.getState().setMode(mode)
  }, [mode])

  useEffect(() => {
    if (mode !== 'page' && document.fullscreenElement === stage.root) void document.exitFullscreen().catch(() => {})
  }, [mode, stage])

  const expand = useCallback(() => {
    const s = usePlayer.getState()
    const path = currentWatchPath()
    if (path && s.current) navigate(path, { state: { video: s.current } })
  }, [navigate])

  const miniPlayer = useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (index > 0) navigate(-1)
    else navigate('/')
  }, [navigate])

  const actions = useMemo(() => ({ miniPlayer, expand }), [miniPlayer, expand])
  usePlayerShortcuts(mode, onShorts, actions)

  return (
    <>
      {createPortal(<PlayerOverlay variant={mode === 'page' ? 'page' : 'mini'} onExpand={expand} onMiniPlayer={miniPlayer} />, stage.overlay)}
      {mode === 'mini' && !onShorts && !windowMini ? <MiniPlayer onExpand={expand} /> : null}
      {windowMini && hasCurrent ? <WindowMiniPlayer /> : null}
    </>
  )
}
