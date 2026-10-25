// 16:9 (or 9:16 for Shorts) thumbnail with lazy loading, a fallback chain of YouTube's own
// thumbnail sizes, the duration / TRỰC TIẾP / SHORTS badge and the red resume bar.

import { useMemo, useState, type ReactNode } from 'react'
import type { VideoItem } from '@shared/models'
import { displayThumbnail, formatDuration, shortsThumbnail } from '@shared/models'
import { useLoadedImage } from '@/lib/dearrow'
import { useLibrary } from '@/state/library'
import { Icon } from './Icon'

function candidates(video: VideoItem, vertical: boolean): string[] {
  const list = [
    vertical ? shortsThumbnail(video) : null,
    video.thumbnail,
    displayThumbnail(video),
    `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
  ]
  return list.filter((u, i): u is string => !!u && list.indexOf(u) === i)
}

export function durationLabel(video: VideoItem): string | null {
  if (video.durationText) return video.durationText
  if (video.durationSeconds && video.durationSeconds > 0) return formatDuration(video.durationSeconds)
  return null
}

export function Thumbnail({
  video,
  vertical,
  showProgress = true,
  hideBadge,
  overlay,
  className,
  replacement,
}: {
  video: VideoItem
  /** DeArrow thumbnail: shown instead once it has loaded. */
  replacement?: string | null
  /** 9:16 Shorts thumbnail. */
  vertical?: boolean
  showProgress?: boolean
  hideBadge?: boolean
  /** Extra content on top (e.g. "Đang phát"). */
  overlay?: ReactNode
  className?: string
}) {
  const sources = useMemo(() => candidates(video, !!vertical), [video, vertical])
  // Index into `sources` of the image being tried; reset when the video changes.
  const key = sources.join('|')
  const [failed, setFailed] = useState({ key, index: 0 })
  const index = failed.key === key ? failed.index : 0
  const progress = useLibrary((s) => (showProgress ? s.progress[video.id] : undefined))
  const percent = progress && progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0
  const duration = durationLabel(video)
  const branded = useLoadedImage(vertical ? null : (replacement ?? null))
  const src = branded ?? sources[index]

  return (
    <div className={'thumb' + (vertical ? ' thumb--vertical' : '') + (className ? ' ' + className : '')}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => !branded && setFailed({ key, index: index + 1 })}
        />
      ) : (
        <div className="thumb-placeholder">
          <Icon name="play" size={32} />
        </div>
      )}
      {!hideBadge && !vertical && (
        <>
          {video.isLive ? (
            <span className="thumb-badge thumb-badge--live">
              <Icon name="live" size={14} weight={2.2} />
              TRỰC TIẾP
            </span>
          ) : video.isShort ? (
            <span className="thumb-badge">
              <Icon name="shorts" size={14} />
              SHORTS
            </span>
          ) : duration ? (
            <span className="thumb-badge">{duration}</span>
          ) : null}
        </>
      )}
      {percent > 1 && !video.isLive && (
        <div className="thumb-progress" aria-hidden>
          <div style={{ width: `${Math.max(percent, 4)}%` }} />
        </div>
      )}
      {overlay}
    </div>
  )
}
