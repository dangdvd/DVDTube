// Mock answers for the player-related API methods (player, watchInfo, comments, captions…)
// used when the UI runs without Electron. OWNED BY THE PLAYER MODULE (stub).
import type { DvdApi } from '@shared/api'

export const mockPlayerApi: Partial<DvdApi> = {}
