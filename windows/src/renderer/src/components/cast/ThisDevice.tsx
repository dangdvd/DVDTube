// "Máy tính này": the address other devices type in "Thêm thiết bị bằng địa chỉ IP" when they do
// not find this computer by themselves (networks that block discovery).

import { useEffect, useState } from 'react'
import type { CastReceiverInfo } from '@shared/api'
import { api } from '@/lib/api'
import { copyText } from '@/lib/actions'
import { toast } from '@/lib/toast'
import { useSettings } from '@/state/settings'
import { Icon } from '../Icon'

/** This computer's receiver addresses, refreshed when "Cho phép truyền video tới máy tính này" changes. */
export function useReceiverInfo(): CastReceiverInfo | null {
  const enabled = useSettings((s) => s.settings.castReceiver)
  const [info, setInfo] = useState<CastReceiverInfo | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => api.castReceiverInfo().then((i) => alive && setInfo(i)).catch(() => {})
    void load()
    // The receiver starts a moment after the setting turns on.
    const timer = setTimeout(load, 1200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [enabled])
  return info
}

export function ThisDeviceAddress() {
  const enabled = useSettings((s) => s.settings.castReceiver)
  const info = useReceiverInfo()
  const [main, ...others] = info?.addresses ?? []
  return (
    <div className="cast-self" data-testid="cast-self">
      <div className="cast-section-title">Máy tính này</div>
      {main ? (
        <>
          <p className="muted small">
            Thiết bị khác không tự tìm thấy máy này? Trên điện thoại, TV hoặc máy tính đó chọn <b>Thêm thiết bị bằng địa chỉ IP</b> và nhập:
          </p>
          <div className="cast-self-address">
            <code data-testid="cast-self-address">{main}</code>
            <button
              className="btn btn-text btn-small"
              onClick={() => void copyText(main).then(() => toast('Đã sao chép địa chỉ'))}
            >
              <Icon name="copy" size={16} />
              Sao chép
            </button>
          </div>
          {others.length > 0 && <p className="muted small">Nếu không kết nối được, thử: {others.join(', ')}</p>}
        </>
      ) : (
        <p className="muted small">
          {enabled
            ? 'Máy tính chưa kết nối mạng nội bộ (Wi-Fi hoặc cáp mạng), nên thiết bị khác chưa truyền tới máy này được.'
            : 'Bật "Cho phép truyền video tới máy tính này" trong Cài đặt › Truyền video để nhận video từ điện thoại hoặc TV.'}
        </p>
      )}
    </div>
  )
}
