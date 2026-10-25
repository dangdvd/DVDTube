// Removes secrets from text before it leaves the computer ("Gửi nhật ký lỗi"): cookie and
// Authorization / SAPISIDHASH values, Google session cookie values, e-mail addresses, the keys
// and tokens of the QR pairing / sync links, and `key=` / `sig=` / `signature=` URL parameters.

const HIDDEN = '[đã ẩn]'
const SESSION_COOKIES = 'SAPISID|SID|HSID|SSID|APISID|LOGIN_INFO|__Secure-[^=\\s;,"\'&:]+'

export function scrub(text: string, options: { home?: string | null } = {}): string {
  let t = text
  // Whole header lines.
  t = t.replace(/\b(set-cookie|cookie|authorization|x-goog-authuser|x-goog-pageid)(\s*[:=]\s*)[^\r\n]*/gi, `$1$2${HIDDEN}`)
  t = t.replace(/\bSAPISID(?:1P|3P)?HASH\s+[^\s"',;]+(?:\s+SAPISID(?:1P|3P)?HASH\s+[^\s"',;]+)*/g, `SAPISIDHASH ${HIDDEN}`)
  // "SAPISID":"…" (JSON) and SAPISID=… (cookie strings, query strings).
  t = t.replace(new RegExp(`"(${SESSION_COOKIES})"\\s*:\\s*"[^"]*"`, 'g'), `"$1":"${HIDDEN}"`)
  t = t.replace(new RegExp(`(?<![A-Za-z0-9_-])(${SESSION_COOKIES})(\\s*=\\s*)[^;\\s,"'&]+`, 'g'), `$1$2${HIDDEN}`)
  // Pairing / sync links carry the one-time token and the AES key.
  t = t.replace(/dvdtube:\/\/[^\s"'<>]+/gi, (link) => link.replace(/([?&](?:t|k)=)[^&\s"'<>]*/gi, `$1${HIDDEN}`))
  // Signed URLs and API keys.
  t = t.replace(/([?&](?:key|sig|signature|lsig|sigh)=)[^&\s"'<>]+/gi, `$1${HIDDEN}`)
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]')
  // The user's folder name is often their own name.
  if (options.home && options.home.length > 3) t = t.split(options.home).join('~')
  return t
}
