// "Nghe nhạc": recently played songs (saved), the search tab and the now-playing panel, and a
// small lyrics cache (the main process caches too).

import { create } from 'zustand'
import type { Lyrics, MusicSearchKind, VideoItem } from '@shared/models'
import { api } from '@/lib/api'
import { load, saveSoon } from '@/lib/persist'
import { usePlayer } from './player'

const MAX_RECENT = 30

interface MusicStore {
  recent: VideoItem[]
  query: string
  kind: MusicSearchKind
  nowPlayingOpen: boolean
  setQuery(query: string): void
  setKind(kind: MusicSearchKind): void
  setNowPlaying(open: boolean): void
  noteSong(video: VideoItem): void
  clearRecent(): void
}

export const useMusic = create<MusicStore>((set, get) => ({
  recent: [],
  query: '',
  kind: 'songs',
  nowPlayingOpen: false,
  setQuery(query) {
    set({ query })
  },
  setKind(kind) {
    set({ kind })
  },
  setNowPlaying(open) {
    set({ nowPlayingOpen: open })
  },
  noteSong(video) {
    const recent = [video, ...get().recent.filter((v) => v.id !== video.id)].slice(0, MAX_RECENT)
    set({ recent })
    saveSoon('music', { recent })
  },
  clearRecent() {
    set({ recent: [] })
    saveSoon('music', { recent: [] })
  },
}))

const lyricsCache = new Map<string, Promise<Lyrics | null>>()

export function lyricsFor(videoId: string): Promise<Lyrics | null> {
  let promise = lyricsCache.get(videoId)
  if (!promise) {
    promise = api.lyrics(videoId).catch((error) => {
      lyricsCache.delete(videoId)
      throw error
    })
    lyricsCache.set(videoId, promise)
  }
  return promise
}

let started = false

export async function loadMusic(): Promise<void> {
  const saved = await load<{ recent?: VideoItem[] }>('music')
  useMusic.setState({ recent: Array.isArray(saved?.recent) ? saved!.recent!.slice(0, MAX_RECENT) : [] })
  if (started) return
  started = true
  // Songs played in music mode become "recent songs".
  usePlayer.subscribe((s, prev) => {
    if (s.musicMode && s.current && s.current.id !== prev.current?.id && s.current.title) useMusic.getState().noteSong(s.current)
  })
}
