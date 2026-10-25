// The author's bank account for "Ủng hộ tác giả" (the same as the VietQR in donate-qr.png),
// shown by the desktop app and the LG webOS app.

export const DONATION = {
  accountName: 'DANG VAN DANG',
  accountNumber: '19033516270019',
  bankName: 'Techcombank',
}

/** "1903 3516 2700 19", as printed under the QR code. */
export const donationAccountText = DONATION.accountNumber.replace(/(\d{4})(?=\d)/g, '$1 ')
