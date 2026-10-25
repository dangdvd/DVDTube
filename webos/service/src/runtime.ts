// Everything the service runs, independent of the webOS bus (so tests and the smoke test can
// start it in-process or under plain Node): the core's network layer, the session, the local
// HTTP server (API + relay), and the cast receiver.

import { randomBytes } from 'crypto'
import { setFetcher } from '../../../windows/src/main/core/http'
import { refreshRemoteConfig } from '../../../windows/src/main/core/clients'
import { setCoreLogger } from '../../../windows/src/main/core/config'
import { createApi, type ApiMethod } from './api'
import { TvCast } from './cast'
import { EventBus } from './events'
import { createFetcher } from './fetcher'
import type { RelayContext } from './hls'
import { LocalServer } from './server'
import { Session } from './session'

declare const __APP_VERSION__: string

export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0'

export interface RuntimeOptions {
  version?: string
  apiPort?: number
  castPort?: number
  /** Advertise the cast receiver with DNS-SD (off in tests). */
  mdns?: boolean
  lan?: { pairingPort?: number; syncPort?: number; address?: string }
  allowHost?: RelayContext['allowHost']
  /** Print log lines to stdout (webOS keeps them in its journal). */
  console?: boolean
  /** Download the remote client configuration at start (off in tests). */
  remoteConfig?: boolean
}

export interface Runtime {
  token: string
  port: number
  version: string
  methods: Record<string, ApiMethod>
  events: EventBus
  session: Session
  cast: TvCast
  log: string[]
  stop(): Promise<void>
}

export async function startRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const version = options.version ?? VERSION
  const log: string[] = []
  setCoreLogger((message) => {
    const line = `${new Date().toISOString()} ${message}`
    log.push(line)
    if (log.length > 2000) log.splice(0, log.length - 2000)
    if (options.console) console.log(`[dvdtube] ${message}`)
  })
  const events = new EventBus()
  const session = new Session(events)
  setFetcher(createFetcher({ auth: session.auth, anon: session.anon }))
  const token = randomBytes(16).toString('hex')
  const relay: RelayContext = { port: 0, token, allowHost: options.allowHost }
  let identity = { id: randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'), name: 'LG webOS TV' }
  const cast = new TvCast({
    version,
    port: options.castPort,
    mdns: options.mdns,
    onCommand: (command) => events.emit('castCommand', command),
    log: (message) => {
      const line = `${new Date().toISOString()} ${message}`
      log.push(line)
      if (options.console) console.log(`[dvdtube] ${message}`)
    },
  })
  const methods = createApi({
    version,
    relay,
    session,
    events,
    cast,
    identity: () => identity,
    setIdentity: (next) => {
      const id = typeof next.id === 'string' && /^[0-9a-f-]{8,64}$/i.test(next.id) ? next.id : identity.id
      const name = typeof next.name === 'string' && next.name.trim() ? next.name.trim().slice(0, 80) : identity.name
      identity = { id, name }
    },
    logLines: () => log,
    lan: options.lan,
  })
  const server = new LocalServer({ port: options.apiPort, token, version, events, relay, methods })
  const port = await server.start()
  if (options.remoteConfig !== false) void refreshRemoteConfig()
  return {
    token,
    port,
    version,
    methods,
    events,
    session,
    cast,
    log,
    async stop() {
      server.stop()
      await cast.stop()
      await methods.stopPairing().catch(() => {})
      await methods.stopSyncReceiver().catch(() => {})
    },
  }
}
