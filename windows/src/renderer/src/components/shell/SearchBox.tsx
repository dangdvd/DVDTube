// Centered search box with the suggestions dropdown: search history (✕ to remove, "Xóa tất
// cả") and debounced suggestions; ↑ ↓ move, Enter searches, Esc closes. Links are opened.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { confirmDialog } from '@/lib/dialogs'
import { looksLikeLink, openLink } from '@/lib/links'
import { paths } from '@/lib/nav'
import { useUi } from '@/lib/ui'
import { useLibrary } from '@/state/library'
import { useParentalFlags } from '@/state/parental'
import { useSettings } from '@/state/settings'
import { Icon } from '../Icon'

interface Entry {
  text: string
  history: boolean
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  if (q && text.toLowerCase().startsWith(q)) {
    return (
      <>
        {text.slice(0, q.length)}
        <b>{text.slice(q.length)}</b>
      </>
    )
  }
  return <b>{text}</b>
}

export function SearchBox() {
  const searchOff = useParentalFlags().disableSearch
  const navigate = useNavigate()
  const location = useLocation()
  const history = useLibrary((s) => s.searchHistory)
  const pausedHistory = useSettings((s) => s.settings.pauseSearchHistory || s.settings.incognito)
  const focusTick = useUi((s) => s.focusSearchTick)
  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [highlight, setHighlight] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLFormElement>(null)

  // Show the current query on the results page; keep it while watching a result, clear it
  // elsewhere (like YouTube).
  useEffect(() => {
    if (location.pathname === '/results') {
      const q = new URLSearchParams(location.search).get('q') ?? ''
      setQuery(q)
      setTyped(q)
    } else if (location.pathname !== '/watch' && document.activeElement !== inputRef.current) {
      setQuery('')
      setTyped('')
    }
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!focusTick) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTick])

  useEffect(() => {
    const q = typed.trim()
    if (!q || looksLikeLink(q)) {
      setSuggestions([])
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      api
        .suggestions(q)
        .then((list) => alive && setSuggestions(list))
        .catch(() => alive && setSuggestions([]))
    }, 180)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [typed])

  const entries: Entry[] = useMemo(() => {
    const q = typed.trim().toLowerCase()
    if (!q) return history.slice(0, 12).map((text) => ({ text, history: true }))
    const fromHistory = history.filter((h) => h.toLowerCase().startsWith(q) && h.toLowerCase() !== q).slice(0, 4)
    const known = new Set(fromHistory.map((h) => h.toLowerCase()))
    return [
      ...fromHistory.map((text) => ({ text, history: true })),
      ...suggestions.filter((s) => !known.has(s.toLowerCase())).map((text) => ({ text, history: false })),
    ].slice(0, 12)
  }, [typed, history, suggestions])

  const close = () => {
    setOpen(false)
    setHighlight(-1)
  }

  const submit = (text: string) => {
    const q = text.trim()
    if (!q) return
    close()
    inputRef.current?.blur()
    setQuery(q)
    setTyped(q)
    if (looksLikeLink(q)) {
      void openLink(q, navigate)
      return
    }
    navigate(paths.search(q))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      if (!entries.length) return
      const next =
        e.key === 'ArrowDown' ? (highlight + 1 >= entries.length ? -1 : highlight + 1) : highlight - 1 < -1 ? entries.length - 1 : highlight - 1
      setHighlight(next)
      setQuery(next === -1 ? typed : entries[next].text)
    } else if (e.key === 'Escape') {
      if (open && entries.length) {
        e.preventDefault()
        e.stopPropagation()
        close()
        setQuery(typed)
      } else {
        inputRef.current?.blur()
      }
    } else if (e.key === 'Delete' && e.shiftKey && highlight >= 0 && entries[highlight]?.history) {
      e.preventDefault()
      useLibrary.getState().removeSearch(entries[highlight].text)
    }
  }

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const showDropdown = open && entries.length > 0
  const showingHistory = !typed.trim() && entries.length > 0

  return (
    <form
      ref={boxRef}
      className={'searchbox' + (focused ? ' is-focused' : '') + (showDropdown ? ' is-open' : '')}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit(query)
      }}
    >
      <div className="searchbox-field">
        {focused && <Icon name="search" size={20} className="searchbox-lead" />}
        <input
          ref={inputRef}
          className="searchbox-input"
          type="text"
          placeholder={searchOff ? 'Tìm kiếm đã bị tắt' : 'Tìm kiếm'}
          disabled={searchOff}
          aria-label="Tìm kiếm"
          spellCheck={false}
          autoComplete="off"
          value={query}
          data-testid="search-input"
          onChange={(e) => {
            setQuery(e.target.value)
            setTyped(e.target.value)
            setHighlight(-1)
            setOpen(true)
          }}
          onFocus={() => {
            setFocused(true)
            setOpen(true)
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className="icon-btn searchbox-clear"
            aria-label="Xóa nội dung tìm kiếm"
            onClick={() => {
              setQuery('')
              setTyped('')
              inputRef.current?.focus()
              setOpen(true)
            }}
          >
            <Icon name="close" />
          </button>
        )}
        {showDropdown && (
          <div className="searchbox-dropdown" role="listbox" data-testid="search-suggestions">
            {entries.map((entry, i) => (
              <div
                key={(entry.history ? 'h-' : 's-') + entry.text}
                role="option"
                aria-selected={i === highlight}
                className={'suggestion' + (i === highlight ? ' is-highlighted' : '')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== highlight && setHighlight(i)}
                onClick={() => submit(entry.text)}
              >
                <Icon name={entry.history ? 'history' : 'search'} size={20} className="suggestion-icon" />
                <span className="suggestion-text">
                  <Highlighted text={entry.text} query={typed} />
                </span>
                {entry.history && (
                  <button
                    type="button"
                    className="suggestion-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      useLibrary.getState().removeSearch(entry.text)
                    }}
                  >
                    Xóa
                  </button>
                )}
              </div>
            ))}
            {showingHistory && (
              <div className="suggestion-footer">
                {pausedHistory && <span className="suggestion-note">Nhật ký tìm kiếm đang tạm dừng</span>}
                <button
                  type="button"
                  className="link-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={async () => {
                    close()
                    if (await confirmDialog({ title: 'Xóa toàn bộ nhật ký tìm kiếm?', confirmLabel: 'Xóa tất cả', danger: true })) {
                      useLibrary.getState().clearSearchHistory()
                    }
                  }}
                >
                  Xóa tất cả
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <button type="submit" className="searchbox-button" aria-label="Tìm kiếm" title="Tìm kiếm" data-testid="search-button">
        <Icon name="search" />
      </button>
    </form>
  )
}
