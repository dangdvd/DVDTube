// Nghe nhạc: YouTube Music search with tabs (Bài hát / Video / Album / Nghệ sĩ / Danh sách
// phát), recently played songs, and album / artist / playlist pages. Songs play in music mode
// (artwork + lyrics, audio only by default, the next song follows without a gap).

import type { MusicItem, MusicSearchKind, VideoItem } from '@shared/models'
import { MUSIC_SEARCH_KINDS } from '@shared/models'
import { useState } from 'preact/hooks'
import { api } from '../api'
import { useAsync } from '../hooks'
import { play } from '../player/controller'
import { useInitialFocus } from '../screen'
import { nav } from '../state/nav'
import { createStore, loadJson, saveSoon, useStore } from '../store'
import { Button, Chips, Grid, Loading, Message, ScreenTitle, Shelf } from '../ui/base'
import { MusicCard, TrackRow } from '../ui/cards'
import { SearchField } from './Search'

// MARK: Recently played songs

const recentStore = createStore<{ items: MusicItem[] }>({ items: loadJson<MusicItem[]>('music-recent') ?? [] })

export function rememberSong(item: MusicItem): void {
  const items = [item, ...recentStore.get().items.filter((i) => i.id !== item.id)].slice(0, 30)
  recentStore.set({ items })
  saveSoon('music-recent', () => recentStore.get().items, 500)
}

function playable(item: MusicItem): boolean {
  return (item.type === 'song' || item.type === 'video') && !!item.video
}

function asVideo(item: MusicItem): VideoItem {
  return item.video ?? { id: item.id, title: item.title, channelName: item.artists ?? null, thumbnail: item.thumbnail ?? null, durationText: item.durationText ?? null }
}

/** Plays a song / video item (in the context of its list) or opens an album / artist / playlist. */
export function openMusicItem(item: MusicItem, context: MusicItem[]): void {
  if (playable(item)) {
    const queue = context.filter(playable).map(asVideo)
    rememberSong(item)
    play(asVideo(item), { queue, music: true })
    return
  }
  nav.open({ name: 'musicBrowse', browseId: item.id, title: item.title })
}

export function MusicScreen() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [kind, setKind] = useState<MusicSearchKind>('songs')
  const recent = useStore(recentStore, (s) => s.items)
  const results = useAsync(submitted ? `music:${kind}:${submitted}` : null, () => api.musicSearch(submitted, kind))
  const items = results.data?.items ?? []
  useInitialFocus(true)

  return (
    <div class="page" data-scroll="y" data-testid="music-page">
      <ScreenTitle title="Nghe nhạc" />
      <SearchField
        value={query}
        onChange={setQuery}
        onSubmit={(q) => {
          setQuery(q)
          setSubmitted(q)
        }}
        placeholder="Tìm bài hát, nghệ sĩ, album…"
        focusKey="music-box"
        autofocus
        testid="music-search"
      />
      {submitted && <Chips items={MUSIC_SEARCH_KINDS} selected={kind} onSelect={setKind} keyPrefix="mk" testid="music-tabs" />}
      {submitted ? (
        results.loading ? (
          <Loading />
        ) : results.error ? (
          <Message title="Không tìm được" detail={results.error}>
            <Button label="Thử lại" icon="refresh" onClick={results.reload} />
          </Message>
        ) : items.length === 0 ? (
          <Message title="Không tìm thấy kết quả" />
        ) : kind === 'songs' ? (
          <div class="track-grid" data-testid="music-results">
            {items.map((item, i) => (
              <TrackRow key={item.id} item={item} index={i} onClick={() => openMusicItem(item, items)} focusKey={`mr-${item.id}`} />
            ))}
          </div>
        ) : (
          <Grid columns={kind === 'videos' ? 4 : 5} testid="music-results">
            {items.map((item) => (
              <MusicCard key={item.id} item={item} onClick={() => openMusicItem(item, items)} focusKey={`mc-${item.id}`} />
            ))}
          </Grid>
        )
      ) : recent.length > 0 ? (
        <Shelf title="Nghe gần đây">
          {recent.map((item) => (
            <MusicCard key={item.id} item={item} onClick={() => openMusicItem(item, recent)} focusKey={`mrc-${item.id}`} />
          ))}
        </Shelf>
      ) : (
        <div class="hint">Tìm một bài hát để bắt đầu nghe (chỉ âm thanh, bài sau nối tiếp bài trước)</div>
      )}
    </div>
  )
}

export function MusicBrowseScreen({ browseId, title }: { browseId: string; title: string }) {
  const page = useAsync(`music-browse:${browseId}`, () => api.musicBrowse(browseId))
  const data = page.data
  useInitialFocus(!!data || !!page.error)
  const allTracks = data ? data.shelves.flatMap((s) => s.items).filter(playable) : []
  return (
    <div class="page" data-scroll="y" data-testid="music-browse">
      {page.loading && <Loading />}
      {page.error && (
        <Message title="Không tải được trang này" detail={page.error}>
          <Button label="Thử lại" icon="refresh" onClick={page.reload} autofocus />
        </Message>
      )}
      {data && (
        <>
          <div class={`music-header${data.kind === 'artist' ? ' artist' : ''}`}>
            {data.thumbnail && <img class="music-header-art" src={data.thumbnail} alt="" />}
            <div>
              <h1>{data.title || title}</h1>
              {data.subtitle && <div class="screen-subtitle">{data.subtitle}</div>}
              {data.description && <div class="music-description">{data.description}</div>}
              {allTracks.length > 0 && (
                <div class="button-row" data-group>
                  <Button label="Phát" icon="play" accent autofocus onClick={() => openMusicItem(allTracks[0], allTracks)} />
                  <Button
                    label="Trộn bài"
                    icon="shuffle"
                    onClick={() => {
                      const shuffled = allTracks.slice().sort(() => Math.random() - 0.5)
                      openMusicItem(shuffled[0], shuffled)
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          {data.shelves.map((shelf, si) =>
            shelf.items.every(playable) && shelf.items.length > 0 ? (
              <div key={si} class="shelf" data-row>
                {shelf.title && <h2 class="shelf-title">{shelf.title}</h2>}
                <div class="track-grid">
                  {shelf.items.map((item, i) => (
                    <TrackRow key={item.id} item={item} index={i} onClick={() => openMusicItem(item, shelf.items)} focusKey={`mb-${si}-${item.id}`} />
                  ))}
                </div>
              </div>
            ) : (
              <Shelf key={si} title={shelf.title}>
                {shelf.items.map((item) => (
                  <MusicCard key={item.id} item={item} onClick={() => openMusicItem(item, shelf.items)} focusKey={`mbc-${si}-${item.id}`} />
                ))}
              </Shelf>
            ),
          )}
        </>
      )}
    </div>
  )
}
