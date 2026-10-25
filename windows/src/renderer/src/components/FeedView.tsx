// Renders feed items (videos, channels, playlists, Shorts shelves) as a responsive grid or as
// wide rows, with the loading skeleton, empty / error states and infinite scrolling.

import type { ReactNode } from 'react'
import type { FeedItem, VideoItem } from '@shared/models'
import { feedItemKey } from '@shared/models'
import type { Feed } from '@/lib/feed'
import { useLibrary } from '@/state/library'
import { blockedByKeywords, useParental } from '@/state/parental'
import { useSettings } from '@/state/settings'
import { ChannelCard, PlaylistCard, ShortsCard, ShortsShelf } from './Cards'
import { Icon, type IconName } from './Icon'
import { InfiniteSentinel } from './InfiniteScroll'
import { EmptyState, ErrorState } from './States'
import { SkeletonGrid, VideoCard } from './VideoCard'

/** Drops hidden videos / channels and (when the setting is on) Shorts. */
export function useVisibleItems(items: FeedItem[]): FeedItem[] {
  const notInterested = useLibrary((s) => s.notInterested)
  const blocked = useLibrary((s) => s.blockedChannels)
  const parental = useParental((s) => s.config)
  const hideShorts = useSettings((s) => s.settings.hideShorts) || (parental.enabled && parental.hideShorts)
  const hidden = (v: VideoItem) =>
    notInterested.includes(v.id) || (!!v.channelId && blocked.includes(v.channelId)) || (hideShorts && !!v.isShort) || blockedByKeywords(v)
  const result: FeedItem[] = []
  for (const item of items) {
    if (item.type === 'video') {
      if (!hidden(item.video)) result.push(item)
    } else if (item.type === 'shorts') {
      if (hideShorts) continue
      const shorts = item.items.filter((v) => !hidden(v))
      if (shorts.length) result.push({ type: 'shorts', items: shorts })
    } else if (item.type === 'channel') {
      if (!blocked.includes(item.channel.id) && !blockedByKeywords({ title: item.channel.name, channelName: item.channel.name })) result.push(item)
    } else if (item.type === 'playlist') {
      if (!blockedByKeywords({ title: item.playlist.title, channelName: item.playlist.channelName })) result.push(item)
    } else {
      result.push(item)
    }
  }
  return result
}

export type FeedLayout = 'grid' | 'list' | 'shorts'

export function FeedItems({ items, layout, hideChannel }: { items: FeedItem[]; layout: FeedLayout; hideChannel?: boolean }) {
  const visible = useVisibleItems(items)
  if (layout === 'shorts') {
    const videos = visible.flatMap((item) => (item.type === 'video' ? [item.video] : item.type === 'shorts' ? item.items : []))
    return (
      <>
        {videos.map((v) => (
          <ShortsCard key={v.id} video={v} queue={videos} />
        ))}
      </>
    )
  }
  return (
    <>
      {visible.map((item) => {
        const key = feedItemKey(item)
        switch (item.type) {
          case 'video':
            return <VideoCard key={key} video={item.video} layout={layout} hideChannel={hideChannel} />
          case 'channel':
            return <ChannelCard key={key} channel={item.channel} layout={layout} />
          case 'playlist':
            return <PlaylistCard key={key} playlist={item.playlist} layout={layout} />
          case 'shorts':
            return (
              <div key={key} className="feed-fullrow">
                <ShortsShelf items={item.items} />
              </div>
            )
        }
      })}
    </>
  )
}

export function FeedView({
  feed,
  layout = 'grid',
  emptyTitle = 'Không có nội dung',
  emptyIcon = 'info',
  emptyMessage,
  testId,
  header,
  hideChannel,
  skeletonCount,
}: {
  feed: Feed
  layout?: FeedLayout
  emptyTitle?: string
  emptyIcon?: IconName
  emptyMessage?: ReactNode
  testId?: string
  /** Shown above the items once loaded (e.g. "Tiếp tục xem"). */
  header?: ReactNode
  hideChannel?: boolean
  skeletonCount?: number
}) {
  if (feed.loading && !feed.items.length) {
    if (layout === 'shorts') return <ShortsSkeleton count={skeletonCount ?? 12} />
    return <SkeletonGrid layout={layout} count={skeletonCount ?? (layout === 'grid' ? 12 : 6)} />
  }
  if (feed.error && !feed.items.length) return <ErrorState message={feed.error} onRetry={feed.reload} />
  if (!feed.items.length) {
    return (
      <>
        {header}
        <EmptyState icon={emptyIcon} title={feed.message || emptyTitle} message={emptyMessage} testId="feed-empty" />
      </>
    )
  }
  return (
    <>
      {header}
      <div className={layout === 'grid' ? 'feed-grid' : layout === 'shorts' ? 'shorts-grid' : 'feed-list'} data-testid={testId}>
        <FeedItems items={feed.items} layout={layout} hideChannel={hideChannel} />
      </div>
      <InfiniteSentinel onMore={feed.more} enabled={!!feed.continuation && !feed.moreError} loading={feed.loadingMore} rearmKey={feed.items.length} />
      {feed.moreError && (
        <div className="feed-more-error">
          <span>{feed.moreError}</span>
          <button className="btn btn-outline btn-small" onClick={feed.more}>
            <Icon name="refresh" size={18} />
            Thử lại
          </button>
        </div>
      )}
    </>
  )
}

export function ShortsSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="shorts-grid" data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="scard" aria-hidden>
          <div className="thumb thumb--vertical skeleton" />
          <div className="skeleton skeleton-line" style={{ width: '85%', marginTop: 10 }} />
          <div className="skeleton skeleton-line" style={{ width: '40%' }} />
        </div>
      ))}
    </div>
  )
}
