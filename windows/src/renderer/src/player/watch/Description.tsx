// Description box: views • date, 3 lines until "…thêm", clickable timestamps / links /
// hashtags, and the chapters row when expanded.

import { useEffect, useState } from 'react'
import type { Chapter, WatchInfo } from '@shared/models'
import { formatTime, storyboardFrame } from '@shared/models'
import { usePlayer } from '@/state/player'
import { RichText } from './RichText'

/** Chapter picture: YouTube's thumbnail, else the storyboard frame at its start. */
export function ChapterThumb({ chapter, width = 120 }: { chapter: Chapter; width?: number }) {
  const storyboard = usePlayer((s) => s.info?.storyboard ?? null)
  const duration = usePlayer((s) => s.duration)
  if (chapter.thumbnail) return <img className="dp-chapter-thumb" src={chapter.thumbnail} alt="" style={{ width }} />
  if (!storyboard || duration <= 0) return <div className="dp-chapter-thumb dp-chapter-thumb--empty" style={{ width }} />
  const frame = storyboardFrame(storyboard, chapter.startSeconds + 1, duration)
  const scale = width / frame.width
  return (
    <div
      className="dp-chapter-thumb"
      style={{
        width,
        height: frame.height * scale,
        backgroundImage: `url("${frame.url}")`,
        backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
        backgroundSize: `${storyboard.columns * storyboard.width * scale}px ${storyboard.rows * storyboard.height * scale}px`,
      }}
    />
  )
}

/** Seeks and brings the player back into view. */
export function seekAndShow(seconds: number): void {
  usePlayer.getState().seek(seconds)
  document.querySelector('.dp-watch')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

export function Description({ watch }: { watch: WatchInfo }) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => setExpanded(false), [watch.videoId])
  const seek = seekAndShow
  const meta = [expanded ? watch.viewCountText : watch.shortViewCountText ?? watch.viewCountText, expanded ? watch.dateText : watch.relativeDateText ?? watch.dateText]
    .filter(Boolean)
    .join('  ')
  return (
    <div
      className={'dp-description' + (expanded ? ' dp-description--open' : '')}
      onClick={() => !expanded && setExpanded(true)}
      role={expanded ? undefined : 'button'}
      tabIndex={expanded ? undefined : 0}
      data-testid="watch-description"
    >
      <div className="dp-description-meta">{meta}</div>
      <div className="dp-description-text">{watch.description ? <RichText text={watch.description} onSeek={seek} /> : 'Không có nội dung mô tả.'}</div>
      {expanded && watch.chapters.length ? (
        <div className="dp-description-chapters">
          <div className="dp-section-title">Chương</div>
          <div className="dp-chapter-strip">
            {watch.chapters.map((chapter) => (
              <button key={chapter.startSeconds} type="button" className="dp-chapter-card" onClick={() => seek(chapter.startSeconds)}>
                <ChapterThumb chapter={chapter} />
                <span className="dp-chapter-card-title">{chapter.title}</span>
                <span className="dp-chapter-card-time">{formatTime(chapter.startSeconds)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {expanded ? (
        <button
          type="button"
          className="dp-description-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(false)
          }}
        >
          Ẩn bớt
        </button>
      ) : (
        <span className="dp-description-toggle">…thêm</span>
      )}
    </div>
  )
}
