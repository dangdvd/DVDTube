// Tìm kiếm: a text field that opens the TV's on-screen keyboard, suggestions while typing, the
// search history, and the results in a grid with type filters.

import type { FeedItem, SearchFilters, VideoItem } from '@shared/models'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../api'
import { focusElement, move } from '../focus'
import { usePagedFeed } from '../hooks'
import { KEY, isBackKey, onKeyboardChange } from '../platform'
import { useInitialFocus, useScreen, useScreenKeys } from '../screen'
import { library, libraryStore } from '../state/library'
import { nav } from '../state/nav'
import { hidesShorts, searchDisabled } from '../state/parental'
import { useStore } from '../store'
import { Button, Chips, Grid, LoadMore, Loading, Message, ScreenTitle, Shelf } from '../ui/base'
import { FeedCard, ShortCard } from '../ui/cards'
import { Icon } from '../ui/icons'
import { uniq } from './Home'

// MARK: The text field

export function SearchField(props: {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  focusKey: string
  autofocus?: boolean
  testid?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const field = useRef<HTMLDivElement>(null)
  const screen = useScreen()

  const close = () => {
    if (input.current && document.activeElement === input.current) input.current.blur()
    if (field.current) focusElement(field.current)
  }

  useEffect(() => {
    onKeyboardChange((visible) => {
      if (!visible && document.activeElement === input.current) close()
    })
  }, [])

  useScreenKeys((event) => {
    if (document.activeElement !== input.current) return false
    if (event.keyCode === KEY.ENTER) {
      const value = input.current?.value.trim() ?? ''
      close()
      if (value) props.onSubmit(value)
      return true
    }
    if (isBackKey(event)) {
      close()
      return true
    }
    if (event.keyCode === KEY.DOWN) {
      close()
      move('down')
      return true
    }
    if (event.keyCode === KEY.UP) {
      close()
      return true
    }
    return false
  }, 20)
  void screen

  return (
    <div
      class="search-field"
      data-f
      tabIndex={-1}
      role="button"
      data-key={props.focusKey}
      data-autofocus={props.autofocus ? '' : undefined}
      data-testid={props.testid}
      ref={field}
      onClick={() => {
        // OK on the field: the real input takes the focus and webOS opens its keyboard.
        input.current?.focus()
      }}
    >
      <Icon name="search" size={40} />
      <input
        ref={input}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        tabIndex={-1}
        autocomplete="off"
        spellcheck={false}
        data-testid={props.testid ? `${props.testid}-input` : undefined}
        onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
      />
    </div>
  )
}

// MARK: The search screen

export function SearchScreen() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const history = useStore(libraryStore, (s) => s.searchHistory)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const pending = nav.consumePendingSearch()
    if (pending) submit(pending)
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (!q) {
      setSuggestions([])
      return
    }
    timer.current = setTimeout(() => {
      api.suggestions(q).then(setSuggestions).catch(() => setSuggestions([]))
    }, 250)
  }, [query])

  useInitialFocus(true)

  function submit(text: string) {
    const q = text.trim()
    if (!q) return
    library.addSearch(q)
    setQuery(q)
    nav.open({ name: 'searchResults', query: q })
  }

  if (searchDisabled()) {
    return (
      <div class="page">
        <Message title="Tìm kiếm đã bị tắt" detail="Phụ huynh đã tắt tìm kiếm." icon="lock" />
      </div>
    )
  }

  return (
    <div class="page" data-scroll="y" data-testid="search-page">
      <ScreenTitle title="Tìm kiếm" />
      <SearchField value={query} onChange={setQuery} onSubmit={submit} placeholder="Tìm trên YouTube" focusKey="search-box" autofocus testid="search-box" />
      {query.trim() && (
        <div class="pill-row" data-group>
          <button type="button" class="pill accent" data-f tabIndex={-1} data-key="search-go" onClick={() => submit(query)}>
            <Icon name="search" size={28} />
            <span>{`Tìm “${query.trim()}”`}</span>
          </button>
          {suggestions.map((s) => (
            <button type="button" key={s} class="pill" data-f tabIndex={-1} data-key={`sg-${s}`} data-testid="suggestion" onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <>
          <div class="section-title">Tìm kiếm gần đây</div>
          <div class="pill-row wrap" data-group>
            {history.slice(0, 24).map((h) => (
              <button type="button" key={h} class="pill" data-f tabIndex={-1} data-key={`sh-${h}`} onClick={() => submit(h)}>
                <Icon name="history" size={26} />
                <span>{h}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!history.length && !query && <div class="hint">Nhập nội dung cần tìm. Bấm OK trên ô tìm kiếm để mở bàn phím.</div>}
    </div>
  )
}

// MARK: Results

type ResultFilter = 'all' | 'video' | 'shorts' | 'channel' | 'playlist'

const FILTERS: { id: ResultFilter; title: string }[] = [
  { id: 'all', title: 'Tất cả' },
  { id: 'video', title: 'Video' },
  { id: 'shorts', title: 'Shorts' },
  { id: 'channel', title: 'Kênh' },
  { id: 'playlist', title: 'Danh sách phát' },
]

export function SearchResultsScreen({ query }: { query: string }) {
  const [filter, setFilter] = useState<ResultFilter>('all')
  const filters: Partial<SearchFilters> = filter === 'all' ? {} : { type: filter }
  const feed = usePagedFeed(`search:${filter}:${query}`, () => api.search(query, filters))
  useStore(libraryStore, (s) => s.notInterested.length)
  const items = feed.items.filter((i) => i.type !== 'video' || !library.isHidden(i.video))
  const shorts = hidesShorts() ? [] : uniq(items.flatMap((i) => (i.type === 'shorts' ? i.items : [])))
  const grid = items.filter((i): i is Exclude<FeedItem, { type: 'shorts' }> => i.type !== 'shorts' && !(hidesShorts() && i.type === 'video' && i.video.isShort))
  const queue: VideoItem[] = grid.flatMap((i) => (i.type === 'video' ? [i.video] : []))
  useInitialFocus(grid.length > 0 || !!feed.error)

  return (
    <div class="page" data-scroll="y" data-testid="search-results">
      <ScreenTitle title={`Kết quả cho “${query}”`} />
      <Chips items={FILTERS} selected={filter} onSelect={setFilter} keyPrefix="sf" />
      {shorts.length > 0 && filter === 'all' && (
        <Shelf title="Shorts" tall>
          {shorts.map((v) => (
            <ShortCard key={v.id} video={v} list={shorts} focusKey={`srs-${v.id}`} />
          ))}
        </Shelf>
      )}
      <Grid columns={filter === 'shorts' ? 6 : 4}>
        {grid.map((item, i) => (
          <FeedCard key={i} item={item} queue={queue} prefix="sr" autofocus={i === 0} />
        ))}
      </Grid>
      {feed.loading && items.length === 0 && <Loading />}
      {feed.error && (
        <Message title="Không tìm được" detail={feed.error}>
          <Button label="Thử lại" icon="refresh" onClick={feed.reload} autofocus />
        </Message>
      )}
      {!feed.loading && !feed.error && items.length === 0 && <Message title="Không tìm thấy kết quả" />}
      {feed.loadingMore && <Loading />}
      <LoadMore active={feed.canLoadMore && !feed.loadingMore} onVisible={feed.loadMore} />
    </div>
  )
}
