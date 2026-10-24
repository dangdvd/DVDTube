// Right column panels of the watch page: queue / playlist, chapters, related videos.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Chapter, FeedPage, VideoItem } from '@shared/models'
import { feedVideos, formatTime } from '@shared/models'
import { VideoCard } from '@/components/VideoCard'
import { api } from '@/lib/api'
import { watchPath } from '@/lib/nav'
import { useLibrary } from '@/state/library'
import { usePlayer } from '@/state/player'
import { PIcon } from '../ui/icons'
import { useSentinel } from './Comments'
import { ChapterThumb, seekAndShow } from './Description'

export function QueuePanel() {
  const navigate = useNavigate()
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.queueIndex)
  const playlistId = usePlayer((s) => s.playlistId)
  const playlistTitle = usePlayer((s) => (s.watch?.playlist && s.watch.playlist.id === s.playlistId ? s.watch.playlist.title : null))
  const loopQueue = usePlayer((s) => s.loopQueue)
  const shuffled = usePlayer((s) => s.shuffled)
  const [collapsed, setCollapsed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[data-active="true"]')
    if (list && active) list.scrollTop = active.offsetTop - list.offsetTop - 8
  }, [index, collapsed, queue.length])

  if (queue.length < 2 && !playlistId) return null
  const p = usePlayer.getState()
  const open = (video: VideoItem, i: number) => {
    navigate(watchPath(video.id, { list: playlistId, index: playlistId ? i : null }), { state: { video } })
  }

  return (
    <section className="dp-queue" data-testid="queue-panel">
      <div className="dp-queue-head">
        <div className="dp-queue-titles">
          <div className="dp-queue-title">{playlistTitle ?? (playlistId ? 'Danh sách phát' : 'Hàng đợi')}</div>
          <div className="dp-queue-sub">
            {index + 1}/{queue.length}
            {collapsed && queue[index + 1] ? ` • Tiếp theo: ${queue[index + 1].title}` : ''}
          </div>
        </div>
        <button type="button" className="dp-icon-button" aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'} onClick={() => setCollapsed(!collapsed)}>
          <PIcon name={collapsed ? 'chevronDown' : 'chevronUp'} size={22} />
        </button>
      </div>
      {!collapsed ? (
        <>
          <div className="dp-queue-tools">
            <button type="button" className={'dp-icon-button' + (loopQueue ? ' dp-icon-button--on' : '')} aria-pressed={loopQueue} title="Lặp lại danh sách phát" onClick={() => p.setLoopQueue(!loopQueue)}>
              <PIcon name="repeat" size={22} />
            </button>
            <button type="button" className={'dp-icon-button' + (shuffled ? ' dp-icon-button--on' : '')} title="Trộn bài" onClick={() => p.shuffleQueue()}>
              <PIcon name="shuffle" size={22} />
            </button>
          </div>
          <div className="dp-queue-list" ref={listRef}>
            {queue.map((video, i) => (
              <div key={video.id + '-' + i} className="dp-queue-item" data-active={i === index}>
                <VideoCard
                  video={video}
                  layout="compact"
                  active={i === index}
                  index={i + 1}
                  onClick={() => (i === index ? undefined : open(video, i))}
                  extraMenu={i === index ? [] : [{ label: 'Xóa khỏi hàng đợi', onSelect: () => p.removeFromQueue(i) }]}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

const NO_CHAPTERS: Chapter[] = []

export function ChaptersPanel() {
  const chapters = usePlayer((s) => (s.watch && s.watch.videoId === s.current?.id ? s.watch.chapters : NO_CHAPTERS))
  const open = usePlayer((s) => s.chaptersOpen)
  const second = usePlayer((s) => Math.floor(s.currentTime))
  if (!open || !chapters.length) return null
  const active = [...chapters].reverse().find((c) => c.startSeconds <= second) ?? chapters[0]
  return (
    <section className="dp-chapters-panel" data-testid="chapters-panel">
      <div className="dp-panel-head">
        <div className="dp-panel-title">Chương</div>
        <button type="button" className="dp-icon-button" aria-label="Đóng" onClick={() => usePlayer.getState().setChaptersOpen(false)}>
          <PIcon name="close" size={22} />
        </button>
      </div>
      <div className="dp-chapters-list">
        {chapters.map((chapter) => (
          <button
            key={chapter.startSeconds}
            type="button"
            className={'dp-chapter-row' + (chapter === active ? ' dp-chapter-row--active' : '')}
            onClick={() => seekAndShow(chapter.startSeconds)}
          >
            <ChapterThumb chapter={chapter} width={88} />
            <span className="dp-chapter-row-text">
              <span className="dp-chapter-row-title">{chapter.title}</span>
              <span className="dp-chapter-row-time">{formatTime(chapter.startSeconds)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function RelatedList({ page, videoId }: { page: FeedPage; videoId: string }) {
  const [items, setItems] = useState<VideoItem[]>(() => feedVideos(page))
  const [continuation, setContinuation] = useState<string | null>(page.continuation ?? null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const isHidden = useLibrary((s) => s.isHidden)
  useLibrary((s) => s.notInterested.length + s.blockedChannels.length)

  useEffect(() => {
    setItems(feedVideos(page))
    setContinuation(page.continuation ?? null)
    setFailed(false)
  }, [page, videoId])

  const sentinel = useSentinel(() => {
    if (!continuation || loading) return
    setLoading(true)
    api
      .more(continuation, 'next')
      .then((next) => {
        setItems((list) => {
          const seen = new Set(list.map((v) => v.id))
          return [...list, ...feedVideos(next).filter((v) => !seen.has(v.id))]
        })
        setContinuation(next.continuation ?? null)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, !!continuation && !loading && !failed)

  const visible = items.filter((v) => !isHidden(v) && v.id !== videoId)
  return (
    <section className="dp-related" data-testid="related-list">
      {visible.map((video) => (
        <VideoCard key={video.id} video={video} layout="compact" />
      ))}
      {loading ? <div className="dp-loading-line">Đang tải…</div> : null}
      <div ref={sentinel} />
    </section>
  )
}
