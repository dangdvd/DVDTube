// Public surface of the player module (OWNED BY THE PLAYER MODULE; stubs until implemented).
//  - PlayerHost: mounted once by the app layout; owns the single <video> element and keeps
//    it alive across navigation (shown inside the watch page or in the mini player).
//  - WatchPage: route /watch?v=ID[&list=…][&t=…]
//  - ShortsPage: routes /shorts and /shorts/:id
export { PlayerHost } from './PlayerHost'
export { WatchPage } from './WatchPage'
export { ShortsPage } from './ShortsPage'
