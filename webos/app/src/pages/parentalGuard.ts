// PIN checks of the parental controls (settings section, sign in / out, account switch).

import { toast } from '../state/nav'
import { parental } from '../state/parental'
import { confirm, pinPrompt } from '../ui/dialogs'

/** "Quên mã PIN": there is no account recovery, so every parental setting is reset. */
export async function forgotParentalPin(): Promise<void> {
  const ok = await confirm('Quên mã PIN?', {
    message: 'Không có cách khôi phục mã PIN. Đặt lại sẽ xóa mã PIN và tắt toàn bộ kiểm soát của phụ huynh.',
    confirmLabel: 'Đặt lại',
    danger: true,
  })
  if (!ok) return
  parental.resetAll()
  toast('Đã đặt lại kiểm soát của phụ huynh')
}

/** True when parental controls are off, unlocked recently, or the right PIN was entered now. */
export async function requirePin(message = 'Nhập mã PIN'): Promise<boolean> {
  if (parental.isUnlocked()) return true
  const ok = await pinPrompt(message, (pin) => parental.verifyPin(pin), { onForgot: () => void forgotParentalPin() })
  if (ok) parental.markUnlocked()
  return ok
}
