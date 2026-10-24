// Search results (/results?q=…): quick filter chips, the "Bộ lọc" panel with every filter,
// wide result rows (YouTube desktop style) and infinite scrolling. Links typed into the box
// are opened instead of searched.

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { SearchFilters } from '@shared/models'
import { DEFAULT_SEARCH_FILTERS, DURATION_FILTERS, FEATURE_FILTERS, SORT_ORDERS, TYPE_FILTERS, UPLOAD_DATE_FILTERS } from '@shared/models'
import { Chip, HScroll } from '@/components/Chips'
import { FeedView } from '@/components/FeedView'
import { Icon } from '@/components/Icon'
import { EmptyState } from '@/components/States'
import { api } from '@/lib/api'
import { useFeed } from '@/lib/feed'
import { looksLikeLink, openLink } from '@/lib/links'
import { QUICK_FILTERS, activeFilterCount, filtersFromParams, filtersKey, isQuickSelected, searchUrl, toggleQuick } from '@/lib/searchFilters'
import { usePageTitle } from '@/lib/title'
import { useLibrary } from '@/state/library'

function FilterGroup<T extends string>({
  title,
  options,
  isSelected,
  onToggle,
  clearable = true,
}: {
  title: string
  options: { id: T; title: string }[]
  isSelected: (id: T) => boolean
  onToggle: (id: T) => void
  /** Selected options show ✕ (sort order is always set, so it has none). */
  clearable?: boolean
}) {
  return (
    <div className="filter-group">
      <div className="filter-group-title">{title}</div>
      {options.map((o) => {
        const on = isSelected(o.id)
        return (
          <button
            key={o.id}
            className={'filter-option' + (on ? ' is-selected' : '')}
            onClick={() => onToggle(o.id)}
            title={on && clearable ? 'Xóa bộ lọc' : undefined}
          >
            <span>{o.title}</span>
            {on && clearable && <Icon name="close" size={16} />}
          </button>
        )
      })}
    </div>
  )
}

function FilterPanel({ filters, onChange }: { filters: SearchFilters; onChange: (f: SearchFilters) => void }) {
  return (
    <div className="filter-panel" data-testid="filter-panel">
      <div className="filter-columns">
        <FilterGroup
          title="Ngày tải lên"
          options={UPLOAD_DATE_FILTERS.filter((o) => o.id !== 'any')}
          isSelected={(id) => filters.uploadDate === id}
          onToggle={(id) => onChange({ ...filters, uploadDate: filters.uploadDate === id ? 'any' : id })}
        />
        <FilterGroup
          title="Loại"
          options={TYPE_FILTERS.filter((o) => o.id !== 'all')}
          isSelected={(id) => filters.type === id}
          onToggle={(id) => onChange({ ...filters, type: filters.type === id ? 'all' : id })}
        />
        <FilterGroup
          title="Thời lượng"
          options={DURATION_FILTERS.filter((o) => o.id !== 'any')}
          isSelected={(id) => filters.duration === id}
          onToggle={(id) => onChange({ ...filters, duration: filters.duration === id ? 'any' : id })}
        />
        <FilterGroup
          title="Tính năng"
          options={FEATURE_FILTERS}
          isSelected={(id) => filters.features.includes(id)}
          onToggle={(id) =>
            onChange({ ...filters, features: filters.features.includes(id) ? filters.features.filter((x) => x !== id) : [...filters.features, id] })
          }
        />
        <FilterGroup
          title="Sắp xếp theo"
          options={SORT_ORDERS}
          clearable={false}
          isSelected={(id) => filters.sort === id}
          onToggle={(id) => onChange({ ...filters, sort: id })}
        />
      </div>
      {activeFilterCount(filters) > 0 && (
        <div className="filter-footer">
          <button className="btn btn-text btn-small" onClick={() => onChange(DEFAULT_SEARCH_FILTERS)}>
            Đặt lại bộ lọc
          </button>
        </div>
      )}
    </div>
  )
}

export function SearchPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const filters = filtersFromParams(params)
  const key = filtersKey(filters)
  const isLink = looksLikeLink(query)
  const [panel, setPanel] = useState(false)
  usePageTitle(query || 'Tìm kiếm')

  useEffect(() => {
    if (!query) return
    if (isLink) {
      void openLink(query, navigate, { replace: true })
      return
    }
    useLibrary.getState().addSearch(query)
  }, [query, isLink, navigate])

  const feed = useFeed(query && !isLink ? `search:${query}:${key}` : null, () => api.search(query, filters))
  const apply = (f: SearchFilters) => navigate(searchUrl(query, f), { replace: true })
  const count = activeFilterCount(filters)

  if (!query) {
    return (
      <div className="page page-pad">
        <EmptyState icon="search" title="Tìm kiếm trên YouTube" message="Nhập nội dung cần tìm hoặc dán đường liên kết YouTube vào ô tìm kiếm." />
      </div>
    )
  }

  return (
    <div className="page page--search" data-testid="search-page">
      <div className="search-toolbar">
        <HScroll className="search-chips">
          {QUICK_FILTERS.map((chip) => (
            <Chip
              key={chip.id}
              selected={isQuickSelected(chip.id, filters)}
              onClick={() => apply(toggleQuick(chip.id, filters))}
              testId={`search-chip-${chip.id}`}
            >
              {chip.title}
            </Chip>
          ))}
        </HScroll>
        <button
          className={'btn btn-text filter-toggle' + (panel ? ' is-open' : '')}
          onClick={() => setPanel(!panel)}
          aria-expanded={panel}
          data-testid="filter-button"
        >
          Bộ lọc
          {count > 0 && <span className="count-badge">{count}</span>}
          <Icon name="filter" size={22} />
        </button>
      </div>
      {panel && <FilterPanel filters={filters} onChange={apply} />}
      <div className="search-results">
        <FeedView
          feed={feed}
          layout={filters.type === 'shorts' ? 'shorts' : 'list'}
          testId="search-results"
          emptyTitle="Không tìm thấy kết quả"
          emptyIcon="search"
          emptyMessage="Hãy thử từ khóa khác hoặc bỏ bớt bộ lọc."
        />
      </div>
    </div>
  )
}
