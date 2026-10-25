// Four boxes for a numeric PIN; calls `onComplete` once 4 digits are typed (keyboard or the
// on-screen pad).

import { useEffect, useRef, useState } from 'react'

export function PinInput({ onComplete, disabled, pad }: { onComplete: (pin: string) => void; disabled?: boolean; pad?: boolean }) {
  const [digits, setDigits] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const change = (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 4)
    setDigits(clean)
    if (clean.length === 4) onComplete(clean)
  }
  return (
    <div className="pin-input" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        className="pin-hidden"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Mã PIN"
        value={digits}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        data-testid="pin-input"
      />
      <div className="pin-boxes" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={'pin-box' + (i === digits.length ? ' is-current' : '') + (i < digits.length ? ' is-filled' : '')}>
            {i < digits.length ? '•' : ''}
          </span>
        ))}
      </div>
      {pad && (
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) =>
            key ? (
              <button
                key={i}
                type="button"
                className="pin-key"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  change(key === '⌫' ? digits.slice(0, -1) : digits + key)
                }}
              >
                {key}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      )}
    </div>
  )
}
