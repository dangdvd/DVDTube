package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Title
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.BuildConfig
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Equalizer
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import androidx.compose.foundation.focusable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

private enum class SettingsDialog { QUALITY, CAPTION_LANGUAGE, EQUALIZER, CLEAR_HISTORY, CLEAR_SEARCHES, LOG }

private fun onOff(value: Boolean) = if (value) "Bật" else "Tắt"

@Composable
fun TvSettingsScreen() {
    var dialog by remember { mutableStateOf<SettingsDialog?>(null) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(250)
        runCatching { first.requestFocus() }
    }
    LazyColumn(
        Modifier.fillMaxSize().focusRestorer(),
        contentPadding = PaddingValues(start = TvInsets.horizontal, end = TvInsets.horizontal, top = TvInsets.vertical, bottom = 48.dp),
    ) {
        item("title") {
            Text("Cài đặt", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(bottom = 12.dp))
        }
        item("playback") { Section("Phát video") }
        item("quality") {
            TvOptionRow("Chất lượng mặc định", value = AppSettings.wifiQuality.title, icon = Icons.Default.HighQuality,
                onClick = { dialog = SettingsDialog.QUALITY }, modifier = Modifier.widthIn(max = 820.dp).focusRequester(first))
        }
        item("autoplay") {
            TvOptionRow("Tự động phát video tiếp theo", value = onOff(AppSettings.autoplay), icon = Icons.Default.SkipNext,
                onClick = { AppSettings.autoplay = !AppSettings.autoplay }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("sponsorblock") {
            TvOptionRow("Bỏ qua đoạn tài trợ (SponsorBlock)", value = onOff(AppSettings.sponsorBlockEnabled), icon = Icons.Default.PlayCircle,
                subtitle = "Tự bỏ qua quảng cáo do người làm video lồng vào",
                onClick = { AppSettings.sponsorBlockEnabled = !AppSettings.sponsorBlockEnabled }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("captions") {
            TvOptionRow("Phụ đề", value = onOff(AppSettings.captionsEnabled), icon = Icons.Default.ClosedCaption,
                onClick = { AppSettings.captionsEnabled = !AppSettings.captionsEnabled }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("captionLanguage") {
            TvOptionRow("Ngôn ngữ phụ đề", icon = Icons.Default.Language,
                value = AppSettings.languages.firstOrNull { it.first == AppSettings.captionLanguage }?.second ?: AppSettings.captionLanguage,
                onClick = { dialog = SettingsDialog.CAPTION_LANGUAGE }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("dislikes") {
            TvOptionRow("Hiện số lượt không thích", value = onOff(AppSettings.showDislikes), icon = Icons.Default.ThumbDown,
                subtitle = "Dữ liệu của Return YouTube Dislike (chỉ gửi mã video)",
                onClick = { AppSettings.showDislikes = !AppSettings.showDislikes }, modifier = Modifier.widthIn(max = 820.dp))
        }

        item("sound") { Section("Âm thanh") }
        item("equalizer") {
            TvOptionRow("Bộ chỉnh âm (EQ)", value = if (Equalizer.isEnabled) Equalizer.presetTitle else "Tắt", icon = Icons.Default.GraphicEq,
                onClick = { dialog = SettingsDialog.EQUALIZER }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("stableVolume") {
            TvOptionRow("Âm lượng ổn định", value = onOff(AppSettings.stableVolume), icon = Icons.AutoMirrored.Filled.VolumeUp,
                subtitle = "Giảm bớt video quá to để âm lượng đều giữa các video",
                onClick = { PlayerController.setStableVolume(!AppSettings.stableVolume) }, modifier = Modifier.widthIn(max = 820.dp))
        }

        item("cast") { Section("Truyền tới DVDTube") }
        item("castReceiver") {
            val context = androidx.compose.ui.platform.LocalContext.current
            TvOptionRow("Nhận video truyền từ điện thoại và máy tính", value = onOff(AppSettings.castReceiverEnabled),
                icon = Icons.Default.Cast,
                subtitle = if (com.dangdvd.dvdtube.cast.DvdCastReceiver.isRunning) {
                    "Tên: ${com.dangdvd.dvdtube.cast.DvdCastReceiver.deviceName(context)}" +
                        (com.dangdvd.dvdtube.cast.DvdCastReceiver.address?.let { " • Địa chỉ: $it" } ?: "")
                } else {
                    "Điện thoại / máy tính cùng mạng Wi-Fi chọn \"Truyền tới TV\" để phát trên TV này"
                },
                onClick = {
                    AppSettings.castReceiverEnabled = !AppSettings.castReceiverEnabled
                    com.dangdvd.dvdtube.cast.DvdCastReceiver.refresh(context)
                }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("musicSection") { Section("Nghe nhạc và DeArrow") }
        item("musicAudio") {
            TvOptionRow("Chỉ phát âm thanh khi nghe nhạc", value = onOff(AppSettings.musicAudioOnly), icon = Icons.Default.MusicNote,
                onClick = { AppSettings.musicAudioOnly = !AppSettings.musicAudioOnly }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("dearrow") {
            TvOptionRow("DeArrow: thay tiêu đề và ảnh giật tít", value = onOff(AppSettings.deArrow), icon = Icons.Default.Title,
                subtitle = "Tiêu đề và ảnh thu nhỏ do cộng đồng sửa lại (dearrow.ajay.app)",
                onClick = { AppSettings.deArrow = !AppSettings.deArrow }, modifier = Modifier.widthIn(max = 820.dp))
        }
        if (AppSettings.deArrow) {
            item("dearrowTitles") {
                TvOptionRow("Tiêu đề", value = onOff(AppSettings.deArrowTitles),
                    onClick = { AppSettings.deArrowTitles = !AppSettings.deArrowTitles }, modifier = Modifier.widthIn(max = 820.dp).padding(start = 38.dp))
            }
            item("dearrowThumbnails") {
                TvOptionRow("Ảnh thu nhỏ", value = onOff(AppSettings.deArrowThumbnails),
                    onClick = { AppSettings.deArrowThumbnails = !AppSettings.deArrowThumbnails }, modifier = Modifier.widthIn(max = 820.dp).padding(start = 38.dp))
            }
        }
        item("toolsSection") { Section("Đồng bộ, hẹn giờ và phụ huynh") }
        item("sync") {
            TvOptionRow("Đồng bộ thư viện", icon = Icons.Default.Sync, subtitle = "Gộp thư viện với điện thoại hoặc máy tính bằng mã QR",
                onClick = { TvNav.open(TvRoute.SyncReceive()) }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("alarms") {
            val count = com.dangdvd.dvdtube.core.alarm.PlaybackAlarms.list.count { it.enabled }
            TvOptionRow("Hẹn giờ phát", value = if (count == 0) "Tắt" else "$count", icon = Icons.Default.Alarm,
                onClick = { TvNav.open(TvRoute.Alarms()) }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("parental") {
            TvOptionRow("Kiểm soát của phụ huynh", value = onOff(com.dangdvd.dvdtube.core.ParentalControls.isEnabled), icon = Icons.Default.Lock,
                onClick = {
                    com.dangdvd.dvdtube.core.ParentalControls.guard("Nhập mã PIN để mở Kiểm soát của phụ huynh") { TvNav.open(TvRoute.Parental()) }
                }, modifier = Modifier.widthIn(max = 820.dp))
        }

        item("privacy") { Section("Nhật ký và quyền riêng tư") }
        item("incognito") {
            TvOptionRow("Chế độ ẩn danh", value = onOff(AppSettings.isIncognito), icon = Icons.Default.VisibilityOff,
                subtitle = "Không lưu video đã xem và tìm kiếm cho tới khi mở lại ứng dụng",
                onClick = { AppSettings.isIncognito = !AppSettings.isIncognito }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("pauseHistory") {
            TvOptionRow("Tạm dừng nhật ký xem", value = onOff(AppSettings.pauseWatchHistory), icon = Icons.Default.History,
                onClick = { AppSettings.pauseWatchHistory = !AppSettings.pauseWatchHistory }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("pauseSearch") {
            TvOptionRow("Tạm dừng nhật ký tìm kiếm", value = onOff(AppSettings.pauseSearchHistory), icon = Icons.Default.SearchOff,
                onClick = { AppSettings.pauseSearchHistory = !AppSettings.pauseSearchHistory }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("clearHistory") {
            TvOptionRow("Xóa nhật ký xem", value = "${LibraryStore.history.size} video", icon = Icons.Default.DeleteSweep,
                onClick = { dialog = SettingsDialog.CLEAR_HISTORY }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("clearSearches") {
            TvOptionRow("Xóa nhật ký tìm kiếm", value = "${LibraryStore.searchHistory.size}", icon = Icons.Default.DeleteSweep,
                onClick = { dialog = SettingsDialog.CLEAR_SEARCHES }, modifier = Modifier.widthIn(max = 820.dp))
        }

        item("about") { Section("Giới thiệu") }
        item("version") {
            TvOptionRow("DVDTube cho Android TV", value = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", icon = Icons.Default.Info,
                subtitle = "Ứng dụng không chính thức, không liên kết với Google/YouTube",
                onClick = {}, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("autoUpdate") {
            TvOptionRow("Tự kiểm tra cập nhật", value = onOff(AppSettings.autoUpdateCheck), icon = Icons.Default.SystemUpdate,
                subtitle = "Mỗi ngày tối đa một lần, khi mở ứng dụng",
                onClick = { AppSettings.autoUpdateCheck = !AppSettings.autoUpdateCheck }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("checkUpdate") {
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            TvOptionRow("Kiểm tra cập nhật", value = if (com.dangdvd.dvdtube.core.services.AppUpdater.isChecking) "Đang kiểm tra…" else null,
                icon = Icons.Default.Refresh,
                onClick = { scope.launch { com.dangdvd.dvdtube.core.services.AppUpdater.checkNow() } }, modifier = Modifier.widthIn(max = 820.dp))
        }
        item("log") {
            TvOptionRow("Gửi nhật ký lỗi", icon = Icons.Default.BugReport, subtitle = "Tệp nhật ký đã xóa cookie, email và mã đăng nhập",
                onClick = { dialog = SettingsDialog.LOG }, modifier = Modifier.widthIn(max = 820.dp))
        }
    }

    when (dialog) {
        SettingsDialog.QUALITY -> TvDialog("Chất lượng mặc định", { dialog = null }) {
            VideoQuality.entries.forEach { quality ->
                TvOptionRow(quality.title, selected = AppSettings.wifiQuality == quality, onClick = {
                    AppSettings.wifiQuality = quality
                    dialog = null
                })
            }
        }
        SettingsDialog.CAPTION_LANGUAGE -> TvDialog("Ngôn ngữ phụ đề", { dialog = null }) {
            AppSettings.languages.forEach { (code, name) ->
                TvOptionRow(name, selected = AppSettings.captionLanguage == code, onClick = {
                    AppSettings.captionLanguage = code
                    dialog = null
                })
            }
        }
        SettingsDialog.EQUALIZER -> TvEqualizerDialog { dialog = null }
        SettingsDialog.LOG -> {
            val context = androidx.compose.ui.platform.LocalContext.current
            val text = remember { com.dangdvd.dvdtube.core.LogExport.build(context) }
            TvDialog("Gửi nhật ký lỗi", { dialog = null }, width = 860.dp) {
                TvOptionRow("Chia sẻ tệp nhật ký", onClick = {
                    dialog = null
                    com.dangdvd.dvdtube.core.LogExport.share(context)
                })
                TvOptionRow("Đóng", onClick = { dialog = null })
                Text(text.takeLast(6000), style = MaterialTheme.typography.bodySmall, color = TvColors.secondaryText,
                    modifier = Modifier.padding(top = 10.dp).focusable())
            }
        }
        SettingsDialog.CLEAR_HISTORY -> TvDialog("Xóa toàn bộ nhật ký xem trên TV này?", { dialog = null }) {
            TvOptionRow("Xóa", onClick = {
                LibraryStore.clearHistory()
                Toasts.show("Đã xóa nhật ký xem")
                dialog = null
            })
            TvOptionRow("Hủy", onClick = { dialog = null })
        }
        SettingsDialog.CLEAR_SEARCHES -> TvDialog("Xóa nhật ký tìm kiếm?", { dialog = null }) {
            TvOptionRow("Xóa", onClick = {
                LibraryStore.clearSearchHistory()
                Toasts.show("Đã xóa nhật ký tìm kiếm")
                dialog = null
            })
            TvOptionRow("Hủy", onClick = { dialog = null })
        }
        null -> Unit
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, color = Brand, modifier = Modifier.padding(top = 18.dp, bottom = 6.dp))
}

private fun gainText(gain: Float): String = when {
    gain == 0f -> "0 dB"
    gain % 1f == 0f -> String.format(Locale.ROOT, "%+d dB", gain.toInt())
    else -> String.format(Locale.ROOT, "%+.1f dB", gain)
}

/** The equalizer for the remote: presets in a row, then each band adjusted with ◀ ▶. */
@Composable
fun TvEqualizerDialog(onDismiss: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(150)
        runCatching { first.requestFocus() }
    }
    TvDialog("Bộ chỉnh âm (EQ)", onDismiss, width = 760.dp) {
        TvOptionRow("Bộ chỉnh âm", value = onOff(Equalizer.isEnabled), onClick = { Equalizer.setEnabled(!Equalizer.isEnabled) },
            subtitle = "Áp dụng cho mọi video", modifier = Modifier.focusRequester(first))
        Text("Kiểu nhạc", style = MaterialTheme.typography.titleSmall, color = Brand, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
        val presets = Equalizer.presets.map { it.id to it.title } +
            if (Equalizer.presetId == Equalizer.CUSTOM) listOf(Equalizer.CUSTOM to "Tùy chỉnh") else emptyList()
        LazyRow(
            Modifier.fillMaxWidth().focusRestorer(),
            contentPadding = PaddingValues(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(presets, key = { it.first }) { (id, title) ->
                TvButton(title, selected = Equalizer.presetId == id, onClick = {
                    if (!Equalizer.isEnabled) Equalizer.setEnabled(true)
                    Equalizer.selectPreset(id)
                })
            }
        }
        Text("Dải tần — chọn một dải rồi bấm ◀ ▶ để giảm / tăng", style = MaterialTheme.typography.titleSmall, color = Brand,
            modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
        val gains = Equalizer.gains
        Equalizer.frequencies.forEachIndexed { index, hz ->
            val gain = gains.getOrElse(index) { 0f }
            AdjustRow(
                label = if (hz >= 1000) "${hz / 1000} kHz" else "$hz Hz",
                value = gain,
                range = Equalizer.MIN_GAIN..Equalizer.MAX_GAIN,
                text = gainText(gain),
                onChange = { delta ->
                    if (!Equalizer.isEnabled) Equalizer.setEnabled(true)
                    Equalizer.setBand(index, gain + delta)
                },
            )
        }
        val preamp = Equalizer.preamp
        AdjustRow(
            label = "Tiền khuếch đại",
            value = preamp,
            range = -12f..6f,
            text = gainText(preamp) + if (AppSettings.equalizerAutoPreamp) " (tự động)" else "",
            onChange = { delta -> Equalizer.setPreamp(preamp + delta) },
            onSelect = { Equalizer.setAutoPreamp(!AppSettings.equalizerAutoPreamp) },
        )
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton("Đặt lại", onClick = { Equalizer.reset() })
            TvButton("Xong", onClick = onDismiss, accent = true)
        }
    }
}

/** A value changed with ◀ ▶ (OK runs [onSelect] when given). */
@Composable
private fun AdjustRow(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    text: String,
    onChange: (Float) -> Unit,
    onSelect: () -> Unit = {},
) {
    Surface(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            when (event.key) {
                Key.DirectionLeft -> { onChange(-1f); true }
                Key.DirectionRight -> { onChange(1f); true }
                else -> false
            }
        },
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(10.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = Color.White,
            focusedContainerColor = TvColors.surfaceHigh,
            focusedContentColor = Color.White,
            pressedContainerColor = TvColors.surfaceHigh,
            pressedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.01f),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.width(150.dp))
            val span = range.endInclusive - range.start
            val fraction = if (span > 0) ((value - range.start) / span).coerceIn(0f, 1f) else 0f
            val zero = if (span > 0) ((0f - range.start) / span).coerceIn(0f, 1f) else 0f
            Box(Modifier.weight(1f).height(8.dp).background(Color.White.copy(alpha = 0.2f), RoundedCornerShape(4.dp))) {
                val start = minOf(fraction, zero)
                val end = maxOf(fraction, zero)
                Row(Modifier.fillMaxSize()) {
                    if (start > 0f) Spacer(Modifier.weight(start))
                    if (end - start > 0f) Box(Modifier.weight(end - start).fillMaxHeight().background(Brand, RoundedCornerShape(4.dp)))
                    if (1f - end > 0f) Spacer(Modifier.weight(1f - end))
                }
            }
            Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 14.dp).width(150.dp))
        }
    }
}
