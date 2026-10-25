// Thư viện (history, Xem sau, liked videos, local playlists; the account's lists when signed in),
// Kênh đăng ký, and the list screens opened from them.

import type { FeedItem, VideoItem } from '@shared/models'
import { feedVideos } from '@shared/models'
import { api } from '../api'
import { usePagedFeed } from '../hooks'
import { play } from '../player/controller'
import { useInitialFocus } from '../screen'
import { accountStore } from '../state/account'
import { library, libraryStore } from '../state/library'
import { nav, toast } from '../state/nav'
import { useStore } from '../store'
import { Button, Grid, LoadMore, Loading, Message, OptionRow, ScreenTitle, SectionTitle, Shelf } from '../ui/base'
import { ChannelCard, FeedCard, PlaylistCard, VideoCard, videoOptions } from '../ui/cards'
import { confirm } from '../ui/dialogs'
import { Icon } from '../ui/icons'
import { useSubscriptionVideos, uniq } from './Home'

function SeeAll({ onClick, focusKey, label = 'Xem tất cả' }: { onClick: () => void; focusKey: string; label?: string }) {
  return (
    <div class="card see-all" data-f tabIndex={-1} role="button" data-key={focusKey} onClick={onClick}>
      <div class="thumb see-all-thumb">
        <Icon name="chevronRight" size={64} />
      </div>
      <div class="card-text">
        <div class="card-title">{label}</div>
      </div>
    </div>
  )
}

export function LibraryScreen() {
  const lib = useStore(libraryStore)
  const signedIn = useStore(accountStore, (s) => s.state.signedIn)
  const history = lib.history.filter((h) => !h.video.isShort).slice(0, 20)
  const empty = !lib.history.length && !lib.watchLater.length && !lib.liked.length && !lib.playlists.length
  useInitialFocus(true)
  return (
    <div class="page" data-scroll="y" data-testid="library-page">
      <ScreenTitle title="Thư viện" subtitle="Trên máy này" />
      {empty && !signedIn && <Message title="Thư viện đang trống" detail="Video bạn xem, lưu vào Xem sau hoặc thích sẽ xuất hiện ở đây." icon="library" />}
      {history.length > 0 && (
        <Shelf title="Nhật ký xem">
          {history.map((h, i) => (
            <VideoCard key={h.video.id} video={h.video} queue={history.map((x) => x.video)} focusKey={`lh-${h.video.id}`} autofocus={i === 0} progress={h.duration ? h.position / h.duration : 0} />
          ))}
          <SeeAll focusKey="lh-all" onClick={() => nav.open({ name: 'localList', list: 'history' })} />
        </Shelf>
      )}
      {lib.watchLater.length > 0 && (
        <Shelf title="Xem sau">
          {lib.watchLater.slice(0, 20).map((v) => (
            <VideoCard key={v.id} video={v} queue={lib.watchLater} focusKey={`lw-${v.id}`} />
          ))}
          <SeeAll focusKey="lw-all" onClick={() => nav.open({ name: 'localList', list: 'watchLater' })} />
        </Shelf>
      )}
      {lib.liked.length > 0 && (
        <Shelf title="Video đã thích">
          {lib.liked.slice(0, 20).map((v) => (
            <VideoCard key={v.id} video={v} queue={lib.liked} focusKey={`ll-${v.id}`} />
          ))}
          <SeeAll focusKey="ll-all" onClick={() => nav.open({ name: 'localList', list: 'liked' })} />
        </Shelf>
      )}
      {lib.playlists.length > 0 && (
        <Shelf title="Danh sách phát">
          {lib.playlists.map((p) => (
            <PlaylistCard
              key={p.id}
              playlist={{ id: p.id, title: p.name, thumbnail: p.videos[0]?.thumbnail ?? (p.videos[0] ? `https://i.ytimg.com/vi/${p.videos[0].id}/hqdefault.jpg` : null), videoCountText: `${p.videos.length} video` }}
              subtitle={`${p.videos.length} video • trên máy này`}
              focusKey={`lp-${p.id}`}
              onClick={() => nav.open({ name: 'localPlaylist', id: p.id })}
            />
          ))}
        </Shelf>
      )}
      {signedIn && (
        <>
          <SectionTitle>Trên YouTube</SectionTitle>
          <div class="option-list">
            <OptionRow title="Nhật ký xem trên YouTube" icon="history" onClick={() => nav.open({ name: 'accountFeed', kind: 'history', title: 'Nhật ký xem trên YouTube' })} />
            <OptionRow title="Xem sau" icon="later" onClick={() => nav.open({ name: 'accountFeed', kind: 'watchLater', title: 'Xem sau' })} />
            <OptionRow title="Video đã thích" icon="like" onClick={() => nav.open({ name: 'accountFeed', kind: 'liked', title: 'Video đã thích' })} />
            <OptionRow title="Tất cả danh sách phát" icon="playlist" onClick={() => nav.open({ name: 'accountFeed', kind: 'playlists', title: 'Danh sách phát' })} />
          </div>
        </>
      )}
    </div>
  )
}

const LIST_TITLES = { history: 'Nhật ký xem', watchLater: 'Xem sau', liked: 'Video đã thích' }

export function LocalListScreen({ list }: { list: 'history' | 'watchLater' | 'liked' }) {
  const lib = useStore(libraryStore)
  const videos: VideoItem[] = list === 'history' ? lib.history.map((h) => h.video) : list === 'watchLater' ? lib.watchLater : lib.liked
  useInitialFocus(true)
  const remove = (v: VideoItem) => {
    if (list === 'history') library.removeHistory(v.id)
    else if (list === 'watchLater') library.toggleWatchLater(v)
    else library.setLiked(v, false)
    toast('Đã xóa')
  }
  return (
    <div class="page" data-scroll="y">
      <ScreenTitle title={LIST_TITLES[list]} subtitle={`${videos.length} video`}>
        {videos.length > 0 && (
          <div class="button-row" data-group>
            <Button label="Phát tất cả" icon="play" accent onClick={() => play(videos[0], { queue: videos, playlistId: 'local' })} />
            {list === 'history' && (
              <Button
                label="Xóa nhật ký xem"
                icon="delete"
                onClick={async () => {
                  if (await confirm('Xóa toàn bộ nhật ký xem trên TV này?', { confirmLabel: 'Xóa', danger: true })) {
                    library.clearHistory()
                    toast('Đã xóa nhật ký xem')
                  }
                }}
              />
            )}
          </div>
        )}
      </ScreenTitle>
      {videos.length === 0 ? (
        <Message title="Chưa có video" />
      ) : (
        <Grid>
          {videos.map((v, i) => (
            <VideoCard key={v.id} video={v} queue={videos} autofocus={i === 0} focusKey={`ls-${v.id}`} onOptions={() => void videoOptions(v, [{ label: 'Xóa khỏi danh sách này', icon: 'delete', run: () => remove(v) }])} />
          ))}
        </Grid>
      )}
    </div>
  )
}

export function LocalPlaylistScreen({ id }: { id: string }) {
  const playlist = useStore(libraryStore, (s) => s.playlists.find((p) => p.id === id) ?? null)
  useInitialFocus(true)
  if (!playlist) return <Message title="Danh sách phát không còn nữa" />
  return (
    <div class="page" data-scroll="y">
      <ScreenTitle title={playlist.name} subtitle={`${playlist.videos.length} video • trên máy này`}>
        <div class="button-row" data-group>
          {playlist.videos.length > 0 && <Button label="Phát tất cả" icon="play" accent onClick={() => play(playlist.videos[0], { queue: playlist.videos, playlistId: 'local' })} />}
          {playlist.videos.length > 1 && (
            <Button
              label="Trộn bài"
              icon="shuffle"
              onClick={() => {
                const shuffled = playlist.videos.slice().sort(() => Math.random() - 0.5)
                play(shuffled[0], { queue: shuffled, playlistId: 'local' })
              }}
            />
          )}
          <Button
            label="Xóa danh sách phát"
            icon="delete"
            onClick={async () => {
              if (await confirm(`Xóa “${playlist.name}”?`, { confirmLabel: 'Xóa', danger: true })) {
                library.deletePlaylist(playlist.id)
                nav.back()
              }
            }}
          />
        </div>
      </ScreenTitle>
      {playlist.videos.length === 0 ? (
        <Message title="Danh sách phát trống" />
      ) : (
        <Grid>
          {playlist.videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              queue={playlist.videos}
              focusKey={`lpv-${v.id}`}
              onOptions={() =>
                void videoOptions(v, [
                  {
                    label: `Xóa khỏi ${playlist.name}`,
                    icon: 'delete',
                    run: () => {
                      library.removeFromPlaylist(playlist.id, v.id)
                      toast(`Đã xóa khỏi ${playlist.name}`)
                    },
                  },
                ])
              }
            />
          ))}
        </Grid>
      )}
    </div>
  )
}

export function AccountFeedScreen({ kind, title }: { kind: 'history' | 'watchLater' | 'liked' | 'playlists' | 'subscriptions'; title: string }) {
  const feed = usePagedFeed(`account:${kind}`, () => api.accountFeed(kind))
  const items = feed.items.filter((i): i is Exclude<FeedItem, { type: 'shorts' }> => i.type !== 'shorts')
  const queue = feedVideos({ items, kind: 'browse' })
  useInitialFocus(items.length > 0 || !!feed.error)
  return (
    <div class="page" data-scroll="y">
      <ScreenTitle title={title} />
      <Grid>
        {items.map((item, i) => (
          <FeedCard key={i} item={item} queue={queue} prefix="af" autofocus={i === 0} />
        ))}
      </Grid>
      {feed.loading && items.length === 0 && <Loading />}
      {feed.error && (
        <Message title="Không tải được nội dung" detail={feed.error}>
          <Button label="Thử lại" icon="refresh" onClick={feed.reload} autofocus />
        </Message>
      )}
      {!feed.loading && !feed.error && items.length === 0 && <Message title="Không có nội dung" />}
      <LoadMore active={feed.canLoadMore && !feed.loadingMore} onVisible={feed.loadMore} />
    </div>
  )
}

export function SubscriptionsScreen() {
  const signedIn = useStore(accountStore, (s) => s.state.signedIn)
  const accountChannels = useStore(accountStore, (s) => s.channels)
  const local = useStore(libraryStore, (s) => s.subscriptions)
  const channels = uniqChannels(signedIn ? [...accountChannels, ...local] : local)
  const { videos, loading, error, reload } = useSubscriptionVideos()
  const list = uniq(videos.filter((v) => !v.isShort && !library.isHidden(v)))
  useInitialFocus(true)
  return (
    <div class="page" data-scroll="y" data-testid="subscriptions-page">
      <ScreenTitle
        title="Kênh đăng ký"
        subtitle={channels.length === 0 ? 'Mở một kênh và chọn Đăng ký để xem video mới của kênh ở đây.' : `${channels.length} kênh`}
      />
      {channels.length > 0 && (
        <Shelf title="Kênh">
          {channels.map((c, i) => (
            <ChannelCard key={c.id} channel={c} focusKey={`sc-${c.id}`} autofocus={i === 0} />
          ))}
        </Shelf>
      )}
      {list.length > 0 && <SectionTitle>Video mới</SectionTitle>}
      <Grid>
        {list.map((v) => (
          <VideoCard key={v.id} video={v} queue={list} focusKey={`sv-${v.id}`} />
        ))}
      </Grid>
      {loading && list.length === 0 && channels.length > 0 && <Loading />}
      {error && (
        <Message title="Không tải được nội dung" detail={error}>
          <Button label="Thử lại" icon="refresh" onClick={reload} />
        </Message>
      )}
      {!loading && channels.length === 0 && <Message title="Chưa đăng ký kênh nào" icon="subscriptions" />}
      {!loading && channels.length > 0 && list.length === 0 && !error && <Message title="Chưa có video mới" />}
    </div>
  )
}

function uniqChannels<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((c) => !seen.has(c.id) && !!seen.add(c.id))
}
