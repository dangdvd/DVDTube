// "Đồng bộ qua mạng LAN": this computer shows the QR code; the phone that scans it sends its
// library (encrypted), both devices merge and end up with the same library.

import { useEffect, useState } from 'react'
import { useSyncDialog } from '@/lib/sync'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { Spinner } from './States'

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function SyncDialog() {
  const { open, info, status, error } = useSyncDialog()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  if (!open) return null
  const remaining = info ? info.expiresAt - now : 0
  const expired = status?.state === 'expired' || (!!info && remaining <= 0 && status?.state !== 'success')
  const close = () => useSyncDialog.getState().close()
  return (
    <Modal
      title="Đồng bộ thư viện qua mạng LAN"
      onClose={close}
      width={640}
      testId="sync-dialog"
      actions={
        <>
          <button className="btn btn-text" onClick={() => void useSyncDialog.getState().start()}>
            <Icon name="refresh" size={18} />
            Tạo mã mới
          </button>
          <button className="btn btn-accent" onClick={close}>
            Xong
          </button>
        </>
      }
    >
      <div className="pairing-body sync-body">
        <div className={'qr-box' + (expired ? ' is-expired' : '')}>
          {info ? <img src={info.qrDataUrl} alt="Mã QR đồng bộ" width={220} height={220} data-testid="sync-qr" /> : !error && <Spinner />}
          {error && (
            <div className="qr-overlay">
              <Icon name="alert" size={28} />
              <span>{error}</span>
            </div>
          )}
          {expired && !error && (
            <div className="qr-overlay">
              <span>Mã đã hết hạn</span>
            </div>
          )}
          {status?.state === 'success' && (
            <div className="qr-overlay is-success">
              <Icon name="checkCircle" size={40} />
              <span>Đã đồng bộ với {status.device}</span>
            </div>
          )}
        </div>
        <div className="pairing-text">
          <ol className="pairing-steps">
            <li>
              Mở <b>DVDTube</b> trên điện thoại › <b>Cài đặt</b> › <b>Đồng bộ &amp; sao lưu</b> › <b>Quét mã đồng bộ</b>, hoặc quét bằng <b>Camera</b> trên iPhone.
            </li>
            <li>Xác nhận "Đồng bộ thư viện với {info?.deviceName ?? 'máy tính này'}?".</li>
            <li>Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nội dung tìm kiếm được gộp trên cả hai thiết bị.</li>
          </ol>
          <p className="muted small">Hai thiết bị phải cùng mạng Wi-Fi. Dữ liệu được mã hoá bằng khoá trong mã QR; mã chỉ dùng được một lần.</p>
          <div className="pairing-status" data-testid="sync-status">
            {status?.state === 'waiting' && !expired && (
              <>
                <Spinner size={16} />
                <span>Đang chờ điện thoại… Mã hết hạn sau {countdown(remaining)}</span>
              </>
            )}
            {status?.state === 'merging' && (
              <>
                <Spinner size={16} />
                <span>Đang gộp thư viện từ {status.device}…</span>
              </>
            )}
            {status?.state === 'success' && <span className="success-text">{status.summary}</span>}
            {status?.state === 'failed' && (
              <span className="error-text">
                <Icon name="alert" size={16} /> {status.message}
              </span>
            )}
            {info && <span className="muted small">{info.host}</span>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
