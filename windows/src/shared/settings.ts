// User settings. Owned by the renderer (persisted with `storeWrite('settings', …)`); the parts
// the main process needs are pushed to it with `configure()` at startup and on every change.

export type ThemeMode = 'dark' | 'light' | 'system'

/** Preferred video height; `0` = automatic (adaptive). */
export type QualityPreference = 0 | 144 | 240 | 360 | 480 | 720 | 1080 | 1440 | 2160 | 4320

export interface EqualizerSettings {
  enabled: boolean
  /** Preset id from EQ_PRESETS, or "custom". */
  preset: string
  /** Gains in dB for EQ_BANDS (10 values, −12…+12). */
  gains: number[]
  /** Overall gain in dB applied before the bands (−12…+12). */
  preamp: number
}

/** "Tự động tải video mới" of subscribed channels. */
export interface AutoDownloadSettings {
  enabled: boolean
  /** Channels picked in Settings (from local subscriptions and the account's). */
  channels: { id: string; name: string; avatar?: string | null }[]
  /** "Giữ tối đa N video mỗi kênh". */
  keep: number
  /** "Chỉ khi dùng Wi-Fi" (on a PC: not over a mobile / cellular connection). */
  wifiOnly: boolean
  audioOnly: boolean
}

export type DownloadQuality = 360 | 480 | 720 | 1080 | 1440 | 2160

export interface AppSettings {
  // Region / language for InnerTube ("hl" / "gl").
  language: string
  region: string
  theme: ThemeMode

  // Playback
  defaultQuality: QualityPreference
  /** Quality while the window is small / mini player (saves bandwidth). */
  miniPlayerQuality: QualityPreference
  preferredCodec: 'auto' | 'av1' | 'vp9' | 'h264'
  autoplayNext: boolean
  defaultSpeed: number
  volume: number
  muted: boolean
  /** Seek step for ← / → and double click, seconds. */
  seekStep: number
  /** Keep playing when the window is minimised / hidden. */
  backgroundPlayback: boolean
  /** "Stable volume": normalise loudness using YouTube's loudness value. */
  stableVolume: boolean
  ambientMode: boolean
  theaterMode: boolean
  /** Remember where each video stopped and resume there. */
  resumePlayback: boolean
  preferredAudioLanguage: string | null

  // Captions
  captionsEnabled: boolean
  /** Language code of the preferred track; null = video default. */
  captionLanguage: string | null
  /** Auto-translate captions into this language when the video has none in it. */
  captionTranslateTo: string | null
  captionSize: number
  captionBackground: number

  // SponsorBlock
  sponsorBlock: boolean
  sponsorCategories: string[]
  /** "skip" skips automatically, "ask" shows a button. */
  sponsorMode: 'skip' | 'ask'

  equalizer: EqualizerSettings

  // Watch page / feed
  showDislikes: boolean
  showComments: boolean
  hideShorts: boolean

  // Privacy
  incognito: boolean
  pauseWatchHistory: boolean
  pauseSearchHistory: boolean

  // Downloads
  downloadFolder: string | null
  /** Above 1080p: AV1 (.mp4) or VP9 + Opus (.webm) when YouTube has them. */
  downloadQuality: DownloadQuality
  /** "Tải kèm phụ đề (.srt)". */
  downloadSubtitles: boolean
  autoDownload: AutoDownloadSettings

  // Cast ("Cho phép truyền video tới máy tính này")
  castReceiver: boolean

  // Music mode
  /** "Nghe nhạc" plays only the sound (saves data); the picture can be turned on per song. */
  musicAudioOnly: boolean

  // DeArrow
  dearrow: boolean
  dearrowTitles: boolean
  dearrowThumbnails: boolean

  /** "Dùng trình phát web khi lỗi": YouTube's embed when every native source fails. */
  webPlayerFallback: boolean

  /** "Hẹn giờ phát": bring the window to the front when an alarm starts. */
  alarmShowWindow: boolean

  // App
  minimizeToTray: boolean
  notifyNewVideos: boolean
  checkUpdates: boolean
  hardwareAcceleration: boolean
  remoteConfigUrl: string
}

/** Center frequencies of the 10-band equalizer (Hz). */
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

/** Presets for popular genres (dB per band, same order as EQ_BANDS). */
export const EQ_PRESETS: { id: string; title: string; gains: number[] }[] = [
  { id: 'flat', title: 'Phẳng (tắt)', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', title: 'Tăng bass', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'pop', title: 'Pop', gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
  { id: 'rock', title: 'Rock', gains: [5, 4, 2, -1, -2, -1, 2, 3, 4, 4] },
  { id: 'edm', title: 'EDM', gains: [6, 5, 2, 0, -1, 1, 2, 3, 4, 5] },
  { id: 'dance', title: 'Dance', gains: [5, 6, 3, 0, 0, -1, 1, 3, 3, 2] },
  { id: 'trap', title: 'Trap / Hip-hop', gains: [7, 6, 3, 1, -1, -1, 1, 1, 2, 3] },
  { id: 'classical', title: 'Cổ điển', gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: 'jazz', title: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: 'acoustic', title: 'Acoustic', gains: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1] },
  { id: 'bolero', title: 'Bolero / Trữ tình', gains: [2, 2, 1, 1, 2, 3, 3, 2, 1, 1] },
  { id: 'vocal', title: 'Giọng hát', gains: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0] },
  { id: 'treble', title: 'Tăng treble', gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: 'loudness', title: 'Loudness', gains: [5, 4, 2, 0, -1, 0, 1, 2, 4, 5] },
  { id: 'night', title: 'Nghe đêm (nhỏ, rõ lời)', gains: [-3, -2, -1, 0, 2, 3, 3, 2, 0, -2] },
]

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'vi',
  region: 'VN',
  theme: 'dark',

  defaultQuality: 1080,
  miniPlayerQuality: 480,
  preferredCodec: 'auto',
  autoplayNext: true,
  defaultSpeed: 1,
  volume: 1,
  muted: false,
  seekStep: 10,
  backgroundPlayback: true,
  stableVolume: false,
  ambientMode: true,
  theaterMode: false,
  resumePlayback: true,
  preferredAudioLanguage: null,

  captionsEnabled: false,
  captionLanguage: null,
  captionTranslateTo: null,
  captionSize: 100,
  captionBackground: 0.75,

  sponsorBlock: true,
  sponsorCategories: ['sponsor', 'selfpromo', 'interaction'],
  sponsorMode: 'skip',

  equalizer: { enabled: false, preset: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },

  showDislikes: true,
  showComments: true,
  hideShorts: false,

  incognito: false,
  pauseWatchHistory: false,
  pauseSearchHistory: false,

  downloadFolder: null,
  downloadQuality: 1080,
  downloadSubtitles: false,
  autoDownload: { enabled: false, channels: [], keep: 3, wifiOnly: true, audioOnly: false },

  castReceiver: true,

  musicAudioOnly: true,

  dearrow: true,
  dearrowTitles: true,
  dearrowThumbnails: true,

  webPlayerFallback: true,

  alarmShowWindow: true,

  minimizeToTray: false,
  notifyNewVideos: true,
  checkUpdates: true,
  hardwareAcceleration: true,
  remoteConfigUrl: '',
}

/** The part of the settings the main process needs. */
export interface CoreConfig {
  language: string
  region: string
  incognito: boolean
  remoteConfigUrl: string
  downloadFolder: string | null
  downloadQuality: number
  minimizeToTray: boolean
  backgroundPlayback: boolean
  hardwareAcceleration: boolean
  /** Runs the cast receiver (HTTP API + DNS-SD advertisement). */
  castReceiver: boolean
  /** Parental controls' "Chế độ hạn chế": `lockedSafetyMode` on every InnerTube request. */
  restrictedMode: boolean
  downloadSubtitles: boolean
  /** Preferred caption language (subtitle downloads). */
  captionLanguage: string | null
  autoDownload: AutoDownloadSettings
}

/** `restrictedMode` comes from the parental controls, which are stored apart from the settings. */
export function coreConfig(s: AppSettings, restrictedMode = false): CoreConfig {
  return {
    language: s.language,
    region: s.region,
    incognito: s.incognito,
    remoteConfigUrl: s.remoteConfigUrl,
    downloadFolder: s.downloadFolder,
    downloadQuality: s.downloadQuality,
    minimizeToTray: s.minimizeToTray,
    backgroundPlayback: s.backgroundPlayback,
    hardwareAcceleration: s.hardwareAcceleration,
    castReceiver: s.castReceiver,
    restrictedMode,
    downloadSubtitles: s.downloadSubtitles,
    captionLanguage: s.captionLanguage,
    autoDownload: s.autoDownload,
  }
}
