// Settings sections of the newer features: casting to / from this computer, music, DeArrow,
// sync & backup, parental controls, alarms, automatic downloads and the error log.

import { useEffect, useState } from 'react'
import type { ChannelItem } from '@shared/models'
import type { AutoDownloadSettings } from '@shared/settings'
import { Avatar } from '@/components/Avatar'
import { Icon } from '@/components/Icon'
import { Modal } from '@/components/Modal'
import { ButtonRow, CheckRow, SelectRow, SettingsSection, ToggleRow } from '@/components/SettingRows'
import { Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { REPEAT_TITLES, contentTitle, newAlarm, nextOccurrence, useAlarms, type Alarm, type AlarmContent, type AlarmRepeat } from '@/lib/alarms'
import { api, errorMessage } from '@/lib/api'
import { confirmDialog, pinDialog } from '@/lib/dialogs'
import { copyErrorLog, saveErrorLog } from '@/lib/logExport'
import { forgotParentalPin, requireParentalPin } from '@/lib/parental'
import { exportLibraryFile, importLibraryFile, useSyncDialog } from '@/lib/sync'
import { toast } from '@/lib/toast'
import { useAccount } from '@/state/account'
import { useCast } from '@/state/cast'
import { useLibrary } from '@/state/library'
import { DAILY_LIMITS, useParental, type ParentalConfig } from '@/state/parental'
import { useSettings } from '@/state/settings'

// MARK: Cast

export function CastSection({ deviceName }: { deviceName: string }) {
  const enabled = useSettings((s) => s.settings.castReceiver)
  const update = useSettings((s) => s.update)
  return (
    <SettingsSection id="truyen-video" title="Truyền video" description="Truyền tới DVDTube trên TV hoặc máy tính khác trong cùng mạng Wi-Fi.">
      <ToggleRow
        title="Cho phép truyền video tới máy tính này"
        subtitle={`Điện thoại, TV và máy tính có DVDTube sẽ thấy "${deviceName || 'máy tính này'}" trong mục Truyền tới TV`}
        checked={enabled}
        onChange={(v) => update({ castReceiver: v })}
        testId="setting-cast-receiver"
      />
      <ButtonRow title="Truyền từ máy tính này" subtitle="Chọn TV hoặc máy tính có DVDTube để phát video trên đó">
        <button className="btn btn-tonal btn-small" onClick={() => useCast.getState().openPicker(null, 'play')}>
          <Icon name="cast" size={18} />
          Tìm thiết bị
        </button>
      </ButtonRow>
    </SettingsSection>
  )
}

// MARK: Music & DeArrow

export function MusicSection() {
  const s = useSettings((st) => st.settings)
  const update = useSettings((st) => st.update)
  return (
    <SettingsSection id="nghe-nhac" title="Nghe nhạc">
      <ToggleRow
        title="Chỉ phát âm thanh khi nghe nhạc"
        subtitle="Tiết kiệm dữ liệu; vẫn bật lại được hình cho từng bài"
        checked={s.musicAudioOnly}
        onChange={(v) => update({ musicAudioOnly: v })}
      />
    </SettingsSection>
  )
}

export function DeArrowSection() {
  const s = useSettings((st) => st.settings)
  const update = useSettings((st) => st.update)
  return (
    <SettingsSection id="dearrow" title="DeArrow" description="Tiêu đề và ảnh thu nhỏ do cộng đồng đề xuất (dearrow.ajay.app) — chỉ gửi 4 ký tự đầu của mã băm video.">
      <ToggleRow
        title="DeArrow: thay tiêu đề và ảnh giật tít"
        subtitle="Di chuột lên tiêu đề để xem tiêu đề gốc"
        checked={s.dearrow}
        onChange={(v) => update({ dearrow: v })}
        testId="setting-dearrow"
      />
      <ToggleRow title="Tiêu đề" checked={s.dearrowTitles} disabled={!s.dearrow} onChange={(v) => update({ dearrowTitles: v })} />
      <ToggleRow title="Ảnh thu nhỏ" checked={s.dearrowThumbnails} disabled={!s.dearrow} onChange={(v) => update({ dearrowThumbnails: v })} />
    </SettingsSection>
  )
}

// MARK: Sync & backup

export function SyncSection() {
  return (
    <SettingsSection
      id="dong-bo"
      title="Đồng bộ & sao lưu"
      description="Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nội dung tìm kiếm. Đồng bộ chỉ gộp thêm, không xóa gì."
    >
      <ButtonRow title="Xuất thư viện" subtitle="Lưu thành tệp DVDTube-thu-vien-…json (dùng được trên iPhone, Android, TV)">
        <button className="btn btn-tonal btn-small" onClick={() => void exportLibraryFile()}>
          <Icon name="upload" size={18} />
          Xuất thư viện
        </button>
      </ButtonRow>
      <ButtonRow title="Nhập thư viện" subtitle="Gộp một tệp thư viện vào thư viện trên máy này">
        <button className="btn btn-tonal btn-small" onClick={() => void importLibraryFile()}>
          <Icon name="download" size={18} />
          Nhập thư viện
        </button>
      </ButtonRow>
      <ButtonRow title="Đồng bộ qua mạng LAN" subtitle="Hiện mã QR để điện thoại quét; hai thiết bị sẽ có cùng một thư viện">
        <button className="btn btn-tonal btn-small" onClick={() => void useSyncDialog.getState().start()} data-testid="sync-lan">
          <Icon name="qr" size={18} />
          Hiện mã QR
        </button>
      </ButtonRow>
    </SettingsSection>
  )
}

// MARK: Parental controls

function limitLabel(minutes: number): string {
  if (!minutes) return 'Tắt'
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} giờ` : minutes > 60 ? `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : `${minutes} phút`
}

function KeywordsEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="setting-row setting-row--block">
      <div className="setting-text">
        <div className="setting-title">Chặn từ khóa</div>
        <div className="setting-subtitle">Video có tiêu đề hoặc tên kênh chứa các từ này bị ẩn khỏi mọi trang, tìm kiếm, video liên quan và Shorts (không phân biệt hoa thường, dấu)</div>
      </div>
      <textarea className="text-input parental-keywords" rows={3} placeholder="Ví dụ: kinh dị, đánh nhau, game bạo lực" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="setting-actions">
        <button className="btn btn-tonal btn-small" disabled={text === value} onClick={() => onSave(text)}>
          Lưu từ khóa
        </button>
      </div>
    </div>
  )
}

export function ParentalSection() {
  const config = useParental((s) => s.config)
  const usage = useParental((s) => s.usage)
  const unlockedUntil = useParental((s) => s.unlockedUntil)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])
  const unlocked = !config.enabled || unlockedUntil > now
  const change = async (patch: Partial<ParentalConfig>) => {
    if (!(await requireParentalPin())) return
    useParental.getState().update(patch)
  }

  if (!config.enabled) {
    return (
      <SettingsSection id="phu-huynh" title="Kiểm soát của phụ huynh" description="Chế độ hạn chế, giới hạn thời gian xem, khung giờ, chặn từ khóa và kênh — khóa bằng mã PIN.">
        <ButtonRow title="Bật kiểm soát của phụ huynh" subtitle="Bạn sẽ đặt một mã PIN gồm 4 chữ số để bảo vệ các cài đặt này">
          <button
            className="btn btn-accent btn-small"
            data-testid="parental-enable"
            onClick={async () => {
              const pin = await pinDialog({ title: 'Đặt mã PIN của phụ huynh', create: true, message: 'Mã PIN dùng để thay đổi các cài đặt này và mở khóa khi hết giờ xem. Hãy nhớ kỹ: không có cách khôi phục.' })
              if (!pin) return
              await useParental.getState().enable(pin)
              toast('Đã bật kiểm soát của phụ huynh')
            }}
          >
            <Icon name="lock" size={18} />
            Bật
          </button>
        </ButtonRow>
      </SettingsSection>
    )
  }

  const used = Math.floor(usage.seconds / 60)
  return (
    <SettingsSection id="phu-huynh" title="Kiểm soát của phụ huynh" description={`Hôm nay đã xem ${used} phút${config.dailyLimitMinutes ? ` / ${limitLabel(config.dailyLimitMinutes)}` : ''}.`}>
      {!unlocked && (
        <ButtonRow title="Các cài đặt đang được khóa" subtitle="Nhập mã PIN để thay đổi">
          <button className="btn btn-accent btn-small" onClick={() => void requireParentalPin('Nhập mã PIN để thay đổi kiểm soát của phụ huynh.')} data-testid="parental-unlock">
            <Icon name="lock" size={18} />
            Mở khóa
          </button>
        </ButtonRow>
      )}
      <ToggleRow
        title="Chế độ hạn chế"
        subtitle="Yêu cầu YouTube ẩn nội dung có thể không phù hợp với trẻ em (mọi yêu cầu, mọi trình phát)"
        checked={config.restricted}
        onChange={(v) => void change({ restricted: v })}
      />
      <SelectRow
        title="Giới hạn thời gian xem mỗi ngày"
        subtitle="Tính thời gian thực sự phát video và nhạc"
        value={config.dailyLimitMinutes}
        options={DAILY_LIMITS.map((m) => ({ value: m, label: limitLabel(m) }))}
        onChange={(v) => void change({ dailyLimitMinutes: v })}
      />
      <div className="setting-row">
        <div className="setting-text">
          <div className="setting-title">Khung giờ được xem</div>
          <div className="setting-subtitle">Ngoài khung giờ này DVDTube bị khóa</div>
        </div>
        <div className="setting-actions parental-window">
          <input
            className="text-input time-input"
            type="time"
            value={config.windowFrom}
            disabled={!config.windowEnabled}
            onChange={(e) => void change({ windowFrom: e.target.value || '07:00' })}
            aria-label="Từ"
          />
          <span className="muted">–</span>
          <input
            className="text-input time-input"
            type="time"
            value={config.windowTo}
            disabled={!config.windowEnabled}
            onChange={(e) => void change({ windowTo: e.target.value || '21:00' })}
            aria-label="Đến"
          />
          <Switch checked={config.windowEnabled} onChange={(v) => void change({ windowEnabled: v })} />
        </div>
      </div>
      <KeywordsEditor value={config.keywords} onSave={(v) => void change({ keywords: v })} />
      <ToggleRow title="Ẩn bình luận" checked={config.hideComments} onChange={(v) => void change({ hideComments: v })} />
      <ToggleRow title="Ẩn Shorts" checked={config.hideShorts} onChange={(v) => void change({ hideShorts: v })} />
      <ToggleRow title="Tắt tìm kiếm" checked={config.disableSearch} onChange={(v) => void change({ disableSearch: v })} />
      <ButtonRow title="Kênh bị chặn" subtitle="Quản lý trong mục Quyền riêng tư › Kênh không đề xuất (cần mã PIN để bỏ chặn)">
        <button className="btn btn-text btn-small" onClick={() => document.getElementById('quyen-rieng-tu')?.scrollIntoView({ behavior: 'smooth' })}>
          Xem
        </button>
      </ButtonRow>
      <ButtonRow title="Mã PIN" subtitle="Cần mã PIN khi thay đổi mục này, đăng nhập / đăng xuất hoặc tắt kiểm soát">
        <button
          className="btn btn-text btn-small"
          onClick={async () => {
            if (!(await requireParentalPin())) return
            const pin = await pinDialog({ title: 'Đổi mã PIN', create: true })
            if (pin) {
              await useParental.getState().changePin(pin)
              toast('Đã đổi mã PIN')
            }
          }}
        >
          Đổi mã PIN
        </button>
        <button className="btn btn-text btn-small" onClick={() => void forgotParentalPin()}>
          Quên mã PIN
        </button>
        <button
          className="btn btn-danger-outline btn-small"
          onClick={async () => {
            if (!(await requireParentalPin('Nhập mã PIN để tắt kiểm soát của phụ huynh.'))) return
            if (await confirmDialog({ title: 'Tắt kiểm soát của phụ huynh?', message: 'Mọi giới hạn và mã PIN sẽ bị xóa.', confirmLabel: 'Tắt', danger: true })) {
              useParental.getState().resetAll()
              toast('Đã tắt kiểm soát của phụ huynh')
            }
          }}
        >
          Tắt
        </button>
      </ButtonRow>
    </SettingsSection>
  )
}

// MARK: Alarms

function AlarmDialog({ alarm, onClose }: { alarm: Alarm; onClose: () => void }) {
  const playlists = useLibrary((s) => s.playlists)
  const [draft, setDraft] = useState<Alarm>(alarm)
  const [link, setLink] = useState(alarm.content.type === 'link' ? alarm.content.url : '')
  const contentKey = draft.content.type === 'playlist' ? `playlist:${draft.content.playlistId}` : draft.content.type
  const contents: { value: string; label: string }[] = [
    { value: 'watchLater', label: 'Xem sau' },
    { value: 'liked', label: 'Video đã thích' },
    { value: 'radio', label: 'Radio từ bài nghe gần nhất' },
    ...playlists.map((p) => ({ value: `playlist:${p.id}`, label: `Danh sách phát: ${p.name}` })),
    { value: 'link', label: 'Một liên kết YouTube' },
  ]
  const setContent = (key: string) => {
    let content: AlarmContent
    if (key.startsWith('playlist:')) {
      const id = key.slice(9)
      content = { type: 'playlist', playlistId: id, name: playlists.find((p) => p.id === id)?.name }
    } else if (key === 'link') content = { type: 'link', url: link }
    else content = { type: key as 'watchLater' | 'liked' | 'radio' }
    setDraft({ ...draft, content })
  }
  const save = () => {
    const content: AlarmContent = draft.content.type === 'link' ? { type: 'link', url: link.trim() } : draft.content
    if (content.type === 'link' && !content.url) {
      toast('Hãy dán một liên kết YouTube')
      return
    }
    useAlarms.getState().save({ ...draft, content, enabled: true, lastFired: draft.time !== alarm.time ? null : draft.lastFired, createdAt: draft.time !== alarm.time ? Date.now() : draft.createdAt })
    toast(`Đã đặt hẹn giờ phát lúc ${draft.time}`)
    onClose()
  }
  return (
    <Modal
      title="Hẹn giờ phát"
      onClose={onClose}
      width={460}
      testId="alarm-dialog"
      actions={
        <>
          <button className="btn btn-text" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-accent" onClick={save}>
            Lưu
          </button>
        </>
      }
    >
      <div className="alarm-form">
        <label className="field-label">
          Giờ phát
          <input className="text-input alarm-time" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value || '07:00' })} />
        </label>
        <div className="field-label">Lặp lại</div>
        <div className="chip-row">
          {(Object.keys(REPEAT_TITLES) as AlarmRepeat[]).map((r) => (
            <button key={r} className={'chip chip--small' + (draft.repeat === r ? ' is-selected' : '')} onClick={() => setDraft({ ...draft, repeat: r })}>
              {REPEAT_TITLES[r]}
            </button>
          ))}
        </div>
        <label className="field-label">
          Nội dung
          <select className="text-input" value={contentKey} onChange={(e) => setContent(e.target.value)}>
            {contents.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {draft.content.type === 'link' && <input className="text-input" placeholder="https://www.youtube.com/watch?v=…" value={link} onChange={(e) => setLink(e.target.value)} />}
        <CheckRow label="Tăng dần âm lượng trong 30 giây" checked={draft.fadeIn} onChange={(v) => setDraft({ ...draft, fadeIn: v })} />
        <CheckRow label="Chỉ phát âm thanh" checked={draft.audioOnly} onChange={(v) => setDraft({ ...draft, audioOnly: v })} />
      </div>
    </Modal>
  )
}

export function AlarmsSection() {
  const alarms = useAlarms((s) => s.alarms)
  const showWindow = useSettings((s) => s.settings.alarmShowWindow)
  const update = useSettings((s) => s.update)
  const [editing, setEditing] = useState<Alarm | null>(null)
  return (
    <SettingsSection id="hen-gio-phat" title="Hẹn giờ phát" description="Tự phát nhạc hoặc video vào giờ đã hẹn khi DVDTube đang chạy (kể cả khi thu nhỏ xuống khay hệ thống).">
      {alarms.map((a) => {
        const next = nextOccurrence(a)
        return (
          <div className="setting-row alarm-row" key={a.id} data-testid="alarm-row">
            <button className="alarm-main" onClick={() => setEditing(a)}>
              <span className={'alarm-time-big' + (a.enabled ? '' : ' is-off')}>{a.time}</span>
              <span className="setting-text">
                <span className="setting-title">{contentTitle(a.content)}</span>
                <span className="setting-subtitle">
                  {REPEAT_TITLES[a.repeat]}
                  {a.fadeIn ? ' • tăng dần âm lượng' : ''}
                  {a.audioOnly ? ' • chỉ âm thanh' : ''}
                  {next ? ` • lần tới ${next.toLocaleString('vi-VN', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
              </span>
            </button>
            <Switch checked={a.enabled} onChange={(v) => useAlarms.getState().save({ ...a, enabled: v, createdAt: v && a.repeat === 'once' ? Date.now() : a.createdAt })} />
            <button className="icon-btn" aria-label="Xóa hẹn giờ" title="Xóa" onClick={() => useAlarms.getState().remove(a.id)}>
              <Icon name="trash" size={20} />
            </button>
          </div>
        )
      })}
      <ButtonRow title={alarms.length ? 'Thêm hẹn giờ khác' : 'Chưa có hẹn giờ nào'} subtitle="Ví dụ: nhạc báo thức 6:30 các ngày thường">
        <button className="btn btn-tonal btn-small" onClick={() => setEditing(newAlarm())} data-testid="alarm-add">
          <Icon name="alarm" size={18} />
          Thêm hẹn giờ
        </button>
      </ButtonRow>
      <ToggleRow title="Hiện cửa sổ khi đến giờ" subtitle="Đưa DVDTube lên trước khi bắt đầu phát" checked={showWindow} onChange={(v) => update({ alarmShowWindow: v })} />
      {editing && <AlarmDialog alarm={editing} onClose={() => setEditing(null)} />}
    </SettingsSection>
  )
}

// MARK: Automatic downloads

function ChannelPicker({ value, onChange, onClose }: { value: AutoDownloadSettings['channels']; onChange: (v: AutoDownloadSettings['channels']) => void; onClose: () => void }) {
  const local = useLibrary((s) => s.subscriptions)
  const signedIn = useAccount((s) => s.signedIn)
  const [account, setAccount] = useState<ChannelItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState(() => new Map(value.map((c) => [c.id, c])))
  useEffect(() => {
    if (!signedIn) return
    setLoading(true)
    api
      .accountSubscriptions()
      .then(setAccount)
      .catch(() => setAccount([]))
      .finally(() => setLoading(false))
  }, [signedIn])
  const all = [...local, ...(account ?? []).filter((c) => !local.some((l) => l.id === c.id))]
  const toggle = (c: ChannelItem, on: boolean) => {
    const next = new Map(picked)
    if (on) next.set(c.id, { id: c.id, name: c.name, avatar: c.avatar ?? null })
    else next.delete(c.id)
    setPicked(next)
  }
  return (
    <Modal
      title="Kênh tự động tải"
      onClose={onClose}
      width={460}
      testId="auto-download-channels"
      actions={
        <>
          <span className="muted small toolbar-spacer">Đã chọn {picked.size} kênh</span>
          <button className="btn btn-text" onClick={onClose}>
            Hủy
          </button>
          <button
            className="btn btn-accent"
            onClick={() => {
              onChange([...picked.values()])
              onClose()
            }}
          >
            Lưu
          </button>
        </>
      }
    >
      <div className="channel-pick-list">
        {all.map((c) => (
          <label key={c.id} className="channel-pick">
            <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => toggle(c, e.target.checked)} />
            <Avatar src={c.avatar} name={c.name} size={32} />
            <span>{c.name}</span>
          </label>
        ))}
        {loading && <Spinner size={24} />}
        {!all.length && !loading && <p className="muted">Chưa có kênh đăng ký nào. Nhấn Đăng ký trên trang kênh hoặc nhập kênh từ tài khoản.</p>}
      </div>
    </Modal>
  )
}

export function AutoDownloadRows() {
  const auto = useSettings((s) => s.settings.autoDownload)
  const quality = useSettings((s) => s.settings.downloadQuality)
  const update = useSettings((s) => s.update)
  const [picking, setPicking] = useState(false)
  const set = (patch: Partial<AutoDownloadSettings>) => update({ autoDownload: { ...auto, ...patch } })
  return (
    <>
      <ToggleRow
        title="Tự động tải video mới"
        subtitle={`Video mới của các kênh đã chọn (không gồm Shorts, trực tiếp), chất lượng ${quality}p, kiểm tra mỗi giờ khi DVDTube đang chạy`}
        checked={auto.enabled}
        onChange={(v) => set({ enabled: v })}
        testId="setting-auto-download"
      />
      {auto.enabled && (
        <>
          <ButtonRow title="Kênh" subtitle={auto.channels.length ? auto.channels.map((c) => c.name).slice(0, 4).join(', ') + (auto.channels.length > 4 ? ` và ${auto.channels.length - 4} kênh khác` : '') : 'Chưa chọn kênh nào'}>
            <button className="btn btn-tonal btn-small" onClick={() => setPicking(true)}>
              Chọn kênh ({auto.channels.length})
            </button>
          </ButtonRow>
          <SelectRow
            title="Giữ tối đa N video mỗi kênh"
            subtitle="Video tự động tải cũ hơn sẽ được xóa (video bạn tự tải không bao giờ bị xóa)"
            value={auto.keep}
            options={[1, 2, 3, 5, 10, 20].map((n) => ({ value: n, label: `${n} video` }))}
            onChange={(v) => set({ keep: v })}
          />
          <ToggleRow title="Chỉ khi dùng Wi-Fi" subtitle="Không tải khi máy chỉ có kết nối di động" checked={auto.wifiOnly} onChange={(v) => set({ wifiOnly: v })} />
          <ToggleRow title="Chỉ âm thanh" checked={auto.audioOnly} onChange={(v) => set({ audioOnly: v })} />
          <ButtonRow title="Kiểm tra ngay">
            <button
              className="btn btn-text btn-small"
              disabled={!auto.channels.length}
              onClick={() =>
                api
                  .runAutoDownloads()
                  .then(() => toast('Đã kiểm tra video mới'))
                  .catch((e) => toast(errorMessage(e)))
              }
            >
              <Icon name="refresh" size={18} />
              Kiểm tra
            </button>
          </ButtonRow>
        </>
      )}
      {picking && <ChannelPicker value={auto.channels} onChange={(channels) => set({ channels })} onClose={() => setPicking(false)} />}
    </>
  )
}

// MARK: Error log

export function ErrorLogRow() {
  return (
    <ButtonRow title="Gửi nhật ký lỗi" subtitle="Tạo tệp nhật ký (đã xóa cookie, tài khoản, email) để gửi khi gặp lỗi">
      <button className="btn btn-tonal btn-small" onClick={() => void saveErrorLog()} data-testid="save-log">
        <Icon name="bug" size={18} />
        Lưu tệp…
      </button>
      <button className="btn btn-text btn-small" onClick={() => void copyErrorLog()}>
        <Icon name="copy" size={18} />
        Sao chép
      </button>
    </ButtonRow>
  )
}
