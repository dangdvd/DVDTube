// Tài khoản: sign in from the phone (the shared QR TV-login protocol, port 8765), the account's
// Google accounts / brand channels, sign out — and the pairing screen with the QR code.

import type { PairingInfo, PairingStatus } from '@shared/api'
import { useEffect, useState } from 'preact/hooks'
import { api, onEvent } from '../api'
import { useInitialFocus } from '../screen'
import { accountStore, refreshAccount, restoreSession, signOut, switchIdentity } from '../state/account'
import { nav, toast } from '../state/nav'
import { useStore } from '../store'
import { Avatar, Button, Loading, OptionRow, ScreenTitle, SectionTitle } from '../ui/base'
import { requirePin } from './parentalGuard'

export function AccountScreen() {
  const { state, error } = useStore(accountStore)
  useInitialFocus(true)
  useEffect(() => {
    if (state.signedIn) void refreshAccount()
  }, [state.signedIn])

  if (!state.signedIn) {
    return (
      <div class="page" data-scroll="y" data-testid="account-page">
        <ScreenTitle title="Đăng nhập YouTube" subtitle="Không bắt buộc. Khi đăng nhập, Trang chủ có đề xuất của tài khoản, Kênh đăng ký, Xem sau và lượt thích được đồng bộ. Video vẫn phát không quảng cáo." />
        <div class="option-list narrow">
          <OptionRow
            title="Đăng nhập bằng điện thoại (khuyên dùng)"
            subtitle="TV hiện mã QR, quét bằng Camera trên iPhone hoặc ứng dụng DVDTube trên Android đã đăng nhập."
            icon="phone"
            autofocus
            testid="pair-phone"
            onClick={async () => {
              if (await requirePin('Nhập mã PIN để đăng nhập')) nav.open({ name: 'pairing' })
            }}
          />
        </div>
      </div>
    )
  }

  const profile = state.profile
  return (
    <div class="page" data-scroll="y" data-testid="account-page">
      <div class="profile">
        <Avatar src={profile?.avatar} name={profile?.name} size={120} />
        <div>
          <h1>{profile?.name ?? 'Tài khoản'}</h1>
          {(profile?.handle || profile?.email) && <div class="screen-subtitle">{profile?.handle ?? profile?.email}</div>}
        </div>
      </div>
      {state.identities.length > 0 && (
        <>
          <SectionTitle>Tài khoản và kênh</SectionTitle>
          <div class="option-list narrow">
            {state.identities.map((identity) => (
              <OptionRow
                key={identity.id}
                title={identity.name}
                subtitle={[identity.byline ?? identity.email, identity.pageId ? 'Kênh thương hiệu' : null].filter(Boolean).join(' • ') || null}
                selected={identity.isSelected}
                icon={identity.isSelected ? null : 'account'}
                autofocus={identity.isSelected}
                onClick={async () => {
                  if (identity.isSelected) return
                  if (await requirePin('Nhập mã PIN để chuyển tài khoản')) void switchIdentity(identity.id)
                }}
              />
            ))}
          </div>
        </>
      )}
      <div class="button-row" data-group>
        <Button label="Làm mới" icon="refresh" onClick={() => void refreshAccount()} autofocus={!state.identities.length} />
        <Button
          label="Đăng xuất"
          icon="logout"
          testid="sign-out"
          onClick={async () => {
            if (!(await requirePin('Nhập mã PIN để đăng xuất'))) return
            await signOut()
            toast('Đã đăng xuất')
          }}
        />
      </div>
      {error && <div class="error-text">{error}</div>}
    </div>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div class="step">
      <span class="step-number">{n}</span>
      <span>{text}</span>
    </div>
  )
}

export function PairingScreen() {
  const [generation, setGeneration] = useState(0)
  const [info, setInfo] = useState<PairingInfo | null>(null)
  const [status, setStatus] = useState<PairingStatus>({ state: 'waiting' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setInfo(null)
    setError(null)
    setStatus({ state: 'waiting' })
    api.startPairing().then(
      (i) => alive && setInfo(i),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    const off = onEvent('pairing', (s) => {
      if (!alive) return
      setStatus(s)
      setBusy(false)
      if (s.state === 'success') {
        toast(`Đã đăng nhập: ${s.accountName || 'tài khoản Google'}`)
        void restoreSessionFromService()
      }
    })
    return () => {
      alive = false
      off()
      api.stopPairing().catch(() => {})
    }
  }, [generation])

  useInitialFocus(true)
  const done = status.state === 'success'
  const expired = status.state === 'expired'
  void busy

  return (
    <div class="page pairing" data-testid="pairing-page">
      <div class="qr-box">
        {done ? (
          <div class="qr-done">✓</div>
        ) : expired ? (
          <div class="qr-text">Mã đã hết hạn</div>
        ) : info ? (
          <img src={info.qrDataUrl} alt="Mã QR đăng nhập" data-testid="pairing-qr" />
        ) : error ? (
          <div class="qr-text small">{error}</div>
        ) : (
          <Loading />
        )}
      </div>
      <div class="pairing-text">
        {done ? (
          <>
            <h1>Đã đăng nhập</h1>
            <div class="screen-subtitle">{status.state === 'success' && status.accountName ? status.accountName : 'Tài khoản Google của bạn'}</div>
            <div class="button-row" data-group>
              <Button label="Xong" accent autofocus onClick={() => nav.back()} />
            </div>
          </>
        ) : (
          <>
            <h1>Đăng nhập bằng điện thoại</h1>
            <Step n={1} text="Đăng nhập tài khoản Google trong DVDTube trên điện thoại." />
            <Step n={2} text="Quét mã bằng Camera trên iPhone, hoặc ứng dụng DVDTube trên Android (Bạn › Đăng nhập cho TV)." />
            <Step n={3} text="Xác nhận “Gửi” trên điện thoại. Điện thoại và TV phải cùng mạng Wi-Fi." />
            <div class="pairing-note">
              {'Phiên đăng nhập được mã hoá bằng khoá chỉ có trong mã QR này và chỉ gửi qua mạng nội bộ tới TV. ' + (info ? `Địa chỉ TV: ${info.host} • ${info.deviceName}` : '')}
            </div>
            {status.state === 'failed' && <div class="error-text">{status.message}</div>}
            <div class="button-row" data-group>
              <Button label="Tạo mã mới" icon="refresh" autofocus onClick={() => setGeneration((g) => g + 1)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

async function restoreSessionFromService(): Promise<void> {
  // The service validated the phone's session: save it here (the `session` event does too).
  try {
    const session = await api.exportSession()
    if (session) {
      const { saveJson } = await import('../store')
      saveJson('session', session)
    }
  } catch {
    // ignore
  }
  await restoreSession()
}
