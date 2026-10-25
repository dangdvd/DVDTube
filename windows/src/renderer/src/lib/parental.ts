// PIN checks of the parental controls used by several screens (settings, sign in / out, the
// blocked channels list).

import { useParental } from '@/state/parental'
import { confirmDialog, pinDialog } from './dialogs'
import { toast } from './toast'

/** "Quên mã PIN": there is no account recovery, so every parental setting is reset. */
export async function forgotParentalPin(): Promise<void> {
  const ok = await confirmDialog({
    title: 'Quên mã PIN?',
    message: 'Không có cách lấy lại mã PIN. Mọi cài đặt kiểm soát của phụ huynh sẽ được đặt lại và tắt.',
    confirmLabel: 'Đặt lại',
    danger: true,
  })
  if (!ok) return
  useParental.getState().resetAll()
  toast('Đã đặt lại kiểm soát của phụ huynh')
}

/** True when parental controls are off, unlocked recently, or the right PIN was entered now. */
export async function requireParentalPin(message?: string): Promise<boolean> {
  const s = useParental.getState()
  if (!s.config.enabled || s.unlockedUntil > Date.now()) return true
  const pin = await pinDialog({
    title: 'Nhập mã PIN của phụ huynh',
    message: message ?? 'Thao tác này được bảo vệ bởi kiểm soát của phụ huynh.',
    verify: (p) => useParental.getState().verifyPin(p),
    forgot: () => void forgotParentalPin(),
  })
  if (pin === null) return false
  useParental.getState().markUnlocked()
  return true
}
