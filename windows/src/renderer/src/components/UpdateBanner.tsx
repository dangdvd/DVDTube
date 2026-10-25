// "Có bản mới v1.0.N": installed with the Windows installer → "Cập nhật ngay" (download with
// progress, silent install, restart); otherwise "Tải bản mới" opens the matching asset.

import { useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '@shared/api'
import { api, errorMessage, onEvent } from '@/lib/api'
import { toast } from '@/lib/toast'
import { Icon } from './Icon'

export function startUpdate(info: UpdateInfo): void {
  if (info.installable) {
    api.installUpdate(info).catch((error) => toast(errorMessage(error)))
  } else {
    void api.openExternal(info.downloadUrl ?? info.url)
  }
}

export function UpdateBanner({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  useEffect(() => onEvent('updateProgress', setProgress), [])
  const busy = progress?.state === 'downloading' || progress?.state === 'installing'
  const notes = info.notes?.split('\n').map((l) => l.trim()).filter(Boolean)[0]
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <Icon name="download" size={20} />
      <span>
        Có bản mới <b>v{info.version}</b>
        {notes ? ` — ${notes.slice(0, 140)}` : ''}
        {progress?.state === 'downloading' && <span className="update-progress"> · Đang tải {Math.round(progress.progress * 100)}%</span>}
        {progress?.state === 'installing' && <span className="update-progress"> · Đang cài đặt, DVDTube sẽ tự mở lại…</span>}
        {progress?.state === 'failed' && <span className="error-text"> · {progress.message}</span>}
      </span>
      <button className="btn btn-accent btn-small" disabled={busy} onClick={() => startUpdate(info)} data-testid="update-now">
        {info.installable ? 'Cập nhật ngay' : 'Tải bản mới'}
      </button>
      <button className="icon-btn" aria-label="Đóng" onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
    </div>
  )
}
