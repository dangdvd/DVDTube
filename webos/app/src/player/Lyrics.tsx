// "Lời bài hát": YouTube Music's lyrics; timed lines are highlighted and scrolled into view with
// the playback position (karaoke style), plain text is shown as paragraphs.

import type { Lyrics } from '@shared/models'
import { useEffect, useRef } from 'preact/hooks'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Loading } from '../ui/base'

export function LyricsPanel({ videoId, time, focusable }: { videoId: string; time: number; focusable?: boolean }) {
  const { data, error, loading } = useAsync<Lyrics | null>(`lyrics:${videoId}`, () => api.lyrics(videoId))
  const box = useRef<HTMLDivElement>(null)
  const lines = data?.lines ?? null
  const ms = time * 1000
  let current = -1
  if (lines && time >= 0) {
    for (let i = 0; i < lines.length; i++) if (lines[i].startMs <= ms) current = i
  }
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.lyric.current')
    const container = box.current
    if (!el || !container) return
    container.scrollTop = Math.max(0, el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2)
  }, [current])
  if (loading) return <Loading />
  if (error) return <div class="lyrics-empty">Không tải được lời bài hát</div>
  if (!data) return <div class="lyrics-empty">Chưa có lời bài hát cho bài này</div>
  return (
    <div class="lyrics" ref={box} data-testid="lyrics">
      {lines
        ? lines.map((line, i) => (
            <div
              key={i}
              class={`lyric${i === current ? ' current' : ''}${i < current ? ' past' : ''}`}
              data-f={focusable ? '' : undefined}
              tabIndex={focusable ? -1 : undefined}
              data-key={`ly-${i}`}
              data-autofocus={focusable && i === 0 ? '' : undefined}
            >
              {line.text || '♪'}
            </div>
          ))
        : data.text.split('\n').map((line, i) => (
            <div
              key={i}
              class="lyric plain"
              data-f={focusable ? '' : undefined}
              tabIndex={focusable ? -1 : undefined}
              data-key={`ly-${i}`}
              data-autofocus={focusable && i === 0 ? '' : undefined}
            >
              {line || ' '}
            </div>
          ))}
      {data.source && <div class="lyrics-source">{data.source}</div>}
    </div>
  )
}
