// A channel (banner, avatar, Đăng ký, tabs Video / Shorts / Trực tiếp / Danh sách phát) and a
// YouTube playlist (Phát tất cả, Trộn bài, Lưu vào danh sách phát trên máy).

import type { ChannelItem, ChannelTab, FeedItem, PlaylistItem } from '@shared/models'
import { CHANNEL_TABS, feedVideos, isMix } from '@shared/models'
import { useState } from 'preact/hooks'
import { api } from '../api'
import { useAsync, usePagedFeed } from '../hooks'
import { play } from '../player/controller'
import { useInitialFocus } from '../screen'
import { accountStore } from '../state/account'
import { library, libraryStore } from '../state/library'
import { toast } from '../state/nav'
import { hidesShorts } from '../state/parental'
import { useStore } from '../store'
import { Avatar, Button, Chips, Grid, LazyImg, LoadMore, Loading, Message } from '../ui/base'
import { FeedCard } from '../ui/cards'

const TABS: ChannelTab[] = ['videos', 'shorts', 'streams', 'playlists']

export function ChannelScreen({ channel }: { channel: Pick<ChannelItem, 'id' | 'name'> & Partial<ChannelItem> }) {
  const [tab, setTab] = useState<ChannelTab>('videos')
  const page = useAsync(`channel:${channel.id}`, () => api.channel(channel.id, 'videos'))
  const data = page.data
  const browseId = data?.channel.id ?? channel.id
  const feed = usePagedFeed(data ? `channel:${browseId}:${tab}` : null, () =>
    tab === 'videos' && data ? Promise.resolve(data.initialPage) : api.channelTab(browseId, tab, data?.tabParams[tab] ?? null),
  )
  const signedIn = useStore(accountStore, (s) => s.state.signedIn)
  useStore(libraryStore, (s) => s.subscriptions.length)
  const [remote, setRemote] = useState<boolean | null>(null)
  const info: ChannelItem = { ...channel, ...(data?.channel ?? {}) } as ChannelItem
  const subscribed = library.isSubscribed(info.id) || (remote ?? data?.isSubscribed ?? false)
  const items = feed.items.filter((i): i is Exclude<FeedItem, { type: 'shorts' }> => i.type !== 'shorts' && !(i.type === 'video' && library.isHidden(i.video)))
  const queue = feedVideos({ items, kind: 'browse' })
  const tabs = CHANNEL_TABS.filter((t) => TABS.includes(t.tab) && (t.tab !== 'shorts' || !hidesShorts()))
  useInitialFocus(!!data || !!page.error)

  const toggle = () => {
    if (subscribed) library.unsubscribe(info.id)
    else library.subscribe({ id: info.id, name: info.name, avatar: info.avatar ?? null, handle: info.handle ?? null, subscriberText: info.subscriberText ?? null })
    if (signedIn) api.subscribe(info.id, !subscribed).catch(() => {})
    setRemote(!subscribed)
    toast(subscribed ? `Đã hủy đăng ký ${info.name}` : `Đã đăng ký ${info.name}`)
  }

  return (
    <div class="page" data-scroll="y" data-testid="channel-page">
      {page.loading && !data && <Loading />}
      {page.error && (
        <Message title="Không tải được kênh" detail={page.error}>
          <Button label="Thử lại" icon="refresh" onClick={page.reload} autofocus />
        </Message>
      )}
      {data && (
        <>
          {data.banner && (
            <div class="channel-banner">
              <LazyImg src={data.banner} eager />
            </div>
          )}
          <div class="channel-header" data-testid="channel-header">
            <Avatar src={info.avatar} name={info.name} size={140} />
            <div class="channel-info">
              <h1 data-testid="channel-name">{info.name}</h1>
              <div class="screen-subtitle">{[info.handle, info.subscriberText, info.videoCountText].filter(Boolean).join(' • ')}</div>
              {data.description && <div class="channel-description">{data.description}</div>}
            </div>
            <div class="button-row" data-group>
              <Button label={subscribed ? 'Đã đăng ký' : 'Đăng ký'} icon={subscribed ? 'check' : 'subscribe'} accent={!subscribed} selected={subscribed} onClick={toggle} autofocus testid="subscribe" />
              {queue.length > 0 && tab !== 'playlists' && <Button label="Phát tất cả" icon="play" onClick={() => play(queue[0], { queue })} />}
            </div>
          </div>
          <Chips items={tabs.map((t) => ({ id: t.tab, title: t.title }))} selected={tab} onSelect={setTab} keyPrefix="ct" />
          <Grid columns={tab === 'shorts' ? 6 : 4} testid="channel-content">
            {items.map((item, i) => (
              <FeedCard key={i} item={item} queue={queue} prefix={`ch-${tab}`} />
            ))}
          </Grid>
          {feed.loading && <Loading />}
          {feed.error && <Message title="Không tải được nội dung" detail={feed.error} />}
          {!feed.loading && !feed.error && items.length === 0 && <Message title="Kênh chưa có nội dung ở mục này" />}
          <LoadMore active={feed.canLoadMore && !feed.loadingMore} onVisible={feed.loadMore} />
        </>
      )}
    </div>
  )
}

export function PlaylistScreen({ playlist }: { playlist: Pick<PlaylistItem, 'id' | 'title'> & Partial<PlaylistItem> }) {
  const page = useAsync(`playlist:${playlist.id}`, () => api.playlist(playlist.id))
  const data = page.data
  const feed = usePagedFeed(data ? `playlist-feed:${playlist.id}` : null, () => Promise.resolve(data!.page))
  const items = feed.items.filter((i): i is Exclude<FeedItem, { type: 'shorts' }> => i.type !== 'shorts')
  const queue = feedVideos({ items, kind: 'browse' })
  const info = data?.playlist ?? playlist
  useInitialFocus(!!data || !!page.error)
  const playlistId = isMix(playlist.id) || playlist.id.startsWith('PL') || playlist.id.startsWith('OLAK') ? playlist.id : null
  return (
    <div class="page" data-scroll="y" data-testid="playlist-page">
      {page.loading && <Loading />}
      {page.error && (
        <Message title="Không tải được nội dung" detail={page.error}>
          <Button label="Thử lại" icon="refresh" onClick={page.reload} autofocus />
        </Message>
      )}
      {data && (
        <>
          <div class="playlist-header">
            {info.thumbnail && <LazyImg src={info.thumbnail} class="playlist-header-art" eager />}
            <div>
              <h1>{info.title}</h1>
              <div class="screen-subtitle">{[info.channelName, info.videoCountText].filter(Boolean).join(' • ')}</div>
              <div class="button-row" data-group>
                <Button label="Phát tất cả" icon="play" accent autofocus onClick={() => queue.length && play(queue[0], { queue, playlistId })} />
                <Button
                  label="Trộn bài"
                  icon="shuffle"
                  onClick={() => {
                    const shuffled = queue.slice().sort(() => Math.random() - 0.5)
                    if (shuffled.length) play(shuffled[0], { queue: shuffled, playlistId })
                  }}
                />
                <Button
                  label="Lưu trên TV này"
                  icon="add"
                  onClick={() => {
                    const created = library.createPlaylist(info.title)
                    for (const v of queue) library.addToPlaylist(created.id, v)
                    toast(`Đã tạo ${created.name}`)
                  }}
                />
              </div>
            </div>
          </div>
          <Grid>
            {items.map((item, i) => (
              <FeedCard key={i} item={item} queue={queue} prefix="pl" />
            ))}
          </Grid>
          {!feed.loading && items.length === 0 && <Message title="Danh sách phát trống" />}
          <LoadMore active={feed.canLoadMore && !feed.loadingMore} onVisible={feed.loadMore} />
        </>
      )}
    </div>
  )
}
