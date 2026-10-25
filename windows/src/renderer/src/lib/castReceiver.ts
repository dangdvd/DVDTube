// This computer as a DVDTube receiver ("Cho phép truyền video tới máy tính này"): commands from
// phones / other PCs (POST /api/play, /api/queue, /api/control, handled by the main process)
// drive the player here, and the player's state is reported back for GET /api/status.

import type { NavigateFunction } from 'react-router-dom'
import type { CastCommand, CastStatus } from '@shared/models'
import { usePlayer } from '@/state/player'
import { settings, useSettings } from '@/state/settings'
import { useCast } from '@/state/cast'
import { api, onEvent } from './api'
import { watchPath } from './nav'
import { toast } from './toast'

function status(): CastStatus {
  const p = usePlayer.getState()
  const s = settings()
  return {
    state: p.current ? p.status : 'idle',
    video: p.current,
    position: Math.max(0, p.currentTime || 0),
    duration: Math.max(0, p.duration || 0),
    volume: s.volume,
    muted: s.muted,
    queue: p.queue.slice(0, 200),
    index: Math.min(p.queueIndex, Math.max(0, Math.min(p.queue.length, 200) - 1)),
    error: p.status === 'error' ? p.error : null,
  }
}

function run(command: CastCommand, navigate: NavigateFunction): void {
  // Being a receiver and a sender at once would send the video straight on.
  if (useCast.getState().connected) void useCast.getState().disconnect(false)
  const p = usePlayer.getState()
  switch (command.type) {
    case 'play': {
      const r = command.request
      const queue = r.queue?.length ? r.queue : undefined
      navigate(watchPath(r.video.id, { list: r.playlistId, t: r.startSeconds ?? null }), {
        state: { video: r.video, queue, index: queue ? (r.index ?? queue.findIndex((v) => v.id === r.video.id)) : undefined },
      })
      // Already on this video: the watch page only seeks; make sure it plays.
      if (p.current?.id === r.video.id) setTimeout(() => usePlayer.getState().resume(), 300)
      toast(`Đang phát từ ${r.sender || 'thiết bị khác'}`)
      return
    }
    case 'queue':
      if (command.next) p.playNext(command.video)
      else p.addToQueue(command.video)
      toast(command.next ? 'Sẽ phát tiếp theo (từ thiết bị khác)' : 'Đã thêm vào hàng đợi (từ thiết bị khác)')
      return
    case 'control': {
      const value = command.value
      switch (command.action) {
        case 'play':
          return p.resume()
        case 'pause':
          return p.pause()
        case 'toggle':
          return p.togglePlay()
        case 'seek':
          return value === null ? undefined : p.seek(value)
        case 'skip':
          return value === null ? undefined : p.seekBy(value)
        case 'next':
          return p.next()
        case 'previous':
          return p.previous()
        case 'stop':
          return p.close()
        case 'volume':
          if (value !== null) useSettings.getState().update({ volume: Math.min(1, Math.max(0, value)), muted: false })
          return
        case 'mute':
          useSettings.getState().update({ muted: value === null ? !settings().muted : value >= 1 })
          return
      }
    }
  }
}

let started = false

export function startCastReceiver(navigate: NavigateFunction): void {
  if (started) return
  started = true
  onEvent('castCommand', (command) => {
    if (!settings().castReceiver) return
    run(command, navigate)
  })
  let last = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const report = () => {
    timer = null
    if (!settings().castReceiver) return
    const next = status()
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    api.castReceiverStatus(next).catch(() => {})
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(report, 400)
  }
  usePlayer.subscribe(schedule)
  useSettings.subscribe((s, prev) => {
    if (s.settings.volume !== prev.settings.volume || s.settings.muted !== prev.settings.muted) schedule()
  })
  schedule()
}
