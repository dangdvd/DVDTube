// Plain text with clickable links (opened in the browser, or in the app for YouTube links),
// #hashtags (search) and optional timestamps (e.g. "12:30" → seek). Newlines are kept by CSS.

import { Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseDuration } from '@shared/models'
import { api } from '@/lib/api'
import { openLink } from '@/lib/links'
import { paths } from '@/lib/nav'

const TOKEN = /(https?:\/\/[^\s]+|www\.[^\s]+|#[\p{L}\p{N}_]+|\b\d{1,2}:\d{2}(?::\d{2})?\b)/gu

function isYouTube(url: string): boolean {
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url)
}

export function RichText({ text, onTimestamp, className }: { text: string; onTimestamp?: (seconds: number) => void; className?: string }) {
  const navigate = useNavigate()
  const parts = text.split(TOKEN)
  return (
    <span className={'rich-text' + (className ? ' ' + className : '')}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>
        if (part.startsWith('#')) {
          return (
            <a key={i} className="link" href="#" onClick={(e) => (e.preventDefault(), navigate(paths.search(part)))}>
              {part}
            </a>
          )
        }
        if (/^\d/.test(part)) {
          const seconds = parseDuration(part)
          if (!onTimestamp || seconds == null) return <Fragment key={i}>{part}</Fragment>
          return (
            <a key={i} className="link" href="#" onClick={(e) => (e.preventDefault(), onTimestamp(seconds))}>
              {part}
            </a>
          )
        }
        const url = part.replace(/[),.;!?]+$/, '')
        const rest = part.slice(url.length)
        const full = url.startsWith('http') ? url : 'https://' + url
        return (
          <Fragment key={i}>
            <a
              className="link"
              href={full}
              onClick={(e) => {
                e.preventDefault()
                if (isYouTube(full)) void openLink(full, navigate)
                else void api.openExternal(full)
              }}
            >
              {url.replace(/^https?:\/\//, '').slice(0, 60)}
              {url.replace(/^https?:\/\//, '').length > 60 ? '…' : ''}
            </a>
            {rest}
          </Fragment>
        )
      })}
    </span>
  )
}
