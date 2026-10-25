// "Bạn" (/feed/library): profile header (or the sign-in card), then rows for Nhật ký xem,
// Danh sách phát (local + account), Xem sau, Video đã thích and Nội dung tải xuống.
// `?tab=playlists` shows every playlist as a grid.

import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { LocalPlaylist, PlaylistItem, VideoItem } from '@shared/models'
import { feedItemKey } from '@shared/models'
import { Avatar } from '@/components/Avatar'
import { PlaylistCard, Shelf } from '@/components/Cards'
import { Icon, type IconName } from '@/components/Icon'
import { EmptyState, ErrorState } from '@/components/States'
import { Switch } from '@/components/Switch'
import { VideoCard, VideoCardSkeleton } from '@/components/VideoCard'
import { switchIdentity } from '@/components/shell/AccountMenu'
import { api } from '@/lib/api'
import { promptDialog } from '@/lib/dialogs'
import { useDownloads } from '@/lib/downloads'
import { useFeed } from '@/lib/feed'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { useSettings } from '@/state/settings'

export function localPlaylistItem(p: LocalPlaylist): PlaylistItem {
  return { id: p.id, title: p.name, thumbnail: p.videos[0]?.thumbnail ?? null, channelName: 'Trên máy', videoCountText: `${p.videos.length} video` }
}

async function createPlaylist(navigate: ReturnType<typeof useNavigate>) {
  const name = await promptDialog({ title: 'Danh sách phát mới', placeholder: 'Tên danh sách phát', confirmLabel: 'Tạo' })
  if (!name) return
  const playlist = useLibrary.getState().createPlaylist(name)
  navigate(paths.localPlaylist(playlist.id))
}

function ProfileHeader() {
  const navigate = useNavigate()
  const { signedIn, profile, identities } = useAccount()
  if (!signedIn || !profile) {
    return (
      <div className="signin-card" data-testid="library-signin">
        <div className="signin-card-icon">
          <Icon name="account" size={56} weight={1.2} />
        </div>
        <div className="signin-card-text">
          <div className="signin-card-title">Đăng nhập YouTube</div>
          <div className="muted">
            Dùng kênh đăng ký, danh sách phát, lượt thích, bình luận và đề xuất của tài khoản Google. Không đăng nhập vẫn dùng được đầy đủ trên máy.
          </div>
        </div>
        <button className="btn btn-signin" onClick={() => navigate(paths.account)}>
          <Icon name="account" size={22} />
          Đăng nhập
        </button>
      </div>
    )
  }
  const others = identities.filter((i) => !i.isSelected)
  return (
    <div className="profile-header" data-testid="library-profile">
      <Avatar src={profile.avatar} name={profile.name} size={120} />
      <div className="profile-text">
        <h1 className="profile-name">{profile.name}</h1>
        <div className="muted">
          {[profile.handle, profile.email].filter(Boolean).join(' • ')}
          {profile.channelId && (
            <>
              {' • '}
              <Link className="link" to={paths.channel(profile.channelId)}>
                Xem kênh
              </Link>
            </>
          )}
        </div>
        <div className="button-row">
          {others.length > 0 && (
            <button className="btn btn-tonal btn-small" onClick={() => void switchIdentity(others[0].id)} title={`Chuyển sang ${others[0].name}`}>
              <Icon name="switchAccount" size={18} />
              Chuyển đổi tài khoản
            </button>
          )}
          <button className="btn btn-tonal btn-small" onClick={() => navigate(paths.account)}>
            <Icon name="account" size={18} />
            Quản lý tài khoản
          </button>
        </div>
      </div>
    </div>
  )
}

function VideoShelf({
  title,
  icon,
  to,
  videos,
  empty,
  testId,
}: {
  title: string
  icon: IconName
  to: string
  videos: VideoItem[]
  empty: string
  testId?: string
}) {
  return (
    <Shelf
      title={
        <Link to={to} className="shelf-title-link">
          {title}
        </Link>
      }
      icon={<Icon name={icon} size={24} />}
      action={
        <Link to={to} className="btn btn-outline btn-small">
          Xem tất cả
        </Link>
      }
      className="shelf--videos"
      testId={testId}
    >
      {videos.length ? (
        videos.slice(0, 16).map((v) => (
          <div key={v.id} className="shelf-video">
            <VideoCard video={v} />
          </div>
        ))
      ) : (
        <div className="shelf-empty">{empty}</div>
      )}
    </Shelf>
  )
}

function usePlaylists() {
  const signedIn = useAccount((s) => s.signedIn)
  const local = useLibrary((s) => s.playlists)
  const remote = useFeed(signedIn ? 'account:playlists' : null, () => api.accountFeed('playlists'))
  return { local, remote, signedIn }
}

function PlaylistsGrid() {
  const navigate = useNavigate()
  const { local, remote, signedIn } = usePlaylists()
  usePageTitle('Danh sách phát')
  return (
    <div className="page page-pad" data-testid="playlists-page">
      <div className="page-header">
        <h1 className="page-title">Danh sách phát</h1>
        <div className="toolbar-spacer" />
        <button className="btn btn-tonal" onClick={() => void createPlaylist(navigate)}>
          <Icon name="plus" size={20} />
          Tạo danh sách phát
        </button>
      </div>
      <h2 className="section-title">Trên máy</h2>
      {local.length ? (
        <div className="feed-grid">
          {local.map((p) => (
            <PlaylistCard key={p.id} playlist={localPlaylistItem(p)} to={paths.localPlaylist(p.id)} />
          ))}
        </div>
      ) : (
        <EmptyState compact icon="playlist" title="Chưa có danh sách phát trên máy." />
      )}
      {signedIn && (
        <>
          <h2 className="section-title">Trên YouTube</h2>
          {remote.loading && (
            <div className="feed-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <VideoCardSkeleton key={i} />
              ))}
            </div>
          )}
          {remote.error && <ErrorState compact message={remote.error} onRetry={remote.reload} />}
          <div className="feed-grid">
            {remote.items.map((item) => (item.type === 'playlist' ? <PlaylistCard key={feedItemKey(item)} playlist={item.playlist} /> : null))}
          </div>
        </>
      )}
    </div>
  )
}

export function LibraryPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const history = useLibrary((s) => s.history)
  const watchLater = useLibrary((s) => s.watchLater)
  const liked = useLibrary((s) => s.liked)
  const downloads = useDownloads((s) => s.finished)
  const incognito = useSettings((s) => s.settings.incognito)
  const { local, remote, signedIn } = usePlaylists()
  usePageTitle(params.get('tab') === 'playlists' ? 'Danh sách phát' : 'Bạn')

  if (params.get('tab') === 'playlists') return <PlaylistsGrid />

  const remotePlaylists = remote.items.flatMap((i) => (i.type === 'playlist' ? [i.playlist] : []))
  return (
    <div className="page page-pad" data-testid="library-page">
      <ProfileHeader />
      {incognito && (
        <div className="info-banner">
          <Icon name="incognito" size={22} />
          <span>Bạn đang ẩn danh: video đã xem và nội dung tìm kiếm không được lưu.</span>
        </div>
      )}
      <VideoShelf
        title="Nhật ký xem"
        icon="history"
        to={paths.history}
        videos={history.map((h) => h.video)}
        empty="Video bạn xem sẽ xuất hiện ở đây."
        testId="library-history"
      />
      <Shelf
        title={
          <Link to={paths.library + '?tab=playlists'} className="shelf-title-link">
            Danh sách phát
          </Link>
        }
        icon={<Icon name="playlist" size={24} />}
        action={
          <div className="button-row">
            <button className="icon-btn" aria-label="Tạo danh sách phát" title="Tạo danh sách phát" onClick={() => void createPlaylist(navigate)}>
              <Icon name="plus" />
            </button>
            <Link to={paths.library + '?tab=playlists'} className="btn btn-outline btn-small">
              Xem tất cả
            </Link>
          </div>
        }
        className="shelf--videos"
        testId="library-playlists"
      >
        {[
          ...local.map((p) => ({ item: localPlaylistItem(p), to: paths.localPlaylist(p.id) })),
          ...remotePlaylists.map((p) => ({ item: p, to: undefined })),
        ].map(({ item, to }) => (
          <div key={item.id} className="shelf-video">
            <PlaylistCard playlist={item} to={to} />
          </div>
        ))}
        {!local.length && !remotePlaylists.length && (
          <div className="shelf-empty">{signedIn && remote.loading ? 'Đang tải…' : 'Chưa có danh sách phát. Nhấn + để tạo.'}</div>
        )}
      </Shelf>
      <VideoShelf
        title="Xem sau"
        icon="watchLater"
        to={paths.watchLater}
        videos={watchLater}
        empty='Chọn "Lưu vào Xem sau" trong menu ⋮ của video.'
      />
      <VideoShelf title="Video đã thích" icon="like" to={paths.liked} videos={liked} empty="Chưa thích video nào." />
      <VideoShelf
        title="Nội dung tải xuống"
        icon="download"
        to={paths.downloads}
        videos={downloads.map((d) => d.video)}
        empty="Tải video xuống để xem khi không có mạng."
      />
      <div className="library-links">
        <Link to={paths.music} className="library-link">
          <Icon name="music" />
          <span>Nghe nhạc</span>
        </Link>
        <Link to={paths.subscriptions + '?view=manage'} className="library-link">
          <Icon name="subscriptions" />
          <span>Quản lý kênh đăng ký</span>
        </Link>
        <label className="library-link">
          <Icon name="incognito" />
          <span>Chế độ ẩn danh</span>
          <Switch checked={incognito} onChange={(v) => useSettings.getState().update({ incognito: v })} />
        </label>
      </div>
    </div>
  )
}
