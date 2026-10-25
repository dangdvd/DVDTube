// "Nghe nhạc" (/music, /music/browse/:id): YouTube Music search with the tabs Bài hát / Video /
// Album / Nghệ sĩ / Danh sách phát, recent songs, album / artist / playlist pages, and the music
// player (bottom bar + now-playing screen with lyrics). Songs play audio only by default and
// follow each other without a countdown (the next one is fetched ahead).

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MUSIC_SEARCH_KINDS, type MusicBrowsePage, type MusicItem, type MusicSearchKind, type VideoItem } from '@shared/models'
import { Icon } from '@/components/Icon'
import { MenuButton, type MenuEntry } from '@/components/Menu'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { addToQueue, playNext } from '@/lib/actions'
import { api, errorMessage } from '@/lib/api'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { MusicBar, NowPlaying, artworkOf, startRadio } from '@/player/music/NowPlaying'
import { useCast } from '@/state/cast'
import { useMusic } from '@/state/music'
import { usePlayer } from '@/state/player'

const SUGGESTED = ['Nhạc trẻ hot', 'Bolero trữ tình', 'Lofi chill', 'Rap Việt', 'Nhạc không lời', 'V-Pop 2026', 'Acoustic', 'Nhạc Trịnh']

function videoOf(item: MusicItem): VideoItem {
  return item.video ?? { id: item.id, title: item.title, channelName: item.artists ?? null, thumbnail: item.thumbnail ?? null, durationText: item.durationText ?? null }
}

/** A song from search: plays with its radio (an endless mix) as the queue, like YouTube Music. */
export function playSong(video: VideoItem): void {
  usePlayer.getState().play(video, { queue: [video], index: 0, playlistId: 'RDAMVM' + video.id, music: true, startAt: 0 })
}

function playAll(videos: VideoItem[], playlistId: string | null, shuffle = false): void {
  if (!videos.length) return
  const list = shuffle ? [...videos].sort(() => Math.random() - 0.5) : videos
  usePlayer.getState().play(list[0], { queue: list, index: 0, playlistId: shuffle ? null : playlistId, music: true, startAt: 0 })
}

function songMenu(video: VideoItem): MenuEntry[] {
  return [
    { label: 'Phát tiếp theo', icon: 'playNext', onSelect: () => playNext(video) },
    { label: 'Thêm vào hàng đợi', icon: 'addQueue', onSelect: () => addToQueue(video) },
    { label: 'Radio từ bài này', icon: 'radio', onSelect: () => startRadio(video) },
    { label: 'Truyền tới TV', icon: 'cast', onSelect: () => useCast.getState().openPicker(video, 'play') },
  ]
}

function SongRow({ item, index, onPlay }: { item: MusicItem; index?: number; onPlay: () => void }) {
  const playing = usePlayer((s) => s.current?.id === item.id)
  const video = videoOf(item)
  return (
    <div className={'music-row' + (playing ? ' is-playing' : '')} data-testid="music-row">
      <button className="music-row-main" onClick={onPlay}>
        {index !== undefined && <span className="music-row-index">{playing ? <Icon name="music" size={16} /> : index}</span>}
        <span className="music-row-art">
          <img src={artworkOf(video)} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span className="music-row-play">
            <Icon name="play" size={20} />
          </span>
        </span>
        <span className="music-row-text">
          <span className="music-row-title">{item.title}</span>
          <span className="music-row-sub">{item.subtitle ?? item.artists}</span>
        </span>
        <span className="music-row-duration">{item.durationText ?? ''}</span>
      </button>
      <MenuButton items={() => songMenu(video)} size={36} />
    </div>
  )
}

function Tile({ item }: { item: MusicItem }) {
  const navigate = useNavigate()
  const round = item.type === 'artist'
  const open = () => {
    if (item.type === 'song' || item.type === 'video') playSong(videoOf(item))
    else navigate(paths.musicBrowse(item.id))
  }
  return (
    <button className="music-tile" onClick={open} data-testid="music-tile">
      <span className={'music-tile-art' + (round ? ' is-round' : '')}>
        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name={round ? 'account' : 'disc'} size={40} />}
      </span>
      <span className="music-tile-title">{item.title}</span>
      <span className="music-tile-sub">{item.subtitle}</span>
    </button>
  )
}

function ItemList({ items }: { items: MusicItem[] }) {
  const songs = items.filter((i) => i.type === 'song' || i.type === 'video')
  const others = items.filter((i) => i.type !== 'song' && i.type !== 'video')
  return (
    <>
      {songs.length > 0 && (
        <div className="music-rows">
          {songs.map((item) => (
            <SongRow key={item.id} item={item} onPlay={() => playSong(videoOf(item))} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="music-tiles">
          {others.map((item) => (
            <Tile key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  )
}

function SearchResults({ query, kind }: { query: string; kind: MusicSearchKind }) {
  const [items, setItems] = useState<MusicItem[]>([])
  const [continuation, setContinuation] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  useEffect(() => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    setItems([])
    api
      .musicSearch(query, kind)
      .then((page) => {
        if (id !== request.current) return
        setItems(page.items)
        setContinuation(page.continuation ?? null)
      })
      .catch((e) => id === request.current && setError(errorMessage(e)))
      .finally(() => id === request.current && setLoading(false))
  }, [query, kind])
  const loadMore = () => {
    if (!continuation) return
    const id = request.current
    setMore(true)
    api
      .musicSearch(query, kind, continuation)
      .then((page) => {
        if (id !== request.current) return
        setItems((list) => [...list, ...page.items.filter((i) => !list.some((x) => x.id === i.id))])
        setContinuation(page.continuation && page.continuation !== continuation ? page.continuation : null)
      })
      .catch(() => setContinuation(null))
      .finally(() => setMore(false))
  }
  if (loading) return <div className="center-spinner"><Spinner /></div>
  if (error) return <ErrorState message={error} onRetry={() => setItems([])} />
  if (!items.length) return <EmptyState icon="music" title="Không có kết quả" message={`Không tìm thấy gì cho "${query}"`} />
  return (
    <div data-testid="music-results">
      <ItemList items={items} />
      {continuation && (
        <div className="music-more">
          <button className="btn btn-tonal" disabled={more} onClick={loadMore}>
            {more ? <Spinner size={16} /> : 'Xem thêm'}
          </button>
        </div>
      )}
    </div>
  )
}

function Home() {
  const recent = useMusic((s) => s.recent)
  const setQuery = useMusic((s) => s.setQuery)
  return (
    <div data-testid="music-home">
      <div className="chip-row music-suggested">
        {SUGGESTED.map((q) => (
          <button key={q} className="chip" onClick={() => setQuery(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="music-heading-row">
        <h2 className="music-heading">Bài hát gần đây</h2>
        {recent.length > 0 && (
          <>
            <button className="btn btn-tonal btn-small" onClick={() => playAll(recent, null)}>
              <Icon name="play" size={16} />
              Phát tất cả
            </button>
            <button className="btn btn-text btn-small" onClick={() => useMusic.getState().clearRecent()}>
              Xóa
            </button>
          </>
        )}
      </div>
      {recent.length ? (
        <div className="music-rows">
          {recent.map((v, i) => (
            <SongRow
              key={v.id}
              item={{ type: 'song', id: v.id, title: v.title, subtitle: v.channelName, artists: v.channelName, durationText: v.durationText, video: v }}
              onPlay={() => playAll(recent.slice(i), null)}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon="music" title="Chưa nghe bài nào" message="Tìm bài hát, album hoặc nghệ sĩ ở ô phía trên. Nhạc chỉ phát âm thanh để tiết kiệm dữ liệu." />
      )}
    </div>
  )
}

function BrowsePage({ browseId }: { browseId: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState<MusicBrowsePage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setPage(null)
    setError(null)
    api
      .musicBrowse(browseId)
      .then((p) => alive && setPage(p))
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [browseId])
  usePageTitle(page?.title ?? 'Nghe nhạc')
  // Artists we cannot read: their normal channel page.
  const fallback = page?.kind === 'artist' && page.shelves.length === 0
  useEffect(() => {
    if (fallback) navigate(paths.channel(browseId), { replace: true })
  }, [fallback, browseId, navigate])
  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />
  if (!page || fallback) return <div className="center-spinner"><Spinner /></div>
  const songs = page.shelves.flatMap((s) => s.items).filter((i) => i.type === 'song' || i.type === 'video').map(videoOf)
  return (
    <div className="music-browse" data-testid="music-browse">
      <div className="music-browse-header">
        {page.thumbnail && <img className={'music-browse-art' + (page.kind === 'artist' ? ' is-round' : '')} src={page.thumbnail} alt="" />}
        <div className="music-browse-text">
          <h1>{page.title}</h1>
          {page.subtitle && <div className="muted">{page.subtitle}</div>}
          {page.description && <p className="music-browse-description">{page.description}</p>}
          <div className="button-row">
            <button className="btn btn-primary" disabled={!songs.length} onClick={() => playAll(songs, page.playlistId ?? null)}>
              <Icon name="play" size={18} />
              Phát tất cả
            </button>
            <button className="btn btn-tonal" disabled={songs.length < 2} onClick={() => playAll(songs, null, true)}>
              <Icon name="shuffle" size={18} />
              Trộn bài
            </button>
            {songs[0] && (
              <button className="btn btn-tonal" onClick={() => startRadio(songs[0])}>
                <Icon name="radio" size={18} />
                Radio
              </button>
            )}
          </div>
        </div>
      </div>
      {page.shelves.map((shelf, s) => {
        const shelfSongs = shelf.items.filter((i) => i.type === 'song' || i.type === 'video')
        return (
          <section key={s} className="music-shelf">
            {shelf.title && <h2 className="music-heading">{shelf.title}</h2>}
            {shelfSongs.length === shelf.items.length ? (
              <div className="music-rows">
                {shelf.items.map((item, i) => (
                  <SongRow
                    key={item.id + i}
                    item={item}
                    index={page.kind === 'album' ? i + 1 : undefined}
                    onPlay={() => playAll(shelfSongs.slice(i).map(videoOf), page.kind === 'album' ? (page.playlistId ?? null) : null)}
                  />
                ))}
              </div>
            ) : (
              <div className="music-tiles">
                {shelf.items.map((item) => (
                  <Tile key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export function MusicPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const query = useMusic((s) => s.query)
  const kind = useMusic((s) => s.kind)
  const nowPlaying = useMusic((s) => s.nowPlayingOpen)
  const hasCurrent = usePlayer((s) => !!s.current)
  const [text, setText] = useState(query)
  usePageTitle('Nghe nhạc')
  useEffect(() => setText(query), [query])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    useMusic.getState().setQuery(text.trim())
    if (id) navigate(paths.music)
  }
  return (
    <div className={'page music-page' + (hasCurrent ? ' has-bar' : '')} data-testid="music-page">
      <div className="music-top">
        <h1 className="music-title">
          <Icon name="music" size={28} />
          Nghe nhạc
        </h1>
        <form className="music-search" onSubmit={submit}>
          <Icon name="search" size={20} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm bài hát, album, nghệ sĩ" aria-label="Tìm nhạc" data-testid="music-search" />
          {text && (
            <button type="button" className="icon-btn" aria-label="Xóa" onClick={() => (setText(''), useMusic.getState().setQuery(''))}>
              <Icon name="close" size={18} />
            </button>
          )}
        </form>
      </div>
      {!id && query && (
        <div className="chip-row music-kinds" data-testid="music-tabs">
          {MUSIC_SEARCH_KINDS.map((k) => (
            <button key={k.id} className={'chip' + (k.id === kind ? ' is-selected' : '')} onClick={() => useMusic.getState().setKind(k.id)}>
              {k.title}
            </button>
          ))}
        </div>
      )}
      <div className="music-content">{id ? <BrowsePage browseId={id} /> : query ? <SearchResults query={query} kind={kind} /> : <Home />}</div>
      {nowPlaying && hasCurrent && <NowPlaying />}
      <MusicBar />
    </div>
  )
}
