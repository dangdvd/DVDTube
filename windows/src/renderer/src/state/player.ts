// Playback state shared by the whole UI. OWNED BY THE PLAYER MODULE (src/player/**): it may add
// fields and actions, but must keep everything below working because the pages use it.
//
// The watch page (route /watch) calls `play()`; leaving the watch page while something plays
// switches `mode` to 'mini' (floating mini player); `close()` stops everything.
//
// The actions are implemented by the player controller (`player/controller.ts`), which
// registers itself with `registerPlayerDriver` when the player module loads.

import { create } from 'zustand'
import type { CaptionCue, CaptionTrack, PlayerInfo, SponsorSegment, VideoItem, WatchInfo } from '@shared/models'
import type { AudioTrackOption, QualityOption, SourceKind } from '@/player/engine/engine'

export type PlayerMode = 'page' | 'mini' | 'hidden'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

export interface PlayOptions {
  queue?: VideoItem[]
  index?: number
  playlistId?: string | null
  /** Seconds; null / undefined = resume where the video stopped last time (when enabled). */
  startAt?: number | null
}

export type { AudioTrackOption, QualityOption, SourceKind }

/** What the controller implements (everything that touches the <video> / network). */
export interface PlayerDriver {
  play(video: VideoItem, options?: PlayOptions): void
  addToQueue(video: VideoItem): void
  playNext(video: VideoItem): void
  setMode(mode: PlayerMode): void
  close(): void

  togglePlay(): void
  pause(): void
  resume(): void
  replay(): void
  seek(seconds: number): void
  seekBy(delta: number): void
  frameStep(direction: 1 | -1): void
  next(): void
  previous(): void
  playQueueItem(index: number): void
  removeFromQueue(index: number): void
  shuffleQueue(): void
  setLoopQueue(on: boolean): void
  setLoop(on: boolean): void
  setRate(rate: number): void
  setBoost(on: boolean): void
  setQuality(height: number): void
  setAudioTrack(id: string): void
  setCaption(track: CaptionTrack | null, translateTo?: string | null): void
  toggleCaptions(): void
  setVolume(volume: number): void
  toggleMute(): void
  setAudioOnly(on: boolean): void
  /** null = off, 0 = at the end of this video, otherwise minutes. */
  setSleepTimer(minutes: number | null): void
  cancelUpNext(): void
  playUpNextNow(): void
  retry(): void
  toggleFullscreen(): void
  togglePip(): void
  skipSponsor(): void
  goLive(): void
}

export interface PlayerStore extends PlayerDriver {
  current: VideoItem | null
  queue: VideoItem[]
  queueIndex: number
  playlistId: string | null
  mode: PlayerMode
  playing: boolean
  status: PlaybackStatus
  /** User-facing message when status is 'error'. */
  error: string | null
  currentTime: number
  duration: number

  /** Second line of the error overlay (technical detail, Vietnamese). */
  errorDetail: string | null
  /** Streams of the current video (player endpoint). */
  info: PlayerInfo | null
  /** Watch page data of the current video (next endpoint). */
  watch: WatchInfo | null
  watchError: string | null
  /** End of the buffered range around the playhead (seconds). */
  buffered: number
  live: boolean
  /** Start of the seekable window of a live stream (DVR), seconds. */
  seekStart: number
  /** Seconds until the streams become available ("Đang chuẩn bị video…"). */
  waitSeconds: number
  source: SourceKind | null
  /** What plays has no picture (audio-only stream or an .m4a download). */
  pictureless: boolean
  rate: number
  /** Held Space: 2× until released. */
  boosted: boolean
  qualities: QualityOption[]
  /** Height picked in the quality menu; 0 = automatic. */
  quality: number
  activeHeight: number | null
  activeFps: number
  audioTracks: AudioTrackOption[]
  audioTrack: string | null
  captionTracks: CaptionTrack[]
  captionTrack: CaptionTrack | null
  captionTranslate: string | null
  captionCues: CaptionCue[]
  sponsorSegments: SponsorSegment[]
  /** Segment the "Bỏ qua" button is shown for (SponsorBlock "ask" mode). */
  sponsorPrompt: SponsorSegment | null
  loop: boolean
  loopQueue: boolean
  shuffled: boolean
  audioOnly: boolean
  sleepEndsAt: number | null
  sleepAtEnd: boolean
  /** Autoplay countdown card. */
  upNext: VideoItem | null
  upNextEndsAt: number | null
  fullscreen: boolean
  pip: boolean
  /** The whole window is the small always-on-top player (`setWindowMode('mini')`). */
  windowMini: boolean
  stats: boolean
  chaptersOpen: boolean

  setStats(on: boolean): void
  setChaptersOpen(on: boolean): void
}

let driver: PlayerDriver | null = null

/** Called once by the player controller. */
export function registerPlayerDriver(implementation: PlayerDriver): void {
  driver = implementation
}

type DriverKey = keyof PlayerDriver

function delegate<K extends DriverKey>(key: K): PlayerDriver[K] {
  return ((...args: unknown[]) => (driver?.[key] as ((...a: unknown[]) => void) | undefined)?.(...args)) as PlayerDriver[K]
}

export const INITIAL_PLAYBACK = {
  playing: false,
  status: 'idle' as PlaybackStatus,
  error: null,
  errorDetail: null,
  currentTime: 0,
  duration: 0,
  info: null,
  watch: null,
  watchError: null,
  buffered: 0,
  live: false,
  seekStart: 0,
  waitSeconds: 0,
  source: null,
  pictureless: false,
  boosted: false,
  qualities: [],
  quality: 0,
  activeHeight: null,
  activeFps: 0,
  audioTracks: [],
  audioTrack: null,
  captionTracks: [],
  captionTrack: null,
  captionTranslate: null,
  captionCues: [],
  sponsorSegments: [],
  sponsorPrompt: null,
  loop: false,
  upNext: null,
  upNextEndsAt: null,
} satisfies Partial<PlayerStore>

export const usePlayer = create<PlayerStore>((set) => ({
  current: null,
  queue: [],
  queueIndex: 0,
  playlistId: null,
  mode: 'hidden',
  ...INITIAL_PLAYBACK,
  rate: 1,
  loopQueue: false,
  shuffled: false,
  audioOnly: false,
  sleepEndsAt: null,
  sleepAtEnd: false,
  fullscreen: false,
  pip: false,
  windowMini: false,
  stats: false,
  chaptersOpen: false,

  play: delegate('play'),
  addToQueue: delegate('addToQueue'),
  playNext: delegate('playNext'),
  setMode: delegate('setMode'),
  close: delegate('close'),
  togglePlay: delegate('togglePlay'),
  pause: delegate('pause'),
  resume: delegate('resume'),
  replay: delegate('replay'),
  seek: delegate('seek'),
  seekBy: delegate('seekBy'),
  frameStep: delegate('frameStep'),
  next: delegate('next'),
  previous: delegate('previous'),
  playQueueItem: delegate('playQueueItem'),
  removeFromQueue: delegate('removeFromQueue'),
  shuffleQueue: delegate('shuffleQueue'),
  setLoopQueue: delegate('setLoopQueue'),
  setLoop: delegate('setLoop'),
  setRate: delegate('setRate'),
  setBoost: delegate('setBoost'),
  setQuality: delegate('setQuality'),
  setAudioTrack: delegate('setAudioTrack'),
  setCaption: delegate('setCaption'),
  toggleCaptions: delegate('toggleCaptions'),
  setVolume: delegate('setVolume'),
  toggleMute: delegate('toggleMute'),
  setAudioOnly: delegate('setAudioOnly'),
  setSleepTimer: delegate('setSleepTimer'),
  cancelUpNext: delegate('cancelUpNext'),
  playUpNextNow: delegate('playUpNextNow'),
  retry: delegate('retry'),
  toggleFullscreen: delegate('toggleFullscreen'),
  togglePip: delegate('togglePip'),
  skipSponsor: delegate('skipSponsor'),
  goLive: delegate('goLive'),

  setStats(on) {
    set({ stats: on })
  },
  setChaptersOpen(on) {
    set({ chaptersOpen: on })
  },
}))
