// "Ủng hộ tác giả": the author's VietQR, to scan with a bank app on the phone, plus the account
// details with a copy button and the QR image to save.

import { DONATION, donationAccountText } from '@shared/donation'
import qrUrl from '@/assets/donate-qr.png'
import { copyText } from '@/lib/actions'
import { toast } from '@/lib/toast'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function SupportDialog({ onClose }: { onClose: () => void }) {
  const copy = async () => {
    await copyText(DONATION.accountNumber)
    toast('Đã sao chép số tài khoản')
  }
  return (
    <Modal
      title="Ủng hộ tác giả"
      onClose={onClose}
      width={720}
      testId="support-dialog"
      actions={
        <>
          <a className="btn btn-text" href={qrUrl} download="DVDTube-ung-ho-tac-gia.png">
            <Icon name="download" size={18} />
            Lưu ảnh mã QR
          </a>
          <button className="btn btn-accent" onClick={onClose}>
            Xong
          </button>
        </>
      }
    >
      <div className="pairing-body support-body">
        <img className="support-qr" src={qrUrl} alt={`Mã QR chuyển khoản VietQR tới ${DONATION.accountName}`} data-testid="support-qr" />
        <div className="pairing-text">
          <h3 className="support-title">
            <Icon name="heart" size={22} />
            Cảm ơn bạn đã dùng DVDTube!
          </h3>
          <p className="muted">
            DVDTube miễn phí và không có quảng cáo. Nếu thấy ứng dụng hữu ích, bạn có thể ủng hộ tác giả một ly cà phê để có thêm động lực
            duy trì và phát triển ứng dụng. Mọi sự ủng hộ, dù nhỏ, đều rất đáng quý.
          </p>
          <ol className="pairing-steps">
            <li>
              Mở ứng dụng <b>ngân hàng</b> hoặc <b>ví điện tử</b> có hỗ trợ VietQR trên điện thoại.
            </li>
            <li>
              Chọn <b>Quét QR</b> và hướng camera vào mã bên trái, nhập số tiền rồi xác nhận.
            </li>
          </ol>
          <dl className="support-account">
            <dt>Chủ tài khoản</dt>
            <dd>{DONATION.accountName}</dd>
            <dt>Ngân hàng</dt>
            <dd>{DONATION.bankName}</dd>
            <dt>Số tài khoản</dt>
            <dd>{donationAccountText}</dd>
          </dl>
          <button className="btn btn-tonal" onClick={() => void copy()} data-testid="support-copy">
            <Icon name="copy" size={18} />
            Sao chép số tài khoản
          </button>
        </div>
      </div>
    </Modal>
  )
}
