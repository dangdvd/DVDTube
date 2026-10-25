// "Ủng hộ tác giả": the author's VietQR, to scan with a bank app on the phone.

import { DONATION, donationAccountText } from '@shared/donation'
import { useInitialFocus } from '../screen'
import { OptionRow } from '../ui/base'

export function SupportScreen() {
  useInitialFocus(true)
  return (
    <div class="page pairing support" data-testid="support-page">
      <img class="support-qr" src="donate-qr.png" alt={`Mã QR chuyển khoản VietQR tới ${DONATION.accountName}`} data-testid="support-qr" />
      <div class="pairing-text">
        <h1>Ủng hộ tác giả</h1>
        <div class="pairing-note big">
          DVDTube miễn phí và không có quảng cáo. Nếu thấy ứng dụng hữu ích, bạn có thể ủng hộ tác giả một ly cà phê để có thêm động lực duy trì
          và phát triển ứng dụng. Mọi sự ủng hộ, dù nhỏ, đều rất đáng quý.
        </div>
        <div class="pairing-note">
          Mở ứng dụng ngân hàng hoặc ví điện tử có hỗ trợ VietQR trên điện thoại › Quét QR › hướng camera vào mã trên TV, nhập số tiền rồi xác nhận.
        </div>
        <div class="option-list">
          <OptionRow title="Chủ tài khoản" value={DONATION.accountName} icon="account" autofocus />
          <OptionRow title="Ngân hàng" value={DONATION.bankName} icon="info" />
          <OptionRow title="Số tài khoản" value={donationAccountText} icon="heart" />
        </div>
        <div class="pairing-note">Cảm ơn bạn rất nhiều!</div>
      </div>
    </div>
  )
}
