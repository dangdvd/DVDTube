// QR codes drawn in the page (mock mode; the service renders the real ones as PNG data URLs).

import QRCode from 'qrcode'

export function qrDataUrl(text: string, size = 360): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const count = qr.modules.size
  const margin = 2
  const total = count + margin * 2
  let path = ''
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.modules.get(x, y)) path += `M${x + margin} ${y + margin}h1v1h-1z`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
