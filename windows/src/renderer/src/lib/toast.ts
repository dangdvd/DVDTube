// Small notifications at the bottom-left. OWNED BY THE UI PAGES MODULE (stub); everyone uses it.
export interface ToastAction {
  label: string
  run: () => void
}

export function toast(message: string, options?: { action?: ToastAction; durationMs?: number }): void {
  console.info('[toast]', message, options?.action?.label ?? '')
}
