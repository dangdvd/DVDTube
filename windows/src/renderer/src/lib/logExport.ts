// "Gửi nhật ký lỗi": the log file is built (and scrubbed) by the main process; this side adds
// a settings summary with nothing personal and the recent renderer / player errors.

import { DEFAULT_SETTINGS } from '@shared/settings'
import { useAccount } from '@/state/account'
import { useParental } from '@/state/parental'
import { settings } from '@/state/settings'
import { copyText } from './actions'
import { api, errorMessage } from './api'
import { recentRendererLines } from './rendererLog'
import { toast } from './toast'

function summary(): Record<string, string> {
  const s = settings()
  const yes = (v: boolean) => (v ? 'bật' : 'tắt')
  return {
    'Ngôn ngữ / khu vực': `${s.language} / ${s.region}`,
    'Giao diện': s.theme,
    'Chất lượng mặc định / mini': `${s.defaultQuality || 'tự động'} / ${s.miniPlayerQuality || 'tự động'}`,
    'Codec ưu tiên': s.preferredCodec,
    'Tốc độ mặc định': String(s.defaultSpeed),
    'Tự phát tiếp': yes(s.autoplayNext),
    'Phát khi thu nhỏ': yes(s.backgroundPlayback),
    'Âm lượng ổn định': yes(s.stableVolume),
    'Bộ chỉnh âm': yes(s.equalizer.enabled),
    'Phụ đề mặc định': yes(s.captionsEnabled),
    SponsorBlock: `${yes(s.sponsorBlock)} (${s.sponsorMode})`,
    DeArrow: `${yes(s.dearrow)} (tiêu đề ${yes(s.dearrowTitles)}, ảnh ${yes(s.dearrowThumbnails)})`,
    'Trình phát web khi lỗi': yes(s.webPlayerFallback),
    'Ẩn danh': yes(s.incognito),
    'Ẩn Shorts / hiện bình luận': `${yes(s.hideShorts)} / ${yes(s.showComments)}`,
    'Tải xuống': `${s.downloadQuality}p, phụ đề ${yes(s.downloadSubtitles)}, thư mục ${s.downloadFolder ? 'tùy chỉnh' : 'mặc định'}`,
    'Tự động tải': `${yes(s.autoDownload.enabled)}, ${s.autoDownload.channels.length} kênh, giữ ${s.autoDownload.keep}, Wi-Fi ${yes(s.autoDownload.wifiOnly)}`,
    'Nhận video truyền tới': yes(s.castReceiver),
    'Nghe nhạc chỉ âm thanh': yes(s.musicAudioOnly),
    'Khay hệ thống': yes(s.minimizeToTray),
    'Tăng tốc phần cứng': yes(s.hardwareAcceleration),
    'Cấu hình máy khách': s.remoteConfigUrl && s.remoteConfigUrl !== DEFAULT_SETTINGS.remoteConfigUrl ? 'tùy chỉnh' : 'mặc định',
    'Kiểm soát của phụ huynh': yes(useParental.getState().config.enabled),
  }
}

async function build(): Promise<{ fileName: string; text: string }> {
  return api.buildLog({ settings: summary(), rendererLines: recentRendererLines(), signedIn: useAccount.getState().signedIn })
}

export async function saveErrorLog(): Promise<void> {
  try {
    const { fileName, text } = await build()
    const path = await api.saveTextFile(fileName, text, 'txt')
    if (path) toast('Đã lưu nhật ký lỗi. Gửi tệp này cho nhà phát triển.', { action: { label: 'Mở thư mục', run: () => void api.showFile(path) } })
  } catch (error) {
    toast('Không tạo được nhật ký: ' + errorMessage(error))
  }
}

export async function copyErrorLog(): Promise<void> {
  try {
    const { text } = await build()
    await copyText(text)
    toast('Đã sao chép nhật ký lỗi')
  } catch (error) {
    toast('Không tạo được nhật ký: ' + errorMessage(error))
  }
}
