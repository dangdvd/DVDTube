// Entry of the JS service `com.dangdvd.dvdtube.service` (bundled into one service.js for the
// TV's Node.js 8.12+). The webOS bus is only used to start the service and keep it alive:
//
//   luna://com.dangdvd.dvdtube.service/start      → { port, token, version }
//   luna://com.dangdvd.dvdtube.service/keepAlive  (subscribe: true) → same, then heartbeats
//
// `webos-service` ends the process 5 s after its last activity; every open subscription holds
// one, so the service lives exactly as long as the TV interface keeps its subscription (closing
// the app cancels it). Everything else goes over HTTP to 127.0.0.1:<port> (see server.ts).

import './polyfills'
import { startRuntime, type Runtime } from './runtime'

declare const require: (id: string) => unknown

interface LunaMessage {
  payload: Record<string, unknown>
  isSubscription: boolean
  uniqueToken: string
  respond(response: Record<string, unknown>): boolean
  cancel(response?: Record<string, unknown>): void
}

interface LunaService {
  register(name: string, request: (message: LunaMessage) => void, cancel?: (message: LunaMessage) => void): unknown
}

type ServiceConstructor = new (busId: string) => LunaService

export const SERVICE_ID = 'com.dangdvd.dvdtube.service'

function log(message: string): void {
  console.log(`[dvdtube] ${message}`)
}

export function runService(Service: ServiceConstructor): LunaService {
  const service = new Service(SERVICE_ID)
  let runtime: Runtime | null = null
  let starting: Promise<Runtime> | null = null
  const subscribers = new Map<string, LunaMessage>()
  let beats = 0

  const ensure = (): Promise<Runtime> => {
    if (runtime) return Promise.resolve(runtime)
    if (!starting) {
      starting = startRuntime({ console: true }).then(
        (rt) => {
          runtime = rt
          log(`ready on 127.0.0.1:${rt.port} (node ${process.version})`)
          return rt
        },
        (error) => {
          starting = null
          throw error
        },
      )
    }
    return starting
  }

  const info = (rt: Runtime) => ({ returnValue: true, port: rt.port, token: rt.token, version: rt.version, node: process.version })

  const fail = (message: LunaMessage, error: unknown) => {
    message.respond({ returnValue: false, errorCode: -1, errorText: error instanceof Error ? error.message : String(error) })
  }

  service.register('start', (message) => {
    ensure().then(
      (rt) => message.respond(info(rt)),
      (error) => fail(message, error),
    )
  })

  service.register(
    'keepAlive',
    (message) => {
      ensure().then(
        (rt) => {
          if (message.isSubscription) subscribers.set(message.uniqueToken, message)
          message.respond({ ...info(rt), subscribed: message.isSubscription })
        },
        (error) => fail(message, error),
      )
    },
    (message) => {
      subscribers.delete(message.uniqueToken)
      log(`keepAlive cancelled (${subscribers.size} left)`)
    },
  )

  service.register('stop', (message) => {
    message.respond({ returnValue: true })
    for (const sub of Array.from(subscribers.values())) {
      try {
        sub.cancel({})
      } catch {
        // already gone
      }
    }
    subscribers.clear()
  })

  // Heartbeats keep the UI informed that the service still runs (and where).
  const timer = setInterval(() => {
    if (!runtime || subscribers.size === 0) return
    beats++
    for (const sub of Array.from(subscribers.values())) {
      try {
        sub.respond({ returnValue: true, heartbeat: beats, port: runtime.port })
      } catch {
        subscribers.delete(sub.uniqueToken)
      }
    }
  }, 60_000)
  ;(timer as { unref?: () => void }).unref?.()

  // Start the servers right away: the UI's first call usually follows within a second.
  void ensure().catch((error) => log(`start failed: ${error instanceof Error ? error.message : String(error)}`))
  return service
}

process.on('uncaughtException', (error) => {
  log(`uncaught: ${error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error)}`)
})
process.on('unhandledRejection', (reason) => {
  log(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`)
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ServiceClass = require('webos-service') as ServiceConstructor
runService(ServiceClass)
