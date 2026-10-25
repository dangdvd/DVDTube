// YouTube captions (json3 cues) → SubRip (.srt) for "Tải kèm phụ đề".

import type { CaptionCue } from '@shared/models'

/** `HH:MM:SS,mmm` */
export function srtTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000))
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60_000) % 60
  const h = Math.floor(total / 3_600_000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

/**
 * Numbered cues in time order. Overlapping cues (YouTube's rolling auto-captions) end where the
 * next one starts, so players never show two at once.
 */
export function cuesToSrt(cues: CaptionCue[]): string {
  const list = cues
    .map((c) => ({ start: c.start, end: c.end, text: c.text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('\n') }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end))
    .sort((a, b) => a.start - b.start)
  const blocks: string[] = []
  list.forEach((cue, i) => {
    const next = list[i + 1]
    let end = Math.max(cue.end, cue.start + 0.1)
    if (next && next.start > cue.start && end > next.start) end = next.start
    blocks.push(`${blocks.length + 1}\r\n${srtTimestamp(cue.start)} --> ${srtTimestamp(end)}\r\n${cue.text.replace(/\n/g, '\r\n')}\r\n`)
  })
  return blocks.join('\r\n')
}
