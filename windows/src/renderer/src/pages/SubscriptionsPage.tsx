// Kênh đăng ký (/feed/subscriptions): the account's feed when signed in, otherwise the newest
// uploads of the local subscriptions grouped by day; "Quản lý" lists the channels with import
// (account / Google Takeout CSV) and export.

import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ChannelItem, VideoItem } from '@shared/models'
import { Avatar } from '@/components/Avatar'
import { Chip } from '@/components/Chips'
import { FeedView } from '@/components/FeedView'
import { Icon } from '@/components/Icon'
import { ErrorState, EmptyState } from '@/components/States'
import { SubscribeButton } from '@/components/SubscribeButton'
import { SkeletonGrid, VideoCard } from '@/components/VideoCard'
import { api, errorMessage } from '@/lib/api'
import { parseSubscriptionsCsv, saveTextFile, subscriptionsCsv } from '@/lib/csv'
import { groupBy, uploadGroup } from '@/lib/dates'
import { useFeed, useLoad } from '@/lib/feed'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useLibrary } from '@/state/library'

function useImporters() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const fromAccount = async () => {
    setBusy(true)
    try {
      const channels = await api.accountSubscriptions()
      const added = useLibrary.getState().importSubscriptions(channels)
      toast(added ? `Đã nhập ${added} kênh` : 'Tất cả kênh của tài khoản đã có trên máy')
    } catch (error) {
      toast('Không nhập được: ' + errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const fromFile = async (file: File) => {
    try {
      const channels = parseSubscriptionsCsv(await file.text())
      if (!channels.length) return toast('Không tìm thấy kênh nào trong tệp')
      const added = useLibrary.getState().importSubscriptions(channels)
      toast(`Đã nhập ${added} kênh`)
    } catch {
      toast('Không đọc được tệp')
    }
  }
  const input = (
    <input
      ref={fileRef}
      type="file"
      accept=".csv,text/csv"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) void fromFile(file)
        e.target.value = ''
      }}
    />
  )
  return { busy, fromAccount, pickFile: () => fileRef.current?.click(), input }
}

function ImportButtons({ signedIn }: { signedIn: boolean }) {
  const importers = useImporters()
  return (
    <>
      {signedIn && (
        <button className="btn btn-tonal" disabled={importers.busy} onClick={() => void importers.fromAccount()} data-testid="import-account">
          <Icon name="download" size={20} />
          Nhập từ tài khoản
        </button>
      )}
      <button
        className="btn btn-tonal"
        onClick={importers.pickFile}
        title="Tệp subscriptions.csv trong bản xuất Google Takeout (YouTube › kênh đăng ký)"
      >
        <Icon name="upload" size={20} />
        Nhập tệp CSV
      </button>
      {importers.input}
    </>
  )
}

function ManageView() {
  const navigate = useNavigate()
  const signedIn = useAccount((s) => s.signedIn)
  const subscriptions = useLibrary((s) => s.subscriptions)
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? subscriptions.filter((c) => c.name.toLowerCase().includes(q) || c.handle?.toLowerCase().includes(q)) : subscriptions
  }, [filter, subscriptions])
  usePageTitle('Quản lý kênh đăng ký')

  return (
    <div className="page page-pad page--narrow" data-testid="subscriptions-manage">
      <div className="page-header">
        <button className="icon-btn" aria-label="Quay lại" onClick={() => navigate(paths.subscriptions)}>
          <Icon name="back" />
        </button>
        <h1 className="page-title">Tất cả kênh đăng ký</h1>
        <span className="page-subtitle">{subscriptions.length} kênh lưu trên máy (không cần tài khoản)</span>
      </div>
      <div className="toolbar">
        <div className="input-with-icon">
          <Icon name="search" size={20} />
          <input className="text-input" placeholder="Tìm kênh" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="toolbar-spacer" />
        <ImportButtons signedIn={signedIn} />
        <button
          className="btn btn-tonal"
          disabled={!subscriptions.length}
          onClick={() => saveTextFile('subscriptions.csv', subscriptionsCsv(subscriptions))}
        >
          <Icon name="download" size={20} />
          Xuất CSV
        </button>
      </div>
      {!subscriptions.length && (
        <EmptyState
          icon="subscriptions"
          title="Chưa đăng ký kênh nào"
          message="Nhấn Đăng ký trên trang kênh, hoặc nhập danh sách kênh từ tài khoản / tệp CSV của Google Takeout."
        />
      )}
      <div className="channel-rows">
        {shown.map((c: ChannelItem) => (
          <div key={c.id} className="channel-row">
            <Link to={paths.channel(c.id)} className="channel-row-main">
              <Avatar src={c.avatar} name={c.name} size={88} />
              <div className="channel-row-text">
                <div className="channel-row-name">{c.name}</div>
                <div className="vcard-meta">{[c.handle, c.subscriberText].filter(Boolean).join(' • ')}</div>
              </div>
            </Link>
            <SubscribeButton channel={c} />
          </div>
        ))}
      </div>
    </div>
  )
}

function LocalFeed({ ids }: { ids: string[] }) {
  const key = ids.join(',')
  const latest = useLoad<VideoItem[]>(ids.length ? `latest:${key}` : null, () => api.latestVideos(ids))
  const hidden = useLibrary((s) => s.notInterested)
  if (latest.loading && !latest.data) return <SkeletonGrid />
  if (latest.error) return <ErrorState message={latest.error} onRetry={latest.reload} />
  const videos = (latest.data ?? []).filter((v) => !hidden.includes(v.id))
  if (!videos.length) return <EmptyState icon="subscriptions" title="Không có video mới" />
  const groups = groupBy(videos, (v) => uploadGroup(v.publishedDate))
  return (
    <div data-testid="subscriptions-feed">
      {groups.map((g) => (
        <section key={g.title} className="feed-section">
          <h2 className="section-title">{g.title}</h2>
          <div className="feed-grid">
            {g.items.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function SubscriptionsPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const signedIn = useAccount((s) => s.signedIn)
  const subscriptions = useLibrary((s) => s.subscriptions)
  const [source, setSource] = useState<'account' | 'local'>('account')
  const useAccountFeed = signedIn && (source === 'account' || !subscriptions.length)
  const feed = useFeed(useAccountFeed ? 'subscriptions:account' : null, () => api.accountFeed('subscriptions'))
  usePageTitle('Kênh đăng ký')

  if (params.get('view') === 'manage') return <ManageView />

  const ids = subscriptions.map((c) => c.id)
  return (
    <div className="page page-pad" data-testid="subscriptions-page">
      <div className="page-header">
        <h1 className="page-title">Mới nhất</h1>
        {signedIn && subscriptions.length > 0 && (
          <div className="chip-row">
            <Chip selected={source === 'account'} onClick={() => setSource('account')}>
              Tài khoản
            </Chip>
            <Chip selected={source === 'local'} onClick={() => setSource('local')}>
              Trên máy
            </Chip>
          </div>
        )}
        <div className="toolbar-spacer" />
        <button className="btn btn-text" onClick={() => navigate(paths.subscriptions + '?view=manage')} data-testid="manage-subscriptions">
          Quản lý
        </button>
      </div>
      {subscriptions.length > 0 && !useAccountFeed && (
        <div className="avatar-strip">
          {subscriptions.slice(0, 14).map((c) => (
            <Link key={c.id} to={paths.channel(c.id)} className="avatar-strip-item" title={c.name}>
              <Avatar src={c.avatar} name={c.name} size={56} />
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
      )}
      {useAccountFeed ? (
        <FeedView feed={feed} layout="grid" testId="subscriptions-feed" emptyTitle="Không có video mới" emptyIcon="subscriptions" />
      ) : subscriptions.length ? (
        <LocalFeed ids={ids} />
      ) : (
        <EmptyState
          icon="subscriptions"
          title="Chưa đăng ký kênh nào"
          message="Nhấn Đăng ký trên trang kênh, đăng nhập Google để dùng kênh đăng ký của tài khoản, hoặc nhập tệp subscriptions.csv từ Google Takeout."
          action={
            <div className="button-row">
              <ImportButtons signedIn={signedIn} />
              {!signedIn && (
                <button className="btn btn-primary" onClick={() => navigate(paths.account)}>
                  Đăng nhập
                </button>
              )}
            </div>
          }
        />
      )}
    </div>
  )
}
