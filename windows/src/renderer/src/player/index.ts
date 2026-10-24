// Public surface of the player module (OWNED BY THE PLAYER MODULE).
//  - PlayerHost: mounted once by the app layout; owns the single <video> element and keeps
//    it alive across navigation (shown inside the watch page or in the mini player).
//  - WatchPage: route /watch?v=ID[&list=…][&index=N][&t=…]
//  - ShortsPage: routes /shorts and /shorts/:id
//  - EqualizerPanel: the 10-band equalizer (also embedded by the Settings page)
//  - SHORTCUTS: the player's keyboard shortcuts (for the Settings page table)
import { startPlayerController } from './controller'
import { startPlayerSession } from './session'

startPlayerController()
startPlayerSession()

export { PlayerHost } from './PlayerHost'
export { WatchPage } from './WatchPage'
export { ShortsPage } from './ShortsPage'
export { EqualizerPanel } from './EqualizerPanel'
export { SHORTCUTS } from './ui/shortcuts'
