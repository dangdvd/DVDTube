// The signed-in YouTube account on the TV (a reduced port of the desktop `accounts.ts`).
//
// The TV interface owns persistence: it keeps the cookies (name → value, youtube.com only) and
// the chosen identity in its localStorage and hands them to the service at start
// (`setSession`). The service keeps them in memory only, signs requests with them (the core's
// SAPISIDHASH headers + Cookie header for youtube.com), absorbs cookie rotations from Set-Cookie
// and tells the UI to save the new values (`session` event → `exportSession`). Cookies are never
// logged, never sent anywhere but *.youtube.com, and never accepted from the LAN except through
// the user-confirmed encrypted QR pairing.

import type { AccountIdentity, AccountProfile, AccountState } from '../../../windows/src/shared/models'
import { hasAuthCookies, setSessionSource, type Identity } from '../../../windows/src/main/core/auth'
import { debug } from '../../../windows/src/main/core/config'
import { describeError } from '../../../windows/src/main/core/errors'
import { identityId } from '../../../windows/src/main/core/parsers/account'
import * as service from '../../../windows/src/main/core/services'
import type { EventBus } from './events'
import { CookieJar, VisitorJar, type CookieMap } from './fetcher'

export interface StoredSession {
  cookies: CookieMap
  identity: Identity
  profile?: AccountProfile | null
  identities?: AccountIdentity[] | null
}

function cleanIdentity(value: unknown): Identity {
  const v = (value ?? {}) as Record<string, unknown>
  const authUser = typeof v.authUser === 'number' && Number.isInteger(v.authUser) && v.authUser >= 0 && v.authUser < 100 ? v.authUser : 0
  const pageId = typeof v.pageId === 'string' && /^\d{1,40}$/.test(v.pageId) ? v.pageId : null
  return { authUser, pageId }
}

function cleanCookies(value: unknown): CookieMap {
  const out: CookieMap = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_.\-]{1,100}$/.test(name) || v.length > 8192 || /[;\r\n]/.test(v)) continue
    out[name] = v
  }
  return out
}

export class Session {
  readonly auth = new CookieJar()
  readonly anon = new VisitorJar()
  private identity: Identity = { authUser: 0, pageId: null }
  private profile: AccountProfile | null = null
  private identities: AccountIdentity[] = []
  private refreshing: Promise<void> | null = null
  private rotationTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped on every sign in / out (results of an older refresh are dropped). */
  private generation = 0

  constructor(private readonly events: EventBus) {
    setSessionSource({ cookies: async () => this.auth.snapshot(), identity: () => this.identity })
    this.auth.onChange = () => {
      if (this.rotationTimer) clearTimeout(this.rotationTimer)
      this.rotationTimer = setTimeout(() => {
        this.rotationTimer = null
        if (this.signedIn) this.events.emit('session', { changed: true })
      }, 3000)
    }
  }

  get signedIn(): boolean {
    return hasAuthCookies(this.auth.snapshot())
  }

  state(): AccountState {
    if (!this.signedIn) return { signedIn: false, profile: null, identities: [] }
    const list = this.identities.map((i) => ({
      ...i,
      id: identityId(i.authUser, i.pageId ?? null),
      isSelected: i.authUser === this.identity.authUser && (i.pageId ?? null) === this.identity.pageId,
    }))
    return { signedIn: true, profile: this.profile, identities: list }
  }

  private publish(): AccountState {
    const state = this.state()
    this.events.emit('account', state)
    return state
  }

  /** The UI hands over the stored session at start (or after the service restarted). */
  setSession(value: unknown): AccountState {
    const v = (value ?? {}) as Record<string, unknown>
    const cookies = cleanCookies(v.cookies)
    this.generation++
    if (!hasAuthCookies(cookies)) {
      this.auth.clear()
      this.profile = null
      this.identities = []
      return this.state()
    }
    this.auth.replace(cookies)
    this.identity = cleanIdentity(v.identity)
    const profile = v.profile as AccountProfile | null | undefined
    this.profile = profile && typeof profile.name === 'string' ? profile : null
    this.identities = Array.isArray(v.identities) ? (v.identities as AccountIdentity[]).filter((i) => i && typeof i.name === 'string') : []
    void this.refresh().catch(() => {})
    return this.state()
  }

  exportSession(): StoredSession | null {
    if (!this.signedIn) return null
    return { cookies: this.auth.snapshot(), identity: { ...this.identity }, profile: this.profile, identities: this.identities }
  }

  /** Reloads the profile and the identity list, then publishes the account state. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const generation = this.generation
    this.refreshing = (async () => {
      if (!this.signedIn) return
      try {
        const profile = await service.accountProfile()
        if (generation !== this.generation) return
        if (profile) this.profile = profile
        else debug('session: no profile in the account menu (session may have expired)')
      } catch (error) {
        debug(`session: profile refresh failed: ${describeError(error)}`)
      }
      try {
        const identities = await service.accountIdentities()
        if (generation !== this.generation) return
        if (identities.length > 0) this.identities = identities.map((i) => ({ ...i, id: identityId(i.authUser, i.pageId ?? null) }))
      } catch (error) {
        debug(`session: identities failed: ${describeError(error)}`)
      }
      if (generation === this.generation) this.publish()
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** "Đăng nhập bằng điện thoại": validates the phone's cookies with YouTube; returns the account name. */
  async completePairing(cookies: CookieMap): Promise<string> {
    const clean = cleanCookies(cookies)
    if (!hasAuthCookies(clean)) throw new Error('Không tìm thấy cookie đăng nhập YouTube (cần LOGIN_INFO và SAPISID).')
    const previous = { cookies: this.auth.snapshot(), identity: this.identity, profile: this.profile, identities: this.identities }
    this.generation++
    this.auth.replace(clean)
    this.identity = { authUser: 0, pageId: null }
    let profile: AccountProfile | null = null
    try {
      profile = await service.accountProfile()
    } catch (error) {
      debug(`session: validating the new session failed: ${describeError(error)}`)
    }
    if (!profile) {
      this.auth.replace(previous.cookies)
      this.identity = previous.identity
      this.profile = previous.profile
      this.identities = previous.identities
      throw new Error('YouTube không chấp nhận phiên đăng nhập này. Hãy thử đăng nhập lại.')
    }
    this.profile = profile
    this.identities = []
    debug('session: signed in from the phone')
    this.events.emit('session', { changed: true })
    this.publish()
    void this.refresh().catch(() => {})
    return profile.name
  }

  signOut(): AccountState {
    this.generation++
    this.auth.clear()
    this.anon.clear()
    this.identity = { authUser: 0, pageId: null }
    this.profile = null
    this.identities = []
    debug('session: signed out')
    return this.publish()
  }

  async switchIdentity(id: string): Promise<AccountState> {
    if (!this.signedIn) throw new Error('Bạn cần đăng nhập tài khoản YouTube để dùng tính năng này.')
    const [userText, pageId] = String(id).split('@')[0].split('|')
    const authUser = parseInt(userText, 10)
    if (!Number.isInteger(authUser) || authUser < 0) throw new Error('Tài khoản không hợp lệ.')
    this.identity = cleanIdentity({ authUser, pageId: pageId || null })
    const chosen = this.identities.find((i) => i.authUser === authUser && (i.pageId ?? null) === (pageId || null))
    if (chosen) {
      this.profile = { name: chosen.name, handle: chosen.byline ?? null, email: chosen.email ?? null, avatar: chosen.avatar ?? null, channelId: null }
    }
    this.generation++
    this.events.emit('session', { changed: true })
    this.publish()
    await this.refresh()
    return this.state()
  }
}
