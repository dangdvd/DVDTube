// Trang chủ: category chips, "Tiếp tục xem", recommendations in rows of ten (more load when the
// last row comes near), Shorts and "Mới từ kênh đăng ký" — like the Android TV home.

import type { FeedItem, HomeCategory, VideoItem } from '@shared/models'
import { HOME_CATEGORIES } from '@shared/models'
import { useState } from 'preact/hooks'
import { api } from '../api'
import { useAsync, usePagedFeed } from '../hooks'
import { useInitialFocus } from '../screen'
import { accountStore } from '../state/account'
import { library, libraryStore } from '../state/library'
import { hidesShorts, parentalStore } from '../state/parental'
import { useStore } from '../store'
import { Button, Chips, LoadMore, Loading, Message, Shelf } from '../ui/base'
import { FeedCard, ShortCard, VideoCard } from '../ui/cards'

const TV_CATEGORIES: HomeCategory[] = ['all', 'music', 'gaming', 'live', 'news', 'sports', 'learning', 'podcasts', 'movies']

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export function useSubscriptionVideos(): { videos: VideoItem[]; loading: boolean; error: string | null; reload(): void } {
  const signedIn = useStore(accountStore, (s) => s.state.signedIn)
  const subs = useStore(libraryStore, (s) => s.subscriptions.map((c) => c.id).join(','))
  const key = signedIn ? 'subs:account' : subs ? `subs:local:${subs}` : null
  const result = useAsync<VideoItem[]>(key, async () => {
    if (signedIn) {
      const page = await api.accountFeed('subscriptions')
      return page.items.flatMap((i) => (i.type === 'video' ? [i.video] : i.type === 'shorts' ? i.items : []))
    }
    return api.latestVideos(subs.split(',').filter(Boolean))
  })
  return { videos: result.data ?? [], loading: result.loading, error: result.error, reload: result.reload }
}

export function HomeScreen() {
  const [category, setCategory] = useState<HomeCategory>('all')
  const session = useStore(accountStore, (s) => (s.state.signedIn ? s.state.profile?.name ?? 'in' : 'out'))
  const feed = usePagedFeed(`home:${category}:${session}`, () => api.home(category))
  const fresh = useSubscriptionVideos()
  const history = useStore(libraryStore, (s) => s.history)
  useStore(libraryStore, (s) => s.notInterested.length + s.blockedChannels.length)
  const parentalKey = useStore(parentalStore, (s) => `${s.config.enabled}${s.config.keywords}${s.config.hideShorts}`)
  void parentalKey

  const visible = (v: VideoItem) => !library.isHidden(v)
  const items = feed.items.filter((i) => i.type !== 'video' || visible(i.video))
  const shorts: VideoItem[] = hidesShorts()
    ? []
    : uniq(items.flatMap((i) => (i.type === 'shorts' ? i.items : i.type === 'video' && i.video.isShort ? [i.video] : [])).filter(visible))
  const regular = items.filter((i): i is Exclude<FeedItem, { type: 'shorts' }> => i.type !== 'shorts' && !(i.type === 'video' && i.video.isShort))
  const rows = chunk(regular, 10)
  const continueWatching =
    category === 'all'
      ? history.filter((h) => !h.video.isShort && h.duration > 0 && h.position / h.duration > 0.03 && h.position / h.duration < 0.95).slice(0, 20)
      : []
  const freshVideos = category === 'all' ? uniq(fresh.videos.filter((v) => !v.isShort && visible(v))).slice(0, 20) : []
  const categoryTitle = HOME_CATEGORIES.find((c) => c.id === category)?.title ?? ''

  useInitialFocus(rows.length > 0 || continueWatching.length > 0 || !!feed.error)

  return (
    <div class="page" data-scroll="y" data-testid="home-feed">
      <Chips
        items={HOME_CATEGORIES.filter((c) => TV_CATEGORIES.includes(c.id))}
        selected={category}
        onSelect={(id) => setCategory(id)}
        keyPrefix="cat"
        testid="home-chips"
      />
      {continueWatching.length > 0 && (
        <Shelf title="Tiếp tục xem" testid="continue-shelf">
          {continueWatching.map((h, i) => (
            <VideoCard
              key={h.video.id}
              video={h.video}
              queue={continueWatching.map((x) => x.video)}
              progress={h.position / h.duration}
              focusKey={`cw-${h.video.id}`}
              autofocus={i === 0}
            />
          ))}
        </Shelf>
      )}
      {rows.map((row, rowIndex) => {
        const queue = row.flatMap((i) => (i.type === 'video' ? [i.video] : []))
        const title = category !== 'all' ? (rowIndex === 0 ? categoryTitle : `Thêm ${categoryTitle.toLowerCase()}`) : rowIndex === 0 ? 'Đề xuất cho bạn' : 'Có thể bạn sẽ thích'
        return (
          <div key={`row-${rowIndex}`}>
            <Shelf title={title} testid={rowIndex === 0 ? 'recommended-shelf' : undefined}>
              {row.map((item, i) => (
                <FeedCard key={i} item={item} queue={queue} prefix={`h${rowIndex}`} autofocus={rowIndex === 0 && i === 0 && continueWatching.length === 0} />
              ))}
            </Shelf>
            {rowIndex === 0 && shorts.length > 0 && (
              <Shelf title="Shorts" testid="shorts-shelf" tall>
                {shorts.slice(0, 20).map((v) => (
                  <ShortCard key={v.id} video={v} list={shorts} focusKey={`hs-${v.id}`} />
                ))}
              </Shelf>
            )}
            {rowIndex === 1 && freshVideos.length > 0 && (
              <Shelf title="Mới từ kênh đăng ký" testid="fresh-shelf">
                {freshVideos.map((v) => (
                  <VideoCard key={v.id} video={v} queue={freshVideos} focusKey={`fr-${v.id}`} />
                ))}
              </Shelf>
            )}
          </div>
        )
      })}
      {feed.loading && items.length === 0 && <Loading />}
      {feed.error && items.length === 0 && (
        <Message title="Không tải được trang chủ" detail={feed.error} icon="refresh">
          <Button label="Thử lại" icon="refresh" onClick={feed.reload} autofocus />
        </Message>
      )}
      {!feed.loading && !feed.error && items.length === 0 && <Message title="Không có nội dung" detail={feed.message} />}
      {feed.loadingMore && <Loading />}
      <LoadMore active={feed.canLoadMore && !feed.loadingMore} onVisible={feed.loadMore} />
    </div>
  )
}

export function uniq(videos: VideoItem[]): VideoItem[] {
  const seen = new Set<string>()
  return videos.filter((v) => !seen.has(v.id) && !!seen.add(v.id))
}
