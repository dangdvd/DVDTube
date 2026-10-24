// The one <video> element of the main player, wrapped in a "stage" (video + controls overlay)
// that is moved with appendChild between the watch page's slot and the mini player. Moving a
// node between two places of the document does not interrupt playback; taking it out of the
// document would pause it, so when no slot shows it, it waits in a hidden parking element.

export interface Stage {
  root: HTMLDivElement
  video: HTMLVideoElement
  /** React renders the controls into this element through a portal. */
  overlay: HTMLDivElement
  parking: HTMLDivElement
}

let stage: Stage | null = null

export function getStage(): Stage {
  if (stage) return stage
  const parking = document.createElement('div')
  parking.className = 'dp-parking'
  parking.setAttribute('aria-hidden', 'true')
  const root = document.createElement('div')
  root.className = 'dp-stage'
  root.dataset.testid = 'player'
  const video = document.createElement('video')
  video.className = 'dp-video'
  // CORS mode so Web Audio (equalizer) and canvas sampling (ambient mode) get real data.
  video.crossOrigin = 'anonymous'
  video.playsInline = true
  video.preload = 'auto'
  video.dataset.testid = 'player-video'
  const overlay = document.createElement('div')
  overlay.className = 'dp-stage-overlay'
  root.append(video, overlay)
  parking.append(root)
  document.body.append(parking)
  stage = { root, video, overlay, parking }
  return stage
}

// Slots that want to show the stage, newest last (e.g. the watch page, then the always-on-top
// mini window on top of it). The newest one shows it; when it goes away the previous one
// gets it back.
const slots: HTMLElement[] = []

function place(): void {
  const { root, parking } = getStage()
  const target = slots[slots.length - 1] ?? parking
  if (root.parentElement !== target) target.append(root)
}

/** Shows the stage inside `slot`. */
export function attachStage(slot: HTMLElement): void {
  const index = slots.indexOf(slot)
  if (index >= 0) slots.splice(index, 1)
  slots.push(slot)
  place()
}

/** `slot` no longer shows the stage (it moves to the previous slot or the parking element). */
export function releaseStage(slot: HTMLElement): void {
  const index = slots.indexOf(slot)
  if (index >= 0) slots.splice(index, 1)
  place()
}
