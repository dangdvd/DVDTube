// "Lời bài hát": YouTube Music lyrics of a video; timed lyrics are highlighted line by line and
// scrolled along (click a line to jump there).

import { useEffect, useRef, useState } from 'react'
import type { Lyrics } from '@shared/models'
import { errorMessage } from '@/lib/api'
import { lyricsFor } from '@/state/music'
import { usePlayer } from '@/state/player'

export function LyricsPanel({ videoId, compact }: { videoId: string; compact?: boolean }) {
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const time = usePlayer((s) => (s.current?.id === videoId ? s.currentTime : 0))
  const box = useRef<HTMLDivElement>(null)
  const lastActive = useRef(-1)

  useEffect(() => {
    let alive = true
    setLyrics(undefined)
    setError(null)
    lastActive.current = -1
    lyricsFor(videoId)
      .then((l) => alive && setLyrics(l))
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [videoId])

  const lines = lyrics?.lines ?? null
  const ms = time * 1000
  let active = -1
  if (lines) {
    for (let i = 0; i < lines.length; i++) if (lines[i].startMs <= ms + 150) active = i
  }

  useEffect(() => {
    if (active < 0 || active === lastActive.current) return
    lastActive.current = active
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${active}"]`)
    const container = box.current
    if (el && container) container.scrollTo({ top: el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
  }, [active])

  return (
    <div className={'lyrics' + (compact ? ' lyrics--compact' : '')} data-testid="lyrics-panel">
      {lyrics === undefined && !error && <div className="lyrics-empty">Đang tải lời bài hát…</div>}
      {error && <div className="lyrics-empty">Không tải được lời bài hát: {error}</div>}
      {lyrics === null && <div className="lyrics-empty">Chưa có lời bài hát cho bài này</div>}
      {lyrics && (
        <div className="lyrics-scroll" ref={box}>
          {lines
            ? lines.map((line, i) => (
                <button
                  key={i}
                  data-line={i}
                  className={'lyrics-line' + (i === active ? ' is-active' : i < active ? ' is-past' : '')}
                  onClick={() => usePlayer.getState().current?.id === videoId && usePlayer.getState().seek(line.startMs / 1000)}
                >
                  {line.text || '♪'}
                </button>
              ))
            : lyrics.text.split('\n').map((line, i) => (
                <p key={i} className="lyrics-text-line">
                  {line || ' '}
                </p>
              ))}
          {lyrics.source && <p className="lyrics-source">{lyrics.source}</p>}
        </div>
      )}
    </div>
  )
}
