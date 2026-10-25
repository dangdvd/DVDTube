// "Truyền tới DVDTube" receiver on the TV: the shared HTTP JSON API (TCP 8766, protocol 1,
// windows/src/main/cast/receiver.ts) plus the DNS-SD advertisement `_dvdtube._tcp` with
// `kind=tv` (windows/src/main/cast/mdns.ts). Commands go to the TV interface as `castCommand`
// events; the interface reports its playback state back (`castReceiverStatus`), answered to
// `GET /api/status`.

import type { CastCommand, CastStatus } from '../../../windows/src/shared/models'
import { Mdns } from '../../../windows/src/main/cast/mdns'
import { CAST_PORT, CastReceiver, IDLE_STATUS, cleanStatus } from '../../../windows/src/main/cast/receiver'
import type { LocalInterface } from '../../../windows/src/main/lan'

export const SERVICE_TYPE = '_dvdtube._tcp'

export interface TvCastOptions {
  version: string
  onCommand(command: CastCommand): void
  log(message: string): void
  port?: number
  /** Tests: no multicast. */
  mdns?: boolean
  mdnsPort?: number
  interfaces?: () => LocalInterface[]
}

export interface TvIdentity {
  id: string
  name: string
}

export class TvCast {
  private receiver: CastReceiver | null = null
  private mdns: Mdns | null = null
  private status: CastStatus = IDLE_STATUS
  private identity: TvIdentity | null = null
  private wanted = false
  private busy: Promise<void> = Promise.resolve()

  constructor(private readonly options: TvCastOptions) {}

  get port(): number {
    return this.receiver?.port ?? 0
  }

  get running(): boolean {
    return !!this.receiver?.running
  }

  setStatus(value: unknown): void {
    this.status = cleanStatus(value)
  }

  /** Starts / stops the receiver (serialised; a name change re-advertises). */
  configure(enabled: boolean, identity: TvIdentity): Promise<void> {
    const run = async () => {
      const changed = !this.identity || this.identity.id !== identity.id || this.identity.name !== identity.name
      this.wanted = enabled
      if (enabled && this.receiver && changed) await this.stopNow()
      this.identity = identity
      if (enabled && !this.receiver) await this.startNow(identity)
      else if (!enabled && this.receiver) await this.stopNow()
    }
    this.busy = this.busy.then(run, run)
    return this.busy
  }

  private async startNow(identity: TvIdentity): Promise<void> {
    const receiver = new CastReceiver(
      { id: identity.id, name: identity.name, kind: 'tv', version: this.options.version },
      { onCommand: (c) => this.options.onCommand(c), status: () => this.status, log: (m) => this.options.log(m) },
      this.options.port ?? CAST_PORT,
    )
    let port: number
    try {
      port = await receiver.start()
    } catch (error) {
      this.options.log(`cast receiver: not started (${error instanceof Error ? error.message : String(error)})`)
      return
    }
    this.receiver = receiver
    if (this.options.mdns === false) return
    try {
      const mdns = new Mdns({ log: (m) => this.options.log(m), port: this.options.mdnsPort, interfaces: this.options.interfaces })
      await mdns.start()
      mdns.advertise({
        instance: identity.name,
        type: SERVICE_TYPE,
        port,
        host: `DVDTube-${identity.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'tv'}`,
        txt: { id: identity.id, v: '1', kind: 'tv', name: identity.name },
      })
      this.mdns = mdns
    } catch (error) {
      // UDP 5353 may be taken / blocked: senders can still add the TV by IP.
      this.options.log(`mdns: not available (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  private async stopNow(): Promise<void> {
    this.receiver?.stop()
    this.receiver = null
    const mdns = this.mdns
    this.mdns = null
    if (mdns) await mdns.stop().catch(() => {})
  }

  stop(): Promise<void> {
    this.wanted = false
    const run = () => this.stopNow()
    this.busy = this.busy.then(run, run)
    return this.busy
  }

  get enabled(): boolean {
    return this.wanted
  }
}
