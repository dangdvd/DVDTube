// Channel (/channel/:id/:tab?): banner, avatar, name, handle • subscribers • videos, the
// description (→ "Giới thiệu" dialog), Đăng ký, tabs with infinite grids, community posts and a
// search box for the channel's own videos.

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ChannelAbout, ChannelPage as ChannelData, ChannelTab, CommunityPost, PostsPage } from '@shared/models'
import { CHANNEL_TABS } from '@shared/models'
import { Avatar } from '@/components/Avatar'
import { FeedView } from '@/components/FeedView'
import { Icon } from '@/components/Icon'
import { InfiniteSentinel } from '@/components/InfiniteScroll'
import { Modal } from '@/components/Modal'
import { CenterSpinner, EmptyState, ErrorState } from '@/components/States'
import { SubscribeButton } from '@/components/SubscribeButton'
import { Tabs } from '@/components/Tabs'
import { VideoCard } from '@/components/VideoCard'
import { api, errorMessage } from '@/lib/api'
import { useFeed, useLoad } from '@/lib/feed'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { useUi } from '@/lib/ui'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { RichText } from '@/components/RichText'

type TabId = ChannelTab | 'search'

function AboutContent({ about, channelName }: { about: ChannelAbout; channelName: string }) {
  const rows: { icon: 'mail' | 'globe' | 'mapPin' | 'info' | 'trending' | 'playlist' | 'you'; text: string }[] = []
  if (about.channelUrl) rows.push({ icon: 'globe', text: about.channelUrl.replace(/^https?:\/\//, '') })
  if (about.subscriberCountText) rows.push({ icon: 'you', text: about.subscriberCountText })
  if (about.videoCountText) rows.push({ icon: 'playlist', text: about.videoCountText })
  if (about.viewCountText) rows.push({ icon: 'trending', text: about.viewCountText })
  if (about.joinedDateText) rows.push({ icon: 'info', text: about.joinedDateText })
  if (about.country) rows.push({ icon: 'mapPin', text: about.country })
  return (
    <div className="about" data-testid="channel-about">
      {about.description && (
        <section>
          <h3>Nội dung mô tả</h3>
          <div className="about-description">
            <RichText text={about.description} />
          </div>
        </section>
      )}
      {about.links.length > 0 && (
        <section>
          <h3>Liên kết</h3>
          {about.links.map((link) => (
            <button key={link.url} className="about-link" onClick={() => void api.openExternal(link.url)}>
              <Icon name="link" size={20} />
              <span>
                <span className="about-link-title">{link.title}</span>
                <span className="link">{link.displayUrl ?? link.url}</span>
              </span>
            </button>
          ))}
        </section>
      )}
      <section>
        <h3>Thông tin khác</h3>
        {rows.map((r) => (
          <div key={r.text} className="about-row">
            <Icon name={r.icon} size={20} />
            <span>{r.text}</span>
          </div>
        ))}
      </section>
      {!about.description && !about.links.length && !rows.length && <p className="muted">{channelName} chưa có phần giới thiệu.</p>}
    </div>
  )
}

function useAbout(id: string, data: ChannelData | null, enabled: boolean) {
  return useLoad<ChannelAbout | null>(enabled && data ? `about:${id}` : null, () => api.channelAbout(id, data?.aboutToken, data?.tabParams.about))
}

function AboutDialog({ id, data, onClose }: { id: string; data: ChannelData; onClose: () => void }) {
  const about = useAbout(id, data, true)
  return (
    <Modal title="Giới thiệu" onClose={onClose} width={560} className="about-dialog">
      {about.loading && <CenterSpinner />}
      {about.error && <ErrorState title="Không tải được thông tin kênh." message={about.error} onRetry={about.reload} compact />}
      {about.data && <AboutContent about={about.data} channelName={data.channel.name} />}
      {!about.loading && !about.error && !about.data && <p className="muted">Kênh chưa có phần giới thiệu.</p>}
    </Modal>
  )
}

function Post({ post }: { post: CommunityPost }) {
  const a = post.attachment
  return (
    <article className="post" data-testid="channel-post">
      <Avatar src={post.authorAvatar} name={post.authorName} size={40} />
      <div className="post-body">
        <div className="post-head">
          <span className="post-author">{post.authorName}</span>
          {post.publishedText && <span className="post-time">{post.publishedText}</span>}
        </div>
        <div className="post-text">
          <RichText text={post.text} />
        </div>
        {a?.type === 'images' && (
          <div className={'post-images' + (a.urls.length > 1 ? ' is-multi' : '')}>
            {a.urls.slice(0, 4).map((url) => (
              <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ))}
          </div>
        )}
        {a?.type === 'video' && (
          <div className="post-video">
            <VideoCard video={a.video} layout="list" />
          </div>
        )}
        {a?.type === 'poll' && (
          <div className="post-poll">
            {a.totalVotes && <div className="post-poll-total">{a.totalVotes}</div>}
            {a.choices.map((c) => (
              <div key={c} className="post-poll-choice">
                {c}
              </div>
            ))}
          </div>
        )}
        <div className="post-actions">
          <span className="post-stat">
            <Icon name="like" size={18} />
            {post.likeCountText ?? ''}
          </span>
          <span className="post-stat">
            <Icon name="dislike" size={18} />
          </span>
          <span className="post-stat">
            <Icon name="comment" size={18} />
            {post.commentCountText ?? ''}
          </span>
        </div>
      </div>
    </article>
  )
}

function PostsTab({ id, params }: { id: string; params?: string | null }) {
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const reloadTick = useUi((s) => s.reloadTick)
  const busy = useRef(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .channelPosts(id, params)
      .then((page) => {
        if (!alive) return
        setPosts(page.posts)
        setToken(page.continuation ?? null)
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [id, params, nonce, reloadTick])

  const more = () => {
    if (!token || busy.current) return
    busy.current = true
    api
      .channelPostsMore(token)
      .then((page: PostsPage) => {
        setPosts((list) => [...list, ...page.posts.filter((p) => !list.some((x) => x.id === p.id))])
        setToken(page.continuation && page.continuation !== token ? page.continuation : null)
      })
      .catch(() => setToken(null))
      .finally(() => (busy.current = false))
  }

  if (loading) return <CenterSpinner />
  if (error) return <ErrorState title="Không tải được bài đăng." message={error} onRetry={() => setNonce(nonce + 1)} />
  if (!posts.length) return <EmptyState icon="comment" title="Kênh chưa có bài đăng nào." />
  return (
    <div className="posts">
      {posts.map((p) => (
        <Post key={p.id} post={p} />
      ))}
      <InfiniteSentinel onMore={more} enabled={!!token} rearmKey={posts.length} />
    </div>
  )
}

function TabContent({ id, data, tab, query }: { id: string; data: ChannelData; tab: TabId; query: string }) {
  const isInitial = tab === data.initialTab
  const feed = useFeed(tab === 'posts' || tab === 'about' ? null : tab === 'search' ? `channel-search:${id}:${query}` : `channel:${id}:${tab}`, () =>
    tab === 'search' ? api.channelSearch(id, query) : isInitial ? Promise.resolve(data.initialPage) : api.channelTab(id, tab, data.tabParams[tab]),
  )
  const about = useAbout(id, data, tab === 'about')

  if (tab === 'posts') return <PostsTab id={id} params={data.tabParams.posts} />
  if (tab === 'about') {
    if (about.loading) return <CenterSpinner />
    if (about.error) return <ErrorState title="Không tải được thông tin kênh." message={about.error} onRetry={about.reload} />
    if (!about.data) return <EmptyState icon="info" title="Kênh chưa có phần giới thiệu." />
    return (
      <div className="about-tab">
        <AboutContent about={about.data} channelName={data.channel.name} />
      </div>
    )
  }
  const empty: Record<string, string> = {
    videos: 'Kênh chưa có video nào',
    shorts: 'Kênh chưa có Shorts',
    streams: 'Kênh chưa có video trực tiếp',
    playlists: 'Kênh chưa có danh sách phát',
    search: 'Không tìm thấy video nào trong kênh',
  }
  return (
    <FeedView
      feed={feed}
      layout={tab === 'shorts' ? 'shorts' : tab === 'search' ? 'list' : 'grid'}
      hideChannel={tab !== 'search'}
      testId="channel-feed"
      emptyTitle={empty[tab] ?? 'Không có nội dung'}
      emptyIcon={tab === 'search' ? 'search' : 'playlist'}
    />
  )
}

function ChannelSearch({ name, initial, onSearch }: { name: string; initial: string; onSearch: (q: string) => void }) {
  const [open, setOpen] = useState(!!initial)
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  return (
    <form
      className={'channel-search' + (open ? ' is-open' : '')}
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSearch(value.trim())
      }}
    >
      <button
        type="button"
        className="icon-btn"
        aria-label="Tìm trong kênh"
        title="Tìm trong kênh"
        onClick={() => (open && value.trim() ? onSearch(value.trim()) : setOpen(!open))}
      >
        <Icon name="search" />
      </button>
      {open && (
        <input
          ref={ref}
          value={value}
          placeholder={`Tìm trong kênh ${name}`}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => !value && setOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && (setValue(''), setOpen(false))}
        />
      )}
    </form>
  )
}

export function ChannelPage() {
  const { id = '', tab: tabParam } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const query = params.get('q') ?? ''
  const myChannel = useAccount((s) => s.profile?.channelId)
  const load = useLoad<ChannelData>(id ? `channel:${id}` : null, () =>
    api.channel(id, CHANNEL_TABS.some((t) => t.tab === tabParam) ? (tabParam as ChannelTab) : undefined),
  )
  const [aboutOpen, setAboutOpen] = useState(false)
  const data = load.data
  usePageTitle(data?.channel.name)

  if (load.loading && !data) return <ChannelSkeleton />
  if (load.error || !data)
    return (
      <div className="page page-pad">
        <ErrorState title="Không tải được kênh." message={load.error} onRetry={load.reload} />
      </div>
    )

  const c = data.channel
  const tabs = CHANNEL_TABS.filter((t) => t.tab === 'videos' || t.tab === 'about' || data.tabParams[t.tab]).map((t) => ({
    id: t.tab as TabId,
    title: t.title,
  }))
  const tab: TabId = tabParam === 'search' ? 'search' : tabs.some((t) => t.id === tabParam) ? (tabParam as ChannelTab) : data.initialTab
  if (tab === 'search') tabs.push({ id: 'search', title: `Kết quả cho "${query}"` })
  const meta = [c.handle, c.subscriberText, c.videoCountText].filter(Boolean)
  const firstLine = (data.description ?? '').split('\n').find((l) => l.trim()) ?? ''

  return (
    <div className="page page--channel" data-testid="channel-page">
      <div className="channel-wrap">
        {data.banner && (
          <div className="channel-banner">
            <img src={data.banner} alt="" referrerPolicy="no-referrer" />
          </div>
        )}
        <header className="channel-header" data-testid="channel-header">
          <Avatar src={c.avatar} name={c.name} size={160} className="channel-avatar" />
          <div className="channel-info">
            <h1 className="channel-name" data-testid="channel-name">
              {c.name}
            </h1>
            <div className="channel-meta">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span className="dot-sep">•</span>}
                  {i === 0 ? <b>{m}</b> : m}
                </span>
              ))}
            </div>
            <button className="channel-description" onClick={() => setAboutOpen(true)}>
              <span className="channel-description-text">{firstLine || 'Tìm hiểu thêm về kênh này'}</span>
              <span className="channel-more">…thêm</span>
            </button>
            <div className="channel-actions">
              {myChannel === c.id ? (
                <button className="btn btn-tonal" onClick={() => void api.openStudio().catch((e) => toast(errorMessage(e)))}>
                  <Icon name="studio" size={20} />
                  Quản lý video
                </button>
              ) : (
                <SubscribeButton key={c.id} channel={c} initial={data.isSubscribed} />
              )}
            </div>
          </div>
        </header>
        <Tabs
          className="channel-tabs"
          tabs={tabs}
          value={tab}
          onChange={(t) =>
            navigate(t === 'search' ? `${paths.channel(id, 'search')}?q=${encodeURIComponent(query)}` : paths.channel(id, t), { replace: true })
          }
          trailing={
            <ChannelSearch
              key={id}
              name={c.name}
              initial={tab === 'search' ? query : ''}
              onSearch={(q) => navigate(`${paths.channel(id, 'search')}?q=${encodeURIComponent(q)}`, { replace: tab === 'search' })}
            />
          }
        />
        <div className="channel-content" data-testid="channel-content">
          <TabContent key={`${id}:${tab}:${query}`} id={id} data={data} tab={tab} query={query} />
        </div>
      </div>
      {aboutOpen && <AboutDialog id={id} data={data} onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function ChannelSkeleton() {
  return (
    <div className="page page--channel" aria-hidden>
      <div className="channel-wrap">
        <div className="channel-banner skeleton" />
        <div className="channel-header">
          <span className="skeleton skeleton-circle" style={{ width: 160, height: 160 }} />
          <div className="channel-info" style={{ flex: 1 }}>
            <div className="skeleton skeleton-line" style={{ width: 280, height: 32 }} />
            <div className="skeleton skeleton-line" style={{ width: 360 }} />
            <div className="skeleton skeleton-line" style={{ width: 420 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
