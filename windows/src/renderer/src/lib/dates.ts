// Day grouping for feeds sorted by date (subscriptions, history).

const DAY = 86_400_000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

/** Subscriptions feed: Hôm nay / Hôm qua / Tuần này / Trước đó. */
export function uploadGroup(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return 'Trước đó'
  const today = startOfDay(now)
  if (ms >= today) return 'Hôm nay'
  if (ms >= today - DAY) return 'Hôm qua'
  if (ms >= today - 6 * DAY) return 'Tuần này'
  return 'Trước đó'
}

/** History: Hôm nay / Hôm qua / weekday this week / "12 tháng 10, 2026". */
export function dayTitle(ms: number, now = Date.now()): string {
  const today = startOfDay(now)
  const day = startOfDay(ms)
  if (day === today) return 'Hôm nay'
  if (day === today - DAY) return 'Hôm qua'
  if (day > today - 7 * DAY) return WEEKDAYS[new Date(ms).getDay()]
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `${d.getDate()} tháng ${d.getMonth() + 1}${sameYear ? '' : ', ' + d.getFullYear()}`
}

export function groupBy<T>(items: T[], key: (item: T) => string): { title: string; items: T[] }[] {
  const groups: { title: string; items: T[] }[] = []
  for (const item of items) {
    const title = key(item)
    const last = groups[groups.length - 1]
    if (last && last.title === title) last.items.push(item)
    else {
      const existing = groups.find((g) => g.title === title)
      if (existing) existing.items.push(item)
      else groups.push({ title, items: [item] })
    }
  }
  return groups
}
