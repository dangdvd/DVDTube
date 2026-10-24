// "Lưu vào danh sách phát": local playlists + the account's playlists when signed in, and
// "Tạo danh sách phát mới". OWNED BY THE UI PAGES MODULE (stub); the watch page uses it.
import type { VideoItem } from '@shared/models'

export function SaveToPlaylistDialog({ onClose }: { video: VideoItem; onClose: () => void }) {
  return <div onClick={onClose} />
}
