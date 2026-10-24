// YouTube-style progress bar: buffered / played per chapter segment (with gaps), SponsorBlock
// segments, the "most replayed" heatmap on hover, a time tooltip with the storyboard frame
// and the chapter title, and dragging with a live preview.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Chapter, HeatMarker } from '@shared/models'
import { formatTime, storyboardFrame } from '@shared/models'
import { usePlayer } from '@/state/player'
import { mainVideo, sponsorTitle } from '../controller'

const SPONSOR_COLORS: Record<string, string> = {
  sponsor: '#00d400',
  selfpromo: '#ffff00',
  interaction: '#cc00ff',
  intro: '#00ffff',
  outro: '#0202ed',
  preview: '#008fd6',
  music_offtopic: '#ff9900',
  filler: '#7300ff',
}

const NO_CHAPTERS: Chapter[] = []
const NO_HEATMAP: HeatMarker[] = []
const PREVIEW_WIDTH = 160

function heatmapPath(markers: HeatMarker[], duration: number): string {
  if (!markers.length || duration <= 0) return ''
  const points = markers.map((m) => ({
    x: Math.min(1, Math.max(0, (m.start + m.duration / 2) / duration)) * 1000,
    y: 100 - Math.min(1, Math.max(0, m.intensity)) * 90,
  }))
  let d = `M0 100 L0 ${points[0].y} L${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const mid = (a.x + b.x) / 2
    d += ` C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`
  }
  return d + ` L1000 ${points[points.length - 1].y} L1000 100 Z`
}

export function ProgressBar({ onScrub }: { onScrub?: (scrubbing: boolean) => void }) {
  const duration = usePlayer((s) => s.duration)
  const live = usePlayer((s) => s.live)
  const seekStart = usePlayer((s) => (s.live ? s.seekStart : 0))
  const chapters = usePlayer((s) => (s.watch && s.watch.videoId === s.current?.id ? s.watch.chapters : NO_CHAPTERS))
  const heatmap = usePlayer((s) => (s.watch && s.watch.videoId === s.current?.id ? s.watch.heatmap : NO_HEATMAP))
  const sponsor = usePlayer((s) => s.sponsorSegments)
  const storyboard = usePlayer((s) => s.info?.storyboard ?? null)
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)
  const lastSeek = useRef(0)

  const span = Math.max(0, duration - seekStart)
  const timeAt = (fraction: number) => seekStart + fraction * span

  // Played / buffered are written straight to CSS variables every frame: smooth without
  // re-rendering React 60 times a second.
  useEffect(() => {
    let frame = 0
    const update = () => {
      const el = ref.current
      if (el) {
        const video = mainVideo()
        const s = usePlayer.getState()
        const total = Math.max(0.001, s.duration - (s.live ? s.seekStart : 0))
        const played = dragRef.current ?? Math.min(1, Math.max(0, (video.currentTime - (s.live ? s.seekStart : 0)) / total))
        const buffered = Math.min(1, Math.max(0, (s.buffered - (s.live ? s.seekStart : 0)) / total))
        el.style.setProperty('--p', played.toFixed(5))
        el.style.setProperty('--b', buffered.toFixed(5))
      }
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])

  const segments = useMemo(() => {
    if (!chapters.length || span <= 0 || live) return [{ start: 0, length: 1 }]
    const starts = chapters.map((c) => Math.min(1, Math.max(0, c.startSeconds / span))).filter((v, i, a) => i === 0 || v > a[i - 1])
    if (starts[0] > 0) starts.unshift(0)
    return starts.map((start, i) => ({ start, length: (starts[i + 1] ?? 1) - start })).filter((s) => s.length > 0)
  }, [chapters, span, live])

  const heatPath = useMemo(() => (live ? '' : heatmapPath(heatmap, duration)), [heatmap, duration, live])

  const fractionAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || span <= 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const f = fractionAt(event.clientX)
    dragRef.current = f
    setDrag(f)
    onScrub?.(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const f = fractionAt(event.clientX)
    setHover(f)
    if (dragRef.current == null) return
    dragRef.current = f
    setDrag(f)
    // Live preview: seek while dragging when the target is already buffered.
    const now = performance.now()
    const video = mainVideo()
    const target = timeAt(f)
    if (now - lastSeek.current > 250) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (target >= video.buffered.start(i) && target <= video.buffered.end(i)) {
          lastSeek.current = now
          usePlayer.getState().seek(target)
          break
        }
      }
    }
  }
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    if (dragRef.current == null) return
    const f = dragRef.current
    dragRef.current = null
    setDrag(null)
    onScrub?.(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (commit) usePlayer.getState().seek(timeAt(f))
  }

  const shown = drag ?? hover
  const shownTime = shown != null ? timeAt(shown) : 0
  const chapter = shown != null && chapters.length ? [...chapters].reverse().find((c) => c.startSeconds <= shownTime) : undefined
  const frame = shown != null && storyboard && span > 0 ? storyboardFrame(storyboard, shownTime, duration) : null
  const scale = frame ? PREVIEW_WIDTH / frame.width : 1
  const sponsorAt = shown != null ? sponsor.find((s) => shownTime >= s.start && shownTime < s.end) : undefined
  const tooltipWidth = frame ? PREVIEW_WIDTH : 120
  const rectWidth = ref.current?.getBoundingClientRect().width ?? 0
  const tooltipLeft = shown != null ? Math.min(Math.max(0, shown * rectWidth - tooltipWidth / 2), Math.max(0, rectWidth - tooltipWidth)) : 0

  return (
    <div
      ref={ref}
      className={'dp-progress' + (drag != null ? ' dp-progress--drag' : '') + (hover != null ? ' dp-progress--hover' : '')}
      style={{ '--h': hover ?? 0 } as CSSProperties}
      role="slider"
      aria-label="Thanh tiến trình"
      aria-valuemin={0}
      aria-valuemax={Math.round(span)}
      data-testid="player-progress"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finishDrag(e, true)}
      onPointerCancel={(e) => finishDrag(e, false)}
      onPointerLeave={() => dragRef.current == null && setHover(null)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {heatPath ? (
        <svg className="dp-heatmap" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={heatPath} />
        </svg>
      ) : null}
      <div className="dp-progress-track">
        {segments.map((segment, i) => (
          <div key={i} className="dp-segment" style={{ width: `${segment.length * 100}%`, '--s': segment.start, '--l': segment.length } as CSSProperties}>
            <div className="dp-segment-buffered" />
            <div className="dp-segment-hover" />
            <div className="dp-segment-played" />
          </div>
        ))}
        {span > 0 && !live
          ? sponsor.map((s) => (
              <div
                key={s.start}
                className="dp-sponsor"
                title={sponsorTitle(s)}
                style={{
                  left: `${(Math.max(0, s.start - seekStart) / span) * 100}%`,
                  width: `${Math.max(0.2, ((s.end - s.start) / span) * 100)}%`,
                  background: SPONSOR_COLORS[s.category] ?? '#00d400',
                }}
              />
            ))
          : null}
      </div>
      <div className="dp-scrubber" />
      {shown != null && span > 0 ? (
        <div className="dp-tooltip" style={{ left: tooltipLeft, width: tooltipWidth }}>
          {frame ? (
            <div
              className="dp-tooltip-frame"
              style={{
                height: frame.height * scale,
                backgroundImage: `url("${frame.url}")`,
                backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
                backgroundSize: `${storyboard!.columns * storyboard!.width * scale}px ${storyboard!.rows * storyboard!.height * scale}px`,
              }}
            />
          ) : null}
          {chapter ? <div className="dp-tooltip-chapter">{chapter.title}</div> : null}
          {sponsorAt ? <div className="dp-tooltip-sponsor">{sponsorTitle(sponsorAt)}</div> : null}
          <div className="dp-tooltip-time">{live ? '-' + formatTime(duration - shownTime) : formatTime(shownTime)}</div>
        </div>
      ) : null}
    </div>
  )
}
