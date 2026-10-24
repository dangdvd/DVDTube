// "Đăng ký" / "Đã đăng ký" pill. Local subscription always; the account too when signed in.

import { useState } from 'react'
import type { ChannelItem } from '@shared/models'
import { setSubscribed } from '@/lib/actions'
import { confirmDialog } from '@/lib/dialogs'
import { useLibrary } from '@/state/library'
import { Icon } from './Icon'

export function SubscribeButton({
  channel,
  initial,
  size = 'normal',
}: {
  channel: ChannelItem
  /** Subscription state reported by YouTube (signed in), used until the user changes it. */
  initial?: boolean | null
  size?: 'normal' | 'small'
}) {
  const local = useLibrary((s) => s.subscriptions.some((c) => c.id === channel.id))
  const [override, setOverride] = useState<boolean | null>(initial ?? null)
  const subscribed = override ?? local

  const toggle = async () => {
    if (subscribed) {
      const ok = await confirmDialog({ title: `Hủy đăng ký ${channel.name}?`, confirmLabel: 'Hủy đăng ký' })
      if (!ok) return
    }
    setOverride(!subscribed)
    await setSubscribed(channel, !subscribed)
  }

  return (
    <button
      className={'btn subscribe-btn ' + (subscribed ? 'btn-tonal is-subscribed' : 'btn-primary') + (size === 'small' ? ' btn-small' : '')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void toggle()
      }}
      data-testid="subscribe-button"
    >
      {subscribed && <Icon name="bell" size={size === 'small' ? 18 : 20} />}
      {subscribed ? 'Đã đăng ký' : 'Đăng ký'}
      {subscribed && <Icon name="chevronDown" size={18} />}
    </button>
  )
}
