// Signed-in Google accounts (port of `AccountStore.kt`, extended to several accounts).
//
// Each account is its own cookie set, saved encrypted with `safeStorage` in
// `userData/accounts.bin`. The active set lives in the `persist:yt` jar (the source of truth while
// it is active; its rotations are snapshotted back). Inside one cookie set, the identity
// (`authUser` + `pageId`) picks the Google account / brand channel requests run as.

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { safeStorage, session, type Cookie, type CookiesSetDetails } from 'electron'
import type { AccountIdentity, AccountProfile, AccountState } from '@shared/models'
import { hasAuthCookies, setSessionSource, type CookieMap, type Identity } from './core/auth'
import { describeError, Errors } from './core/errors'
import * as service from './core/services'
import { identityId } from './core/parsers/account'
import { emit } from './ipc'
import { log } from './log'
import { onYouTubeCookiesChanged, youtubeCookies, ytSession } from './net'
import { userDataFile, writeFileAtomic } from './store'

interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  expirationDate?: number
  sameSite?: CookiesSetDetails['sameSite']
}

interface StoredAccount {
  key: string
  cookies: StoredCookie[]
  identity: Identity
  profile: AccountProfile | null
  /** Last known identities of this cookie set (ids without the account suffix). */
  identities: AccountIdentity[]
}

interface AccountsData {
  version: 1
  active: string | null
  accounts: StoredAccount[]
}

const FILE_MAGIC_ENCRYPTED = Buffer.from('DVA1')
const FILE_MAGIC_PLAIN = Buffer.from('DVP1')

let data: AccountsData = { version: 1, active: null, accounts: [] }
let signedIn = false
let swapping = false
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let refreshing: Promise<void> | null = null

function file(): string {
  return userDataFile('accounts.bin')
}

function active(): StoredAccount | null {
  return data.accounts.find((a) => a.key === data.active) ?? null
}

// MARK: Persistence

async function load(): Promise<void> {
  try {
    const bytes = await readFile(file())
    const magic = bytes.subarray(0, 4)
    let text: string
    if (magic.equals(FILE_MAGIC_ENCRYPTED)) text = safeStorage.decryptString(bytes.subarray(4))
    else if (magic.equals(FILE_MAGIC_PLAIN)) text = bytes.subarray(4).toString('utf8')
    else return
    const parsed = JSON.parse(text) as AccountsData
    if (parsed && Array.isArray(parsed.accounts)) data = { version: 1, active: parsed.active ?? null, accounts: parsed.accounts }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`accounts: could not read the account file (${describeError(error)})`)
  }
}

async function save(): Promise<void> {
  const text = JSON.stringify(data)
  let bytes: Buffer
  if (safeStorage.isEncryptionAvailable()) {
    bytes = Buffer.concat([FILE_MAGIC_ENCRYPTED, safeStorage.encryptString(text)])
  } else {
    // No OS keyring (some Linux setups): the cookies are still in Chromium's own jar anyway.
    bytes = Buffer.concat([FILE_MAGIC_PLAIN, Buffer.from(text, 'utf8')])
  }
  try {
    await writeFileAtomic(file(), bytes)
  } catch (error) {
    log.warn(`accounts: could not save (${describeError(error)})`)
  }
}

// MARK: Cookie jar

function toStored(cookie: Cookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    hostOnly: cookie.hostOnly ?? false,
    expirationDate: cookie.expirationDate,
    sameSite: cookie.sameSite,
  }
}

async function snapshotJar(partition = ytSession()): Promise<StoredCookie[]> {
  return (await partition.cookies.get({})).map(toStored)
}

async function setCookie(target: Electron.Session, cookie: StoredCookie): Promise<void> {
  const host = cookie.domain.replace(/^\./, '')
  if (!host) return
  const details: CookiesSetDetails = {
    url: `https://${host}${cookie.path || '/'}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  }
  if (!cookie.hostOnly && !cookie.name.startsWith('__Host-')) details.domain = cookie.domain
  if (cookie.expirationDate) details.expirationDate = cookie.expirationDate
  if (cookie.sameSite) details.sameSite = cookie.sameSite
  try {
    await target.cookies.set(details)
  } catch {
    // A cookie Chromium refuses (e.g. expired) is simply skipped.
  }
}

async function clearJar(): Promise<void> {
  await ytSession().clearStorageData({ storages: ['cookies'] })
}

async function loadIntoJar(cookies: StoredCookie[]): Promise<void> {
  swapping = true
  try {
    await clearJar()
    for (const cookie of cookies) await setCookie(ytSession(), cookie)
    await ytSession().cookies.flushStore()
  } finally {
    swapping = false
  }
}

/** Cookies from the phone (name → value) as youtube.com cookies. */
function cookiesFromMap(map: CookieMap): StoredCookie[] {
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600
  return Object.entries(map).map(([name, value]) => ({
    name,
    value,
    domain: name.startsWith('__Host-') ? 'www.youtube.com' : '.youtube.com',
    path: '/',
    secure: true,
    httpOnly: false,
    hostOnly: name.startsWith('__Host-'),
    expirationDate: expires,
  }))
}

function scheduleSnapshot(): void {
  if (swapping || !data.active) return
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    void snapshotActive()
  }, 3000)
}

async function snapshotActive(): Promise<void> {
  const account = active()
  if (!account || swapping) return
  const cookies = await snapshotJar()
  const valid = hasAuthCookies(Object.fromEntries(cookies.filter((c) => c.domain.endsWith('youtube.com')).map((c) => [c.name, c.value])))
  if (!valid) {
    // Signed out elsewhere (e.g. in the Studio window): show it, keep the stored copy.
    if (signedIn) {
      signedIn = false
      log.info('accounts: the cookie jar lost its session')
      publish()
    }
    return
  }
  account.cookies = cookies
  if (!signedIn) {
    signedIn = true
    publish()
  }
  await save()
}

// MARK: State

export function currentIdentity(): Identity {
  return active()?.identity ?? { authUser: 0, pageId: null }
}

export function isSignedIn(): boolean {
  return signedIn
}

function identitiesOf(account: StoredAccount, isActive: boolean): AccountIdentity[] {
  const suffix = isActive ? '' : `@${account.key}`
  let list = account.identities
  if (list.length === 0 && account.profile) {
    list = [
      {
        id: identityId(account.identity.authUser, account.identity.pageId),
        authUser: account.identity.authUser,
        pageId: account.identity.pageId,
        name: account.profile.name,
        byline: account.profile.handle ?? null,
        email: account.profile.email ?? null,
        avatar: account.profile.avatar ?? null,
        isSelected: true,
        hasChannel: !!account.profile.channelId,
      },
    ]
  }
  return list.map((identity) => ({
    ...identity,
    id: identityId(identity.authUser, identity.pageId) + suffix,
    isSelected: isActive && identity.authUser === account.identity.authUser && (identity.pageId ?? null) === account.identity.pageId,
  }))
}

export function accountState(): AccountState {
  const current = active()
  if (!signedIn || !current) return { signedIn: false, profile: null, identities: [] }
  const identities = [
    ...identitiesOf(current, true),
    ...data.accounts.filter((a) => a !== current).flatMap((a) => identitiesOf(a, false)),
  ]
  return { signedIn: true, profile: current.profile, identities }
}

function publish(): AccountState {
  const state = accountState()
  emit('account', state)
  return state
}

// MARK: Startup and refresh

export async function initAccounts(): Promise<void> {
  setSessionSource({ cookies: youtubeCookies, identity: currentIdentity })
  await load()
  let jar = await youtubeCookies()
  const current = active()
  if (current && !hasAuthCookies(jar) && current.cookies.length > 0) {
    log.info('accounts: restoring the active session into the cookie jar')
    await loadIntoJar(current.cookies)
    jar = await youtubeCookies()
  } else if (!current && hasAuthCookies(jar)) {
    const account: StoredAccount = {
      key: randomBytes(6).toString('hex'),
      cookies: await snapshotJar(),
      identity: { authUser: 0, pageId: null },
      profile: null,
      identities: [],
    }
    data.accounts.push(account)
    data.active = account.key
    await save()
  }
  signedIn = hasAuthCookies(jar) && !!active()
  onYouTubeCookiesChanged(scheduleSnapshot)
  log.info(`accounts: ${data.accounts.length} stored, signed in: ${signedIn}`)
  if (signedIn) void refreshAccount().catch(() => {})
}

/** Refreshes the profile and the identity list of the active account, then publishes it. */
export function refreshAccount(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const account = active()
    if (!account || !signedIn) return
    try {
      const profile = await service.accountProfile()
      if (profile) account.profile = profile
      else log.warn('accounts: no profile in the account menu (session may have expired)')
    } catch (error) {
      log.warn(`accounts: profile refresh failed: ${describeError(error)}`)
    }
    try {
      const identities = await service.accountIdentities()
      if (identities.length > 0) account.identities = identities.map((i) => ({ ...i, id: identityId(i.authUser, i.pageId) }))
    } catch (error) {
      log.warn(`accounts: identities failed: ${describeError(error)}`)
    }
    await save()
    publish()
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

// MARK: Sign in / out

function sameAccount(a: AccountProfile | null, b: AccountProfile | null): boolean {
  if (!a || !b) return false
  if (a.channelId && b.channelId) return a.channelId === b.channelId
  if (a.email && b.email) return a.email === b.email
  return a.name === b.name && (a.handle ?? null) === (b.handle ?? null)
}

/**
 * Makes `cookies` the active session and validates it with YouTube. On failure the previous
 * session is restored and a Vietnamese message thrown.
 */
async function adopt(cookies: StoredCookie[] | null): Promise<AccountState> {
  const previous = active()
  // With `cookies` the jar still holds the previous session: keep its newest values. Without,
  // the sign-in window already replaced it and the stored copy is the one to fall back to.
  if (previous && cookies && signedIn) previous.cookies = await snapshotJar()
  const previousCookies = previous?.cookies ?? []
  if (cookies) await loadIntoJar(cookies)
  const jar = await youtubeCookies()
  if (!hasAuthCookies(jar)) {
    await rollback(previousCookies)
    throw new Error('Không tìm thấy cookie đăng nhập YouTube (cần SAPISID). Hãy thử đăng nhập lại.')
  }
  const previousActive = data.active
  // Validate as authuser 0 of the new cookie set.
  const candidate: StoredAccount = { key: randomBytes(6).toString('hex'), cookies: [], identity: { authUser: 0, pageId: null }, profile: null, identities: [] }
  data.accounts.push(candidate)
  data.active = candidate.key
  signedIn = true
  let profile: AccountProfile | null = null
  try {
    profile = await service.accountProfile()
  } catch (error) {
    log.warn(`accounts: validating the new session failed: ${describeError(error)}`)
  }
  if (!profile) {
    data.accounts = data.accounts.filter((a) => a !== candidate)
    data.active = previousActive
    await rollback(previousCookies)
    throw new Error('YouTube không chấp nhận phiên đăng nhập này. Hãy thử đăng nhập lại.')
  }
  candidate.profile = profile
  candidate.cookies = await snapshotJar()
  // Signing in again with an account that is already stored replaces it.
  data.accounts = data.accounts.filter((a) => a === candidate || !sameAccount(a.profile, profile))
  await save()
  log.info(`accounts: signed in (${data.accounts.length} stored)`)
  const state = publish()
  void refreshAccount().catch(() => {})
  return state
}

async function rollback(previousCookies: StoredCookie[]): Promise<void> {
  if (previousCookies.length > 0) await loadIntoJar(previousCookies)
  else await clearJar()
  signedIn = hasAuthCookies(await youtubeCookies()) && !!active()
}

/** The sign-in window finished in the `persist:yt` partition itself. */
export async function completeWindowSignIn(): Promise<AccountState> {
  const jar = await youtubeCookies()
  if (!hasAuthCookies(jar)) return accountState()
  const current = active()
  if (current) {
    // The active cookie set signed in again (e.g. after it expired). Like Android, a fresh
    // sign-in runs as authuser 0 again; the profile and identities are reloaded.
    current.cookies = await snapshotJar()
    current.identity = { authUser: 0, pageId: null }
    current.identities = []
    signedIn = true
    await save()
    await refreshAccount()
    const profile = current.profile
    data.accounts = data.accounts.filter((a) => a === current || !sameAccount(a.profile, profile))
    await save()
    return publish()
  }
  return adopt(null)
}

/** "Add account": the sign-in ran in a temporary partition; its cookies become a new account. */
export async function completeAddAccount(partition: string): Promise<AccountState> {
  const cookies = await snapshotJar(session.fromPartition(partition))
  return adopt(cookies)
}

/** Sign in from the phone: name → value cookies. Returns the account name. */
export async function completePairing(cookies: CookieMap): Promise<string> {
  if (!hasAuthCookies(cookies)) throw new Error('Không tìm thấy cookie đăng nhập YouTube (cần LOGIN_INFO và SAPISID).')
  const state = await adopt(cookiesFromMap(cookies))
  return state.profile?.name ?? ''
}

export async function signOut(): Promise<AccountState> {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  data = { version: 1, active: null, accounts: [] }
  signedIn = false
  swapping = true
  try {
    await clearJar()
    await ytSession().clearStorageData({ storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }).catch(() => {})
  } finally {
    swapping = false
  }
  await save()
  log.info('accounts: signed out')
  return publish()
}

/** Runs every following request as another Google account / brand channel (or stored account). */
export async function switchIdentity(id: string): Promise<AccountState> {
  if (typeof id !== 'string') throw Errors.signedOut()
  const [identityPart, accountKey] = id.split('@')
  const [userText, pageId] = identityPart.split('|')
  const authUser = parseInt(userText, 10)
  if (!Number.isInteger(authUser) || authUser < 0) throw new Error('Tài khoản không hợp lệ.')
  if (accountKey && accountKey !== data.active) {
    const target = data.accounts.find((a) => a.key === accountKey)
    if (!target) throw new Error('Tài khoản không còn được lưu. Hãy đăng nhập lại.')
    const current = active()
    if (current) current.cookies = await snapshotJar()
    await loadIntoJar(target.cookies)
    data.active = target.key
    signedIn = hasAuthCookies(await youtubeCookies())
    if (!signedIn) {
      if (current) {
        await loadIntoJar(current.cookies)
        data.active = current.key
        signedIn = true
      }
      throw new Error('Phiên đăng nhập của tài khoản này đã hết hạn. Hãy đăng nhập lại.')
    }
  }
  const account = active()
  if (!account) throw Errors.signedOut()
  account.identity = { authUser, pageId: pageId || null }
  const chosen = account.identities.find((i) => i.authUser === authUser && (i.pageId ?? null) === (pageId || null))
  if (chosen) {
    account.profile = {
      name: chosen.name,
      handle: chosen.byline ?? null,
      email: chosen.email ?? null,
      avatar: chosen.avatar ?? null,
      channelId: null,
    }
  }
  await save()
  log.info('accounts: switched identity')
  publish()
  await refreshAccount()
  return accountState()
}

/** Called before quitting: keep the newest cookie values of the active account. */
export async function flushAccounts(): Promise<void> {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
    await snapshotActive().catch(() => {})
  }
}
