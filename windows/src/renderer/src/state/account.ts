// Signed-in Google account (or none). Kept in sync with the main process.

import { create } from 'zustand'
import type { AccountState } from '@shared/models'
import { api, onEvent } from '@/lib/api'

interface AccountStore extends AccountState {
  loaded: boolean
  refresh(): Promise<void>
}

export const useAccount = create<AccountStore>((set) => ({
  signedIn: false,
  profile: null,
  identities: [],
  loaded: false,
  async refresh() {
    try {
      const state = await api.account()
      set({ ...state, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
}))

export function startAccountSync(): void {
  onEvent('account', (state) => useAccount.setState({ ...state, loaded: true }))
  void useAccount.getState().refresh()
}
