// Text from YouTube (descriptions, comments) with clickable timestamps (seek), links (opened
// in the browser, or inside the app for YouTube links) and #hashtags (search).

import { Fragment, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseDuration } from '@shared/models'
import { api } from '@/lib/api'
import { paths, watchPath } from '@/lib/nav'

const PATTERN = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])|(#[\p{L}\p{N}_]+)|\b((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)\b/gu

export function useOpenLink(): (url: string) => void {
  const navigate = useNavigate()
  return (url: string) => {
    const youtube = /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(url)
    if (!youtube) {
      api.openExternal(url).catch(() => window.open(url, '_blank'))
      return
    }
    api
      .resolveLink(url)
      .then((link) => {
        if (!link) throw new Error('unknown link')
        switch (link.type) {
          case 'video':
            return navigate(watchPath(link.videoId, { list: link.playlistId, t: link.startSeconds }))
          case 'shorts':
            return navigate(paths.shorts(link.videoId))
          case 'channel':
            return navigate(paths.channel(link.channelId))
          case 'playlist':
            return navigate(paths.playlist(link.playlistId))
          case 'search':
            return navigate(paths.search(link.query))
        }
      })
      .catch(() => api.openExternal(url).catch(() => window.open(url, '_blank')))
  }
}

export function RichText({ text, onSeek }: { text: string; onSeek?: (seconds: number) => void }) {
  const navigate = useNavigate()
  const openLink = useOpenLink()
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const [whole, url, tag, time] = match
    if (url) {
      parts.push(
        <a
          key={index}
          href={url}
          className="dp-link"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openLink(url)
          }}
        >
          {url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
          {url.replace(/^https?:\/\/(www\.)?/, '').length > 60 ? '…' : ''}
        </a>,
      )
    } else if (tag) {
      parts.push(
        <a
          key={index}
          href="#"
          className="dp-link"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            navigate(paths.search(tag))
          }}
        >
          {tag}
        </a>,
      )
    } else if (time && onSeek) {
      const seconds = parseDuration(time)
      parts.push(
        seconds == null ? (
          whole
        ) : (
          <a
            key={index}
            href="#"
            className="dp-link"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSeek(seconds)
            }}
          >
            {time}
          </a>
        ),
      )
    } else {
      parts.push(whole)
    }
    last = index + whole.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts.map((part, i) => (typeof part === 'string' ? <Fragment key={'t' + i}>{part}</Fragment> : part))}</>
}

/** 1320 → "1,3 N", 2_400_000 → "2,4 Tr" (YouTube's Vietnamese short numbers). */
export function shortCount(value: number): string {
  const format = (n: number) => (n >= 10 ? String(Math.floor(n)) : (Math.floor(n * 10) / 10).toString().replace('.', ','))
  if (value >= 1e9) return format(value / 1e9) + ' T'
  if (value >= 1e6) return format(value / 1e6) + ' Tr'
  if (value >= 1e3) return format(value / 1e3) + ' N'
  return String(value)
}
