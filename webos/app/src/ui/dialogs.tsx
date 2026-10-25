// Dialogs (option lists, confirmations, the PIN pad) as modal focus scopes. Each returns a
// promise; Back closes the top dialog. The focus goes back to where it was.

import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { focusElement, focusFirst, isFocusable } from '../focus'
import { useKeys } from '../keys'
import { KEY, isBackKey } from '../platform'
import { createStore, useStore } from '../store'
import { Button, OptionRow } from './base'

export interface DialogOption {
  label: string
  subtitle?: string | null
  value?: string | null
  selected?: boolean
  icon?: string
  danger?: boolean
}

interface DialogEntry {
  id: number
  render: (close: (result: unknown) => void) => ComponentChildren
  resolve: (result: unknown) => void
  previous: HTMLElement | null
  width?: number
}

const dialogStore = createStore<{ dialogs: DialogEntry[] }>({ dialogs: [] })
let ids = 0

export function hasDialog(): boolean {
  return dialogStore.get().dialogs.length > 0
}

export function openDialog<T>(render: (close: (result: T | null) => void) => ComponentChildren, width?: number): Promise<T | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null
    const entry: DialogEntry = { id: ++ids, render: render as DialogEntry['render'], resolve: resolve as (r: unknown) => void, previous, width }
    dialogStore.set({ dialogs: [...dialogStore.get().dialogs, entry] })
  })
}

function closeDialog(id: number, result: unknown): void {
  const entry = dialogStore.get().dialogs.find((d) => d.id === id)
  if (!entry) return
  dialogStore.set({ dialogs: dialogStore.get().dialogs.filter((d) => d.id !== id) })
  entry.resolve(result)
  setTimeout(() => {
    if (isFocusable(entry.previous)) focusElement(entry.previous)
    else focusFirst()
  }, 0)
}

export function closeAllDialogs(): void {
  for (const d of dialogStore.get().dialogs.slice().reverse()) closeDialog(d.id, null)
}

function DialogFrame({ entry, top }: { entry: DialogEntry; top: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!top) return
    const timer = setTimeout(() => {
      if (ref.current && !ref.current.contains(document.activeElement)) focusFirst(ref.current)
    }, 30)
    return () => clearTimeout(timer)
  }, [top])
  return (
    <div class="dialog-backdrop" data-scope={top ? '' : undefined} data-inert={top ? undefined : ''}>
      <div class="dialog" ref={ref} style={entry.width ? { width: `${entry.width}px` } : undefined} data-scroll="y" data-scroll-tight>
        {entry.render((result) => closeDialog(entry.id, result))}
      </div>
    </div>
  )
}

export function DialogHost() {
  const dialogs = useStore(dialogStore, (s) => s.dialogs)
  useKeys((event) => {
    const top = dialogStore.get().dialogs[dialogStore.get().dialogs.length - 1]
    if (!top) return false
    if (isBackKey(event)) {
      closeDialog(top.id, null)
      return true
    }
    return false
  }, dialogs.length > 0, 100)
  return (
    <>
      {dialogs.map((entry, i) => (
        <DialogFrame key={entry.id} entry={entry} top={i === dialogs.length - 1} />
      ))}
    </>
  )
}

// MARK: Ready-made dialogs

/** A list of choices; resolves with the chosen index (null = closed). */
export function choose(title: string, options: DialogOption[], width?: number, message?: string): Promise<number | null> {
  return openDialog<number>(
    (close) => (
      <div class="dialog-body" data-testid="dialog">
        <div class="dialog-title">{title}</div>
        {message && <div class="dialog-message">{message}</div>}
        <div class="dialog-options">
          {options.map((o, i) => (
            <OptionRow
              key={i}
              title={o.label}
              subtitle={o.subtitle}
              value={o.value}
              selected={o.selected}
              icon={o.icon}
              danger={o.danger}
              autofocus={o.selected || (i === 0 && !options.some((x) => x.selected))}
              focusKey={`dlg-${i}`}
              onClick={() => close(i)}
            />
          ))}
        </div>
      </div>
    ),
    width,
  )
}

export function confirm(title: string, options: { message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return openDialog<boolean>((close) => (
    <div class="dialog-body" data-testid="confirm-dialog">
      <div class="dialog-title">{title}</div>
      {options.message && <div class="dialog-message">{options.message}</div>}
      <div class="dialog-buttons">
        <Button label={options.confirmLabel ?? 'Đồng ý'} accent={!options.danger} onClick={() => close(true)} autofocus testid="confirm-yes" />
        <Button label={options.cancelLabel ?? 'Hủy'} onClick={() => close(false)} testid="confirm-no" />
      </div>
    </div>
  )).then((v) => v === true)
}

export function alertDialog(title: string, message?: string, children?: ComponentChildren, width?: number): Promise<void> {
  return openDialog<boolean>(
    (close) => (
      <div class="dialog-body">
        <div class="dialog-title">{title}</div>
        {message && <div class="dialog-message pre">{message}</div>}
        {children}
        <div class="dialog-buttons">
          <Button label="Đóng" onClick={() => close(true)} autofocus />
        </div>
      </div>
    ),
    width,
  ).then(() => undefined)
}

// MARK: PIN pad

export function PinPad(props: { onDone: (pin: string) => void; error?: string | null; title: string; message?: string | null; onForgot?: () => void }) {
  // The digits live in a ref too: two key presses before the next render must both count.
  const [pin, setPinState] = useState('')
  const pinRef = useRef('')
  const setPin = (value: string) => {
    pinRef.current = value
    setPinState(value)
  }
  const press = (digit: string) => {
    const next = pinRef.current + digit
    if (next.length > 4) return
    if (next.length < 4) {
      setPin(next)
      return
    }
    // Complete: hand it over right away, so a digit typed next already goes to the next step.
    setPin('')
    props.onDone(next)
  }
  useKeys((event) => {
    if (event.keyCode >= 48 && event.keyCode <= 57) {
      press(String(event.keyCode - 48))
      return true
    }
    if (event.keyCode >= 96 && event.keyCode <= 105) {
      press(String(event.keyCode - 96))
      return true
    }
    return false
  }, true, 110)
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']
  return (
    <div class="dialog-body pin" data-testid="pin-dialog">
      <div class="dialog-title">{props.title}</div>
      {props.message && <div class="dialog-message">{props.message}</div>}
      <div class="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} class={`pin-dot${i < pin.length ? ' filled' : ''}`} />
        ))}
      </div>
      <div class="pin-error">{props.error ?? ''}</div>
      <div class="pin-grid">
        {keys.map((k) => (
          <button
            type="button"
            key={k}
            class="pin-key"
            data-f
            tabIndex={-1}
            data-key={`pin-${k}`}
            data-autofocus={k === '1' ? '' : undefined}
            onClick={() => {
              if (k === '⌫') setPin(pinRef.current.slice(0, -1))
              else if (k !== 'OK') press(k)
            }}
          >
            {k}
          </button>
        ))}
      </div>
      {props.onForgot && (
        <div class="dialog-buttons">
          <Button label="Quên mã PIN" small onClick={props.onForgot} />
        </div>
      )}
    </div>
  )
}

/** Asks for the PIN; resolves true when `verify` accepts it. */
export function pinPrompt(title: string, verify: (pin: string) => boolean, options: { message?: string; onForgot?: () => void } = {}): Promise<boolean> {
  return openDialog<boolean>((close) => <PinPrompt title={title} message={options.message} verify={verify} onForgot={options.onForgot} close={close} />, 640).then(
    (v) => v === true,
  )
}

function PinPrompt(props: { title: string; message?: string; verify: (pin: string) => boolean; onForgot?: () => void; close: (v: boolean | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <PinPad
      title={props.title}
      message={props.message}
      error={error}
      onDone={(pin) => {
        if (props.verify(pin)) props.close(true)
        else setError('Sai mã PIN')
      }}
      onForgot={
        props.onForgot
          ? () => {
              props.close(false)
              props.onForgot?.()
            }
          : undefined
      }
    />
  )
}

/** Two entries of a new PIN; resolves with it (null = cancelled). */
export function newPinDialog(): Promise<string | null> {
  return openDialog<string>((close) => <NewPin close={close} />, 640)
}

function NewPin({ close }: { close: (pin: string | null) => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <PinPad
      title={first ? 'Nhập lại mã PIN' : 'Đặt mã PIN mới'}
      message={first ? null : 'Mã PIN gồm 4 chữ số. Nếu quên, chỉ có thể đặt lại toàn bộ kiểm soát của phụ huynh.'}
      error={error}
      onDone={(pin) => {
        if (!first) {
          setFirst(pin)
          setError(null)
        } else if (pin === first) close(pin)
        else {
          setFirst(null)
          setError('Hai mã PIN không khớp')
        }
      }}
    />
  )
}

export { KEY }
