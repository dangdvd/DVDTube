// Nội dung tải xuống (/downloads): downloads in progress (live from `download` events: queued,
// preparing, %, merging, failed with retry, cancel) and finished files (play offline, show in
// Explorer, delete), with the total size.

import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { DownloadState, DownloadedVideo } from '@shared/models'
import { Icon } from '@/components/Icon'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Thumbnail } from '@/components/Thumbnail'
import { api, errorMessage } from '@/lib/api'
import { confirmDialog } from '@/lib/dialogs'
import { formatBytes, useDownloads, type ActiveDownload } from '@/lib/downloads'
import { paths, watchPath } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { useUi } from '@/lib/ui'
import { toast } from '@/lib/toast'
import { useSettings } from '@/state/settings'

function statusText(status: DownloadState): string {
  switch (status.state) {
    case 'queued':
      return 'Đang chờ…'
    case 'preparing':
      return 'Đang chuẩn bị…'
    case 'downloading':
      return `Đang tải ${Math.floor(status.progress * 100)}%`
    case 'merging':
      return 'Đang ghép video và âm thanh…'
    case 'failed':
      return status.message
    default:
      return ''
  }
}

function ActiveRow({ item }: { item: ActiveDownload }) {
  const { cancel, retry, dismiss } = useDownloads.getState()
  const s = item.status
  const progress = s.state === 'downloading' ? s.progress : s.state === 'merging' ? 1 : 0
  const failed = s.state === 'failed'
  return (
    <div className={'dl-row' + (failed ? ' is-failed' : '')} data-testid="download-active">
      <div className="dl-thumb">
        <Thumbnail video={item.video} showProgress={false} />
      </div>
      <div className="dl-text">
        <div className="dl-title">{item.video.title}</div>
        <div className="vcard-meta">{[item.video.channelName, item.audioOnly ? 'Chỉ âm thanh (m4a)' : 'Video'].filter(Boolean).join(' • ')}</div>
        <div className={'dl-status' + (failed ? ' is-error' : '')}>
          {(s.state === 'preparing' || s.state === 'merging' || s.state === 'queued') && <Spinner size={14} />}
          {failed && <Icon name="alert" size={16} />}
          {statusText(s)}
        </div>
        {!failed && (
          <div className={'dl-progress' + (s.state !== 'downloading' ? ' is-indeterminate' : '')}>
            <div style={{ width: `${Math.max(2, progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="dl-actions">
        {failed ? (
          <>
            <button className="btn btn-tonal btn-small" onClick={() => void retry(item.video.id)}>
              <Icon name="refresh" size={18} />
              Thử lại
            </button>
            <button className="icon-btn" aria-label="Bỏ qua" title="Bỏ qua" onClick={() => dismiss(item.video.id)}>
              <Icon name="close" />
            </button>
          </>
        ) : (
          <button className="btn btn-text btn-small" onClick={() => void cancel(item.video.id)}>
            Hủy
          </button>
        )}
      </div>
    </div>
  )
}

function FinishedRow({ item }: { item: DownloadedVideo }) {
  const navigate = useNavigate()
  const play = () => navigate(watchPath(item.video.id), { state: { video: item.video } })
  const date = new Date(item.downloadedAt).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })
  const remove = async () => {
    if (
      !(await confirmDialog({ title: 'Xóa bản tải xuống?', message: `"${item.video.title}" sẽ bị xóa khỏi máy.`, confirmLabel: 'Xóa', danger: true }))
    )
      return
    try {
      await useDownloads.getState().remove(item.video.id)
      toast('Đã xóa bản tải xuống')
    } catch (error) {
      toast(errorMessage(error))
    }
  }
  return (
    <div className="dl-row" data-testid="download-finished">
      <button className="dl-thumb" onClick={play} aria-label="Phát">
        <Thumbnail video={item.video} />
        {item.isAudioOnly && (
          <span className="dl-audio-badge">
            <Icon name="headphones" size={16} />
          </span>
        )}
      </button>
      <div className="dl-text">
        <button className="dl-title" onClick={play} title={item.video.title}>
          {item.video.title}
        </button>
        <div className="vcard-meta">
          {item.video.channelId ? (
            <Link to={paths.channel(item.video.channelId)} className="vcard-channel">
              {item.video.channelName}
            </Link>
          ) : (
            item.video.channelName
          )}
        </div>
        <div className="vcard-meta">
          {[item.isAudioOnly ? 'Chỉ âm thanh' : item.qualityLabel || 'Video', formatBytes(item.fileSize), `Tải ngày ${date}`].join(' • ')}
        </div>
      </div>
      <div className="dl-actions">
        <button className="btn btn-tonal btn-small" onClick={play}>
          <Icon name="play" size={18} />
          Phát
        </button>
        <button
          className="icon-btn"
          aria-label="Mở thư mục"
          title="Mở thư mục"
          onClick={() => void api.showDownload(item.video.id).catch((e) => toast(errorMessage(e)))}
        >
          <Icon name="folder" />
        </button>
        <button className="icon-btn" aria-label="Xóa" title="Xóa" onClick={() => void remove()}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  )
}

export function DownloadsPage() {
  const navigate = useNavigate()
  const active = useDownloads((s) => s.active)
  const finished = useDownloads((s) => s.finished)
  const loaded = useDownloads((s) => s.loaded)
  const error = useDownloads((s) => s.error)
  const folder = useSettings((s) => s.settings.downloadFolder)
  const quality = useSettings((s) => s.settings.downloadQuality)
  const reloadTick = useUi((s) => s.reloadTick)
  usePageTitle('Nội dung tải xuống')

  useEffect(() => {
    void useDownloads.getState().refresh()
  }, [reloadTick])

  const activeList = Object.values(active).sort((a, b) => a.startedAt - b.startedAt)
  const total = finished.reduce((sum, d) => sum + d.fileSize, 0)

  return (
    <div className="page page-pad page--narrow" data-testid="downloads-page">
      <div className="page-header">
        <h1 className="page-title">Nội dung tải xuống</h1>
        <span className="page-subtitle">
          {finished.length} video • {formatBytes(total)}
        </span>
        <div className="toolbar-spacer" />
        <button
          className="btn btn-text"
          onClick={() => navigate(paths.settings + '#tai-xuong')}
          title={`Chất lượng ${quality}p • ${folder ?? 'Video\\DVDTube'}`}
        >
          <Icon name="settings" size={20} />
          Cài đặt tải xuống
        </button>
      </div>
      {activeList.length > 0 && (
        <section className="dl-section">
          <h2 className="section-title">Đang tải xuống</h2>
          {activeList.map((item) => (
            <ActiveRow key={item.video.id} item={item} />
          ))}
        </section>
      )}
      {!loaded && <Spinner />}
      {error && <ErrorState message={error} onRetry={() => void useDownloads.getState().refresh()} />}
      {loaded && !error && !finished.length && !activeList.length && (
        <EmptyState
          icon="download"
          title="Chưa có video tải xuống"
          message="Chọn Tải xuống trong menu ⋮ của video hoặc trên trang video để xem khi không có mạng."
        />
      )}
      {finished.length > 0 && (
        <section className="dl-section">
          {activeList.length > 0 && <h2 className="section-title">Đã tải xuống</h2>}
          {finished.map((item) => (
            <FinishedRow key={item.video.id} item={item} />
          ))}
        </section>
      )}
    </div>
  )
}
