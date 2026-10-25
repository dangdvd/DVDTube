// Cài đặt (like the Android TV settings): playback, captions, SponsorBlock, language / region,
// the cast receiver, music and DeArrow, library sync, parental controls, privacy, and "Giới
// thiệu" with the update check (a webOS app cannot install itself: it shows the new version and
// how to install it).

import type { SyncInfo, SyncStatus } from '@shared/api'
import { SPONSOR_CATEGORIES } from '@shared/models'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, apiMode, onEvent, type ServiceInfo } from '../api'
import { clearCache } from '../hooks'
import { KEY, isBackKey } from '../platform'
import { useInitialFocus, useScreenKeys } from '../screen'
import { libraryStore, library } from '../state/library'
import { nav, toast } from '../state/nav'
import { DAILY_LIMITS, parental, parentalStore, watchedTodayText } from '../state/parental'
import {
  CAPTION_SIZES,
  LANGUAGES,
  QUALITIES,
  REGIONS,
  languageName,
  qualityTitle,
  settingsStore,
  updateSettings,
  type TvSettings,
} from '../state/settings'
import { useStore } from '../store'
import { Button, Loading, OptionRow, ScreenTitle, SectionTitle } from '../ui/base'
import { alertDialog, choose, confirm, newPinDialog, openDialog } from '../ui/dialogs'
import { forgotParentalPin, requirePin } from './parentalGuard'

declare const __APP_VERSION__: string
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0'

const onOff = (v: boolean) => (v ? 'Bật' : 'Tắt')

export function SettingsScreen() {
  const s = useStore(settingsStore)
  const historyCount = useStore(libraryStore, (l) => l.history.length)
  const searchCount = useStore(libraryStore, (l) => l.searchHistory.length)
  const parentalOn = useStore(parentalStore, (p) => p.config.enabled)
  const [service, setService] = useState<ServiceInfo | null>(null)
  const [checking, setChecking] = useState(false)
  useInitialFocus(true)

  useEffect(() => {
    api.appInfo().then(setService).catch(() => {})
  }, [s.castReceiver, s.deviceName])

  const set = (patch: Partial<TvSettings>) => updateSettings(patch)

  return (
    <div class="page settings" data-scroll="y" data-testid="settings-page">
      <ScreenTitle title="Cài đặt" />
      <div class="option-list narrow">
        <SectionTitle>Phát video</SectionTitle>
        <OptionRow
          title="Chất lượng mặc định"
          value={qualityTitle(s.defaultQuality)}
          icon="quality"
          autofocus
          onClick={async () => {
            const list = QUALITIES
            const i = await choose('Chất lượng mặc định', list.map((q) => ({ label: q.title, selected: q.height === s.defaultQuality })))
            if (i !== null) set({ defaultQuality: list[i].height })
          }}
        />
        <OptionRow title="Tự động phát video tiếp theo" value={onOff(s.autoplayNext)} icon="next" onClick={() => set({ autoplayNext: !s.autoplayNext })} />
        <OptionRow title="Tiếp tục từ chỗ đã xem" value={onOff(s.resumePlayback)} icon="history" onClick={() => set({ resumePlayback: !s.resumePlayback })} />
        <OptionRow
          title="Bỏ qua đoạn tài trợ (SponsorBlock)"
          subtitle="Tự bỏ qua quảng cáo do người làm video lồng vào"
          value={onOff(s.sponsorBlock)}
          icon="forward"
          onClick={() => set({ sponsorBlock: !s.sponsorBlock })}
        />
        {s.sponsorBlock && (
          <OptionRow
            title="Loại đoạn được bỏ qua"
            value={`${s.sponsorCategories.length} loại`}
            indent
            onClick={async () => {
              for (;;) {
                const current = settingsStore.get().sponsorCategories
                const i = await choose(
                  'Loại đoạn được bỏ qua',
                  SPONSOR_CATEGORIES.map((c) => ({ label: c.title, selected: current.includes(c.id) })),
                )
                if (i === null) return
                const id = SPONSOR_CATEGORIES[i].id
                updateSettings({ sponsorCategories: current.includes(id) ? current.filter((c) => c !== id) : [...current, id] })
              }
            }}
          />
        )}

        <SectionTitle>Phụ đề</SectionTitle>
        <OptionRow title="Phụ đề" value={onOff(s.captionsEnabled)} icon="captions" onClick={() => set({ captionsEnabled: !s.captionsEnabled })} />
        <OptionRow
          title="Ngôn ngữ phụ đề"
          value={languageName(s.captionLanguage)}
          icon="language"
          onClick={async () => {
            const i = await choose('Ngôn ngữ phụ đề', LANGUAGES.map(([code, name]) => ({ label: name, selected: s.captionLanguage === code })))
            if (i !== null) set({ captionLanguage: LANGUAGES[i][0] })
          }}
        />
        <OptionRow
          title="Cỡ chữ phụ đề"
          value={CAPTION_SIZES.find((c) => c.id === s.captionSize)?.title ?? 'Bình thường'}
          icon="title"
          onClick={async () => {
            const i = await choose('Cỡ chữ phụ đề', CAPTION_SIZES.map((c) => ({ label: c.title, selected: c.id === s.captionSize })))
            if (i !== null) set({ captionSize: CAPTION_SIZES[i].id })
          }}
        />

        <SectionTitle>Ngôn ngữ và khu vực</SectionTitle>
        <OptionRow
          title="Ngôn ngữ nội dung"
          value={languageName(s.language)}
          icon="language"
          onClick={async () => {
            const i = await choose('Ngôn ngữ nội dung', LANGUAGES.map(([code, name]) => ({ label: name, selected: s.language === code })))
            if (i !== null) {
              set({ language: LANGUAGES[i][0] })
              clearCache()
            }
          }}
        />
        <OptionRow
          title="Khu vực"
          value={REGIONS.find(([c]) => c === s.region)?.[1] ?? s.region}
          icon="language"
          onClick={async () => {
            const i = await choose('Khu vực', REGIONS.map(([code, name]) => ({ label: name, selected: s.region === code })))
            if (i !== null) {
              set({ region: REGIONS[i][0] })
              clearCache()
            }
          }}
        />

        <SectionTitle>Truyền tới DVDTube</SectionTitle>
        <OptionRow
          title="Nhận video truyền từ điện thoại và máy tính"
          value={onOff(s.castReceiver)}
          icon="cast"
          subtitle={
            s.castReceiver && service?.castRunning
              ? `Tên: ${service.deviceName}${service.castPort ? ` • Cổng: ${service.castPort}` : ''}`
              : 'Điện thoại / máy tính cùng mạng Wi-Fi chọn "Truyền tới TV" để phát trên TV này'
          }
          onClick={() => set({ castReceiver: !s.castReceiver })}
        />
        <OptionRow
          title="Tên TV"
          value={s.deviceName || service?.deviceName || 'LG webOS TV'}
          icon="tv"
          onClick={async () => {
            const name = await inputDialog('Tên TV', s.deviceName || service?.deviceName || '', 'Tên hiện trên điện thoại và máy tính khi truyền video hoặc đồng bộ.')
            if (name !== null) set({ deviceName: name.trim().slice(0, 60) })
          }}
        />

        <SectionTitle>Nghe nhạc và DeArrow</SectionTitle>
        <OptionRow title="Chỉ phát âm thanh khi nghe nhạc" value={onOff(s.musicAudioOnly)} icon="music" onClick={() => set({ musicAudioOnly: !s.musicAudioOnly })} />
        <OptionRow
          title="DeArrow: thay tiêu đề và ảnh giật tít"
          subtitle="Tiêu đề và ảnh thu nhỏ do cộng đồng sửa lại (dearrow.ajay.app)"
          value={onOff(s.dearrow)}
          icon="title"
          onClick={() => set({ dearrow: !s.dearrow })}
        />
        {s.dearrow && <OptionRow title="Tiêu đề" value={onOff(s.dearrowTitles)} indent onClick={() => set({ dearrowTitles: !s.dearrowTitles })} />}
        {s.dearrow && <OptionRow title="Ảnh thu nhỏ" value={onOff(s.dearrowThumbnails)} indent onClick={() => set({ dearrowThumbnails: !s.dearrowThumbnails })} />}

        <SectionTitle>Đồng bộ và phụ huynh</SectionTitle>
        <OptionRow title="Đồng bộ thư viện" subtitle="Gộp thư viện với điện thoại hoặc máy tính bằng mã QR" icon="sync" onClick={() => nav.open({ name: 'sync' })} testid="open-sync" />
        <OptionRow
          title="Kiểm soát của phụ huynh"
          value={onOff(parentalOn)}
          icon="lock"
          onClick={async () => {
            if (await requirePin('Nhập mã PIN để mở Kiểm soát của phụ huynh')) nav.open({ name: 'parental' })
          }}
        />

        <SectionTitle>Nhật ký và quyền riêng tư</SectionTitle>
        <OptionRow
          title="Chế độ ẩn danh"
          subtitle="Không lưu video đã xem và tìm kiếm cho tới khi mở lại ứng dụng"
          value={onOff(s.incognito)}
          icon="incognito"
          onClick={() => set({ incognito: !s.incognito })}
        />
        <OptionRow title="Tạm dừng nhật ký xem" value={onOff(s.pauseWatchHistory)} icon="history" onClick={() => set({ pauseWatchHistory: !s.pauseWatchHistory })} />
        <OptionRow title="Tạm dừng nhật ký tìm kiếm" value={onOff(s.pauseSearchHistory)} icon="search" onClick={() => set({ pauseSearchHistory: !s.pauseSearchHistory })} />
        <OptionRow
          title="Xóa nhật ký xem"
          value={`${historyCount} video`}
          icon="delete"
          onClick={async () => {
            if (await confirm('Xóa toàn bộ nhật ký xem trên TV này?', { confirmLabel: 'Xóa', danger: true })) {
              library.clearHistory()
              toast('Đã xóa nhật ký xem')
            }
          }}
        />
        <OptionRow
          title="Xóa nhật ký tìm kiếm"
          value={`${searchCount}`}
          icon="delete"
          onClick={async () => {
            if (await confirm('Xóa nhật ký tìm kiếm?', { confirmLabel: 'Xóa', danger: true })) {
              library.clearSearchHistory()
              toast('Đã xóa nhật ký tìm kiếm')
            }
          }}
        />

        <SectionTitle>Giới thiệu</SectionTitle>
        <OptionRow
          title="DVDTube cho LG webOS TV"
          value={APP_VERSION}
          icon="info"
          subtitle="Ứng dụng không chính thức, không liên kết với Google/YouTube"
          onClick={() => nav.open({ name: 'about' })}
        />
        <OptionRow title="Tự kiểm tra cập nhật" subtitle="Mỗi ngày tối đa một lần, khi mở ứng dụng" value={onOff(s.checkUpdates)} icon="update" onClick={() => set({ checkUpdates: !s.checkUpdates })} />
        <OptionRow
          title="Kiểm tra cập nhật"
          value={checking ? 'Đang kiểm tra…' : null}
          icon="refresh"
          testid="check-update"
          onClick={async () => {
            setChecking(true)
            try {
              await showUpdate(true)
            } finally {
              setChecking(false)
            }
          }}
        />
      </div>
    </div>
  )
}

// MARK: Updates

export async function showUpdate(manual: boolean): Promise<void> {
  let result
  try {
    result = await api.checkUpdate()
  } catch (error) {
    if (manual) void alertDialog('Không kiểm tra được bản cập nhật', error instanceof Error ? error.message : String(error))
    return
  }
  if (!result.newer) {
    if (manual) void alertDialog('Bạn đang dùng bản mới nhất', `DVDTube ${result.current}${result.latest ? ` • bản phát hành mới nhất: v${result.latest}` : ''}`)
    return
  }
  const steps = [
    `Bạn đang dùng v${result.current}.`,
    '',
    'Cách cài bản mới (ứng dụng ở chế độ nhà phát triển không tự cập nhật được):',
    `1. Trên máy tính, tải DVDTube-webOS.ipk từ trang phát hành:\n${result.url}`,
    '2. Cài lên TV bằng webOS Dev Manager hoặc lệnh: ares-install DVDTube-webOS.ipk',
    '3. Bản mới cài đè lên bản hiện tại, cài đặt và thư viện được giữ nguyên.',
  ].join('\n')
  await alertDialog(`Có bản mới v${result.latest}`, steps + (result.notes ? `\n\n${result.notes}` : ''), undefined, 980)
}

// MARK: Text input

export function inputDialog(title: string, initial: string, hint?: string, multiline = false): Promise<string | null> {
  return openDialog<string>((close) => <InputDialog title={title} initial={initial} hint={hint} close={close} multiline={multiline} />, 900)
}

function InputDialog(props: { title: string; initial: string; hint?: string; close: (v: string | null) => void; multiline: boolean }) {
  const [value, setValue] = useState(props.initial)
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useScreenKeys((event) => {
    if (document.activeElement !== input.current) return false
    if (event.keyCode === KEY.ENTER && !props.multiline) {
      props.close(input.current?.value ?? value)
      return true
    }
    if (isBackKey(event) || event.keyCode === KEY.DOWN) {
      input.current?.blur()
      const field = input.current?.parentElement
      if (field) (field as HTMLElement).focus()
      return true
    }
    return false
  }, 120)
  return (
    <div class="dialog-body">
      <div class="dialog-title">{props.title}</div>
      {props.hint && <div class="dialog-message">{props.hint}</div>}
      <div class="search-field input" data-f tabIndex={-1} data-key="input-field" data-autofocus onClick={() => input.current?.focus()}>
        {props.multiline ? (
          <textarea ref={input} value={value} rows={3} onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)} />
        ) : (
          <input ref={input} type="text" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
        )}
      </div>
      <div class="dialog-buttons">
        <Button label="Lưu" accent onClick={() => props.close(input.current?.value ?? value)} />
        <Button label="Hủy" onClick={() => props.close(null)} />
      </div>
    </div>
  )
}

// MARK: Parental controls

export function ParentalScreen() {
  const { config } = useStore(parentalStore)
  useInitialFocus(true)
  const update = (patch: Parameters<typeof parental.update>[0]) => parental.update(patch)

  if (!config.enabled) {
    return (
      <div class="page" data-scroll="y" data-testid="parental-page">
        <ScreenTitle
          title="Kiểm soát của phụ huynh"
          subtitle="Bảo vệ bằng mã PIN 4 chữ số: chế độ hạn chế, giới hạn thời gian xem mỗi ngày, khung giờ được xem, chặn từ khóa và kênh, ẩn Shorts, tắt tìm kiếm."
        />
        <div class="button-row" data-group>
          <Button
            label="Bật và đặt mã PIN"
            icon="lock"
            accent
            autofocus
            onClick={async () => {
              const pin = await newPinDialog()
              if (!pin) return
              parental.enable(pin)
              toast('Đã bật kiểm soát của phụ huynh')
            }}
          />
        </div>
      </div>
    )
  }

  const limitTitle = (m: number) => (m === 0 ? 'Tắt' : m < 60 ? `${m} phút` : m % 60 === 0 ? `${m / 60} giờ` : `${Math.floor(m / 60)} giờ ${m % 60} phút`)
  const words = config.keywords.split(/[,\n;]/).filter((w) => w.trim()).length
  const blocked = libraryStore.get().blockedChannels.length

  return (
    <div class="page" data-scroll="y" data-testid="parental-page">
      <ScreenTitle title="Kiểm soát của phụ huynh" subtitle={`Đang bật. Hôm nay đã xem ${watchedTodayText()}.`} />
      <div class="option-list narrow">
        <OptionRow title="Chế độ hạn chế" subtitle="Ẩn nội dung YouTube đánh dấu là không phù hợp" value={onOff(config.restricted)} icon="shield" autofocus onClick={() => update({ restricted: !config.restricted })} />
        <OptionRow
          title="Giới hạn thời gian xem mỗi ngày"
          value={limitTitle(config.dailyLimitMinutes)}
          icon="later"
          onClick={async () => {
            const i = await choose('Giới hạn thời gian xem mỗi ngày', DAILY_LIMITS.map((m) => ({ label: limitTitle(m), selected: m === config.dailyLimitMinutes })))
            if (i !== null) update({ dailyLimitMinutes: DAILY_LIMITS[i] })
          }}
        />
        <OptionRow
          title="Khung giờ được xem"
          value={config.windowEnabled ? `${config.windowFrom} – ${config.windowTo}` : 'Tắt'}
          icon="sleep"
          onClick={async () => {
            const i = await choose('Khung giờ được xem', [
              { label: config.windowEnabled ? 'Tắt khung giờ' : 'Bật khung giờ', selected: config.windowEnabled },
              { label: 'Được xem từ', value: config.windowFrom },
              { label: 'Được xem đến', value: config.windowTo },
            ])
            if (i === 0) update({ windowEnabled: !config.windowEnabled })
            else if (i === 1 || i === 2) {
              const times = Array.from({ length: 48 }, (_, k) => `${String(Math.floor(k / 2)).padStart(2, '0')}:${k % 2 ? '30' : '00'}`)
              const current = i === 1 ? config.windowFrom : config.windowTo
              const t = await choose(i === 1 ? 'Được xem từ' : 'Được xem đến', times.map((x) => ({ label: x, selected: x === current })), 520)
              if (t !== null) update(i === 1 ? { windowFrom: times[t], windowEnabled: true } : { windowTo: times[t], windowEnabled: true })
            }
          }}
        />
        <OptionRow
          title="Chặn từ khóa"
          subtitle="Ngăn cách các từ bằng dấu phẩy. Không phân biệt hoa thường và dấu."
          value={words ? `${words} từ` : 'Chưa có'}
          icon="hide"
          onClick={async () => {
            const text = await inputDialog('Chặn từ khóa', config.keywords, 'Ngăn cách các từ bằng dấu phẩy. Không phân biệt hoa thường và dấu.')
            if (text !== null) update({ keywords: text })
          }}
        />
        <OptionRow
          title="Chặn kênh"
          value={blocked ? `${blocked} kênh` : 'Chưa có'}
          subtitle={blocked ? 'Chọn để bỏ chặn tất cả.' : null}
          icon="hide"
          onClick={async () => {
            if (blocked && (await confirm('Bỏ chặn tất cả kênh?', { confirmLabel: 'Bỏ chặn' }))) library.unblockAll()
          }}
        />
        <OptionRow title="Ẩn Shorts" value={onOff(config.hideShorts)} icon="shorts" onClick={() => update({ hideShorts: !config.hideShorts })} />
        <OptionRow title="Tắt tìm kiếm" value={onOff(config.disableSearch)} icon="search" onClick={() => update({ disableSearch: !config.disableSearch })} />
        <OptionRow
          title="Đổi mã PIN"
          icon="lock"
          onClick={async () => {
            const pin = await newPinDialog()
            if (pin) {
              parental.changePin(pin)
              toast('Đã đổi mã PIN')
            }
          }}
        />
        <OptionRow
          title="Khóa lại ngay"
          icon="lock"
          onClick={() => {
            parentalStore.set({ unlockedUntil: 0 })
            nav.back()
          }}
        />
        <OptionRow
          title="Tắt kiểm soát của phụ huynh"
          icon="close"
          danger
          onClick={async () => {
            if (await confirm('Tắt kiểm soát của phụ huynh?', { confirmLabel: 'Tắt', danger: true })) {
              parental.resetAll()
              toast('Đã tắt kiểm soát của phụ huynh')
            }
          }}
        />
        <OptionRow title="Quên mã PIN" icon="info" onClick={() => void forgotParentalPin()} />
      </div>
    </div>
  )
}

// MARK: Library sync

export function SyncScreen() {
  const [generation, setGeneration] = useState(0)
  const [info, setInfo] = useState<SyncInfo | null>(null)
  const [status, setStatus] = useState<SyncStatus>({ state: 'waiting' })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setInfo(null)
    setError(null)
    setStatus({ state: 'waiting' })
    api.startSyncReceiver().then(
      (i) => alive && setInfo(i),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    const off = onEvent('syncStatus', (s) => alive && setStatus(s))
    return () => {
      alive = false
      off()
      api.stopSyncReceiver().catch(() => {})
    }
  }, [generation])
  useInitialFocus(true)
  const done = status.state === 'success'
  return (
    <div class="page pairing" data-testid="sync-page">
      <div class="qr-box">
        {done ? (
          <div class="qr-done">✓</div>
        ) : status.state === 'expired' ? (
          <div class="qr-text">Mã đã hết hạn</div>
        ) : status.state === 'merging' ? (
          <Loading label="Đang đồng bộ…" />
        ) : info ? (
          <img src={info.qrDataUrl} alt="Mã QR đồng bộ" data-testid="sync-qr" />
        ) : error ? (
          <div class="qr-text small">{error}</div>
        ) : (
          <Loading />
        )}
      </div>
      <div class="pairing-text">
        <h1>{done ? 'Đã đồng bộ' : 'Đồng bộ thư viện'}</h1>
        {done && status.state === 'success' ? (
          <div class="screen-subtitle">{`${status.device}: ${status.summary}`}</div>
        ) : (
          <>
            <div class="pairing-note big">
              Quét mã bằng DVDTube trên điện thoại (Cài đặt › Đồng bộ &amp; sao lưu › Quét mã QR) hoặc Camera trên iPhone. Hai thiết bị phải cùng mạng Wi-Fi.
            </div>
            <div class="pairing-note">Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nhật ký tìm kiếm của hai thiết bị được gộp lại; không xóa gì.</div>
            {info && <div class="pairing-note">{`Địa chỉ TV: ${info.host} • ${info.deviceName}`}</div>}
            {status.state === 'failed' && <div class="error-text">{status.message}</div>}
          </>
        )}
        <div class="button-row" data-group>
          {done ? <Button label="Xong" accent autofocus onClick={() => nav.back()} /> : <Button label="Tạo mã mới" icon="refresh" autofocus onClick={() => setGeneration((g) => g + 1)} />}
        </div>
      </div>
    </div>
  )
}

// MARK: About

export function AboutScreen() {
  const [service, setService] = useState<ServiceInfo | null>(null)
  useEffect(() => {
    api.appInfo().then(setService).catch(() => {})
  }, [])
  useInitialFocus(true)
  return (
    <div class="page" data-scroll="y" data-testid="about-page">
      <ScreenTitle title="DVDTube cho LG webOS TV" subtitle="Ứng dụng không chính thức, không liên kết với Google/YouTube" />
      <div class="option-list narrow">
        <OptionRow title="Phiên bản" value={APP_VERSION} icon="info" autofocus />
        <OptionRow title="Dịch vụ trên TV" value={service ? `${service.version} • Node.js ${service.node ?? '?'}` : apiMode() === 'mock' ? 'Chế độ mẫu' : '…'} icon="tv" />
        <OptionRow title="Tên TV" value={service?.deviceName ?? '…'} icon="cast" />
        <OptionRow title="Kiểm tra cập nhật" icon="refresh" onClick={() => void showUpdate(true)} />
      </div>
    </div>
  )
}
