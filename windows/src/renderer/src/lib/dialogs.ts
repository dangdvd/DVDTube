// Promise-based confirm / prompt dialogs, rendered by <DialogHost/> (mounted once in App).
//   if (await confirmDialog({ title: 'Xóa?', confirmLabel: 'Xóa', danger: true })) …
//   const name = await promptDialog({ title: 'Đổi tên', initial: playlist.name })

import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  maxLength?: number
  /** An empty answer is valid (e.g. "leave empty for the default"). */
  allowEmpty?: boolean
}

export interface PinOptions {
  title: string
  message?: string
  /** New PIN: asks twice. */
  create?: boolean
  /** Checks an entered PIN; the dialog stays open on false ("Mã PIN không đúng"). */
  verify?: (pin: string) => Promise<boolean>
  /** Extra link at the bottom (e.g. "Quên mã PIN"). */
  forgot?: () => void
}

export type DialogRequest =
  | { kind: 'confirm'; id: number; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; id: number; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'pin'; id: number; options: PinOptions; resolve: (pin: string | null) => void }

interface DialogStore {
  queue: DialogRequest[]
  finish(id: number): void
}

let nextId = 1

export const useDialogs = create<DialogStore>((set, get) => ({
  queue: [],
  finish(id) {
    set({ queue: get().queue.filter((d) => d.id !== id) })
  },
}))

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const request: DialogRequest = { kind: 'confirm', id: nextId++, options, resolve }
    useDialogs.setState({ queue: [...useDialogs.getState().queue, request] })
  })
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const request: DialogRequest = { kind: 'prompt', id: nextId++, options, resolve }
    useDialogs.setState({ queue: [...useDialogs.getState().queue, request] })
  })
}

/** 4-digit PIN entry (parental controls); null when cancelled. */
export function pinDialog(options: PinOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const request: DialogRequest = { kind: 'pin', id: nextId++, options, resolve }
    useDialogs.setState({ queue: [...useDialogs.getState().queue, request] })
  })
}
