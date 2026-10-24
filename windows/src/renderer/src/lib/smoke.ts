// CI smoke scenario (started by App when `appInfo().smoke`): drives the real UI through home →
// search → watch → channel → mini player → Shorts → settings and reports each step with
// `api.smokeStep` (the main process writes report.json and a screenshot per step).
//
// DOM hooks used (data-testid):
//   home-feed, search-results, video-card (+ data-video-id, data-layout), video-link,
//   channel-header, channel-name, channel-content, settings-page          (UI module)
//   watch-title, watch-channel, related-list, watch-comments, mini-player, shorts-page
//                                                                           (player module; with
//   fallbacks to h1 / compact video cards / a playing <video>, so markup changes do not break it)

import type { NavigateFunction } from 'react-router-dom'
import { usePlayer } from '@/state/player'
import { api } from './api'
import { paths, watchPath } from './nav'

const STEP_TIMEOUT_MS = 45_000
const SEARCH_QUERY = 'nhạc trẻ remix'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls `check` until it returns a truthy value (or throws after `timeout`). */
async function waitFor<T>(what: string, check: () => T | null | undefined | false, timeout = STEP_TIMEOUT_MS): Promise<T> {
  const until = Date.now() + timeout
  let last: unknown = null
  while (Date.now() < until) {
    try {
      const value = check()
      if (value) return value
    } catch (error) {
      last = error
    }
    await sleep(250)
  }
  throw new Error(`Hết thời gian chờ: ${what}` + (last ? ` (${String(last)})` : ''))
}

const all = (selector: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLElement>(selector))
const visible = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.getClientRects().length > 0

function playerState(): Record<string, unknown> {
  return usePlayer.getState() as unknown as Record<string, unknown>
}

function playbackDetail(): string {
  const s = playerState()
  const info = s.info as { client?: string | null } | null | undefined
  const parts = [
    typeof s.activeHeight === 'number' && s.activeHeight
      ? `${s.activeHeight}p${typeof s.activeFps === 'number' && s.activeFps > 30 ? s.activeFps : ''}`
      : null,
    typeof s.source === 'string' ? s.source : null,
    info?.client ? `client ${info.client}` : null,
    `t=${Math.round(usePlayer.getState().currentTime)}s`,
  ]
  return parts.filter(Boolean).join(' • ')
}

/** A <video> that is actually advancing (Shorts has its own element). */
function playingVideo(root: ParentNode = document): HTMLVideoElement | null {
  return Array.from(root.querySelectorAll('video')).find((v) => !v.paused && v.currentTime > 0.5 && v.readyState >= 2) ?? null
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Quá ${Math.round(ms / 1000)} giây`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

let running = false

export async function runSmoke(navigate: NavigateFunction): Promise<void> {
  if (running) return
  running = true
  let allOk = true
  let firstVideoId: string | null = null

  const step = async (name: string, run: () => Promise<string>) => {
    let ok = true
    let detail: string
    try {
      detail = await withTimeout(run(), STEP_TIMEOUT_MS)
    } catch (error) {
      ok = false
      detail = error instanceof Error ? error.message : String(error)
    }
    allOk &&= ok
    // Let the page settle (and thumbnails load) so the screenshot shows the finished state.
    await sleep(1500)
    await api.smokeStep({ name, ok, detail, screenshot: true }).catch(() => {})
  }

  await sleep(1500)

  await step('home', async () => {
    navigate(paths.home)
    const cards = await waitFor('video trên trang chủ', () => {
      const list = all('[data-testid="home-feed"] [data-testid="video-card"]')
      return list.length ? list : null
    })
    return `${cards.length} video`
  })

  await step('search', async () => {
    navigate(paths.search(SEARCH_QUERY))
    const cards = await waitFor('kết quả tìm kiếm', () => {
      const list = all('[data-testid="search-results"] [data-testid="video-card"]')
      return list.length ? list : null
    })
    return `${cards.length} kết quả cho "${SEARCH_QUERY}"`
  })

  await step('watch', async () => {
    const card =
      all('[data-testid="search-results"] [data-testid="video-card"][data-layout="list"]')[0] ??
      all('[data-testid="video-card"]').find((c) => !c.closest('[data-testid="shorts-shelf"]'))
    const link = card?.querySelector<HTMLElement>('[data-testid="video-link"]')
    firstVideoId = card?.dataset.videoId ?? null
    if (link) link.click()
    else if (firstVideoId) navigate(watchPath(firstVideoId))
    else throw new Error('Không có video để mở')
    await waitFor('trang xem video', () => location.hash.startsWith('#/watch'), 10_000)
    await waitFor('video phát được 5 giây', () => {
      const s = usePlayer.getState()
      if (s.status === 'error') throw new Error(s.error ?? 'Lỗi trình phát')
      return s.status === 'playing' && s.currentTime >= 5
    })
    return playbackDetail()
  })

  await step('watch-details', async () => {
    const title = await waitFor('tiêu đề video', () => {
      const el =
        document.querySelector<HTMLElement>('[data-testid="watch-title"]') ?? document.querySelector<HTMLElement>('[data-testid="content"] h1')
      return el?.textContent?.trim() ? el : null
    })
    const related = await waitFor('danh sách video liên quan', () => {
      const list = all('[data-testid="related-list"] [data-testid="video-card"]')
      const fallback = all('[data-testid="video-card"][data-layout="compact"]')
      return list.length ? list : fallback.length ? fallback : null
    })
    const comments = await waitFor('khung bình luận', () => document.querySelector<HTMLElement>('[data-testid="watch-comments"]'), 10_000).catch(
      () => null,
    )
    let commentInfo = 'không có khung bình luận'
    if (comments) {
      comments.scrollIntoView({ block: 'start' })
      const count = await waitFor('bình luận', () => comments.querySelectorAll('.dp-comment, [data-testid="comment"]').length, 15_000).catch(() => 0)
      commentInfo = count ? `${count} bình luận` : 'khung bình luận (chưa có bình luận)'
    }
    return `"${title.textContent!.trim().slice(0, 60)}" • ${related.length} video liên quan • ${commentInfo}`
  })

  await step('channel', async () => {
    const channelId = usePlayer.getState().current?.channelId
    const link =
      document.querySelector<HTMLAnchorElement>('a[data-testid="watch-channel"]') ??
      document.querySelector<HTMLAnchorElement>('[data-testid="watch-channel"] a[href*="/channel/"]')
    if (link) link.click()
    else if (channelId) navigate(paths.channel(channelId))
    else throw new Error('Không tìm thấy kênh của video')
    const name = await waitFor('trang kênh', () => {
      const el = document.querySelector<HTMLElement>('[data-testid="channel-header"] [data-testid="channel-name"]')
      return el?.textContent?.trim() ? el.textContent.trim() : null
    })
    const videos = await waitFor('video của kênh', () => {
      const list = all('[data-testid="channel-content"] [data-testid="video-card"], [data-testid="channel-content"] [data-testid="shorts-card"]')
      return list.length ? list : null
    })
    return `${name} • ${videos.length} video`
  })

  await step('mini-player', async () => {
    navigate(paths.home)
    await waitFor('trình phát thu nhỏ', () => {
      const s = usePlayer.getState()
      if (s.mode !== 'mini' || !s.current) return null
      const el = document.querySelector<HTMLElement>('[data-testid="mini-player"]')
      return el ? visible(el) : true
    })
    await waitFor('video tiếp tục phát', () => usePlayer.getState().status === 'playing', 15_000)
    return `${usePlayer.getState().current?.title ?? ''} • ${playbackDetail()}`
  })

  await step('shorts', async () => {
    navigate(paths.shorts())
    const video = await waitFor('Shorts đang phát', () => {
      const page = document.querySelector('[data-testid="shorts-page"]') ?? document.querySelector('[data-testid="content"]')
      return page ? playingVideo(page) : null
    })
    return `t=${video.currentTime.toFixed(1)}s`
  })

  await step('settings', async () => {
    navigate(paths.settings)
    const page = await waitFor('trang cài đặt', () => document.querySelector<HTMLElement>('[data-testid="settings-page"]'))
    return `${page.querySelectorAll('.settings-section').length} mục`
  })

  await api.smokeStep({ name: 'finish', ok: allOk, detail: allOk ? 'Tất cả các bước đều đạt' : 'Có bước không đạt', finish: true }).catch(() => {})
  running = false
}
