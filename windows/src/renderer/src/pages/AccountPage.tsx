// Tài khoản (/account). Signed out: "Đăng nhập bằng Google" (sign-in window) and "Đăng nhập
// bằng điện thoại" (QR pairing over the local network, like the Android TV app). Signed in:
// profile, accounts / brand channels, Thêm tài khoản, Đăng xuất, YouTube Studio.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PairingInfo, PairingStatus } from '@shared/api'
import { Avatar } from '@/components/Avatar'
import { GoogleMark, Icon } from '@/components/Icon'
import { signIn, signOut, switchIdentity } from '@/components/shell/AccountMenu'
import { Spinner } from '@/components/States'
import { api, errorMessage, onEvent } from '@/lib/api'
import { paths } from '@/lib/nav'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function PhonePairing() {
  const [info, setInfo] = useState<PairingInfo | null>(null)
  const [status, setStatus] = useState<PairingStatus | { state: 'starting' }>({ state: 'starting' })
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const running = useRef(false)

  const start = useCallback(async () => {
    setError(null)
    setInfo(null)
    setStatus({ state: 'starting' })
    try {
      const next = await api.startPairing()
      running.current = true
      setInfo(next)
      setStatus({ state: 'waiting' })
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void start()
    const off = onEvent('pairing', (s) => {
      setStatus(s)
      if (s.state === 'success') {
        running.current = false
        toast(`Đã đăng nhập: ${s.accountName}`)
        void useAccount.getState().refresh()
      }
      if (s.state === 'expired' || s.state === 'failed') running.current = false
    })
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      off()
      clearInterval(timer)
      if (running.current) void api.stopPairing().catch(() => {})
      running.current = false
    }
  }, [start])

  const remaining = info ? info.expiresAt - now : 0
  const expired = status.state === 'expired' || (info != null && remaining <= 0)

  return (
    <div className="signin-option" data-testid="pairing-card">
      <div className="signin-option-head">
        <span className="signin-option-icon">
          <Icon name="phone" size={26} />
        </span>
        <div>
          <h2>Đăng nhập bằng điện thoại</h2>
          <p className="muted">Dùng tài khoản đã đăng nhập trong ứng dụng DVDTube trên điện thoại, không cần nhập mật khẩu.</p>
        </div>
      </div>
      <div className="pairing-body">
        <div className={'qr-box' + (expired ? ' is-expired' : '')}>
          {info ? <img src={info.qrDataUrl} alt="Mã QR đăng nhập" width={220} height={220} data-testid="pairing-qr" /> : !error && <Spinner />}
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
          {status.state === 'success' && (
            <div className="qr-overlay is-success">
              <Icon name="checkCircle" size={40} />
              <span>Đã đăng nhập: {status.accountName}</span>
            </div>
          )}
        </div>
        <div className="pairing-text">
          <ol className="pairing-steps">
            <li>
              Mở ứng dụng <b>DVDTube</b> trên điện thoại › <b>Bạn</b> › <b>Đăng nhập cho TV (quét mã QR)</b>, hoặc quét bằng <b>Camera</b> trên
              iPhone.
            </li>
            <li>Xác nhận gửi phiên đăng nhập tới máy tính này{info ? ` (${info.deviceName})` : ''}.</li>
          </ol>
          <p className="muted small">Điện thoại và máy tính phải cùng mạng Wi-Fi. Dữ liệu được mã hoá bằng khoá trong mã QR.</p>
          <div className="pairing-status" data-testid="pairing-status">
            {status.state === 'waiting' && !expired && (
              <>
                <Spinner size={16} />
                <span>Đang chờ điện thoại… Mã hết hạn sau {countdown(remaining)}</span>
              </>
            )}
            {status.state === 'failed' && (
              <span className="error-text">
                <Icon name="alert" size={16} /> {status.message}
              </span>
            )}
            {info && <span className="muted small">{info.host}</span>}
          </div>
          <button className="btn btn-tonal" onClick={() => void start()} disabled={status.state === 'starting'}>
            <Icon name="refresh" size={18} />
            Tạo mã mới
          </button>
        </div>
      </div>
    </div>
  )
}

function SignedOut() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="page page-pad page--narrow" data-testid="account-page">
      <div className="page-header">
        <h1 className="page-title">Đăng nhập</h1>
      </div>
      <p className="muted account-intro">
        Dùng kênh đăng ký, danh sách phát, lượt thích, bình luận và đề xuất của tài khoản Google. Không đăng nhập vẫn dùng được đầy đủ trên máy.
      </p>
      <div className="signin-options">
        <div className="signin-option" data-testid="google-card">
          <div className="signin-option-head">
            <span className="signin-option-icon is-google">
              <GoogleMark size={26} />
            </span>
            <div>
              <h2>Đăng nhập bằng Google</h2>
              <p className="muted">
                Mật khẩu được nhập trực tiếp trên trang của Google. Sau khi đăng nhập, ứng dụng chỉ lưu phiên YouTube (cookie) đã mã hóa trên máy.
              </p>
            </div>
          </div>
          <button
            className="btn btn-primary btn-large"
            disabled={busy}
            data-testid="google-signin"
            onClick={async () => {
              setBusy(true)
              await signIn()
              setBusy(false)
            }}
          >
            {busy ? <Spinner size={18} /> : <GoogleMark size={18} />}
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </div>
        <PhonePairing />
      </div>
    </div>
  )
}

export function AccountPage() {
  const navigate = useNavigate()
  const { signedIn, profile, identities, loaded } = useAccount()
  usePageTitle('Tài khoản')
  if (!loaded)
    return (
      <div className="center-spinner">
        <Spinner />
      </div>
    )
  if (!signedIn || !profile) return <SignedOut />

  return (
    <div className="page page-pad page--narrow" data-testid="account-page">
      <div className="account-profile card">
        <Avatar src={profile.avatar} name={profile.name} size={96} />
        <div className="account-profile-text">
          <h1>{profile.name}</h1>
          <div className="muted">{[profile.handle, profile.email].filter(Boolean).join(' • ')}</div>
          <div className="button-row">
            {profile.channelId && (
              <button className="btn btn-tonal btn-small" onClick={() => navigate(paths.channel(profile.channelId!))}>
                <Icon name="you" size={18} />
                Xem kênh của bạn
              </button>
            )}
            <button className="btn btn-tonal btn-small" onClick={() => void api.openStudio().catch((e) => toast(errorMessage(e)))}>
              <Icon name="studio" size={18} />
              Mở YouTube Studio
            </button>
          </div>
        </div>
      </div>
      <h2 className="section-title">Tài khoản và kênh</h2>
      <div className="card identity-list" data-testid="identity-list">
        {identities.map((i) => (
          <button key={i.id} className={'identity' + (i.isSelected ? ' is-selected' : '')} onClick={() => !i.isSelected && void switchIdentity(i.id)}>
            <Avatar src={i.avatar} name={i.name} size={40} />
            <span className="identity-text">
              <span className="identity-name">{i.name}</span>
              <span className="muted small">{i.byline ?? i.email ?? (i.pageId ? 'Kênh thương hiệu' : 'Tài khoản Google')}</span>
            </span>
            {i.isSelected ? <span className="identity-current">Đang dùng</span> : <Icon name="chevronRight" size={20} />}
          </button>
        ))}
        <button className="identity" onClick={() => void signIn(true)}>
          <span className="identity-icon">
            <Icon name="plus" />
          </span>
          <span className="identity-text">
            <span className="identity-name">Thêm tài khoản</span>
          </span>
        </button>
      </div>
      <div className="button-row account-actions">
        <button className="btn btn-outline" onClick={() => void signOut()} data-testid="signout">
          <Icon name="logout" size={20} />
          Đăng xuất
        </button>
      </div>
    </div>
  )
}
