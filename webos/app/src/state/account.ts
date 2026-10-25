// The signed-in YouTube account. The TV keeps the session (youtube.com cookies + the chosen
// account / channel) in its own localStorage (`dvd.session`) and hands it to the service at
// start; the service tells us when YouTube rotated a cookie (`session` event) and we save the new
// values. Nothing here is ever logged or sent anywhere but to the local service.

import type { AccountState, ChannelItem } from '@shared/models'
import { api, onEvent, type StoredSession } from '../api'
import { createStore, loadJson, saveJson } from '../store'

interface AccountStoreState {
  state: AccountState
  channels: ChannelItem[]
  error: string | null
}

const stored = loadJson<StoredSession>('session')

export const accountStore = createStore<AccountStoreState>({
  state: stored?.profile ? { signedIn: true, profile: stored.profile, identities: stored.identities ?? [] } : { signedIn: false, profile: null, identities: [] },
  channels: [],
  error: null,
})

export function isSignedIn(): boolean {
  return accountStore.get().state.signedIn
}

async function persistSession(): Promise<void> {
  try {
    const session = await api.exportSession()
    if (session && Object.keys(session.cookies ?? {}).length > 0) saveJson('session', session)
    else saveJson('session', null)
  } catch {
    // keep what we have
  }
}

function setState(state: AccountState): void {
  const before = accountStore.get().state
  accountStore.set({ state, error: null })
  if (state.signedIn && (before.profile?.name !== state.profile?.name || !accountStore.get().channels.length)) void loadChannels()
  if (!state.signedIn) accountStore.set({ channels: [] })
  // Keep the profile with the stored session for an instant start next time.
  const session = loadJson<StoredSession>('session')
  if (session && state.signedIn) saveJson('session', { ...session, profile: state.profile, identities: state.identities })
}

export async function loadChannels(): Promise<void> {
  if (!isSignedIn()) return
  try {
    accountStore.set({ channels: await api.accountSubscriptions() })
  } catch {
    // the local subscriptions still work
  }
}

/** At start (and after the service restarted): hand the stored session to the service. */
export async function restoreSession(): Promise<void> {
  const session = loadJson<StoredSession>('session')
  try {
    const state = await api.setSession(session)
    setState(state.signedIn ? { ...state, profile: state.profile ?? session?.profile ?? null } : state)
  } catch (error) {
    accountStore.set({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function signOut(): Promise<void> {
  saveJson('session', null)
  try {
    setState(await api.signOut())
  } catch {
    setState({ signedIn: false, profile: null, identities: [] })
  }
}

export async function switchIdentity(id: string): Promise<void> {
  try {
    setState(await api.switchIdentity(id))
    await persistSession()
  } catch (error) {
    accountStore.set({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function refreshAccount(): Promise<void> {
  try {
    setState(await api.refreshAccount())
  } catch (error) {
    accountStore.set({ error: error instanceof Error ? error.message : String(error) })
  }
}

let wired = false

export function initAccount(): void {
  if (wired) return
  wired = true
  onEvent('account', (state) => setState(state))
  onEvent('session', (payload) => {
    if (payload.changed) void persistSession()
    else void restoreSession()
  })
}
