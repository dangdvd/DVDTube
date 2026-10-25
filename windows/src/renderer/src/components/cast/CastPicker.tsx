// "Truyền tới thiết bị": DVDTube receivers found on the network (TVs first), receivers added by
// IP address (remembered), and "Thêm thiết bị bằng địa chỉ IP" for networks that block mDNS.

import { useState } from 'react'
import type { CastDevice } from '@shared/models'
import { errorMessage } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useCast } from '@/state/cast'
import { Icon } from '../Icon'
import { Modal } from '../Modal'
import { Spinner } from '../States'

function DeviceRow({ device, onPick, onForget }: { device: CastDevice; onPick: () => void; onForget?: () => void }) {
  const connected = useCast((s) => s.connected?.id === device.id)
  return (
    <div className={'cast-device' + (connected ? ' is-connected' : '') + (device.online === false ? ' is-offline' : '')} data-testid="cast-device">
      <button className="cast-device-main" onClick={onPick}>
        <span className="cast-device-icon">
          <Icon name={device.kind === 'tv' ? 'tv' : 'monitor'} size={24} />
        </span>
        <span className="cast-device-text">
          <span className="cast-device-name">{device.name}</span>
          <span className="cast-device-detail">
            {connected ? 'Đang kết nối' : device.kind === 'tv' ? 'TV có DVDTube' : 'Máy tính có DVDTube'}
            {device.manual ? ` • ${device.host}:${device.port}` : ''}
            {device.online === false ? ' • không phản hồi' : ''}
          </span>
        </span>
      </button>
      {onForget && (
        <button className="icon-btn" aria-label="Quên thiết bị" title="Quên thiết bị" onClick={onForget}>
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  )
}

export function CastPicker() {
  const picker = useCast((s) => s.picker)
  const devices = useCast((s) => s.devices)
  const scanning = useCast((s) => s.scanning)
  const connected = useCast((s) => s.connected)
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  if (!picker) return null
  const close = () => useCast.getState().closePicker()
  const add = async () => {
    if (!address.trim()) return
    setBusy(true)
    try {
      const device = await useCast.getState().addDevice(address.trim())
      setAdding(false)
      setAddress('')
      toast(`Đã thêm ${device.name}`)
    } catch (error) {
      toast(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={picker.mode === 'queue' ? 'Thêm vào hàng đợi trên TV' : 'Truyền tới thiết bị'}
      onClose={close}
      width={460}
      className="cast-picker"
      testId="cast-picker"
    >
      {picker.video && <p className="modal-text cast-picker-video">{picker.video.title}</p>}
      <div className="cast-section-title">
        Thiết bị có DVDTube
        {scanning && <Spinner size={14} />}
      </div>
      <div className="cast-devices">
        {devices.map((d) => (
          <DeviceRow key={d.id} device={d} onPick={() => void useCast.getState().pick(d)} onForget={d.manual ? () => void useCast.getState().forget(d.id) : undefined} />
        ))}
        {!devices.length && (
          <div className="cast-empty">
            {scanning ? 'Đang tìm TV và máy tính trong mạng…' : 'Không tìm thấy thiết bị nào. Mở DVDTube trên TV (hoặc máy tính khác) và dùng cùng mạng Wi-Fi.'}
          </div>
        )}
      </div>
      {adding ? (
        <div className="cast-add">
          <input
            className="text-input"
            autoFocus
            placeholder="192.168.1.20 hoặc 192.168.1.20:8766"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            data-testid="cast-address"
          />
          <button className="btn btn-accent" disabled={busy || !address.trim()} onClick={() => void add()}>
            {busy ? <Spinner size={16} /> : 'Thêm'}
          </button>
        </div>
      ) : (
        <button className="cast-add-link" onClick={() => setAdding(true)}>
          <Icon name="plusCircle" size={20} />
          Thêm thiết bị bằng địa chỉ IP
        </button>
      )}
      <p className="muted small cast-note">
        Chromecast không có trên máy tính. Thiết bị nhận tự tải video ở chất lượng cao nhất; chỉ mã video được gửi đi, không gửi tài khoản.
      </p>
      {connected && (
        <div className="modal-actions cast-picker-actions">
          <button className="btn btn-text" onClick={() => (close(), void useCast.getState().disconnect(true))}>
            Tiếp tục trên thiết bị này
          </button>
          <button className="btn btn-tonal" onClick={() => (close(), void useCast.getState().disconnect(false))}>
            Ngắt kết nối
          </button>
        </div>
      )}
    </Modal>
  )
}
