// Full-screen lock of the parental controls: "Đã hết thời gian xem hôm nay" (daily limit) or
// outside "Khung giờ được xem". The PIN unlocks +15 min, +30 min or the rest of the day.

import { useEffect, useState } from 'react'
import { forgotParentalPin } from '@/lib/parental'
import { useParental } from '@/state/parental'
import { Icon } from './Icon'
import { PinInput } from './PinInput'

export function ParentalLock() {
  const lock = useParental((s) => s.lock)
  const config = useParental((s) => s.config)
  const [step, setStep] = useState<'locked' | 'pin' | 'choose'>('locked')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!lock) setStep('locked')
  }, [lock])
  if (!lock) return null
  const title = lock === 'limit' ? 'Đã hết thời gian xem hôm nay' : 'Ngoài khung giờ được xem'
  const detail =
    lock === 'limit'
      ? `Giới hạn mỗi ngày là ${config.dailyLimitMinutes >= 60 && config.dailyLimitMinutes % 60 === 0 ? `${config.dailyLimitMinutes / 60} giờ` : `${config.dailyLimitMinutes} phút`}. Hẹn gặp lại vào ngày mai!`
      : `DVDTube chỉ được xem từ ${config.windowFrom} đến ${config.windowTo}.`
  const grant = (choice: 15 | 30 | 'day') => {
    useParental.getState().grant(choice)
    setStep('locked')
  }
  return (
    <div className="parental-lock" data-testid="parental-lock" role="dialog" aria-modal="true">
      <div className="parental-lock-card">
        <span className="parental-lock-icon">
          <Icon name={lock === 'limit' ? 'watchLater' : 'alarm'} size={44} />
        </span>
        <h1>{title}</h1>
        <p className="muted">{detail}</p>
        {step === 'locked' && (
          <button className="btn btn-tonal" onClick={() => setStep('pin')}>
            <Icon name="lock" size={18} />
            Mở khóa bằng mã PIN của phụ huynh
          </button>
        )}
        {step === 'pin' && (
          <>
            <PinInput
              key={attempt}
              pad
              onComplete={async (pin) => {
                if (await useParental.getState().verifyPin(pin)) {
                  setError(null)
                  setStep('choose')
                } else {
                  setError('Mã PIN không đúng.')
                  setAttempt((a) => a + 1)
                }
              }}
            />
            {error && <p className="pin-error">{error}</p>}
            <div className="button-row">
              <button className="btn btn-text btn-small" onClick={() => setStep('locked')}>
                Hủy
              </button>
              <button className="btn btn-text btn-small" onClick={() => void forgotParentalPin()}>
                Quên mã PIN
              </button>
            </div>
          </>
        )}
        {step === 'choose' && (
          <div className="parental-lock-choices">
            <button className="btn btn-tonal" onClick={() => grant(15)}>
              +15 phút
            </button>
            <button className="btn btn-tonal" onClick={() => grant(30)}>
              +30 phút
            </button>
            <button className="btn btn-accent" onClick={() => grant('day')}>
              Hết hôm nay
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
