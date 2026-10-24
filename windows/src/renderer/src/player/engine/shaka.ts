// shaka-player (UI-less ES2021 build), set up once for the whole app.

import shaka from 'shaka-player/dist/shaka-player.compiled-es2021.js'

let installed = false

export function setupShaka(): typeof shaka {
  if (!installed) {
    installed = true
    shaka.polyfill.installAll()
    // Downloads and the local dev test media are `file://` URLs; Electron's fetch reads them
    // (with Range support), shaka just has no plugin registered for the scheme.
    shaka.net.NetworkingEngine.registerScheme(
      'file',
      shaka.net.HttpFetchPlugin.parse,
      shaka.net.NetworkingEngine.PluginPriority.APPLICATION,
    )
  }
  return shaka
}

export function shakaSupported(): boolean {
  setupShaka()
  return shaka.Player.isBrowserSupported()
}

export { shaka }
