// TV-login crypto (encrypt like the phone apps, decrypt in the server) and the pairing server's
// HTTP protocol (same as the Android TV app).

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { describe, it } from 'node:test'
import type { PairingStatus } from '@shared/api'
import { PairingServer } from '../pairing'
import { cookiesFrom, cookiesJson, decode, decrypt, encode, encrypt, isLocalHost, link, randomBytes } from '../core/tvlogin'

function post(host: string, body: string | Buffer, headers: Record<string, string> = {}, method = 'POST', path = '/pair') {
  const [hostname, port] = host.split(':')
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname, port: Number(port), path, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : {} })
      })
    })
    req.on('error', reject)
    if (method !== 'GET') req.end(body)
    else req.end()
  })
}

/** What the phone apps send (TvLogin.send / TVLoginSender.send). */
function phoneBody(token: Buffer, key: Buffer, cookies: Record<string, string>): string {
  const { nonce, sealed } = encrypt(key, token, Buffer.from(cookiesJson(cookies), 'utf8'))
  return JSON.stringify({ t: encode(token), n: encode(nonce), c: encode(sealed) })
}

function params(qr: string): URLSearchParams {
  return new URL(qr.replace('dvdtube://tv-login', 'https://x/')).searchParams
}

describe('tv login crypto', () => {
  it('round-trips AES-256-GCM with the token as associated data', () => {
    const token = randomBytes(16)
    const key = randomBytes(32)
    const cookies = { SAPISID: 'abc', LOGIN_INFO: 'xyz', 'Tên': 'giá trị' }
    const { nonce, sealed } = encrypt(key, token, Buffer.from(cookiesJson(cookies)))
    assert.equal(nonce.length, 12)
    const plain = decrypt(key, token, nonce, sealed)!
    assert.deepEqual(cookiesFrom(plain), cookies)
    assert.equal(decrypt(key, randomBytes(16), nonce, sealed), null, 'other token')
    assert.equal(decrypt(randomBytes(32), token, nonce, sealed), null, 'other key')
    const tampered = Buffer.from(sealed)
    tampered[0] ^= 1
    assert.equal(decrypt(key, token, nonce, tampered), null, 'tampered')
  })

  it('encodes base64url without padding and builds the QR link', () => {
    const token = Buffer.from([0xfb, 0xff, 0xfe, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    assert.equal(encode(token).includes('='), false)
    assert.deepEqual(decode(encode(token)), token)
    assert.deepEqual(decode(token.toString('base64')), token, 'standard base64 accepted')
    const qr = link('192.168.1.20:8765', token, randomBytes(32), 'PC của Đăng')
    assert.ok(qr.startsWith('dvdtube://tv-login?h=192.168.1.20:8765&t='))
    assert.equal(params(qr).get('n'), 'PC của Đăng')
    assert.equal(isLocalHost('192.168.1.20:8765'), true)
    assert.equal(isLocalHost('172.20.0.1:1'), true)
    assert.equal(isLocalHost('8.8.8.8:8765'), false)
    assert.equal(isLocalHost('192.168.1.20'), false)
  })
})

describe('pairing server', () => {
  it('accepts the phone session once and stops', async () => {
    const statuses: PairingStatus[] = []
    let received: Record<string, string> | null = null
    const server = new PairingServer(
      { signIn: async (cookies) => { received = cookies; return 'Đăng' }, onStatus: (s) => statuses.push(s) },
      { address: '127.0.0.1', port: 0, deviceName: 'PC thử' },
    )
    const info = await server.start()
    try {
      assert.ok(info.qrDataUrl.startsWith('data:image/png;base64,'))
      assert.equal(info.host.split(':')[0], '127.0.0.1')
      const qr = params(info.qrText)
      const token = decode(qr.get('t'))!
      const key = decode(qr.get('k'))!
      assert.equal(token.length, 16)
      assert.equal(key.length, 32)

      const hello = await post(info.host, '', {}, 'GET')
      assert.deepEqual(hello, { status: 200, json: { ok: true, tv: 'PC thử' } })
      assert.equal((await post(info.host, '', {}, 'GET', '/other')).status, 404)
      assert.equal((await post(info.host, 'x', {}, 'PUT')).status, 405)

      const wrongToken = await post(info.host, phoneBody(randomBytes(16), key, { SAPISID: 'a' }), { 'Content-Type': 'application/json' })
      assert.equal(wrongToken.status, 403)
      assert.equal(received, null)

      const wrongKey = await post(info.host, phoneBody(token, randomBytes(32), { SAPISID: 'a' }))
      assert.equal(wrongKey.status, 403)

      const big = Buffer.alloc(70 * 1024, 0x20)
      assert.equal((await post(info.host, big)).status, 413)

      const ok = await post(info.host, phoneBody(token, key, { SAPISID: 'abc', LOGIN_INFO: 'def' }))
      assert.deepEqual(ok, { status: 200, json: { ok: true, name: 'Đăng' } })
      assert.deepEqual(received, { SAPISID: 'abc', LOGIN_INFO: 'def' })
      assert.deepEqual(statuses.at(-1), { state: 'success', accountName: 'Đăng' })

      const again = await post(info.host, phoneBody(token, key, { SAPISID: 'abc' }))
      assert.equal(again.status, 403, 'single use')
    } finally {
      server.stop()
    }
  })

  it('reports a failed sign-in to the phone and expires', async () => {
    const statuses: PairingStatus[] = []
    const server = new PairingServer(
      { signIn: async () => { throw new Error('YouTube không chấp nhận phiên đăng nhập này.') }, onStatus: (s) => statuses.push(s) },
      { address: '127.0.0.1', port: 0, lifetimeMs: 300 },
    )
    const info = await server.start()
    const qr = params(info.qrText)
    const response = await post(info.host, phoneBody(decode(qr.get('t'))!, decode(qr.get('k'))!, { SAPISID: 'x' }))
    assert.equal(response.status, 400)
    assert.equal(response.json.error, 'YouTube không chấp nhận phiên đăng nhập này.')
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert.deepEqual(statuses.at(-1), { state: 'expired' })
  })
})
