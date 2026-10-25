// Events from the service to the TV interface (the desktop app's `DvdEvents`): pairing and sync
// status, cast commands from phones / PCs, account changes. The UI long-polls
// `GET /api/events?after=<seq>`; the last 200 events are kept for it to catch up.

export interface ServiceEvent {
  seq: number
  name: string
  payload: unknown
  at: number
}

type Waiter = { after: number; resolve: (events: ServiceEvent[]) => void; timer: ReturnType<typeof setTimeout> }

export class EventBus {
  private events: ServiceEvent[] = []
  private seq = 0
  private waiters: Waiter[] = []
  private readonly limit: number

  constructor(limit = 200) {
    this.limit = limit
  }

  get lastSeq(): number {
    return this.seq
  }

  emit(name: string, payload: unknown): ServiceEvent {
    const event: ServiceEvent = { seq: ++this.seq, name, payload, at: Date.now() }
    this.events.push(event)
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit)
    const ready = this.waiters
    this.waiters = []
    for (const waiter of ready) {
      clearTimeout(waiter.timer)
      waiter.resolve(this.since(waiter.after))
    }
    return event
  }

  since(after: number): ServiceEvent[] {
    return this.events.filter((e) => e.seq > after)
  }

  /** Resolves with the events after `after` as soon as there is one (or [] after `timeoutMs`). */
  wait(after: number, timeoutMs: number): Promise<ServiceEvent[]> {
    // A UI that restarted while the service kept running asks with a sequence from the future.
    const start = after > this.seq ? 0 : after
    const pending = this.since(start)
    if (pending.length > 0 || timeoutMs <= 0) return Promise.resolve(pending)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        after: start,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter)
          resolve([])
        }, timeoutMs),
      }
      this.waiters.push(waiter)
    })
  }

  close(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve([])
    }
    this.waiters = []
  }
}
