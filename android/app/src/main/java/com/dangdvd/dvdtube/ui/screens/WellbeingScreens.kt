package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.core.storage.WatchTimeStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.player.SettingRow
import com.dangdvd.dvdtube.ui.player.ToggleRow
import com.dangdvd.dvdtube.ui.player.sleepDurationTitle
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun watchTimeText(seconds: Double): String {
    val minutes = (seconds / 60).toInt()
    return when {
        minutes < 1 -> if (seconds > 0) "< 1 phút" else "0 phút"
        minutes < 60 -> "$minutes phút"
        else -> "${minutes / 60} giờ ${minutes % 60} phút"
    }
}

/** "Time watched": today, yesterday, the last 7 days and the daily average (on this device). */
@Composable
fun WatchTimeScreen() {
    var confirmReset by remember { mutableStateOf(false) }
    var breakPicker by remember { mutableStateOf(false) }
    // Reading the map makes the screen follow new watch time.
    WatchTimeStore.secondsByDay
    val week = WatchTimeStore.lastWeek
    val maxSeconds = maxOf(week.maxOf { it.second }, 60.0)
    val dayFormat = remember { SimpleDateFormat("EEEEE", Locale("vi")) }
    ScreenScaffold("Thời gian xem") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Text("Trung bình mỗi ngày", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(watchTimeText(WatchTimeStore.dailyAverage), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Text("7 ngày qua", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(
                        Modifier.fillMaxWidth().height(150.dp).padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        week.forEachIndexed { index, (time, seconds) ->
                            Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Bottom) {
                                Box(
                                    Modifier.fillMaxWidth()
                                        .height((120 * seconds / maxSeconds).coerceAtLeast(4.0).dp)
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(if (index == week.size - 1) Brand else Brand.copy(alpha = 0.45f)),
                                )
                                Text(dayFormat.format(Date(time)), style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                HorizontalDivider()
                SettingRow(null, "Hôm nay", watchTimeText(WatchTimeStore.seconds(0))) {}
                SettingRow(null, "Hôm qua", watchTimeText(WatchTimeStore.seconds(1))) {}
                SettingRow(null, "7 ngày qua", watchTimeText(week.sumOf { it.second })) {}
                Text("Thời gian xem được tính trên thiết bị này, gồm cả phát trong nền và trên TV.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
                HorizontalDivider()
                Text("Công cụ quản lý thời gian", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 4.dp))
                SettingRow(null, "Nhắc tôi nghỉ giải lao",
                    AppSettings.breakReminderMinutes.let { if (it == 0) "Tắt" else "Sau mỗi ${sleepDurationTitle(it)}" }) { breakPicker = true }
                ToggleRow(null, "Nhắc tôi khi đến giờ đi ngủ", AppSettings.bedtimeReminder,
                    "${clockText(AppSettings.bedtimeStart)} – ${clockText(AppSettings.bedtimeEnd)} (đổi trong Cài đặt)") {
                    AppSettings.bedtimeReminder = it
                }
                TextButton(onClick = { confirmReset = true }, modifier = Modifier.padding(12.dp)) {
                    Text("Xóa thống kê thời gian xem", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
    if (breakPicker) BreakReminderDialog { breakPicker = false }
    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Xóa thống kê thời gian xem?") },
            confirmButton = { TextButton(onClick = { WatchTimeStore.reset(); confirmReset = false }) { Text("Xóa") } },
            dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Hủy") } },
        )
    }
}

fun clockText(minutes: Int): String = String.format(Locale.ROOT, "%02d:%02d", minutes / 60, minutes % 60)

@Composable
fun BreakReminderDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nhắc tôi nghỉ giải lao") },
        text = {
            Column {
                AppSettings.breakReminderOptions.forEach { minutes ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.material3.RadioButton(
                            selected = AppSettings.breakReminderMinutes == minutes,
                            onClick = { AppSettings.breakReminderMinutes = minutes; onDismiss() },
                        )
                        Text(if (minutes == 0) "Tắt" else "Sau mỗi ${sleepDurationTitle(minutes)} xem")
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Đóng") } },
    )
}

/** Videos marked "Not interested" and channels not to recommend, with undo. */
@Composable
fun HiddenContentScreen() {
    var confirmClear by remember { mutableStateOf(false) }
    val videos = HiddenContentStore.videos
    val channels = HiddenContentStore.channels
    ScreenScaffold("Nội dung đã ẩn") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            if (videos.isEmpty() && channels.isEmpty()) {
                item {
                    EmptyState(Icons.Outlined.VisibilityOff, "Chưa ẩn nội dung nào",
                        "Chọn \"Không quan tâm\" hoặc \"Không đề xuất kênh này\" trong menu ⋮ của video.")
                }
            }
            if (channels.isNotEmpty()) {
                item { SectionTitle("Kênh không đề xuất") }
                items(channels, key = { "c-" + it.id }) { channel ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(channel.avatar, 36.dp, channel.name)
                        Text(channel.name, Modifier.weight(1f).padding(horizontal = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        OutlinedButton(onClick = { HiddenContentStore.unhideChannel(channel.id) }) { Text("Bỏ ẩn") }
                    }
                }
            }
            if (videos.isNotEmpty()) {
                item { SectionTitle("Video không quan tâm") }
                items(videos, key = { "v-" + it.id }) { video ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        RemoteImage(video.displayThumbnail, Modifier.width(96.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp)))
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(video.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                            video.channelName?.let {
                                Text(it, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        OutlinedButton(onClick = { HiddenContentStore.unhideVideo(video.id) }) { Text("Bỏ ẩn") }
                    }
                }
            }
            if (videos.isNotEmpty() || channels.isNotEmpty()) {
                item {
                    TextButton(onClick = { confirmClear = true }, modifier = Modifier.padding(12.dp)) {
                        Text("Bỏ ẩn tất cả", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Bỏ ẩn tất cả video và kênh?") },
            confirmButton = { TextButton(onClick = { HiddenContentStore.clear(); confirmClear = false }) { Text("Bỏ ẩn tất cả") } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Hủy") } },
        )
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
}

/** Banner shown while incognito is on. */
@Composable
fun IncognitoBanner(modifier: Modifier = Modifier) {
    if (!AppSettings.isIncognito) return
    Row(
        modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)
            .background(Color(0xFF333333), RoundedCornerShape(12.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("Bạn đang ẩn danh", color = Color.White, style = MaterialTheme.typography.titleSmall)
            Text("Video đã xem và nội dung tìm kiếm không được lưu.", color = Color.White.copy(alpha = 0.8f),
                style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(8.dp))
        FilledTonalButton(onClick = { AppSettings.isIncognito = false }) { Text("Tắt") }
    }
}

/** "Take a break" and bedtime reminders, shown over the whole app. */
@Composable
fun WellbeingReminderDialog() {
    val kind = PlayerController.reminder ?: return
    val isBreak = kind == PlayerController.Reminder.TAKE_BREAK
    AlertDialog(
        onDismissRequest = { PlayerController.dismissReminder(kind, if (isBreak) null else 30) },
        title = { Text(if (isBreak) "Đã đến lúc nghỉ giải lao" else "Đến giờ đi ngủ rồi") },
        text = {
            Text(
                if (isBreak) "Bạn đã xem liên tục ${sleepDurationTitle(AppSettings.breakReminderMinutes)}. Hãy đứng dậy, uống nước và cho mắt nghỉ một chút. Đổi thời gian nhắc trong Cài đặt › Sức khỏe số."
                else "Đã đến giờ đi ngủ bạn đặt. Video đã tạm dừng.",
            )
        },
        confirmButton = {
            if (isBreak) {
                TextButton(onClick = { PlayerController.dismissReminder(kind); PlayerController.resume() }) { Text("Tiếp tục xem") }
            } else {
                TextButton(onClick = { PlayerController.dismissReminder(kind, 10) }) { Text("Nhắc lại sau 10 phút") }
            }
        },
        dismissButton = {
            TextButton(onClick = { PlayerController.dismissReminder(kind) }) { Text(if (isBreak) "Đóng" else "Bỏ qua đêm nay") }
        },
    )
}
