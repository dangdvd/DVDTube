// Playlist stored on this PC (/local-playlist/:id): rename, delete, remove items, drag-and-drop
// reorder, play all / shuffle (the queue is passed in the router state).

import { useNavigate, useParams } from 'react-router-dom'
import type { VideoItem } from '@shared/models'
import { DraggableRows, PlaylistLayout } from '@/components/PlaylistLayout'
import { EmptyState } from '@/components/States'
import { VideoCard } from '@/components/VideoCard'
import { downloadAll } from '@/lib/actions'
import { confirmDialog, promptDialog } from '@/lib/dialogs'
import { paths, watchPath } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useLibrary } from '@/state/library'
import { shuffled } from './PlaylistPage'

function playQueue(navigate: ReturnType<typeof useNavigate>, queue: VideoItem[], index: number) {
  const video = queue[index]
  if (video) navigate(watchPath(video.id), { state: { video, queue, index } })
}

export function LocalPlaylistPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id))
  usePageTitle(playlist?.name ?? 'Danh sách phát')

  if (!playlist) {
    return (
      <div className="page page-pad">
        <EmptyState
          icon="playlist"
          title="Danh sách phát đã bị xóa"
          action={
            <button className="btn btn-outline" onClick={() => navigate(paths.library)}>
              Về Thư viện
            </button>
          }
        />
      </div>
    )
  }

  const videos = playlist.videos
  const rename = async () => {
    const name = await promptDialog({ title: 'Đổi tên danh sách phát', initial: playlist.name, placeholder: 'Tên danh sách phát' })
    if (name) useLibrary.getState().renamePlaylist(id, name)
  }
  const remove = async () => {
    if (
      !(await confirmDialog({
        title: `Xóa "${playlist.name}"?`,
        message: 'Danh sách phát này sẽ bị xóa khỏi máy.',
        confirmLabel: 'Xóa',
        danger: true,
      }))
    )
      return
    useLibrary.getState().deletePlaylist(id)
    toast('Đã xóa danh sách phát')
    navigate(paths.library, { replace: true })
  }
  const created = new Date(playlist.createdAt).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <PlaylistLayout
      testId="local-playlist-page"
      title={playlist.name}
      owner="Danh sách phát trên máy"
      meta={`${videos.length} video • Tạo ngày ${created}`}
      thumbnail={videos[0]?.thumbnail}
      onPlayAll={videos.length ? () => playQueue(navigate, videos, 0) : undefined}
      onShuffle={videos.length ? () => playQueue(navigate, shuffled(videos), 0) : undefined}
      actions={[
        { icon: 'edit', label: 'Đổi tên', onClick: () => void rename() },
        { icon: 'download', label: 'Tải xuống tất cả', onClick: () => void downloadAll(videos) },
        { icon: 'trash', label: 'Xóa danh sách phát', onClick: () => void remove() },
      ]}
    >
      {!videos.length && (
        <EmptyState icon="playlistAdd" title="Danh sách phát trống" message='Thêm video bằng "Lưu vào danh sách phát" trong menu ⋮ của video.' />
      )}
      <DraggableRows
        videos={videos}
        onMove={(from, to) => useLibrary.getState().moveInPlaylist(id, from, to)}
        render={(video, index) => (
          <VideoCard
            video={video}
            layout="compact"
            index={index + 1}
            onClick={() => playQueue(navigate, videos, index)}
            extraMenu={[
              { label: 'Xóa khỏi danh sách phát', onSelect: () => useLibrary.getState().removeFromPlaylist(id, video.id) },
              ...(index > 0 ? [{ label: 'Chuyển lên đầu', onSelect: () => useLibrary.getState().moveInPlaylist(id, index, 0) }] : []),
              ...(index < videos.length - 1
                ? [{ label: 'Chuyển xuống cuối', onSelect: () => useLibrary.getState().moveInPlaylist(id, index, videos.length - 1) }]
                : []),
            ]}
            onRemove={() => {
              useLibrary.getState().removeFromPlaylist(id, video.id)
              toast(`Đã xóa khỏi ${playlist.name}`, { action: { label: 'Hoàn tác', run: () => restore(id, video, index) } })
            }}
            removeLabel="Xóa khỏi danh sách phát"
          />
        )}
      />
    </PlaylistLayout>
  )
}

function restore(id: string, video: VideoItem, index: number) {
  const library = useLibrary.getState()
  library.addToPlaylist(id, video)
  const list = useLibrary.getState().playlists.find((p) => p.id === id)
  if (list) library.moveInPlaylist(id, list.videos.length - 1, index)
}
