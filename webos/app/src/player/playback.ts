// A thin wrapper around the TV's native <video> element (HLS / MP4 / M4A through the service's
// relay), plus a simulated clock for the `mock:` sources of the sample data. The player screens
// only talk to this.

export type PlaybackEvent = 'loading' | 'playing' | 'pause' | 'waiting' | 'time' | 'ended' | 'error' | 'ready'

export class Playback {
  private mockTimer: ReturnType<typeof setInterval> | null = null
  private mockTime = 0
  private mockDuration = 0
  private mockPaused = true
  private mockRate = 1
  private mock = false
  private destroyed = false
  private pendingSeek: number | null = null
  private readonly listeners: [string, EventListener][] = []
  src: string | null = null

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly emit: (event: PlaybackEvent, detail?: string) => void,
  ) {
    const on = (type: string, handler: () => void) => {
      const listener = () => {
        if (!this.mock && !this.destroyed) handler()
      }
      video.addEventListener(type, listener)
      this.listeners.push([type, listener])
    }
    on('loadedmetadata', () => {
      if (this.pendingSeek !== null && this.pendingSeek > 0) {
        try {
          video.currentTime = this.pendingSeek
        } catch {
          // some HLS streams only seek once playing
        }
      }
      this.emit('ready')
    })
    on('playing', () => {
      // Some players ignore a seek before the first frame: try once more.
      if (this.pendingSeek !== null && this.pendingSeek > 0 && Math.abs(video.currentTime - this.pendingSeek) > 3) {
        try {
          video.currentTime = this.pendingSeek
        } catch {
          // ignore
        }
      }
      this.pendingSeek = null
      this.emit('playing')
    })
    on('pause', () => this.emit('pause'))
    on('waiting', () => this.emit('waiting'))
    on('timeupdate', () => this.emit('time'))
    on('ended', () => this.emit('ended'))
    on('error', () => {
      const code = video.error ? video.error.code : 0
      this.emit('error', `media error ${code}`)
    })
  }

  load(src: string, startAt: number, duration: number | null, autoplay = true): void {
    this.stopMock()
    this.src = src
    this.emit('loading')
    if (src.startsWith('mock:')) {
      this.mock = true
      this.video.removeAttribute('src')
      this.mockDuration = duration && duration > 0 ? duration : 420
      this.mockTime = Math.max(0, Math.min(startAt, this.mockDuration - 1))
      this.mockPaused = !autoplay
      setTimeout(() => {
        if (this.destroyed || this.src !== src) return
        this.emit('ready')
        if (autoplay) this.play()
      }, 350)
      this.mockTimer = setInterval(() => {
        if (this.mockPaused || this.destroyed) return
        this.mockTime += 0.25 * this.mockRate
        if (this.mockTime >= this.mockDuration) {
          this.mockTime = this.mockDuration
          this.mockPaused = true
          this.emit('time')
          this.emit('ended')
          return
        }
        this.emit('time')
      }, 250)
      return
    }
    this.mock = false
    this.pendingSeek = startAt > 0 ? startAt : null
    this.video.src = src
    this.video.load()
    if (autoplay) this.play()
  }

  play(): void {
    if (this.mock) {
      this.mockPaused = false
      this.emit('playing')
      return
    }
    const result = this.video.play() as Promise<void> | undefined
    if (result && typeof result.catch === 'function') result.catch(() => {})
  }

  pause(): void {
    if (this.mock) {
      this.mockPaused = true
      this.emit('pause')
      return
    }
    this.video.pause()
  }

  toggle(): void {
    if (this.paused) this.play()
    else this.pause()
  }

  seek(seconds: number): void {
    const d = this.duration
    const target = Math.max(0, d > 0 ? Math.min(seconds, d - 0.5) : seconds)
    if (this.mock) {
      this.mockTime = target
      this.emit('time')
      return
    }
    try {
      this.video.currentTime = target
    } catch {
      this.pendingSeek = target
    }
    this.emit('time')
  }

  get time(): number {
    return this.mock ? this.mockTime : this.video.currentTime || 0
  }

  get duration(): number {
    if (this.mock) return this.mockDuration
    const d = this.video.duration
    return Number.isFinite(d) ? d : 0
  }

  get paused(): boolean {
    return this.mock ? this.mockPaused : this.video.paused
  }

  get isMock(): boolean {
    return this.mock
  }

  set rate(value: number) {
    if (this.mock) this.mockRate = value
    else this.video.playbackRate = value
  }

  set volume(value: number) {
    this.video.volume = Math.max(0, Math.min(1, value))
  }

  get volume(): number {
    return this.video.volume
  }

  set muted(value: boolean) {
    this.video.muted = value
  }

  get muted(): boolean {
    return this.video.muted
  }

  /** Seconds buffered ahead of the playhead. */
  get bufferedEnd(): number {
    if (this.mock) return Math.min(this.mockDuration, this.mockTime + 30)
    const b = this.video.buffered
    for (let i = 0; i < b.length; i++) if (b.start(i) <= this.video.currentTime + 0.5 && b.end(i) >= this.video.currentTime) return b.end(i)
    return this.video.currentTime
  }

  private stopMock(): void {
    if (this.mockTimer) clearInterval(this.mockTimer)
    this.mockTimer = null
  }

  /** Releases the TV's decoder (important on webOS: only one pipeline at a time). */
  destroy(): void {
    this.destroyed = true
    this.stopMock()
    for (const [type, listener] of this.listeners) this.video.removeEventListener(type, listener)
    try {
      this.video.pause()
      this.video.removeAttribute('src')
      this.video.load()
    } catch {
      // ignore
    }
  }
}
