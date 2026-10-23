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
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand

private enum class SettingsPage { MAIN, QUALITY, SPEED, CAPTIONS, TRANSLATE, SLEEP }

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
                            SettingsPage.SLEEP -> "Hẹn giờ đi ngủ"
                            SettingsPage.MAIN -> ""
                        },
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    )
                }
                HorizontalDivider()
            }
            when (page) {
                SettingsPage.MAIN -> MainPage { page = it }
                SettingsPage.QUALITY -> VideoQuality.entries.forEach { quality ->
                    CheckRow(quality.title, PlayerController.quality == quality) {
                        PlayerController.setQuality(quality)
                        onDismiss()
                    }
                }
                SettingsPage.SPEED -> AppSettings.speeds.forEach { speed ->
                    CheckRow(speedTitle(speed), PlayerController.rate == speed) {
                        PlayerController.setPlaybackRate(speed)
                        onDismiss()
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
                SettingsPage.SLEEP -> {
                    CheckRow("Tắt", PlayerController.sleepTimerEnd == null && !PlayerController.sleepAtEndOfVideo) {
                        PlayerController.setSleepTimer(null)
                        onDismiss()
                    }
                    listOf(10, 15, 20, 30, 45, 60).forEach { minutes ->
                        CheckRow("$minutes phút", false) {
                            PlayerController.setSleepTimer(minutes)
                            onDismiss()
                        }
                    }
                    CheckRow("Khi hết video này", PlayerController.sleepAtEndOfVideo) {
                        PlayerController.setSleepTimer(0)
                        onDismiss()
                    }
                }
            }
        }
    }
}

@Composable
private fun MainPage(open: (SettingsPage) -> Unit) {
    val isLive = PlayerController.currentVideo?.isLive == true
    if (!PlayerController.usesWebPlayer) {
        val qualityValue = PlayerController.quality.title
        SettingRow(Icons.Default.HighQuality, "Chất lượng", qualityValue) { open(SettingsPage.QUALITY) }
        if (!isLive) SettingRow(Icons.Default.Speed, "Tốc độ phát", speedTitle(PlayerController.rate)) { open(SettingsPage.SPEED) }
    }
    if (PlayerController.captionTracks.isNotEmpty()) {
        SettingRow(Icons.Default.ClosedCaption, "Phụ đề", PlayerController.selectedCaption?.name ?: "Tắt") { open(SettingsPage.CAPTIONS) }
    }
    if (!isLive && !PlayerController.usesWebPlayer) {
        ToggleRow(Icons.Default.Repeat, "Phát lặp lại", PlayerController.isLooping) { PlayerController.setLooping(it) }
    }
    ToggleRow(Icons.Default.PlayCircle, "Tự động phát", AppSettings.autoplay) { PlayerController.toggleAutoplay() }
    val sleepValue = when {
        PlayerController.sleepAtEndOfVideo -> "Khi hết video"
        PlayerController.sleepTimerEnd != null -> {
            val left = ((PlayerController.sleepTimerEnd!! - System.currentTimeMillis()) / 60_000).coerceAtLeast(0) + 1
            "Còn khoảng $left phút"
        }
        else -> "Tắt"
    }
    SettingRow(Icons.Default.Bedtime, "Hẹn giờ đi ngủ", sleepValue) { open(SettingsPage.SLEEP) }
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
