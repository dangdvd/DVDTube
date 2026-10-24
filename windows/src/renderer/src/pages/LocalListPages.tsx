// Xem sau (/feed/watch-later) and Video đã thích (/feed/liked): the local lists, plus the
// account's lists when signed in (source chips "Trên máy" / "Trên YouTube").

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { VideoItem } from '@shared/models'
import { feedVideos } from '@shared/models'
import { Chip } from '@/components/Chips'
import { InfiniteSentinel } from '@/components/InfiniteScroll'
import { PlainRows, PlaylistLayout } from '@/components/PlaylistLayout'
import { EmptyState, ErrorState } from '@/components/States'
import { VideoCard, VideoCardSkeleton } from '@/components/VideoCard'
import { downloadAll } from '@/lib/actions'
import { api } from '@/lib/api'
import { confirmDialog } from '@/lib/dialogs'
import { useFeed } from '@/lib/feed'
import { watchPath } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { shuffled } from './PlaylistPage'

type Source = 'local' | 'account'

function ListPage({ kind }: { kind: 'watchLater' | 'liked' }) {
  const navigate = useNavigate()
  const signedIn = useAccount((s) => s.signedIn)
  const profile = useAccount((s) => s.profile)
  const local = useLibrary((s) => (kind === 'watchLater' ? s.watchLater : s.liked))
  const [source, setSource] = useState<Source>('local')
  const useAccountList = signedIn && source === 'account'
  const feed = useFeed(useAccountList ? `account:${kind}` : null, () => api.accountFeed(kind))
  const title = kind === 'watchLater' ? 'Xem sau' : 'Video đã thích'
  usePageTitle(title)

  const videos: VideoItem[] = useAccountList ? feedVideos({ items: feed.items, kind: feed.kind }) : local
  const play = (queue: VideoItem[], index: number) => {
    const video = queue[index]
    if (!video) return
    if (useAccountList) navigate(watchPath(video.id, { list: kind === 'watchLater' ? 'WL' : 'LL', index }), { state: { video } })
    else navigate(watchPath(video.id), { state: { video, queue, index } })
  }
  const removeLocal = (video: VideoItem) => {
    const library = useLibrary.getState()
    if (kind === 'watchLater') library.toggleWatchLater(video)
    else library.setLiked(video, false)
    toast(kind === 'watchLater' ? 'Đã xóa khỏi Xem sau' : 'Đã xóa khỏi Video đã thích', {
      action: {
        label: 'Hoàn tác',
        run: () => (kind === 'watchLater' ? useLibrary.getState().toggleWatchLater(video) : useLibrary.getState().setLiked(video, true)),
      },
    })
  }
  const clearAll = async () => {
    if (
      !(await confirmDialog({
        title: `Xóa tất cả video khỏi ${title}?`,
        message: 'Chỉ xóa danh sách trên máy này.',
        confirmLabel: 'Xóa tất cả',
        danger: true,
      }))
    )
      return
    const library = useLibrary.getState()
    for (const v of [...local]) {
      if (kind === 'watchLater') library.toggleWatchLater(v)
      else library.setLiked(v, false)
    }
  }

  const toolbar = signedIn ? (
    <div className="plist-toolbar">
      <Chip selected={source === 'local'} onClick={() => setSource('local')}>
        Trên máy ({local.length})
      </Chip>
      <Chip selected={source === 'account'} onClick={() => setSource('account')} testId="source-account">
        Trên YouTube
      </Chip>
    </div>
  ) : null

  return (
    <PlaylistLayout
      testId={kind === 'watchLater' ? 'watch-later-page' : 'liked-page'}
      title={title}
      owner={useAccountList ? profile?.name : 'Trên máy này'}
      meta={`${videos.length} video${useAccountList && feed.continuation ? '+' : ''}`}
      thumbnail={videos[0]?.thumbnail}
      onPlayAll={videos.length ? () => play(videos, 0) : undefined}
      onShuffle={videos.length ? () => play(shuffled(videos), 0) : undefined}
      actions={[
        { icon: 'download', label: 'Tải xuống tất cả', onClick: () => void downloadAll(videos) },
        ...(!useAccountList && local.length ? [{ icon: 'trash' as const, label: 'Xóa tất cả', onClick: () => void clearAll() }] : []),
      ]}
      toolbar={toolbar}
    >
      {useAccountList && feed.loading && !feed.items.length && (
        <div className="plist-rows">
          {Array.from({ length: 8 }, (_, i) => (
            <VideoCardSkeleton key={i} layout="compact" />
          ))}
        </div>
      )}
      {useAccountList && feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
      {!videos.length && !(useAccountList && (feed.loading || feed.error)) && (
        <EmptyState
          icon={kind === 'watchLater' ? 'watchLater' : 'like'}
          title={kind === 'watchLater' ? 'Chưa có video nào' : 'Chưa thích video nào'}
          message={kind === 'watchLater' ? 'Chọn "Lưu vào Xem sau" trong menu ⋮ của video.' : 'Nhấn 👍 trên trang video để lưu video bạn thích.'}
        />
      )}
      <PlainRows
        videos={videos}
        render={(video, index) => (
          <VideoCard
            video={video}
            layout="compact"
            index={index + 1}
            onClick={() => play(videos, index)}
            onRemove={useAccountList ? undefined : removeLocal}
            removeLabel={kind === 'watchLater' ? 'Xóa khỏi Xem sau' : 'Xóa khỏi Video đã thích'}
          />
        )}
      />
      {useAccountList && (
        <InfiniteSentinel
          onMore={feed.more}
          enabled={!!feed.continuation && !feed.moreError}
          loading={feed.loadingMore}
          rearmKey={feed.items.length}
        />
      )}
    </PlaylistLayout>
  )
}

export function WatchLaterPage() {
  return <ListPage key="wl" kind="watchLater" />
}

export function LikedPage() {
  return <ListPage key="ll" kind="liked" />
}
