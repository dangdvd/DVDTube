package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.services.AutoDownloadWorker
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.player.SettingRow
import com.dangdvd.dvdtube.ui.player.ToggleRow

/** Settings › Tải xuống › "Tự động tải video mới". */
@Composable
fun AutoDownloadScreen() {
    val context = LocalContext.current
    var keepPicker by remember { mutableStateOf(false) }
    val channels = AutoDownloadWorker.channels()
    val selected = AppSettings.autoDownloadChannels
    fun changed() = AutoDownloadWorker.sync(context)
    ScreenScaffold("Tự động tải video mới") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                ToggleRow(null, "Tự động tải video mới", AppSettings.autoDownloadEnabled,
                    "Khoảng mỗi 2 giờ, tải video mới của các kênh được chọn (không gồm Shorts và video trực tiếp)") {
                    AppSettings.autoDownloadEnabled = it
                    changed()
                }
                SettingRow(null, "Giữ tối đa ${AppSettings.autoDownloadKeep} video mỗi kênh", null) { keepPicker = true }
                ToggleRow(null, "Chỉ khi dùng Wi-Fi", AppSettings.autoDownloadWifiOnly) {
                    AppSettings.autoDownloadWifiOnly = it
                    changed()
                }
                ToggleRow(null, "Chỉ âm thanh", AppSettings.autoDownloadAudioOnly, "Tải tệp .m4a thay vì video") {
                    AppSettings.autoDownloadAudioOnly = it
                }
                Text(
                    "Dùng chất lượng tải xuống trong Cài đặt (${AppSettings.downloadQuality.title}). Bản tự động tải cũ hơn được xóa khi có video mới; " +
                        "video bạn tự tải xuống không bao giờ bị xóa.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
                )
                if (AppSettings.autoDownloadEnabled && selected.isNotEmpty()) {
                    SettingRow(null, "Kiểm tra ngay", null) {
                        AutoDownloadWorker.runNow(context)
                        Toasts.show("Đang kiểm tra video mới để tải…")
                    }
                }
                Text("Kênh (${selected.count { id -> channels.any { it.id == id } }}/${channels.size})",
                    style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 4.dp))
            }
            if (channels.isEmpty()) {
                item { EmptyState(Icons.Outlined.People, "Chưa đăng ký kênh nào", "Đăng ký kênh rồi quay lại đây để chọn kênh tự động tải.") }
            }
            items(channels, key = { it.id }) { channel ->
                val checked = channel.id in selected
                Row(
                    Modifier.fillMaxWidth().clickable {
                        AppSettings.autoDownloadChannels = if (checked) selected - channel.id else selected + channel.id
                        changed()
                    }.padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(channel.avatar, 36.dp, channel.name)
                    Text(channel.name.ifEmpty { channel.id }, Modifier.weight(1f).padding(horizontal = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Checkbox(checked = checked, onCheckedChange = { on ->
                        AppSettings.autoDownloadChannels = if (on) AppSettings.autoDownloadChannels + channel.id else AppSettings.autoDownloadChannels - channel.id
                        changed()
                    })
                }
            }
        }
    }
    if (keepPicker) {
        AlertDialog(
            onDismissRequest = { keepPicker = false },
            title = { Text("Giữ tối đa mỗi kênh") },
            text = {
                Column {
                    listOf(1, 2, 3, 5, 10).forEach { count ->
                        Row(
                            Modifier.fillMaxWidth().clickable { AppSettings.autoDownloadKeep = count; keepPicker = false },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = AppSettings.autoDownloadKeep == count, onClick = { AppSettings.autoDownloadKeep = count; keepPicker = false })
                            Text("$count video")
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { keepPicker = false }) { Text("Đóng") } },
        )
    }
}
