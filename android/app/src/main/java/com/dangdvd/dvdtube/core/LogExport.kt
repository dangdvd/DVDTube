package com.dangdvd.dvdtube.core

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.content.FileProvider
import com.dangdvd.dvdtube.BuildConfig
import com.dangdvd.dvdtube.cast.DvdCastReceiver
import com.dangdvd.dvdtube.cast.DvdCastSender
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.player.Equalizer
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.tv.TvActivity
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * "Gửi nhật ký lỗi": one text file with the app version, device, a settings summary (no account
 * names, emails or history), the network type, the last log lines, recent errors and crash
 * reports — scrubbed of cookies, auth headers, emails, pairing keys and URL signatures.
 */
object LogExport {
    private val scrubbers: List<Pair<Regex, String>> = listOf(
        Regex("(?i)(cookie\\s*[:=]\\s*)[^\\n]+") to "$1[đã ẩn]",
        Regex("(?i)(authorization\\s*[:=]\\s*)[^\\n]+") to "$1[đã ẩn]",
        Regex("(?i)(SAPISID(?:1P|3P)?HASH)[\\s=:]+\\S+") to "$1 [đã ẩn]",
        Regex("\\b(SAPISID|SID|HSID|SSID|APISID|LOGIN_INFO|__Secure-[^=\\s;]+)=[^;\\s&\"]+") to "$1=[đã ẩn]",
        Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}") to "[email]",
        Regex("(?i)(dvdtube://(?:tv-login|sync))\\?\\S+") to "$1?[đã ẩn]",
        Regex("(?i)([?&](?:key|sig|signature|lsig)=)[^&\\s\"]+") to "$1[đã ẩn]",
        Regex("(?i)(\"(?:t|k|n|c|token|key)\"\\s*:\\s*\")[A-Za-z0-9_+/=-]{16,}") to "$1[đã ẩn]",
    )

    /** Removes anything that could identify an account or unlock a session. */
    fun scrub(text: String): String = scrubbers.fold(text) { current, (pattern, replacement) -> pattern.replace(current, replacement) }

    private val platform: String get() = runCatching { if (TvActivity.isTelevision(com.dangdvd.dvdtube.DVDTubeApp.instance)) "tv" else "android" }.getOrDefault("android")

    fun fileName(time: Long = System.currentTimeMillis()): String =
        "DVDTube-log-$platform-" + SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(Date(time)) + ".txt"

    private fun networkType(context: Context): String = runCatching {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return@runCatching "không rõ"
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return@runCatching "không có mạng"
        when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Dữ liệu di động"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "khác"
        } + if (manager.isActiveNetworkMetered) " (tính phí)" else ""
    }.getOrDefault("không rõ")

    private fun onOff(value: Boolean) = if (value) "bật" else "tắt"

    private fun settingsSummary(): List<String> = listOf(
        "Ngôn ngữ / khu vực: ${AppSettings.language} / ${AppSettings.region}",
        "Chất lượng Wi-Fi / di động / tải xuống: ${AppSettings.wifiQuality.title} / ${AppSettings.cellularQuality.title} / ${AppSettings.downloadQuality.title}",
        "Tự động phát: ${onOff(AppSettings.autoplay)}, phát trong nền: ${onOff(AppSettings.backgroundPlayback)}, hình trong hình: ${onOff(AppSettings.autoPictureInPicture)}",
        "Chỉ âm thanh: ${onOff(AppSettings.audioOnlyMode)}, tiết kiệm dữ liệu: ${onOff(AppSettings.dataSaver)}",
        "Trình phát web dự phòng: ${onOff(AppSettings.webPlayerFallback)}, SponsorBlock: ${onOff(AppSettings.sponsorBlockEnabled)}",
        "DeArrow: ${onOff(AppSettings.deArrow)} (tiêu đề ${onOff(AppSettings.deArrowTitles)}, ảnh ${onOff(AppSettings.deArrowThumbnails)})",
        "Phụ đề: ${onOff(AppSettings.captionsEnabled)} (${AppSettings.captionLanguage}), EQ: ${if (Equalizer.isEnabled) Equalizer.presetTitle else "tắt"}",
        "Đã đăng nhập: ${if (AccountStore.isSignedIn) "có" else "không"}, ẩn danh: ${onOff(AppSettings.isIncognito)}",
        "Kiểm soát của phụ huynh: ${onOff(ParentalControls.isEnabled)}",
        "Tự động tải: ${onOff(AppSettings.autoDownloadEnabled)} (${AppSettings.autoDownloadChannels.size} kênh), đã tải: ${DownloadManager.downloads.size} video",
        "Truyền tới DVDTube: nhận ${onOff(AppSettings.castReceiverEnabled)}${if (DvdCastReceiver.isRunning) " (đang chạy)" else ""}, " +
            "đang truyền: ${if (DvdCastSender.isConnected) "có" else "không"}",
        "Tự kiểm tra cập nhật: ${onOff(AppSettings.autoUpdateCheck)}",
    )

    /** The whole report, already scrubbed. */
    fun build(context: Context): String {
        val now = System.currentTimeMillis()
        val header = listOf(
            "DVDTube ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) — ${if (platform == "tv") "Android TV" else "Android"}",
            "Thời điểm: " + SimpleDateFormat("dd/MM/yyyy HH:mm:ss Z", Locale.ROOT).format(Date(now)),
            "Thiết bị: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE}), Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            "Mạng: ${networkType(context)}",
        )
        val sections = StringBuilder()
        sections.append(header.joinToString("\n")).append("\n\n== Cài đặt ==\n")
        sections.append(settingsSummary().joinToString("\n")).append("\n\n== Lỗi gần đây ==\n")
        val errors = Log.recentErrors()
        sections.append(if (errors.isEmpty()) "(không có)" else errors.joinToString("\n")).append("\n\n== Báo cáo sự cố ==\n")
        val crashes = Log.crashReports()
        if (crashes.isEmpty()) sections.append("(không có)\n") else crashes.forEach { (name, text) -> sections.append("--- $name ---\n").append(text).append('\n') }
        sections.append("\n== Nhật ký (").append(Log.recentLines().size).append(" dòng gần nhất) ==\n")
        sections.append(Log.recentLines().joinToString("\n"))
        return scrub(sections.toString())
    }

    /** Writes the report to the cache and opens the share sheet. */
    fun share(context: Context) {
        val text = build(context)
        val file = runCatching {
            val folder = File(context.cacheDir, "logs").apply { mkdirs() }
            folder.listFiles()?.forEach { it.delete() }
            File(folder, fileName()).also { it.writeText(text) }
        }.getOrNull()
        if (file == null) {
            Toasts.show("Không tạo được tệp nhật ký")
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, file.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            context.startActivity(Intent.createChooser(intent, "Gửi nhật ký lỗi").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (error: ActivityNotFoundException) {
            Toasts.show("Không có ứng dụng nào để chia sẻ tệp")
        }
    }
}
