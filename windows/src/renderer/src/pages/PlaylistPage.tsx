// YouTube playlist (/playlist?list=…). Mixes (RD…) open straight in the watch page; WL / LL are
// the account's Watch later / Liked lists (signed in) or the local lists (signed out).

import { useEffect } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import type { PlaylistItem, VideoItem } from '@shared/models'
import { feedVideos, isMix } from '@shared/models'
import { InfiniteSentinel } from '@/components/InfiniteScroll'
import { PlainRows, PlaylistLayout } from '@/components/PlaylistLayout'
import { EmptyState, ErrorState } from '@/components/States'
import { VideoCard, VideoCardSkeleton } from '@/components/VideoCard'
import { copyText, downloadAll } from '@/lib/actions'
import { api, errorMessage } from '@/lib/api'
import { confirmDialog } from '@/lib/dialogs'
import { useFeed } from '@/lib/feed'
import { paths, watchPath } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'

/** Playlist headers by id, so going back to a cached page still shows its header. */
const infos = new Map<string, PlaylistItem>()

export function shuffled<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function PlaylistPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const list = params.get('list') ?? ''
  const signedIn = useAccount((s) => s.signedIn)
  const accountLoaded = useAccount((s) => s.loaded)
  const special = list === 'WL' || list === 'LL'
  const mix = isMix(list) && list.length >= 13

  useEffect(() => {
    if (mix) navigate(watchPath(list.slice(2, 13), { list }), { replace: true })
  }, [mix, list, navigate])

  const feed = useFeed(!list || mix || (special && !signedIn) ? null : `playlist:${list}`, async () => {
    if (special) {
      const page = await api.accountFeed(list === 'WL' ? 'watchLater' : 'liked')
      infos.set(list, { id: list, title: list === 'WL' ? 'Xem sau' : 'Video đã thích', channelName: useAccount.getState().profile?.name ?? null })
      return page
    }
    const result = await api.playlist(list)
    infos.set(list, result.playlist)
    return result.page
  })
  const info = infos.get(list)
  usePageTitle(info?.title ?? 'Danh sách phát')

  if (special && accountLoaded && !signedIn) return <Navigate to={list === 'WL' ? paths.watchLater : paths.liked} replace />
  if (!list)
    return (
      <div className="page page-pad">
        <EmptyState icon="playlist" title="Không tìm thấy danh sách phát" />
      </div>
    )

  const videos = feedVideos({ items: feed.items, kind: feed.kind })
  const firstThumb = info?.thumbnail ?? videos[0]?.thumbnail ?? null
  const play = (index: number, list2: VideoItem[] = videos, shuffle = false) => {
    const video = list2[index]
    if (!video) return
    if (shuffle) navigate(watchPath(video.id), { state: { video, queue: list2, index } })
    else navigate(watchPath(video.id, { list, index }), { state: { video } })
  }

  const saveCopy = async () => {
    try {
      const all = special ? videos : await api.playlistVideos(list, 500)
      const copy = useLibrary.getState().importPlaylist(info?.title ?? 'Danh sách phát', all)
      toast(`Đã lưu "${copy.name}" vào thư viện (${all.length} video)`, {
        action: { label: 'Xem', run: () => navigate(paths.localPlaylist(copy.id)) },
      })
    } catch (error) {
      toast(errorMessage(error))
    }
  }
  const downloadEverything = async () => {
    const all = special ? videos : await api.playlistVideos(list, 500).catch(() => videos)
    if (
      !(await confirmDialog({
        title: `Tải xuống ${all.length} video?`,
        message: 'Video được tải lần lượt theo chất lượng tải xuống trong Cài đặt.',
        confirmLabel: 'Tải xuống',
      }))
    )
      return
    await downloadAll(all)
  }

  return (
    <PlaylistLayout
      testId="playlist-page"
      title={info?.title ?? (feed.loading ? '' : 'Danh sách phát')}
      owner={info?.channelName}
      meta={info?.videoCountText ?? (videos.length ? `${videos.length} video` : null)}
      thumbnail={firstThumb}
      onPlayAll={videos.length ? () => play(0) : undefined}
      onShuffle={videos.length ? () => play(0, shuffled(videos), true) : undefined}
      actions={[
        ...(special ? [] : [{ icon: 'playlistAdd' as const, label: 'Lưu vào thư viện', onClick: () => void saveCopy() }]),
        { icon: 'download', label: 'Tải xuống tất cả', onClick: () => void downloadEverything() },
        {
          icon: 'share',
          label: 'Sao chép đường liên kết',
          onClick: () => void copyText(`https://www.youtube.com/playlist?list=${list}`).then(() => toast('Đã sao chép đường liên kết')),
        },
      ]}
    >
      {feed.loading && !feed.items.length && (
        <div className="plist-rows">
          {Array.from({ length: 8 }, (_, i) => (
            <VideoCardSkeleton key={i} layout="compact" />
          ))}
        </div>
      )}
      {feed.error && <ErrorState message={feed.error} onRetry={feed.reload} />}
      {!feed.loading && !feed.error && !videos.length && (
        <EmptyState
          icon="playlist"
          title="Danh sách phát trống"
          message={
            special ? (
              <Link className="link" to={list === 'WL' ? paths.watchLater : paths.liked}>
                Xem danh sách trên máy
              </Link>
            ) : undefined
          }
        />
      )}
      <PlainRows
        videos={videos}
        render={(video, index) => <VideoCard video={video} layout="compact" index={index + 1} onClick={() => play(index)} />}
      />
      <InfiniteSentinel onMore={feed.more} enabled={!!feed.continuation && !feed.moreError} loading={feed.loadingMore} rearmKey={feed.items.length} />
    </PlaylistLayout>
  )
}
