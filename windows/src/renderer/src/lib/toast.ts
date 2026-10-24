// Small notifications at the bottom-left (rendered by <Toaster/>). Usable from anywhere,
// including outside React: `toast('Đã lưu', { action: { label: 'Hoàn tác', run } })`.

import { create } from 'zustand'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastItem {
  id: number
  message: string
  action?: ToastAction
  durationMs: number
}

interface ToastStore {
  toasts: ToastItem[]
  dismiss(id: number): void
}

let nextId = 1
const MAX_VISIBLE = 3

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

export function toast(message: string, options?: { action?: ToastAction; durationMs?: number }): void {
  const item: ToastItem = {
    id: nextId++,
    message,
    action: options?.action,
    durationMs: options?.durationMs ?? (options?.action ? 6000 : 3500),
  }
  // A repeated message replaces the previous one instead of stacking.
  const rest = useToasts.getState().toasts.filter((t) => t.message !== message)
  useToasts.setState({ toasts: [...rest, item].slice(-MAX_VISIBLE) })
}
