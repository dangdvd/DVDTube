// Renders the confirm / prompt dialogs requested through `lib/dialogs`.

import { useState } from 'react'
import { useDialogs, type ConfirmOptions, type PinOptions, type PromptOptions } from '@/lib/dialogs'
import { Modal } from './Modal'
import { PinInput } from './PinInput'

export function ConfirmDialog({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(false)}
      hideClose
      width={400}
      testId="confirm-dialog"
      actions={
        <>
          <button className="btn btn-text" onClick={() => onDone(false)}>
            {options.cancelLabel ?? 'Hủy'}
          </button>
          <button className={'btn ' + (options.danger ? 'btn-danger' : 'btn-accent')} onClick={() => onDone(true)} autoFocus>
            {options.confirmLabel ?? 'Đồng ý'}
          </button>
        </>
      }
    >
      {options.message && <p className="modal-text">{options.message}</p>}
    </Modal>
  )
}

function PromptDialog({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(options.initial ?? '')
  const valid = options.allowEmpty || !!value.trim()
  const submit = () => valid && onDone(value.trim())
  return (
    <Modal
      title={options.title}
      onClose={() => onDone(null)}
      hideClose
      width={420}
      actions={
        <>
          <button className="btn btn-text" onClick={() => onDone(null)}>
            Hủy
          </button>
          <button className="btn btn-accent" disabled={!valid} onClick={submit}>
            {options.confirmLabel ?? 'Lưu'}
          </button>
        </>
      }
    >
      {options.message && <p className="modal-text">{options.message}</p>}
      <input
        className="text-input"
        autoFocus
        value={value}
        maxLength={options.maxLength ?? 150}
        placeholder={options.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </Modal>
  )
}

function PinDialog({ options, onDone }: { options: PinOptions; onDone: (pin: string | null) => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const submit = async (pin: string) => {
    if (options.create) {
      if (first === null) {
        setFirst(pin)
        setError(null)
        setResetKey((k) => k + 1)
        return
      }
      if (pin !== first) {
        setFirst(null)
        setError('Hai lần nhập không khớp. Hãy nhập lại.')
        setResetKey((k) => k + 1)
        return
      }
      onDone(pin)
      return
    }
    if (options.verify) {
      setBusy(true)
      const ok = await options.verify(pin).catch(() => false)
      setBusy(false)
      if (!ok) {
        setError('Mã PIN không đúng.')
        setResetKey((k) => k + 1)
        return
      }
    }
    onDone(pin)
  }
  return (
    <Modal title={options.title} onClose={() => onDone(null)} width={380} testId="pin-dialog">
      {options.message && <p className="modal-text">{options.message}</p>}
      <p className="pin-step">{options.create ? (first === null ? 'Nhập mã PIN gồm 4 chữ số' : 'Nhập lại mã PIN để xác nhận') : 'Nhập mã PIN'}</p>
      <PinInput key={resetKey} onComplete={(pin) => void submit(pin)} disabled={busy} />
      {error && <p className="pin-error">{error}</p>}
      {options.forgot && (
        <button
          className="btn btn-text btn-small pin-forgot"
          onClick={() => {
            onDone(null)
            options.forgot?.()
          }}
        >
          Quên mã PIN
        </button>
      )}
    </Modal>
  )
}

export function DialogHost() {
  const queue = useDialogs((s) => s.queue)
  const finish = useDialogs((s) => s.finish)
  const current = queue[0]
  if (!current) return null
  if (current.kind === 'confirm') {
    return (
      <ConfirmDialog
        key={current.id}
        options={current.options}
        onDone={(ok) => {
          finish(current.id)
          current.resolve(ok)
        }}
      />
    )
  }
  if (current.kind === 'pin') {
    return (
      <PinDialog
        key={current.id}
        options={current.options}
        onDone={(pin) => {
          finish(current.id)
          current.resolve(pin)
        }}
      />
    )
  }
  return (
    <PromptDialog
      key={current.id}
      options={current.options}
      onDone={(value) => {
        finish(current.id)
        current.resolve(value)
      }}
    />
  )
}
