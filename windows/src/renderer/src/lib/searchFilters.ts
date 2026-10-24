// Quick filter chips above search results (same semantics as Android `SearchFilter.toggle`)
// and the filters ↔ URL query encoding, so back / forward keep the chosen filters.

import type { DurationFilter, FeatureFilter, SearchFilters, SortOrder, TypeFilter, UploadDateFilter } from '@shared/models'
import { DEFAULT_SEARCH_FILTERS, DURATION_FILTERS, FEATURE_FILTERS, SORT_ORDERS, TYPE_FILTERS, UPLOAD_DATE_FILTERS } from '@shared/models'

export type QuickFilter = 'all' | 'videos' | 'shorts' | 'channels' | 'playlists' | 'live' | 'recent'

export const QUICK_FILTERS: { id: QuickFilter; title: string }[] = [
  { id: 'all', title: 'Tất cả' },
  { id: 'videos', title: 'Video' },
  { id: 'shorts', title: 'Shorts' },
  { id: 'channels', title: 'Kênh' },
  { id: 'playlists', title: 'Danh sách phát' },
  { id: 'live', title: 'Trực tiếp' },
  { id: 'recent', title: 'Mới tải lên' },
]

export function isQuickSelected(chip: QuickFilter, f: SearchFilters): boolean {
  switch (chip) {
    case 'all':
      return f.type === 'all' && !f.features.includes('live') && f.sort === 'relevance'
    case 'videos':
      return f.type === 'video'
    case 'shorts':
      return f.type === 'shorts'
    case 'channels':
      return f.type === 'channel'
    case 'playlists':
      return f.type === 'playlist'
    case 'live':
      return f.features.includes('live')
    case 'recent':
      return f.sort === 'date'
  }
}

export function toggleQuick(chip: QuickFilter, f: SearchFilters): SearchFilters {
  const selected = isQuickSelected(chip, f)
  const type = (value: TypeFilter): SearchFilters => ({ ...f, type: selected ? 'all' : value })
  switch (chip) {
    case 'all':
      return { ...f, type: 'all', features: f.features.filter((x) => x !== 'live'), sort: 'relevance' }
    case 'videos':
      return type('video')
    case 'shorts':
      return type('shorts')
    case 'channels':
      return type('channel')
    case 'playlists':
      return type('playlist')
    case 'live':
      return { ...f, features: selected ? f.features.filter((x) => x !== 'live') : [...f.features, 'live'] }
    case 'recent':
      return { ...f, sort: selected ? 'relevance' : 'date' }
  }
}

/** Filters chosen in the panel (badge on the "Bộ lọc" button). */
export function activeFilterCount(f: SearchFilters): number {
  return [f.uploadDate !== 'any', f.type !== 'all', f.duration !== 'any', f.sort !== 'relevance'].filter(Boolean).length + f.features.length
}

const valid = <T extends string>(list: { id: T }[], value: string | null, fallback: T): T =>
  list.some((o) => o.id === value) ? (value as T) : fallback

export function filtersFromParams(params: URLSearchParams): SearchFilters {
  const features = (params.get('fe') ?? '').split(',').filter((x): x is FeatureFilter => FEATURE_FILTERS.some((o) => o.id === x))
  return {
    uploadDate: valid<UploadDateFilter>(UPLOAD_DATE_FILTERS, params.get('ud'), DEFAULT_SEARCH_FILTERS.uploadDate),
    type: valid<TypeFilter>(TYPE_FILTERS, params.get('ty'), DEFAULT_SEARCH_FILTERS.type),
    duration: valid<DurationFilter>(DURATION_FILTERS, params.get('du'), DEFAULT_SEARCH_FILTERS.duration),
    features,
    sort: valid<SortOrder>(SORT_ORDERS, params.get('so'), DEFAULT_SEARCH_FILTERS.sort),
  }
}

export function searchUrl(query: string, f: SearchFilters): string {
  const params = new URLSearchParams({ q: query })
  if (f.uploadDate !== 'any') params.set('ud', f.uploadDate)
  if (f.type !== 'all') params.set('ty', f.type)
  if (f.duration !== 'any') params.set('du', f.duration)
  if (f.features.length) params.set('fe', [...f.features].sort().join(','))
  if (f.sort !== 'relevance') params.set('so', f.sort)
  return '/results?' + params.toString()
}

export function filtersKey(f: SearchFilters): string {
  return [f.uploadDate, f.type, f.duration, [...f.features].sort().join('+'), f.sort].join('/')
}
