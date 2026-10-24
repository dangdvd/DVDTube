import type { DvdBridge } from '../shared/api'

declare global {
  interface Window {
    /** Present inside the Electron app; absent in a plain browser (the UI then uses mock data). */
    dvd?: DvdBridge
  }
}

export {}
