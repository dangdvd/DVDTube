// Web Audio processing for a media element: 10-band equalizer and "stable volume".
//
//   MediaElementSource → preamp → 10 × BiquadFilter → loudness gain → limiter → speakers
//
// The graph is only created once the equalizer or stable volume is first needed (a media
// element can be routed through Web Audio only once and never back), and while neither is on
// the source is wired straight to the speakers so the sound stays untouched.

import { EQ_BANDS, type EqualizerSettings } from '@shared/settings'

interface Graph {
  source: MediaElementAudioSourceNode
  preamp: GainNode
  bands: BiquadFilterNode[]
  loudness: GainNode
  limiter: DynamicsCompressorNode
  wiring: 'direct' | 'processed' | null
}

export interface AudioProcessing {
  equalizer: EqualizerSettings
  stableVolume: boolean
  /** YouTube's loudness of the current video in dB relative to its reference level. */
  loudnessDb: number | null
}

let context: AudioContext | null = null
const graphs = new WeakMap<HTMLMediaElement, Graph>()

function audioContext(): AudioContext {
  if (!context) context = new AudioContext()
  return context
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Gain for "stable volume": loud videos are turned down, quiet ones up a little. */
export function loudnessGain(loudnessDb: number | null, enabled: boolean): number {
  if (!enabled || loudnessDb == null || !Number.isFinite(loudnessDb)) return 1
  return Math.min(2, Math.max(0.3, dbToGain(-loudnessDb)))
}

/** Boosting bands would clip: take half of the largest boost off the input. */
export function autoHeadroom(gains: number[]): number {
  return -0.5 * Math.max(0, ...gains)
}

function createGraph(element: HTMLMediaElement): Graph {
  const ctx = audioContext()
  const source = ctx.createMediaElementSource(element)
  const preamp = ctx.createGain()
  const bands = EQ_BANDS.map((frequency, index) => {
    const filter = ctx.createBiquadFilter()
    filter.type = index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking'
    filter.frequency.value = frequency
    filter.Q.value = 1.1
    filter.gain.value = 0
    return filter
  })
  const loudness = ctx.createGain()
  // A safety net against clipping when bands or the loudness gain push the level up.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.25
  let node: AudioNode = preamp
  for (const band of bands) {
    node.connect(band)
    node = band
  }
  node.connect(loudness)
  loudness.connect(limiter)
  limiter.connect(ctx.destination)
  return { source, preamp, bands, loudness, limiter, wiring: null }
}

function wire(graph: Graph, processed: boolean): void {
  const want = processed ? 'processed' : 'direct'
  if (graph.wiring === want) return
  graph.source.disconnect()
  graph.source.connect(processed ? graph.preamp : audioContext().destination)
  graph.wiring = want
}

function ramp(param: AudioParam, value: number): void {
  const ctx = audioContext()
  param.cancelScheduledValues(ctx.currentTime)
  param.setTargetAtTime(value, ctx.currentTime, 0.04)
}

/** Applies the settings to the element's audio (creating the graph when first needed). */
export function applyAudioProcessing(element: HTMLMediaElement, processing: AudioProcessing): void {
  const { equalizer, stableVolume, loudnessDb } = processing
  const eqOn = equalizer.enabled
  const gain = loudnessGain(loudnessDb, stableVolume)
  let graph = graphs.get(element)
  if (!graph) {
    if (!eqOn && gain === 1) return
    try {
      graph = createGraph(element)
    } catch (error) {
      console.warn('audio graph unavailable', error)
      return
    }
    graphs.set(element, graph)
  }
  const gains = EQ_BANDS.map((_, i) => (eqOn ? (equalizer.gains[i] ?? 0) : 0))
  ramp(graph.preamp.gain, eqOn ? dbToGain(equalizer.preamp + autoHeadroom(gains)) : 1)
  graph.bands.forEach((band, i) => ramp(band.gain, gains[i]))
  ramp(graph.loudness.gain, gain)
  wire(graph, eqOn || gain !== 1)
  resumeAudio()
}

/** Audio contexts start suspended when created before any user gesture. */
export function resumeAudio(): void {
  if (context && context.state === 'suspended') void context.resume().catch(() => {})
}

export function isProcessing(element: HTMLMediaElement): boolean {
  return graphs.get(element)?.wiring === 'processed'
}
