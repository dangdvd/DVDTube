// "Sign in from the phone" (port of `TvLogin.kt`): this PC shows a QR code with a one-time token
// and an AES-256 key; the phone that scans it sends its YouTube session (cookies) over the local
// network, encrypted with that key. Format shared with the mobile apps:
// `dvdtube://tv-login?h=<ip>:<port>&t=<token>&k=<key>&n=<name>` (base64url without padding), then
// `POST http://<h>/pair` with `{"t":token,"n":nonce,"c":ciphertext+tag}`, AES/GCM with the token
// as associated data, plaintext `{"cookies":{…}}`.

import { createCipheriv, createDecipheriv, randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto'

export const PAIR_PATH = '/pair'
const NONCE_BYTES = 12
const TAG_BYTES = 16

export function randomBytes(count: number): Buffer {
  return cryptoRandomBytes(count)
}

export function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** base64url with or without padding (standard base64 is accepted too). */
export function decode(text: unknown): Buffer | null {
  if (typeof text !== 'string') return null
  const normalized = text.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]*$/.test(normalized) || normalized.length % 4 === 1) return null
  return Buffer.from(normalized, 'base64url')
}

/** The name is percent-encoded with `%20` for spaces (iOS does not turn `+` back into a space). */
export function link(host: string, token: Uint8Array, key: Uint8Array, name: string): string {
  return `dvdtube://tv-login?h=${host}&t=${encode(token)}&k=${encode(key)}&n=${encodeURIComponent(name)}`
}

/**
 * `a.b.c.d:port` in a private range (10/8, 172.16/12, 192.168/16, 169.254/16): a QR code must
 * not be able to send the session to a server on the internet.
 */
export function isLocalHost(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(host)
  if (!match) return false
  const parts = match.slice(1).map((p) => parseInt(p, 10))
  if (parts.slice(0, 4).some((p) => p > 255) || parts[4] < 1 || parts[4] > 65535) return false
  return isPrivateIPv4(parts.slice(0, 4).join('.'))
}

export function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((p) => parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** Phone side (used by tests): returns the nonce and ciphertext+tag. */
export function encrypt(key: Uint8Array, token: Uint8Array, plaintext: Uint8Array): { nonce: Buffer; sealed: Buffer } {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(token)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { nonce, sealed: Buffer.concat([body, cipher.getAuthTag()]) }
}

/** Null when the data was not encrypted with `key` for `token` (or was changed). */
export function decrypt(key: Uint8Array, token: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Buffer | null {
  if (key.length !== 32 || nonce.length < 1 || sealed.length < TAG_BYTES) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(token)
    decipher.setAuthTag(Buffer.from(sealed.subarray(sealed.length - TAG_BYTES)))
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()])
  } catch {
    return null
  }
}

export function sameToken(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function cookiesJson(cookies: Record<string, string>): string {
  return JSON.stringify({ cookies })
}

export function cookiesFrom(plaintext: Uint8Array): Record<string, string> | null {
  try {
    const json = JSON.parse(Buffer.from(plaintext).toString('utf8')) as { cookies?: unknown }
    if (typeof json.cookies !== 'object' || json.cookies === null) return null
    const result: Record<string, string> = {}
    for (const [name, value] of Object.entries(json.cookies as Record<string, unknown>)) {
      if (typeof value === 'string' && name.length > 0) result[name] = value
    }
    return result
  } catch {
    return null
  }
}
