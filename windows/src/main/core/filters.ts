// YouTube's search filter sheet encoded into the `params` of a search request (port of
// `SearchFilters.kt`).

import type { DurationFilter, FeatureFilter, SearchFilters, SortOrder, TypeFilter, UploadDateFilter } from '@shared/models'

const UPLOAD_DATE: Record<UploadDateFilter, number> = { any: 0, hour: 1, today: 2, week: 3, month: 4, year: 5 }
const TYPE: Record<TypeFilter, number> = { all: 0, video: 1, shorts: 9, channel: 2, playlist: 3, movie: 4 }
const DURATION: Record<DurationFilter, number> = { any: 0, short: 1, medium: 3, long: 2 }
/** Protobuf field numbers of the boolean filters. */
const FEATURE_FIELD: Record<FeatureFilter, number> = {
  live: 8, '4k': 14, hd: 4, subtitles: 5, creativeCommons: 6, '360': 15, hdr: 25, vr180: 26,
}
const SORT: Record<SortOrder, number> = { relevance: 0, date: 2, views: 3, rating: 1 }

function varint(out: number[], value: number): void {
  let rest = value
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80)
    rest = Math.floor(rest / 128)
  }
  out.push(rest)
}

function field(out: number[], number: number, value: number): void {
  varint(out, number * 8)
  varint(out, value)
}

/**
 * Protobuf `{1: sort, 2: {1: uploadDate, 2: type, 3: duration, <feature>: true…}}`, base64 and
 * URL-encoded like the params YouTube's own links carry (e.g. "EgIQAQ%3D%3D" = videos only).
 */
export function searchParams(filters: SearchFilters): string | null {
  const inner: number[] = []
  const uploadDate = UPLOAD_DATE[filters.uploadDate] ?? 0
  const type = TYPE[filters.type] ?? 0
  const duration = DURATION[filters.duration] ?? 0
  if (uploadDate !== 0) field(inner, 1, uploadDate)
  if (type !== 0) field(inner, 2, type)
  if (duration !== 0) field(inner, 3, duration)
  const features = [...new Set(filters.features ?? [])]
    .map((f) => FEATURE_FIELD[f])
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b)
  for (const number of features) field(inner, number, 1)

  const message: number[] = []
  const sort = SORT[filters.sort] ?? 0
  if (sort !== 0) field(message, 1, sort)
  if (inner.length > 0) {
    varint(message, (2 << 3) | 2)
    varint(message, inner.length)
    message.push(...inner)
  }
  if (message.length === 0) return null
  return encodeURIComponent(Buffer.from(message).toString('base64'))
}

/** Search restricted to the current week's videos. */
export const RECENT_VIDEOS_PARAMS = 'EgQIAxAB'
/** Videos only. */
export const VIDEOS_PARAMS = 'EgIQAQ%3D%3D'
