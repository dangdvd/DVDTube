// InnerTube client identities (port of `ClientProfile.kt`). All values can be overridden by the
// remote config (`Config/remote-config.json` in the repo), so the app keeps working when YouTube
// changes something.

import { coreState, debug } from './config'
import { describeError } from './errors'
import { requestText } from './http'

export interface ClientProfile {
  name: string
  id: number
  version: string
  host: string
  userAgent?: string | null
  deviceMake?: string | null
  deviceModel?: string | null
  osName?: string | null
  osVersion?: string | null
  platform?: string | null
  clientScreen?: string | null
  /** Send `X-YouTube-Client-Name/Version` + `Origin` headers. */
  sendClientHeaders: boolean
  extraHeaders?: Record<string, string> | null
}

/** `{gl}` in the user agent is replaced by the content country. */
export function resolvedUserAgent(profile: ClientProfile, gl: string): string | null {
  return profile.userAgent ? profile.userAgent.replace('{gl}', gl.toUpperCase()) : null
}

export const WEB: ClientProfile = {
  name: 'WEB',
  id: 1,
  version: '2.20261019.01.00',
  host: 'www.youtube.com',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  platform: 'DESKTOP',
  sendClientHeaders: true,
}

/**
 * The visionOS app's client gets HLS + direct stream URLs without PO tokens or JavaScript
 * signature deciphering.
 */
export const VISIONOS: ClientProfile = {
  name: 'VISIONOS',
  id: 101,
  version: '1.04',
  host: 'youtubei.googleapis.com',
  userAgent: 'com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; {gl})',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.6.0.23O770',
  platform: 'MOBILE',
  clientScreen: 'WATCH',
  sendClientHeaders: false,
  extraHeaders: { 'X-Goog-Api-Format-Version': '2' },
}

export const CHARTS: ClientProfile = {
  name: 'WEB_MUSIC_ANALYTICS',
  id: 31,
  version: '2.0',
  host: 'charts.youtube.com',
  sendClientHeaders: true,
  extraHeaders: { Origin: 'https://charts.youtube.com', Referer: 'https://charts.youtube.com' },
}

export interface RemoteConfig {
  web?: ClientProfile | null
  playerClients?: ClientProfile[] | null
  charts?: ClientProfile | null
  message?: string | null
}

export const DEFAULT_REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/dangdvd/DVDTube/main/Config/remote-config.json'

/** Validates one profile of the remote JSON (unknown keys are ignored, like `ignoreUnknownKeys`). */
export function parseProfile(value: unknown): ClientProfile | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const str = (key: string): string | null => (typeof v[key] === 'string' ? (v[key] as string) : null)
  const name = str('name')
  const version = str('version')
  const id = typeof v.id === 'number' ? v.id : null
  if (!name || !version || id === null) return null
  let extraHeaders: Record<string, string> | null = null
  if (typeof v.extraHeaders === 'object' && v.extraHeaders !== null) {
    extraHeaders = {}
    for (const [key, header] of Object.entries(v.extraHeaders as Record<string, unknown>)) {
      if (typeof header === 'string') extraHeaders[key] = header
    }
  }
  return {
    name,
    id,
    version,
    host: str('host') ?? 'www.youtube.com',
    userAgent: str('userAgent'),
    deviceMake: str('deviceMake'),
    deviceModel: str('deviceModel'),
    osName: str('osName'),
    osVersion: str('osVersion'),
    platform: str('platform'),
    clientScreen: str('clientScreen'),
    sendClientHeaders: typeof v.sendClientHeaders === 'boolean' ? v.sendClientHeaders : true,
    extraHeaders,
  }
}

export function parseRemoteConfig(text: string): RemoteConfig | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const v = json as Record<string, unknown>
  const players = Array.isArray(v.playerClients)
    ? v.playerClients.map(parseProfile).filter((p): p is ClientProfile => p !== null)
    : null
  return {
    web: parseProfile(v.web),
    playerClients: players,
    charts: parseProfile(v.charts),
    message: typeof v.message === 'string' ? v.message : null,
  }
}

/** Where the last downloaded remote config is cached (set by the main process). */
let persistence: { load(): string | null; save(text: string): void } = { load: () => null, save: () => {} }
let cached: RemoteConfig | null = null
let loaded = false

export function setRemoteConfigPersistence(p: typeof persistence): void {
  persistence = p
  loaded = false
}

function remote(): RemoteConfig | null {
  if (!loaded) {
    const text = persistence.load()
    cached = text ? parseRemoteConfig(text) : null
    loaded = true
  }
  return cached
}

export const APIConfig = {
  get hl(): string {
    return coreState.hl
  },
  get gl(): string {
    return coreState.gl
  },
  get webProfile(): ClientProfile {
    return remote()?.web ?? WEB
  },
  get chartsProfile(): ClientProfile {
    return remote()?.charts ?? CHARTS
  },
  get playerProfiles(): ClientProfile[] {
    const list = remote()?.playerClients
    return list && list.length > 0 ? list : [VISIONOS]
  },
  get remoteConfigUrl(): string {
    return coreState.remoteConfigUrl.trim() || DEFAULT_REMOTE_CONFIG_URL
  },
  get message(): string | null {
    return remote()?.message ?? null
  },
  /** Every profile streams may come from (for matching a googlevideo URL's `c=` parameter). */
  allProfiles(): ClientProfile[] {
    return [...this.playerProfiles, this.webProfile, VISIONOS, WEB]
  },
}

/** Downloads the remote config; failures keep the previous (or built-in) values. */
export async function refreshRemoteConfig(): Promise<void> {
  try {
    const response = await requestText(APIConfig.remoteConfigUrl, {
      transport: 'plain',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    })
    if (response.status !== 200) {
      debug(`remote config -> HTTP ${response.status}`)
      return
    }
    const config = parseRemoteConfig(response.text)
    if (!config) {
      debug('remote config: invalid JSON')
      return
    }
    persistence.save(response.text)
    cached = config
    loaded = true
    debug(`remote config: ${config.playerClients?.map((p) => p.name).join(', ') || 'default'} player clients`)
  } catch (error) {
    debug(`remote config failed: ${describeError(error)}`)
  }
}
