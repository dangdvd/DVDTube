// Renders the confirm / prompt dialogs requested through `lib/dialogs`.

import { useState } from 'react'
import { useDialogs, type ConfirmOptions, type PromptOptions } from '@/lib/dialogs'
import { Modal } from './Modal'

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
