package com.dangdvd.dvdtube.ui.player

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.QueryStats
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.player.Equalizer
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand

private enum class SettingsPage { MAIN, QUALITY, SPEED, CAPTIONS, TRANSLATE, SLEEP, AUDIO_TRACK, EQUALIZER }

private fun speedTitle(speed: Float): String = if (speed == 1f) "Chuẩn" else "${speed}x".replace(".0x", "x")

@Composable
fun PlayerSettingsSheet(onDismiss: () -> Unit) {
    var page by remember { mutableStateOf(SettingsPage.MAIN) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 12.dp)) {
            if (page != SettingsPage.MAIN) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { page = if (page == SettingsPage.TRANSLATE) SettingsPage.CAPTIONS else SettingsPage.MAIN }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại")
                    }
                    Text(
                        when (page) {
                            SettingsPage.QUALITY -> "Chất lượng"
                            SettingsPage.SPEED -> "Tốc độ phát"
                            SettingsPage.CAPTIONS -> "Phụ đề"
                            SettingsPage.TRANSLATE -> "Tự động dịch"
                            SettingsPage.SLEEP -> "Hẹn giờ tắt"
                            SettingsPage.AUDIO_TRACK -> "Bản âm thanh"
                            SettingsPage.EQUALIZER -> "Bộ chỉnh âm (EQ)"
                            SettingsPage.MAIN -> ""
                        },
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    )
                }
                HorizontalDivider()
            }
            when (page) {
                SettingsPage.MAIN -> MainPage(open = { page = it }, onDismiss = onDismiss)
                SettingsPage.QUALITY -> VideoQuality.entries.forEach { quality ->
                    CheckRow(quality.title, PlayerController.quality == quality) {
                        PlayerController.setQuality(quality)
                        onDismiss()
                    }
                }
                SettingsPage.SPEED -> {
                    AppSettings.speeds.forEach { speed ->
                        CheckRow(speedTitle(speed), PlayerController.rate == speed) {
                            PlayerController.setPlaybackRate(speed)
                            onDismiss()
                        }
                    }
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                        Text("Tùy chỉnh: ${String.format(java.util.Locale.ROOT, "%.2fx", PlayerController.rate)}",
                            style = MaterialTheme.typography.bodyLarge)
                        Slider(
                            value = PlayerController.rate,
                            onValueChange = { PlayerController.setPlaybackRate(Math.round(it * 20) / 20f) },
                            valueRange = 0.25f..4f,
                            steps = 74,
                        )
                    }
                }
                SettingsPage.CAPTIONS -> {
                    CheckRow("Tắt", PlayerController.selectedCaption == null) {
                        PlayerController.selectCaption(null)
                        onDismiss()
                    }
                    PlayerController.captionTracks.forEach { track ->
                        CheckRow(track.name, PlayerController.selectedCaption == track && PlayerController.captionTranslation == null) {
                            PlayerController.selectCaption(track)
                            AppSettings.captionLanguage = track.languageCode.substringBefore('-')
                            onDismiss()
                        }
                    }
                    if (PlayerController.captionTracks.any { it.isTranslatable }) {
                        SettingRow(Icons.Default.Language, "Tự động dịch", PlayerController.captionTranslation?.let { code ->
                            AppSettings.languages.firstOrNull { it.first == code }?.second ?: code
                        }) { page = SettingsPage.TRANSLATE }
                    }
                }
                SettingsPage.TRANSLATE -> AppSettings.languages.forEach { (code, name) ->
                    CheckRow(name, PlayerController.captionTranslation == code) {
                        val source = PlayerController.selectedCaption?.takeIf { it.isTranslatable }
                            ?: PlayerController.captionTracks.firstOrNull { it.isTranslatable && !it.isAutoGenerated }
                            ?: PlayerController.captionTracks.first { it.isTranslatable }
                        PlayerController.selectCaption(source, code)
                        onDismiss()
                    }
                }
                SettingsPage.SLEEP -> SleepTimerContent(onDone = onDismiss)
                SettingsPage.AUDIO_TRACK -> PlayerController.audioTracks.forEach { option ->
                    CheckRow(option.name + if (option.isDefault) " (gốc)" else "", PlayerController.selectedAudioTrackId == option.id) {
                        PlayerController.selectAudioTrack(option)
                        onDismiss()
                    }
                }
                SettingsPage.EQUALIZER -> EqualizerContent()
            }
        }
    }
}

@Composable
private fun MainPage(open: (SettingsPage) -> Unit, onDismiss: () -> Unit) {
    val isLive = PlayerController.currentVideo?.isLive == true
    if (!PlayerController.isCasting && !PlayerController.usesWebPlayer && !PlayerController.isLocalPlayback) {
        ToggleRow(Icons.Default.Headphones, "Chỉ phát âm thanh", PlayerController.isAudioOnly,
            "Không tải hình — tiết kiệm dữ liệu 4G") { PlayerController.switchAudioOnly(it) }
    }
    if (!PlayerController.usesWebPlayer) {
        val qualityValue = PlayerController.quality.title
        SettingRow(Icons.Default.HighQuality, "Chất lượng", qualityValue) { open(SettingsPage.QUALITY) }
        if (!isLive) SettingRow(Icons.Default.Speed, "Tốc độ phát", speedTitle(PlayerController.rate)) { open(SettingsPage.SPEED) }
    }
    if (PlayerController.captionTracks.isNotEmpty()) {
        SettingRow(Icons.Default.ClosedCaption, "Phụ đề", PlayerController.selectedCaption?.name ?: "Tắt") { open(SettingsPage.CAPTIONS) }
    }
    val audioTracks = PlayerController.audioTracks
    if (audioTracks.size > 1 && !PlayerController.usesWebPlayer && !PlayerController.isCasting) {
        val current = audioTracks.firstOrNull { it.id == PlayerController.selectedAudioTrackId }
            ?: audioTracks.firstOrNull { it.isDefault }
        SettingRow(Icons.Default.RecordVoiceOver, "Bản âm thanh", current?.name) { open(SettingsPage.AUDIO_TRACK) }
    }
    if (!PlayerController.usesWebPlayer && !PlayerController.isCasting) {
        SettingRow(Icons.Default.GraphicEq, "Bộ chỉnh âm (EQ)", if (Equalizer.isEnabled) Equalizer.presetTitle else "Tắt") {
            open(SettingsPage.EQUALIZER)
        }
        ToggleRow(Icons.AutoMirrored.Filled.VolumeUp, "Âm lượng ổn định", AppSettings.stableVolume,
            "Giảm bớt video quá to để âm lượng đều giữa các video") { PlayerController.setStableVolume(it) }
    }
    if (!isLive && !PlayerController.usesWebPlayer) {
        ToggleRow(Icons.Default.Repeat, "Phát lặp lại", PlayerController.isLooping) { PlayerController.setLooping(it) }
    }
    ToggleRow(Icons.Default.PlayCircle, "Tự động phát", AppSettings.autoplay) { PlayerController.toggleAutoplay() }
    SettingRow(Icons.Default.Bedtime, "Hẹn giờ tắt", PlayerController.sleepTimerLabel ?: "Tắt") { open(SettingsPage.SLEEP) }
    SettingRow(Icons.Default.Lock, "Khóa màn hình", null) {
        PlayerController.isScreenLocked = true
        onDismiss()
    }
    ToggleRow(Icons.Default.QueryStats, "Thống kê chi tiết", PlayerController.showsStats) { PlayerController.showsStats = it }
    if (!PlayerController.isCasting) {
        if (PlayerController.usesWebPlayer) {
            SettingRow(Icons.Default.PlayCircle, "Thử lại trình phát gốc", null) { PlayerController.switchToNativePlayer() }
        } else if (!PlayerController.isLocalPlayback) {
            SettingRow(Icons.Default.PlayCircle, "Dùng trình phát web của YouTube", null) {
                PlayerController.switchToWebPlayer("người dùng chọn")
            }
        }
    }
    PlayerController.webFallbackReason?.takeIf { PlayerController.usesWebPlayer }?.let {
        Text("Đang dùng trình phát web vì: $it", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
    }
}

@Composable
fun SettingRow(icon: ImageVector?, title: String, value: String?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(22.dp))
            Spacer(Modifier.width(18.dp))
        }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (value != null) {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun ToggleRow(icon: ImageVector?, title: String, checked: Boolean, subtitle: String? = null, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(22.dp))
            Spacer(Modifier.width(18.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
fun CheckRow(title: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
        if (selected) Icon(Icons.Default.Check, null, tint = Brand)
    }
}

fun sleepDurationTitle(minutes: Int): String {
    if (minutes < 60) return "$minutes phút"
    val rest = minutes % 60
    return if (rest == 0) "${minutes / 60} giờ" else "${minutes / 60} giờ $rest phút"
}

/** Sleep timer: preset durations, end of video, a custom duration and extending a running timer. */
@Composable
fun SleepTimerContent(onDone: () -> Unit) {
    var custom by remember { mutableStateOf(25f) }
    PlayerController.sleepTimerLabel?.let { label ->
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Bedtime, null, tint = Brand)
                Spacer(Modifier.width(10.dp))
                Text(if (PlayerController.sleepAtEndOfVideo) "Dừng khi hết video này" else "Dừng phát sau $label",
                    style = MaterialTheme.typography.titleSmall)
            }
            Row(Modifier.padding(top = 8.dp)) {
                if (!PlayerController.sleepAtEndOfVideo) {
                    listOf(5, 15, 30).forEach { minutes ->
                        OutlinedButton(onClick = { PlayerController.extendSleepTimer(minutes) }, modifier = Modifier.padding(end = 8.dp)) {
                            Text("+$minutes phút")
                        }
                    }
                }
            }
        }
        CheckRow("Tắt hẹn giờ", false) {
            PlayerController.setSleepTimer(null)
            onDone()
        }
        HorizontalDivider()
    }
    Text("Dừng phát sau", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
    AppSettings.sleepTimerOptions.forEach { minutes ->
        CheckRow(sleepDurationTitle(minutes), false) {
            PlayerController.setSleepTimer(minutes)
            onDone()
        }
    }
    CheckRow("Khi hết video này", PlayerController.sleepAtEndOfVideo) {
        PlayerController.setSleepTimer(0)
        onDone()
    }
    HorizontalDivider()
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
        Text("Tùy chỉnh: ${sleepDurationTitle(custom.toInt())}", style = MaterialTheme.typography.bodyLarge)
        Slider(value = custom, onValueChange = { custom = it }, valueRange = 1f..240f)
        OutlinedButton(onClick = {
            PlayerController.setSleepTimer(custom.toInt().coerceAtLeast(1))
            onDone()
        }) { Text("Bắt đầu hẹn giờ") }
        Text(
            "Âm thanh nhỏ dần trong 10 giây cuối rồi video tạm dừng — kể cả khi đang phát trong nền hoặc tắt màn hình.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
fun SleepTimerSheet(onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 12.dp)) {
            Text("Hẹn giờ tắt", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            SleepTimerContent(onDone = onDismiss)
        }
    }
}
