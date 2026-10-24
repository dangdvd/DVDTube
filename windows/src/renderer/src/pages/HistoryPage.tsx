// Nhật ký xem (/feed/history): grouped by day with resume bars, search, remove entries, clear
// all, pause history; the account's YouTube history as a second source when signed in.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryEntry } from '@shared/models'
import { Chip } from '@/components/Chips'
import { FeedView } from '@/components/FeedView'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/States'
import { VideoCard } from '@/components/VideoCard'
import { api } from '@/lib/api'
import { groupBy, dayTitle } from '@/lib/dates'
import { confirmDialog } from '@/lib/dialogs'
import { useFeed } from '@/lib/feed'
import { watchPath } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'
import { useSettings } from '@/state/settings'

export function HistoryPage() {
  const navigate = useNavigate()
  const history = useLibrary((s) => s.history)
  const signedIn = useAccount((s) => s.signedIn)
  const paused = useSettings((s) => s.settings.pauseWatchHistory)
  const incognito = useSettings((s) => s.settings.incognito)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'local' | 'account'>('local')
  const accountFeed = useFeed(signedIn && source === 'account' ? 'account:history' : null, () => api.accountFeed('history'))
  usePageTitle('Nhật ký xem')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return history
    return history.filter((h) => h.video.title.toLowerCase().includes(q) || h.video.channelName?.toLowerCase().includes(q))
  }, [history, query])
  const groups = groupBy(filtered, (h: HistoryEntry) => dayTitle(h.watchedAt))

  const remove = (entry: HistoryEntry) => {
    useLibrary.getState().removeHistory(entry.video.id)
    toast('Đã xóa khỏi nhật ký xem', {
      action: { label: 'Hoàn tác', run: () => useLibrary.getState().restoreHistory(entry) },
    })
  }
  const clearAll = async () => {
    if (
      !(await confirmDialog({
        title: 'Xóa toàn bộ nhật ký xem?',
        message: 'Nhật ký xem và vị trí đang xem dở trên máy này sẽ bị xóa.',
        confirmLabel: 'Xóa nhật ký xem',
        danger: true,
      }))
    )
      return
    useLibrary.getState().clearHistory()
    toast('Đã xóa nhật ký xem')
  }

  return (
    <div className="page page-pad history-page" data-testid="history-page">
      <h1 className="page-title history-title">Nhật ký xem</h1>
      <div className="history-layout">
        <div className="history-main">
          {signedIn && (
            <div className="chip-row history-sources">
              <Chip selected={source === 'local'} onClick={() => setSource('local')}>
                Trên máy
              </Chip>
              <Chip selected={source === 'account'} onClick={() => setSource('account')} testId="history-account">
                Trên YouTube
              </Chip>
            </div>
          )}
          {(paused || incognito) && (
            <div className="info-banner">
              <Icon name={incognito ? 'incognito' : 'pause'} size={22} />
              <span>
                {incognito ? 'Bạn đang ẩn danh: video đã xem không được lưu.' : 'Nhật ký xem đang tạm dừng: video mới xem không được thêm vào đây.'}
              </span>
            </div>
          )}
          {source === 'account' && signedIn ? (
            <FeedView feed={accountFeed} layout="list" emptyTitle="Chưa có video nào trong nhật ký" emptyIcon="history" />
          ) : !filtered.length ? (
            <EmptyState
              icon="history"
              title={query ? 'Không tìm thấy video nào' : 'Chưa có video nào trong nhật ký'}
              message={query ? undefined : 'Video bạn xem sẽ xuất hiện ở đây.'}
            />
          ) : (
            groups.map((g) => (
              <section key={g.title} className="history-group">
                <h2 className="section-title">{g.title}</h2>
                <div className="feed-list">
                  {g.items.map((entry) => (
                    <VideoCard
                      key={entry.video.id}
                      video={entry.video}
                      layout="list"
                      onRemove={() => remove(entry)}
                      removeLabel="Xóa khỏi nhật ký xem"
                      onClick={(video) => navigate(watchPath(video.id), { state: { video } })}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
        <aside className="history-side">
          <div className="input-with-icon input-underline">
            <Icon name="search" size={22} />
            <input placeholder="Tìm kiếm trong nhật ký xem" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="history-search" />
            {query && (
              <button className="icon-btn" aria-label="Xóa" onClick={() => setQuery('')}>
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
          <button className="side-action" onClick={() => void clearAll()} disabled={!history.length}>
            <Icon name="trash" />
            Xóa toàn bộ nhật ký xem
          </button>
          <button
            className="side-action"
            onClick={() => {
              useSettings.getState().update({ pauseWatchHistory: !paused })
              toast(paused ? 'Đã bật lại nhật ký xem' : 'Đã tạm dừng nhật ký xem')
            }}
            data-testid="pause-history"
          >
            <Icon name={paused ? 'play' : 'pause'} />
            {paused ? 'Bật nhật ký xem' : 'Tạm dừng nhật ký xem'}
          </button>
          <p className="muted small">Nhật ký xem được lưu trên máy này. Tạm dừng nhật ký vẫn nhớ chỗ bạn đang xem dở.</p>
        </aside>
      </div>
    </div>
  )
}
