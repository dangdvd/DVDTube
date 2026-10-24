// Round channel / account picture; falls back to the first letter on a coloured circle.

import { useState } from 'react'

const COLORS = ['#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5', '#00897b', '#43a047', '#f4511e', '#6d4c41', '#546e7a']

function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export function Avatar({ src, name, size = 36, className }: { src?: string | null; name?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const label = (name ?? '').trim()
  const letter = label ? Array.from(label)[0].toUpperCase() : '?'
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) }
  if (src && failed !== src) {
    return (
      <img
        className={'avatar' + (className ? ' ' + className : '')}
        style={style}
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
      />
    )
  }
  return (
    <span
      className={'avatar avatar--letter' + (className ? ' ' + className : '')}
      style={{ ...style, background: colorFor(label || '?') }}
      aria-hidden
    >
      {letter}
    </span>
  )
}
