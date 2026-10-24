// Short-lived visual feedback on the video (center play/pause bubble, "+10 giây", volume %),
// triggered by clicks and keyboard shortcuts.

import { create } from 'zustand'
import type { PlayerIconName } from './icons'

export interface Feedback {
  id: number
  icon?: PlayerIconName
  text?: string
  /** Where it appears: the center bubble, the left / right seek hints or the top pill. */
  place: 'center' | 'left' | 'right' | 'top'
}

interface FeedbackStore {
  feedback: Feedback | null
}

export const useFeedback = create<FeedbackStore>(() => ({ feedback: null }))

let nextId = 1
let timer: ReturnType<typeof setTimeout> | null = null

export function showFeedback(feedback: Omit<Feedback, 'id'>, durationMs = 650): void {
  if (timer) clearTimeout(timer)
  useFeedback.setState({ feedback: { ...feedback, id: nextId++ } })
  timer = setTimeout(() => useFeedback.setState({ feedback: null }), durationMs)
}
