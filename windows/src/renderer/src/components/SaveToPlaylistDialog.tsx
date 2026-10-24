// "Lưu video vào…": Xem sau, the local playlists, the account's playlists when signed in, and
// "Tạo danh sách phát mới" (on this PC or on YouTube). Every checkbox applies immediately.

import { useEffect, useState } from 'react'
import type { AccountPlaylistOption, VideoItem } from '@shared/models'
import { api, errorMessage } from '@/lib/api'
import { toggleWatchLater } from '@/lib/actions'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { Spinner } from './States'

function CheckRow({
  checked,
  label,
  detail,
  onChange,
  icon,
}: {
  checked: boolean
  label: string
  detail?: string
  onChange: () => void
  icon?: 'lock' | 'globe' | 'watchLater'
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="check-box">{checked && <Icon name="check" size={16} weight={3} />}</span>
      <span className="check-label">{label}</span>
      {detail && <span className="check-detail">{detail}</span>}
      {icon && <Icon name={icon} size={18} className="check-icon" />}
    </label>
  )
}

export function SaveToPlaylistDialog({ video, onClose }: { video: VideoItem; onClose: () => void }) {
  const signedIn = useAccount((s) => s.signedIn)
  const playlists = useLibrary((s) => s.playlists)
  const inWatchLater = useLibrary((s) => s.watchLater.some((v) => v.id === video.id))
  const [remote, setRemote] = useState<AccountPlaylistOption[] | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    api
      .playlistOptions(video.id)
      .then((list) => alive && setRemote(list))
      .catch((error) => alive && setRemoteError(errorMessage(error)))
    return () => {
      alive = false
    }
  }, [signedIn, video.id])

  const toggleLocal = (id: string, title: string, contains: boolean) => {
    const library = useLibrary.getState()
    if (contains) {
      library.removeFromPlaylist(id, video.id)
      toast(`Đã xóa khỏi ${title}`)
    } else {
      library.addToPlaylist(id, video)
      toast(`Đã lưu vào ${title}`)
    }
  }

  const toggleRemote = async (option: AccountPlaylistOption) => {
    const contains = option.containsVideo
    setRemote((list) => list?.map((p) => (p.id === option.id ? { ...p, containsVideo: !contains } : p)) ?? null)
    try {
      await api.editPlaylist(option.id, contains ? null : video.id, contains ? video.id : null)
      toast(contains ? `Đã xóa khỏi ${option.title}` : `Đã lưu vào ${option.title}`)
    } catch (error) {
      setRemote((list) => list?.map((p) => (p.id === option.id ? { ...p, containsVideo: contains } : p)) ?? null)
      toast('Không cập nhật được danh sách phát: ' + errorMessage(error))
    }
  }

  const create = async (onAccount: boolean) => {
    const title = name.trim()
    if (!title) return
    if (!onAccount) {
      useLibrary.getState().createPlaylist(title, video)
      toast(`Đã tạo "${title}" và lưu video`)
      onClose()
      return
    }
    setBusy(true)
    try {
      const id = await api.createPlaylist(title, video.id)
      toast(`Đã tạo "${title}" (riêng tư) và lưu video`)
      if (id) setRemote((list) => [{ id, title, containsVideo: true }, ...(list ?? [])])
      onClose()
    } catch (error) {
      toast('Không tạo được danh sách phát: ' + errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Lưu video vào…" onClose={onClose} width={380} className="save-dialog" testId="save-dialog">
      <div className="save-list">
        <CheckRow checked={inWatchLater} label="Xem sau" onChange={() => toggleWatchLater(video)} icon="watchLater" />
        {playlists.length > 0 && <div className="save-section">Danh sách phát trên máy</div>}
        {playlists.map((p) => {
          const contains = p.videos.some((v) => v.id === video.id)
          return (
            <CheckRow
              key={p.id}
              checked={contains}
              label={p.name}
              detail={`${p.videos.length}`}
              onChange={() => toggleLocal(p.id, p.name, contains)}
            />
          )
        })}
        {signedIn && (
          <>
            <div className="save-section">Danh sách phát trên YouTube</div>
            {!remote && !remoteError && (
              <div className="save-loading">
                <Spinner size={24} />
              </div>
            )}
            {remoteError && <div className="save-error">{remoteError}</div>}
            {remote?.map((p) => (
              <CheckRow key={p.id} checked={p.containsVideo} label={p.title} onChange={() => void toggleRemote(p)} icon="lock" />
            ))}
          </>
        )}
      </div>
      {creating ? (
        <div className="save-create">
          <label className="field-label" htmlFor="new-playlist-name">
            Tên
          </label>
          <input
            id="new-playlist-name"
            className="text-input"
            autoFocus
            maxLength={150}
            placeholder="Nhập tên danh sách phát…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create(false)}
          />
          <div className="save-create-actions">
            <button className="btn btn-text" onClick={() => setCreating(false)}>
              Hủy
            </button>
            {signedIn && (
              <button className="btn btn-tonal" disabled={!name.trim() || busy} onClick={() => void create(true)}>
                Tạo trên YouTube
              </button>
            )}
            <button className="btn btn-accent" disabled={!name.trim() || busy} onClick={() => void create(false)}>
              {signedIn ? 'Tạo trên máy' : 'Tạo'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-text save-new" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          Tạo danh sách phát mới
        </button>
      )}
    </Modal>
  )
}
