// Playlist-style page: the big header card on the left (blurred thumbnail background, title,
// owner, count, ▶ Phát tất cả / 🔀 Trộn bài and icon actions) and the numbered rows on the
// right. Used by YouTube playlists, local playlists, Xem sau and Video đã thích.

import { useState, type ReactNode } from 'react'
import type { VideoItem } from '@shared/models'
import { Icon, type IconName } from './Icon'

export interface HeaderAction {
  icon: IconName
  label: string
  onClick: () => void
  testId?: string
}

export function PlaylistLayout({
  title,
  owner,
  meta,
  thumbnail,
  description,
  onPlayAll,
  onShuffle,
  actions,
  menu,
  children,
  toolbar,
  testId,
}: {
  title: string
  owner?: ReactNode
  meta?: ReactNode
  thumbnail?: string | null
  description?: ReactNode
  onPlayAll?: () => void
  onShuffle?: () => void
  actions?: HeaderAction[]
  /** Extra node at the end of the icon actions (e.g. a ⋮ MenuButton). */
  menu?: ReactNode
  children: ReactNode
  /** Above the list (e.g. source chips). */
  toolbar?: ReactNode
  testId?: string
}) {
  return (
    <div className="page plist-page" data-testid={testId}>
      <aside className="plist-header">
        {thumbnail && <div className="plist-header-bg" style={{ backgroundImage: `url("${thumbnail}")` }} aria-hidden />}
        <div className="plist-header-content">
          <button className="plist-cover" onClick={onPlayAll} disabled={!onPlayAll} aria-label="Phát tất cả">
            {thumbnail ? (
              <img src={thumbnail} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="thumb-placeholder">
                <Icon name="playlist" size={48} />
              </div>
            )}
            {onPlayAll && (
              <span className="plist-cover-hover">
                <Icon name="play" size={20} />
                PHÁT TẤT CẢ
              </span>
            )}
          </button>
          <h1 className="plist-title">{title}</h1>
          {owner && <div className="plist-owner">{owner}</div>}
          {meta && <div className="plist-meta">{meta}</div>}
          {(actions?.length || menu) && (
            <div className="plist-icon-actions">
              {actions?.map((a) => (
                <button
                  key={a.label}
                  className="icon-btn icon-btn--glass"
                  aria-label={a.label}
                  title={a.label}
                  onClick={a.onClick}
                  data-testid={a.testId}
                >
                  <Icon name={a.icon} />
                </button>
              ))}
              {menu}
            </div>
          )}
          <div className="plist-buttons">
            <button className="btn btn-primary" onClick={onPlayAll} disabled={!onPlayAll} data-testid="play-all">
              <Icon name="play" size={20} />
              Phát tất cả
            </button>
            <button className="btn btn-glass" onClick={onShuffle} disabled={!onShuffle}>
              <Icon name="shuffle" size={20} />
              Trộn bài
            </button>
          </div>
          {description && <div className="plist-description">{description}</div>}
        </div>
      </aside>
      <section className="plist-items" data-testid="playlist-items">
        {toolbar}
        {children}
      </section>
    </div>
  )
}

/** Rows that can be reordered by dragging (local playlists). */
export function DraggableRows({
  videos,
  onMove,
  render,
}: {
  videos: VideoItem[]
  onMove: (from: number, to: number) => void
  render: (video: VideoItem, index: number) => ReactNode
}) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  return (
    <div className="plist-rows">
      {videos.map((video, index) => (
        <div
          key={video.id}
          className={
            'plist-row is-draggable' +
            (dragging === index ? ' is-dragging' : '') +
            (over === index && dragging !== null && dragging !== index ? (dragging < index ? ' drop-after' : ' drop-before') : '')
          }
          draggable
          onDragStart={(e) => {
            setDragging(index)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(index))
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (over !== index) setOver(index)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOver(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            const from = Number(e.dataTransfer.getData('text/plain'))
            if (Number.isFinite(from) && from !== index) onMove(from, index)
            setDragging(null)
            setOver(null)
          }}
        >
          <span className="plist-drag" title="Kéo để sắp xếp" aria-hidden>
            <Icon name="drag" size={20} />
          </span>
          {render(video, index)}
        </div>
      ))}
    </div>
  )
}

export function PlainRows({ videos, render }: { videos: VideoItem[]; render: (video: VideoItem, index: number) => ReactNode }) {
  return (
    <div className="plist-rows">
      {videos.map((video, index) => (
        <div key={video.id + ':' + index} className="plist-row">
          {render(video, index)}
        </div>
      ))}
    </div>
  )
}
