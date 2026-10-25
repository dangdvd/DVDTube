package com.dangdvd.dvdtube.ui.screens

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.alarm.AlarmRepeat
import com.dangdvd.dvdtube.core.alarm.AlarmSource
import com.dangdvd.dvdtube.core.alarm.PlaybackAlarm
import com.dangdvd.dvdtube.core.alarm.PlaybackAlarms
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.player.ToggleRow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

fun alarmNextText(alarm: PlaybackAlarm): String {
    if (!alarm.enabled) return "Đang tắt"
    val next = alarm.nextTrigger() ?: return "Không có lần phát tiếp theo"
    return "Lần tới: " + SimpleDateFormat("EEEE HH:mm, dd/MM", Locale("vi")).format(Date(next))
}

/** Settings › "Hẹn giờ phát". */
@Composable
fun AlarmsScreen() {
    val context = LocalContext.current
    var editing by remember { mutableStateOf<PlaybackAlarm?>(null) }
    PlaybackAlarms.list
    val alarms = PlaybackAlarms.alarms
    ScreenScaffold("Hẹn giờ phát", actions = {
        IconButton(onClick = { editing = PlaybackAlarm() }) { Icon(Icons.Default.Add, "Thêm hẹn giờ") }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Text(
                    "DVDTube tự bắt đầu phát vào giờ đã hẹn (kể cả khi không mở ứng dụng), âm lượng tăng dần trong 30 giây.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                if (!PlaybackAlarms.canRingExactly(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Cần cho phép báo thức chính xác để phát đúng giờ.", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                        TextButton(onClick = {
                            runCatching {
                                context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")))
                            }
                        }) { Text("Cho phép") }
                    }
                }
            }
            if (alarms.isEmpty()) {
                item {
                    EmptyState(Icons.Outlined.Alarm, "Chưa có hẹn giờ nào", "Nhấn + để hẹn giờ phát danh sách phát, Xem sau, video đã thích hoặc radio.")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center) {
                        FilledTonalButton(onClick = { editing = PlaybackAlarm() }) { Text("Thêm hẹn giờ") }
                    }
                }
            }
            items(alarms, key = { it.id }) { alarm ->
                Row(
                    Modifier.fillMaxWidth().clickable { editing = alarm }.padding(horizontal = 20.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(alarm.timeText, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold,
                            color = if (alarm.enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${alarm.repeat.title} • ${alarm.sourceText()}", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                        Text(alarmNextText(alarm), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = alarm.enabled, onCheckedChange = { PlaybackAlarms.setEnabled(context, alarm.id, it) })
                    IconButton(onClick = { PlaybackAlarms.delete(context, alarm.id) }) { Icon(Icons.Default.Delete, "Xóa") }
                }
            }
        }
    }
    editing?.let { alarm ->
        AlarmEditor(alarm, onDismiss = { editing = null }) { saved ->
            PlaybackAlarms.upsert(context, saved.copy(enabled = true))
            Toasts.show("Đã hẹn giờ phát lúc ${saved.timeText}")
            editing = null
        }
    }
}

@Composable
private fun AlarmEditor(initial: PlaybackAlarm, onDismiss: () -> Unit, onSave: (PlaybackAlarm) -> Unit) {
    var alarm by remember(initial.id) { mutableStateOf(initial) }
    var pickingTime by remember { mutableStateOf(false) }
    val playlists = LibraryStore.playlists
    val valid = when (alarm.source) {
        AlarmSource.LOCAL_PLAYLIST -> alarm.playlistId != null && playlists.any { it.id == alarm.playlistId }
        AlarmSource.LINK -> !alarm.link.isNullOrBlank()
        else -> true
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (PlaybackAlarms.alarm(initial.id) == null) "Thêm hẹn giờ phát" else "Sửa hẹn giờ phát") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(Modifier.fillMaxWidth().clickable { pickingTime = true }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Giờ phát", Modifier.weight(1f))
                    Text(alarm.timeText, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                }
                Text("Lặp lại", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
                AlarmRepeat.entries.forEach { option ->
                    Row(Modifier.fillMaxWidth().clickable { alarm = alarm.copy(repeat = option) }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = alarm.repeat == option, onClick = { alarm = alarm.copy(repeat = option) })
                        Text(option.title)
                    }
                }
                Text("Nội dung", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
                AlarmSource.entries.forEach { option ->
                    Row(Modifier.fillMaxWidth().clickable { alarm = alarm.copy(source = option) }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = alarm.source == option, onClick = { alarm = alarm.copy(source = option) })
                        Text(option.title)
                    }
                }
                when (alarm.source) {
                    AlarmSource.LOCAL_PLAYLIST -> {
                        if (playlists.isEmpty()) {
                            Text("Chưa có danh sách phát trên máy. Hãy tạo trong tab Bạn.", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 12.dp))
                        }
                        playlists.forEach { playlist ->
                            Row(
                                Modifier.fillMaxWidth().padding(start = 24.dp).clickable { alarm = alarm.copy(playlistId = playlist.id) },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(selected = alarm.playlistId == playlist.id, onClick = { alarm = alarm.copy(playlistId = playlist.id) })
                                Text("${playlist.name} (${playlist.videos.size})")
                            }
                        }
                    }
                    AlarmSource.LINK -> OutlinedTextField(
                        alarm.link.orEmpty(), { alarm = alarm.copy(link = it) },
                        singleLine = true,
                        placeholder = { Text("https://youtu.be/… hoặc liên kết danh sách phát") },
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    )
                    else -> Unit
                }
                ToggleRow(null, "Âm lượng tăng dần (30 giây)", alarm.fadeIn) { alarm = alarm.copy(fadeIn = it) }
                ToggleRow(null, "Chỉ phát âm thanh", alarm.audioOnly) { alarm = alarm.copy(audioOnly = it) }
            }
        },
        confirmButton = { TextButton(enabled = valid, onClick = { onSave(alarm) }) { Text("Lưu") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } },
    )
    if (pickingTime) {
        TimeDialog("Giờ phát", alarm.hour * 60 + alarm.minute, { pickingTime = false }) { minutes ->
            alarm = alarm.copy(hour = minutes / 60, minute = minutes % 60)
        }
    }
}
