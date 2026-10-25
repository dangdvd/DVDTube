package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockClock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.ParentalControls
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.core.storage.WatchTimeStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.player.SettingRow
import com.dangdvd.dvdtube.ui.player.ToggleRow
import com.dangdvd.dvdtube.ui.player.sleepDurationTitle

/** Daily limits offered (minutes, 0 = off). */
val parentalLimitOptions = listOf(0, 15, 30, 45, 60, 90, 120, 180, 240)

fun parentalLimitTitle(minutes: Int): String = if (minutes == 0) "Tắt" else sleepDurationTitle(minutes)

fun watchedTodayText(): String {
    val minutes = (WatchTimeStore.seconds(0) / 60).toInt()
    return if (minutes >= 60) "${minutes / 60} giờ ${minutes % 60} phút" else "$minutes phút"
}

private sealed class ParentalDialog {
    data object Limit : ParentalDialog()
    data object WindowStart : ParentalDialog()
    data object WindowEnd : ParentalDialog()
    data object Keywords : ParentalDialog()
    data object NewPin : ParentalDialog()
    data object TurnOff : ParentalDialog()
}

/** Settings › "Kiểm soát của phụ huynh" (opened behind the PIN). */
@Composable
fun ParentalScreen() {
    var dialog by remember { mutableStateOf<ParentalDialog?>(null) }
    val enabled = ParentalControls.isEnabled
    fun change(action: () -> Unit) = ParentalControls.guard("Nhập mã PIN để thay đổi Kiểm soát của phụ huynh", action)
    ScreenScaffold("Kiểm soát của phụ huynh") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            if (!enabled) {
                item {
                    Column(Modifier.padding(20.dp)) {
                        Icon(Icons.Default.Lock, null, tint = Brand, modifier = Modifier.size(40.dp))
                        Spacer(Modifier.height(10.dp))
                        Text("Bảo vệ bằng mã PIN 4 chữ số", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Chế độ hạn chế, giới hạn thời gian xem mỗi ngày, khung giờ được xem, chặn từ khóa và kênh, ẩn bình luận, Shorts hoặc tìm kiếm. " +
                                "Thay đổi cài đặt, đăng nhập / đăng xuất hoặc tắt tính năng này đều cần mã PIN.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                        Button(onClick = { dialog = ParentalDialog.NewPin }) { Text("Bật và đặt mã PIN") }
                    }
                }
                return@LazyColumn
            }
            item {
                val remaining = ParentalControls.remainingSeconds
                Text(
                    "Hôm nay đã xem ${watchedTodayText()}" + (remaining?.let { ", còn ${maxOf(it / 60, 0)} phút" } ?: ""),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                ToggleRow(null, "Chế độ hạn chế", AppSettings.parentalRestricted, "Yêu cầu YouTube ẩn nội dung có thể không phù hợp") {
                    change { AppSettings.parentalRestricted = it }
                }
                SettingRow(null, "Giới hạn thời gian xem mỗi ngày", parentalLimitTitle(AppSettings.parentalDailyLimit)) {
                    change { dialog = ParentalDialog.Limit }
                }
                ToggleRow(null, "Khung giờ được xem", AppSettings.parentalWindowEnabled,
                    "${clockText(AppSettings.parentalWindowStart)} – ${clockText(AppSettings.parentalWindowEnd)}") {
                    change { AppSettings.parentalWindowEnabled = it }
                }
                if (AppSettings.parentalWindowEnabled) {
                    SettingRow(null, "Từ", clockText(AppSettings.parentalWindowStart)) { change { dialog = ParentalDialog.WindowStart } }
                    SettingRow(null, "Đến", clockText(AppSettings.parentalWindowEnd)) { change { dialog = ParentalDialog.WindowEnd } }
                }
                val words = AppSettings.parentalKeywords.split(',', '\n', ';').count { it.isNotBlank() }
                SettingRow(null, "Chặn từ khóa", if (words == 0) "Chưa có" else "$words từ") { change { dialog = ParentalDialog.Keywords } }
                SettingRow(null, "Chặn kênh", "${HiddenContentStore.channelCount} kênh") { change { Router.open(Route.HiddenContent()) } }
                ToggleRow(null, "Ẩn bình luận", AppSettings.parentalHideComments) { change { AppSettings.parentalHideComments = it } }
                ToggleRow(null, "Ẩn Shorts", AppSettings.parentalHideShorts) { change { AppSettings.parentalHideShorts = it } }
                ToggleRow(null, "Tắt tìm kiếm", AppSettings.parentalNoSearch) { change { AppSettings.parentalNoSearch = it } }
                SettingRow(null, "Đổi mã PIN", null) { change { dialog = ParentalDialog.NewPin } }
                SettingRow(null, "Khóa lại ngay", null) {
                    ParentalControls.lockSettings()
                    Router.back()
                }
                TextButton(onClick = { change { dialog = ParentalDialog.TurnOff } }, modifier = Modifier.padding(12.dp)) {
                    Text("Tắt kiểm soát của phụ huynh", color = MaterialTheme.colorScheme.error)
                }
                Text(
                    "Kênh bị chặn là các kênh đã chọn \"Không đề xuất kênh này\"; khi bật kiểm soát của phụ huynh, chúng bị ẩn ở mọi nơi.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
        }
    }

    when (dialog) {
        ParentalDialog.Limit -> ChoiceDialog("Giới hạn thời gian xem mỗi ngày", parentalLimitOptions.map { it to parentalLimitTitle(it) },
            AppSettings.parentalDailyLimit, { dialog = null }) { AppSettings.parentalDailyLimit = it }
        ParentalDialog.WindowStart -> TimeDialog("Được xem từ", AppSettings.parentalWindowStart, { dialog = null }) { AppSettings.parentalWindowStart = it }
        ParentalDialog.WindowEnd -> TimeDialog("Được xem đến", AppSettings.parentalWindowEnd, { dialog = null }) { AppSettings.parentalWindowEnd = it }
        ParentalDialog.Keywords -> KeywordsDialog { dialog = null }
        ParentalDialog.NewPin -> NewPinDialog(onDismiss = { dialog = null }) { pin ->
            if (ParentalControls.isEnabled) {
                ParentalControls.changePin(pin)
                Toasts.show("Đã đổi mã PIN")
            } else {
                ParentalControls.enable(pin)
                Toasts.show("Đã bật kiểm soát của phụ huynh")
            }
            dialog = null
        }
        ParentalDialog.TurnOff -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Tắt kiểm soát của phụ huynh?") },
            text = { Text("Các giới hạn sẽ ngừng áp dụng. Cài đặt và mã PIN được giữ lại cho lần bật sau.") },
            confirmButton = { TextButton(onClick = { ParentalControls.disable(); dialog = null }) { Text("Tắt") } },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Hủy") } },
        )
        null -> Unit
    }
}

@Composable
private fun KeywordsDialog(onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(AppSettings.parentalKeywords) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Chặn từ khóa") },
        text = {
            Column {
                Text("Video có tiêu đề hoặc tên kênh chứa một trong các từ này bị ẩn khỏi mọi danh sách (không phân biệt hoa thường và dấu). " +
                    "Ngăn cách bằng dấu phẩy hoặc xuống dòng.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(text, { text = it }, minLines = 3, maxLines = 8, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            }
        },
        confirmButton = { TextButton(onClick = { AppSettings.parentalKeywords = text.trim(); onDismiss() }) { Text("Lưu") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } },
    )
}

@Composable
private fun PinField(value: String, label: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.filter(Char::isDigit).take(4)) },
        label = { Text(label) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
    )
}

/** Picks a new 4-digit PIN (typed twice). */
@Composable
fun NewPinDialog(onDismiss: () -> Unit, onPin: (String) -> Unit) {
    var first by remember { mutableStateOf("") }
    var second by remember { mutableStateOf("") }
    val mismatch = second.length == 4 && first != second
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Đặt mã PIN") },
        text = {
            Column {
                Text("Mã PIN gồm 4 chữ số. Hãy nhớ kỹ: nếu quên, chỉ có thể đặt lại toàn bộ kiểm soát của phụ huynh.",
                    style = MaterialTheme.typography.bodySmall)
                PinField(first, "Mã PIN mới") { first = it }
                PinField(second, "Nhập lại mã PIN") { second = it }
                if (mismatch) Text("Hai mã PIN không khớp", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(enabled = ParentalControls.isValidPin(first) && first == second, onClick = { onPin(first) }) { Text("Lưu") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } },
    )
}

/** Asks for the PIN when something protected is requested ([ParentalControls.guard]). */
@Composable
fun ParentalPinPrompt() {
    val request = ParentalControls.pinRequest ?: return
    var pin by remember(request) { mutableStateOf("") }
    var wrong by remember(request) { mutableStateOf(false) }
    var forgot by remember(request) { mutableStateOf(false) }
    if (forgot) {
        AlertDialog(
            onDismissRequest = { forgot = false },
            title = { Text("Quên mã PIN?") },
            text = { Text("Không có cách khôi phục mã PIN. Đặt lại sẽ xóa mã PIN và đưa toàn bộ kiểm soát của phụ huynh về mặc định (tắt).") },
            confirmButton = {
                TextButton(onClick = {
                    ParentalControls.cancelPin()
                    ParentalControls.resetAll()
                    Toasts.show("Đã đặt lại kiểm soát của phụ huynh")
                }) { Text("Đặt lại", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { forgot = false }) { Text("Hủy") } },
        )
        return
    }
    AlertDialog(
        onDismissRequest = { ParentalControls.cancelPin() },
        icon = { Icon(Icons.Default.Lock, null) },
        title = { Text("Nhập mã PIN") },
        text = {
            Column {
                Text(request.title, style = MaterialTheme.typography.bodyMedium)
                PinField(pin, "Mã PIN") {
                    pin = it
                    wrong = false
                    if (it.length == 4 && !ParentalControls.submitPin(it)) wrong = true
                }
                if (wrong) Text("Sai mã PIN", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { forgot = true }) { Text("Quên mã PIN") }
            }
        },
        confirmButton = {
            TextButton(enabled = pin.length == 4, onClick = { if (!ParentalControls.submitPin(pin)) wrong = true }) { Text("Mở khóa") }
        },
        dismissButton = { TextButton(onClick = { ParentalControls.cancelPin() }) { Text("Hủy") } },
    )
}

/** Full-screen lock when today's time is used up or outside the allowed hours. */
@Composable
fun ParentalLockOverlay() {
    val reason = ParentalControls.lockReason ?: return
    var pin by remember(reason) { mutableStateOf("") }
    var wrong by remember(reason) { mutableStateOf(false) }
    fun extend(minutes: Int?) {
        if (ParentalControls.checkPin(pin)) {
            ParentalControls.extend(minutes)
            Toasts.show(if (minutes == null) "Đã mở khóa đến hết hôm nay" else "Đã thêm $minutes phút")
        } else {
            wrong = true
        }
    }
    Box(
        Modifier.fillMaxSize().background(Color(0xF2101010))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
        contentAlignment = Alignment.Center,
    ) {
        Column(Modifier.widthIn(max = 420.dp).padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.LockClock, null, tint = Brand, modifier = Modifier.size(56.dp))
            Spacer(Modifier.height(14.dp))
            Text(reason.title, color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(6.dp))
            Text(
                reason.message + " Hôm nay đã xem ${watchedTodayText()}." +
                    if (AppSettings.parentalWindowEnabled) " Khung giờ được xem: ${clockText(AppSettings.parentalWindowStart)} – ${clockText(AppSettings.parentalWindowEnd)}." else "",
                color = Color.White.copy(alpha = 0.8f), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(16.dp))
            Text("Phụ huynh nhập mã PIN để cho xem thêm", color = Color.White, style = MaterialTheme.typography.labelLarge)
            PinField(pin, "Mã PIN") { pin = it; wrong = false }
            if (wrong) Text("Sai mã PIN", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(enabled = pin.length == 4, onClick = { extend(15) }) { Text("+15 phút") }
                FilledTonalButton(enabled = pin.length == 4, onClick = { extend(30) }) { Text("+30 phút") }
            }
            Button(enabled = pin.length == 4, onClick = { extend(null) }, modifier = Modifier.padding(top = 8.dp)) { Text("Hết hôm nay") }
            OutlinedButton(onClick = { ParentalControls.dismissLock() }, modifier = Modifier.padding(top = 16.dp)) { Text("Đóng", color = Color.White) }
        }
    }
}
