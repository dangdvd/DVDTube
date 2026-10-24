// Cài đặt (/settings): every option of AppSettings, grouped like the mobile apps, with a
// section index on the left. Everything writes through `useSettings().update(patch)`.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppInfo } from '@shared/api'
import { SPONSOR_CATEGORIES } from '@shared/models'
import type { AppSettings, QualityPreference } from '@shared/settings'
import { EqualizerPanel } from '@/player/EqualizerPanel'
import { Icon } from '@/components/Icon'
import { ButtonRow, CheckRow, SelectRow, SettingsSection, SliderRow, ToggleRow } from '@/components/SettingRows'
import { THEME_TITLES } from '@/components/shell/AccountMenu'
import { useScrollRoot } from '@/components/InfiniteScroll'
import { api, errorMessage } from '@/lib/api'
import { confirmDialog, promptDialog } from '@/lib/dialogs'
import { loadPrefs, usePrefs } from '@/lib/prefs'
import { usePageTitle } from '@/lib/title'
import { toast } from '@/lib/toast'
import { useLibrary } from '@/state/library'
import { useSettings } from '@/state/settings'

export const LANGUAGES = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh-Hans', label: '中文' },
]

const REGIONS = [
  { value: 'VN', label: 'Việt Nam' },
  { value: 'US', label: 'Hoa Kỳ' },
  { value: 'JP', label: 'Nhật Bản' },
  { value: 'KR', label: 'Hàn Quốc' },
  { value: 'GB', label: 'Vương quốc Anh' },
  { value: 'FR', label: 'Pháp' },
  { value: 'DE', label: 'Đức' },
  { value: 'TH', label: 'Thái Lan' },
  { value: 'SG', label: 'Singapore' },
  { value: 'AU', label: 'Úc' },
  { value: 'CA', label: 'Canada' },
  { value: 'IN', label: 'Ấn Độ' },
]

const QUALITIES: { value: QualityPreference; label: string }[] = [
  { value: 0, label: 'Tự động' },
  { value: 4320, label: '4320p (8K)' },
  { value: 2160, label: '2160p (4K)' },
  { value: 1440, label: '1440p' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
  { value: 240, label: '240p' },
  { value: 144, label: '144p' },
]

const CODECS: { value: AppSettings['preferredCodec']; label: string }[] = [
  { value: 'auto', label: 'Tự động' },
  { value: 'av1', label: 'AV1 (tiết kiệm dữ liệu)' },
  { value: 'vp9', label: 'VP9' },
  { value: 'h264', label: 'H.264 (nhẹ máy nhất)' },
]

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4].map((v) => ({ value: v, label: v === 1 ? 'Chuẩn' : `${String(v).replace('.', ',')}×` }))
const SEEK_STEPS = [5, 10, 15, 20, 30, 60].map((v) => ({ value: v, label: `${v} giây` }))
const CAPTION_SIZES = [
  { value: 80, label: 'Nhỏ' },
  { value: 100, label: 'Bình thường' },
  { value: 130, label: 'Lớn' },
  { value: 160, label: 'Rất lớn' },
]
const CAPTION_BACKGROUNDS = [
  { value: 0, label: 'Không có' },
  { value: 0.5, label: 'Mờ' },
  { value: 0.75, label: 'Đậm' },
  { value: 1, label: 'Đen' },
]
const DOWNLOAD_QUALITIES: { value: AppSettings['downloadQuality']; label: string }[] = [
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
]

const SHORTCUTS: [string, string][] = [
  ['Space / K', 'Phát / tạm dừng (giữ Space: tốc độ 2× trong lúc giữ)'],
  ['J / L', 'Tua lại / tua tới 10 giây'],
  ['← / →', 'Tua lại / tua tới theo "Bước tua"'],
  ['↑ / ↓', 'Tăng / giảm âm lượng 5%'],
  ['M', 'Tắt / bật tiếng'],
  ['F', 'Toàn màn hình'],
  ['T', 'Chế độ rạp chiếu'],
  ['I', 'Trình phát thu nhỏ'],
  ['C', 'Bật / tắt phụ đề'],
  ['Shift + < / Shift + >', 'Giảm / tăng tốc độ 0,25×'],
  [', / .', 'Lùi / tiến một khung hình (khi tạm dừng)'],
  ['0 – 9', 'Tua tới 0% – 90% video'],
  ['Home / End', 'Về đầu / cuối video'],
  ['Shift + N / Shift + P', 'Video tiếp theo / video trước'],
  ['Esc', 'Thoát toàn màn hình'],
  ['Ctrl + K hoặc /', 'Tìm kiếm'],
  ['Alt + ← / Alt + →', 'Quay lại / tiến tới'],
  ['F5', 'Tải lại nội dung trang'],
  ['Ctrl + V', 'Mở đường liên kết YouTube vừa sao chép'],
]

const SECTIONS = [
  { id: 'chung', title: 'Chung', icon: 'globe' },
  { id: 'phat-video', title: 'Phát video', icon: 'play' },
  { id: 'phu-de', title: 'Phụ đề', icon: 'captions' },
  { id: 'sponsorblock', title: 'SponsorBlock', icon: 'shield' },
  { id: 'bo-chinh-am', title: 'Bộ chỉnh âm', icon: 'equalizer' },
  { id: 'trang-chu', title: 'Trang chủ & bình luận', icon: 'home' },
  { id: 'quyen-rieng-tu', title: 'Quyền riêng tư', icon: 'lock' },
  { id: 'tai-xuong', title: 'Tải xuống', icon: 'download' },
  { id: 'ung-dung', title: 'Ứng dụng', icon: 'monitor' },
  { id: 'phim-tat', title: 'Phím tắt', icon: 'keyboard' },
  { id: 'gioi-thieu', title: 'Giới thiệu', icon: 'info' },
] as const

function audioLanguages() {
  return [{ value: null as string | null, label: 'Bản gốc' }, ...LANGUAGES.map((l) => ({ value: l.value as string | null, label: l.label }))]
}

function CaptionPreview({ size, background }: { size: number; background: number }) {
  return (
    <div className="caption-preview" aria-hidden>
      <span style={{ fontSize: `${(18 * size) / 100}px`, background: `rgba(8, 8, 8, ${background})` }}>Xin chào! Đây là phụ đề mẫu.</span>
    </div>
  )
}

export function SettingsPage() {
  const s = useSettings((st) => st.settings)
  const update = useSettings((st) => st.update)
  const history = useLibrary((st) => st.history.length)
  const searches = useLibrary((st) => st.searchHistory.length)
  const notInterested = useLibrary((st) => st.notInterested.length)
  const blocked = useLibrary((st) => st.blockedChannels)
  const blockedNames = useLibrary((st) => st.blockedChannelNames)
  const startWithWindows = usePrefs((st) => st.startWithWindows)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [current, setCurrent] = useState<string>('chung')
  const location = useLocation()
  const root = useScrollRoot()
  usePageTitle('Cài đặt')

  useEffect(() => {
    void loadPrefs()
    api
      .appInfo()
      .then(setInfo)
      .catch(() => {})
  }, [])

  // Jump to /settings#section.
  useEffect(() => {
    const id = location.hash.slice(1)
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50)
  }, [location.hash])

  // Highlight the section being read in the index.
  useEffect(() => {
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setCurrent((visible[0].target as HTMLElement).dataset.section ?? 'chung')
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    )
    document.querySelectorAll('.settings-section').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [root])

  const checkUpdate = async () => {
    setChecking(true)
    try {
      const u = await api.checkUpdate()
      if (u) toast(`Đã có phiên bản mới ${u.version}`, { action: { label: 'Tải bản mới', run: () => void api.openExternal(u.downloadUrl ?? u.url) } })
      else toast('Bạn đang dùng phiên bản mới nhất')
    } catch (error) {
      toast('Không kiểm tra được: ' + errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="page settings-page" data-testid="settings-page">
      <nav className="settings-nav" aria-label="Mục cài đặt">
        <h1 className="settings-heading">Cài đặt</h1>
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            className={'settings-nav-item' + (current === sec.id ? ' is-active' : '')}
            onClick={() => {
              document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              setCurrent(sec.id)
            }}
          >
            <Icon name={sec.icon} size={20} />
            {sec.title}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <h1 className="settings-heading">Cài đặt</h1>
        <SettingsSection id="chung" title="Chung">
          <SelectRow
            title="Ngôn ngữ nội dung"
            subtitle="Ngôn ngữ của tiêu đề, đề xuất và kết quả tìm kiếm"
            value={s.language}
            options={LANGUAGES}
            onChange={(v) => update({ language: v })}
          />
          <SelectRow
            title="Khu vực"
            subtitle="Nội dung thịnh hành theo quốc gia"
            value={s.region}
            options={REGIONS}
            onChange={(v) => update({ region: v })}
          />
          <SelectRow
            title="Giao diện"
            value={s.theme}
            options={(['system', 'dark', 'light'] as const).map((t) => ({ value: t, label: THEME_TITLES[t] }))}
            onChange={(v) => update({ theme: v })}
            testId="setting-theme"
          />
        </SettingsSection>

        <SettingsSection id="phat-video" title="Phát video">
          <SelectRow title="Chất lượng mặc định" value={s.defaultQuality} options={QUALITIES} onChange={(v) => update({ defaultQuality: v })} />
          <SelectRow
            title="Chất lượng mini player"
            subtitle="Khi xem trong trình phát thu nhỏ (tiết kiệm băng thông)"
            value={s.miniPlayerQuality}
            options={QUALITIES}
            onChange={(v) => update({ miniPlayerQuality: v })}
          />
          <SelectRow
            title="Codec ưu tiên"
            subtitle="H.264 ít tốn CPU nhất trên máy cũ; AV1 nét hơn ở cùng dung lượng"
            value={s.preferredCodec}
            options={CODECS}
            onChange={(v) => update({ preferredCodec: v })}
          />
          <ToggleRow title="Tự phát video tiếp theo" checked={s.autoplayNext} onChange={(v) => update({ autoplayNext: v })} />
          <SelectRow title="Tốc độ mặc định" value={s.defaultSpeed} options={SPEEDS} onChange={(v) => update({ defaultSpeed: v })} />
          <SelectRow
            title="Bước tua (giây)"
            subtitle="Khi nhấn ← / → hoặc nhấp đúp"
            value={s.seekStep}
            options={SEEK_STEPS}
            onChange={(v) => update({ seekStep: v })}
          />
          <ToggleRow
            title="Phát khi thu nhỏ cửa sổ"
            subtitle="Tiếp tục nghe khi cửa sổ thu nhỏ hoặc ẩn xuống khay hệ thống"
            checked={s.backgroundPlayback}
            onChange={(v) => update({ backgroundPlayback: v })}
          />
          <ToggleRow
            title="Âm lượng ổn định"
            subtitle="Giảm bớt những video quá to để âm lượng đều nhau giữa các video"
            checked={s.stableVolume}
            onChange={(v) => update({ stableVolume: v })}
          />
          <ToggleRow
            title="Chế độ ánh sáng bao quanh"
            subtitle="Màu của video tỏa nhẹ ra nền trang xem (khi dùng giao diện tối)"
            checked={s.ambientMode}
            onChange={(v) => update({ ambientMode: v })}
          />
          <ToggleRow
            title="Chế độ rạp chiếu mặc định"
            subtitle="Trình phát rộng hết cửa sổ"
            checked={s.theaterMode}
            onChange={(v) => update({ theaterMode: v })}
          />
          <ToggleRow
            title="Nhớ vị trí đang xem"
            subtitle="Mở lại video sẽ tiếp tục từ chỗ đã xem"
            checked={s.resumePlayback}
            onChange={(v) => update({ resumePlayback: v })}
          />
          <SelectRow
            title="Bản âm thanh ưu tiên"
            subtitle="Với video có nhiều bản âm thanh (lồng tiếng)"
            value={s.preferredAudioLanguage}
            options={audioLanguages()}
            onChange={(v) => update({ preferredAudioLanguage: v })}
          />
        </SettingsSection>

        <SettingsSection id="phu-de" title="Phụ đề">
          <ToggleRow title="Bật phụ đề mặc định" checked={s.captionsEnabled} onChange={(v) => update({ captionsEnabled: v })} />
          <SelectRow
            title="Ngôn ngữ phụ đề"
            value={s.captionLanguage}
            options={[
              { value: null as string | null, label: 'Mặc định của video' },
              ...LANGUAGES.map((l) => ({ value: l.value as string | null, label: l.label })),
            ]}
            onChange={(v) => update({ captionLanguage: v })}
          />
          <SelectRow
            title="Tự dịch sang"
            subtitle="Khi video không có phụ đề bằng ngôn ngữ này"
            value={s.captionTranslateTo}
            options={[{ value: null as string | null, label: 'Tắt' }, ...LANGUAGES.map((l) => ({ value: l.value as string | null, label: l.label }))]}
            onChange={(v) => update({ captionTranslateTo: v })}
          />
          <SelectRow
            title="Cỡ chữ phụ đề"
            value={CAPTION_SIZES.some((o) => o.value === s.captionSize) ? s.captionSize : 100}
            options={CAPTION_SIZES}
            onChange={(v) => update({ captionSize: v })}
          />
          <SliderRow
            title="Độ đậm nền phụ đề"
            value={s.captionBackground}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => update({ captionBackground: v })}
          />
          <div className="setting-row setting-row--preview">
            <CaptionPreview size={s.captionSize} background={s.captionBackground} />
            <div className="chip-row">
              {CAPTION_BACKGROUNDS.map((b) => (
                <button
                  key={b.value}
                  className={'chip chip--small' + (Math.abs(s.captionBackground - b.value) < 0.01 ? ' is-selected' : '')}
                  onClick={() => update({ captionBackground: b.value })}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection id="sponsorblock" title="SponsorBlock" description="Dữ liệu cộng đồng từ sponsor.ajay.app — chỉ gửi mã video.">
          <ToggleRow
            title="Bỏ qua đoạn tài trợ"
            checked={s.sponsorBlock}
            onChange={(v) => update({ sponsorBlock: v })}
            testId="setting-sponsorblock"
          />
          <SelectRow
            title="Chế độ"
            value={s.sponsorMode}
            options={[
              { value: 'skip', label: 'Tự động bỏ qua' },
              { value: 'ask', label: 'Hỏi trước (hiện nút Bỏ qua)' },
            ]}
            onChange={(v) => update({ sponsorMode: v })}
          />
          {s.sponsorBlock && (
            <div className="setting-row setting-row--block">
              <div className="setting-text">
                <div className="setting-title">Loại đoạn cần bỏ qua</div>
                <div className="setting-subtitle">{s.sponsorCategories.length} loại</div>
              </div>
              <div className="check-grid">
                {SPONSOR_CATEGORIES.map((c) => (
                  <CheckRow
                    key={c.id}
                    label={c.title}
                    checked={s.sponsorCategories.includes(c.id)}
                    onChange={(on) =>
                      update({ sponsorCategories: on ? [...s.sponsorCategories, c.id] : s.sponsorCategories.filter((x) => x !== c.id) })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="bo-chinh-am" title="Bộ chỉnh âm" description="Áp dụng cho mọi video, kể cả khi phát trong nền.">
          <div className="settings-eq">
            <EqualizerPanel />
          </div>
        </SettingsSection>

        <SettingsSection id="trang-chu" title="Trang chủ & bình luận">
          <ToggleRow
            title="Hiện số lượt không thích"
            subtitle="Số ước tính từ returnyoutubedislike.com (chỉ gửi mã video)"
            checked={s.showDislikes}
            onChange={(v) => update({ showDislikes: v })}
          />
          <ToggleRow title="Hiện bình luận" checked={s.showComments} onChange={(v) => update({ showComments: v })} />
          <ToggleRow
            title="Ẩn Shorts"
            subtitle="Ẩn kệ Shorts và video Shorts khỏi trang chủ, tìm kiếm và kênh"
            checked={s.hideShorts}
            onChange={(v) => update({ hideShorts: v })}
          />
        </SettingsSection>

        <SettingsSection id="quyen-rieng-tu" title="Quyền riêng tư">
          <ToggleRow
            title="Chế độ ẩn danh"
            subtitle="Không lưu video đã xem và tìm kiếm (máy lẫn tài khoản)"
            checked={s.incognito}
            onChange={(v) => update({ incognito: v })}
          />
          <ToggleRow
            title="Tạm dừng nhật ký xem"
            subtitle="Không thêm video vào nhật ký; vẫn nhớ chỗ đang xem dở"
            checked={s.pauseWatchHistory}
            onChange={(v) => update({ pauseWatchHistory: v })}
          />
          <ToggleRow
            title="Tạm dừng nhật ký tìm kiếm"
            subtitle="Nội dung tìm kiếm không được lưu lại"
            checked={s.pauseSearchHistory}
            onChange={(v) => update({ pauseSearchHistory: v })}
          />
          <ButtonRow title="Xóa nhật ký xem" subtitle={`${history} video`}>
            <button
              className="btn btn-tonal btn-small"
              disabled={!history}
              onClick={async () => {
                if (await confirmDialog({ title: 'Xóa toàn bộ nhật ký xem trên máy?', confirmLabel: 'Xóa', danger: true })) {
                  useLibrary.getState().clearHistory()
                  toast('Đã xóa nhật ký xem')
                }
              }}
            >
              Xóa
            </button>
          </ButtonRow>
          <ButtonRow title="Xóa nhật ký tìm kiếm" subtitle={`${searches} nội dung`}>
            <button
              className="btn btn-tonal btn-small"
              disabled={!searches}
              onClick={async () => {
                if (await confirmDialog({ title: 'Xóa toàn bộ nhật ký tìm kiếm?', confirmLabel: 'Xóa', danger: true })) {
                  useLibrary.getState().clearSearchHistory()
                  toast('Đã xóa nhật ký tìm kiếm')
                }
              }}
            >
              Xóa
            </button>
          </ButtonRow>
          <ButtonRow title="Video không quan tâm" subtitle={`${notInterested} video đã ẩn khỏi đề xuất`}>
            <button
              className="btn btn-tonal btn-small"
              disabled={!notInterested}
              onClick={() => (useLibrary.getState().clearNotInterested(), toast('Đã bỏ ẩn tất cả video'))}
            >
              Bỏ ẩn tất cả
            </button>
          </ButtonRow>
          <div className="setting-row setting-row--block">
            <div className="setting-text">
              <div className="setting-title">Kênh không đề xuất</div>
              <div className="setting-subtitle">
                {blocked.length ? `${blocked.length} kênh` : 'Chưa chặn kênh nào. Chọn "Không đề xuất kênh này" trong menu ⋮ của video.'}
              </div>
            </div>
            {blocked.length > 0 && (
              <div className="blocked-list">
                {blocked.map((id) => (
                  <div key={id} className="blocked-item">
                    <Icon name="block" size={20} />
                    <span>{blockedNames[id] ?? id}</span>
                    <button className="btn btn-text btn-small" onClick={() => useLibrary.getState().unblockChannel(id)}>
                      Bỏ chặn
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection id="tai-xuong" title="Tải xuống">
          <ButtonRow title="Thư mục lưu" subtitle={s.downloadFolder ?? 'Video\\DVDTube (mặc định)'}>
            {s.downloadFolder && (
              <button className="btn btn-text btn-small" onClick={() => update({ downloadFolder: null })}>
                Mặc định
              </button>
            )}
            <button
              className="btn btn-tonal btn-small"
              onClick={async () => {
                try {
                  const folder = await api.chooseDownloadFolder()
                  if (folder) update({ downloadFolder: folder })
                } catch (error) {
                  toast(errorMessage(error))
                }
              }}
            >
              <Icon name="folder" size={18} />
              Thay đổi
            </button>
          </ButtonRow>
          <SelectRow
            title="Chất lượng tải xuống"
            subtitle="Video H.264 tối đa chất lượng này + âm thanh AAC"
            value={s.downloadQuality}
            options={DOWNLOAD_QUALITIES}
            onChange={(v) => update({ downloadQuality: v })}
          />
        </SettingsSection>

        <SettingsSection id="ung-dung" title="Ứng dụng">
          <ToggleRow
            title="Thu nhỏ xuống khay hệ thống"
            subtitle="Đóng cửa sổ sẽ ẩn DVDTube xuống khay thay vì thoát"
            checked={s.minimizeToTray}
            onChange={(v) => update({ minimizeToTray: v })}
          />
          <ToggleRow
            title="Khởi động cùng Windows"
            subtitle="Chạy ẩn dưới khay hệ thống khi mở máy"
            checked={startWithWindows}
            onChange={async (v) => {
              try {
                await api.setStartWithWindows(v)
                usePrefs.getState().set({ startWithWindows: v })
              } catch (error) {
                toast(errorMessage(error))
              }
            }}
          />
          <ToggleRow
            title="Thông báo video mới"
            subtitle="Video mới từ kênh đăng ký trên máy, kiểm tra khoảng mỗi giờ"
            checked={s.notifyNewVideos}
            onChange={(v) => update({ notifyNewVideos: v })}
          />
          <ToggleRow title="Tự kiểm tra cập nhật" checked={s.checkUpdates} onChange={(v) => update({ checkUpdates: v })} />
          <ToggleRow
            title="Tăng tốc phần cứng"
            subtitle="Cần khởi động lại ứng dụng. Tắt nếu video bị giật hoặc màn hình đen."
            checked={s.hardwareAcceleration}
            onChange={(v) => {
              update({ hardwareAcceleration: v })
              toast('Thay đổi có hiệu lực sau khi khởi động lại DVDTube')
            }}
          />
          <ButtonRow title="Cấu hình máy khách từ xa" subtitle={s.remoteConfigUrl ? s.remoteConfigUrl : 'Mặc định'}>
            <button
              className="btn btn-tonal btn-small"
              onClick={async () => {
                const url = await promptDialog({
                  title: 'Cấu hình máy khách từ xa',
                  message: 'Khi YouTube thay đổi, chỉ cần cập nhật tệp cấu hình JSON thay vì cài lại ứng dụng. Để trống để dùng địa chỉ mặc định.',
                  initial: s.remoteConfigUrl,
                  placeholder: 'https://…/remote-config.json',
                  allowEmpty: true,
                })
                if (url != null) update({ remoteConfigUrl: url.trim() })
              }}
            >
              Thay đổi
            </button>
          </ButtonRow>
        </SettingsSection>

        <SettingsSection
          id="phim-tat"
          title="Phím tắt"
          description="Phím tắt trình phát dùng được trên trang video, trong trình phát thu nhỏ và khi toàn màn hình."
        >
          <table className="shortcut-table">
            <tbody>
              {SHORTCUTS.map(([keys, action]) => (
                <tr key={keys}>
                  <td>
                    {keys.split(' / ').map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="muted"> / </span>}
                        {k.split(' + ').map((part, j) => (
                          <span key={part}>
                            {j > 0 && ' + '}
                            <kbd>{part}</kbd>
                          </span>
                        ))}
                      </span>
                    ))}
                  </td>
                  <td>{action.replace('"Bước tua"', `${s.seekStep} giây`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SettingsSection>

        <SettingsSection id="gioi-thieu" title="Giới thiệu">
          <ButtonRow title="Phiên bản" subtitle={info ? `${info.version} • Electron ${info.electron} • Chromium ${info.chrome}` : '…'}>
            <button className="btn btn-tonal btn-small" disabled={checking} onClick={() => void checkUpdate()}>
              <Icon name="refresh" size={18} />
              Kiểm tra cập nhật
            </button>
          </ButtonRow>
          <ButtonRow title="Mã nguồn và bản phát hành" subtitle="github.com/dangdvd/DVDTube">
            <button className="btn btn-tonal btn-small" onClick={() => void api.openExternal('https://github.com/dangdvd/DVDTube')}>
              <Icon name="external" size={18} />
              Mở GitHub
            </button>
          </ButtonRow>
          <ButtonRow title="Khôi phục cài đặt gốc" subtitle="Đưa mọi cài đặt về mặc định. Nhật ký, danh sách phát và kênh đăng ký được giữ nguyên.">
            <button
              className="btn btn-danger-outline btn-small"
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: 'Khôi phục cài đặt gốc?',
                    message: 'Mọi cài đặt sẽ trở về mặc định.',
                    confirmLabel: 'Khôi phục',
                    danger: true,
                  })
                ) {
                  useSettings.getState().reset()
                  toast('Đã khôi phục cài đặt gốc')
                }
              }}
            >
              Khôi phục
            </button>
          </ButtonRow>
          <p className="settings-about">
            DVDTube phát video YouTube không quảng cáo bằng API công khai của YouTube. Ứng dụng không liên kết với Google.
          </p>
        </SettingsSection>
      </div>
    </div>
  )
}
