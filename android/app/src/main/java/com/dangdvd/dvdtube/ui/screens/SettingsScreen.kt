package com.dangdvd.dvdtube.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dangdvd.dvdtube.BuildConfig
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.AppTheme
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.services.NewVideoWorker
import com.dangdvd.dvdtube.core.services.SponsorBlock
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.components.shareText
import com.dangdvd.dvdtube.ui.player.SettingRow
import com.dangdvd.dvdtube.ui.player.ToggleRow
import kotlinx.coroutines.launch

private val versionText: String get() = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

private sealed class SettingsDialog {
    data object Language : SettingsDialog()
    data object Region : SettingsDialog()
    data object Theme : SettingsDialog()
    data object WifiQuality : SettingsDialog()
    data object CellularQuality : SettingsDialog()
    data object DownloadQuality : SettingsDialog()
    data object Speed : SettingsDialog()
    data object CaptionLanguage : SettingsDialog()
    data object SponsorCategories : SettingsDialog()
    data object RemoteConfig : SettingsDialog()
    data object ClearHistory : SettingsDialog()
    data object DoubleTap : SettingsDialog()
    data object BreakReminder : SettingsDialog()
    data object BedtimeStart : SettingsDialog()
    data object BedtimeEnd : SettingsDialog()
    data object CaptionSizeChoice : SettingsDialog()
    data object CaptionBackground : SettingsDialog()
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 4.dp))
}

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var dialog by remember { mutableStateOf<SettingsDialog?>(null) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) Toasts.show("Cần cho phép thông báo trong Cài đặt Android")
    }
    fun languageName(code: String) = AppSettings.languages.firstOrNull { it.first == code }?.second ?: code

    ScreenScaffold("Cài đặt") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Section("Chung")
                SettingRow(null, "Ngôn ngữ nội dung", languageName(AppSettings.language)) { dialog = SettingsDialog.Language }
                SettingRow(null, "Khu vực", AppSettings.regions.firstOrNull { it.first == AppSettings.region }?.second ?: AppSettings.region) {
                    dialog = SettingsDialog.Region
                }
                SettingRow(null, "Giao diện", AppSettings.theme.title) { dialog = SettingsDialog.Theme }
            }
            item {
                Section("Phát video")
                SettingRow(null, "Chất lượng khi dùng Wi-Fi", AppSettings.wifiQuality.title) { dialog = SettingsDialog.WifiQuality }
                SettingRow(null, "Chất lượng khi dùng dữ liệu di động", AppSettings.cellularQuality.title) { dialog = SettingsDialog.CellularQuality }
                SettingRow(null, "Tốc độ mặc định", if (AppSettings.playbackSpeed == 1f) "Chuẩn" else "${AppSettings.playbackSpeed}x") {
                    dialog = SettingsDialog.Speed
                }
                ToggleRow(null, "Tự động phát video tiếp theo", AppSettings.autoplay) { AppSettings.autoplay = it }
                ToggleRow(null, "Phát trong nền", AppSettings.backgroundPlayback, "Tiếp tục nghe khi tắt màn hình hoặc mở ứng dụng khác") {
                    AppSettings.backgroundPlayback = it
                }
                ToggleRow(null, "Tự động bật hình trong hình", AppSettings.autoPictureInPicture, "Khi rời ứng dụng lúc đang xem video") {
                    AppSettings.autoPictureInPicture = it
                }
                ToggleRow(null, "Tiếp tục từ chỗ đã xem", AppSettings.resumePlayback) { AppSettings.resumePlayback = it }
                SettingRow(null, "Chạm hai lần để tua", "${AppSettings.doubleTapSeconds} giây") { dialog = SettingsDialog.DoubleTap }
                SettingRow(null, "Ngôn ngữ phụ đề", languageName(AppSettings.captionLanguage)) { dialog = SettingsDialog.CaptionLanguage }
                SettingRow(null, "Cỡ chữ phụ đề", AppSettings.captionSize.title) { dialog = SettingsDialog.CaptionSizeChoice }
                SettingRow(null, "Nền phụ đề", captionBackgroundTitle(AppSettings.captionBackground)) { dialog = SettingsDialog.CaptionBackground }
                ToggleRow(null, "Trình phát web dự phòng", AppSettings.webPlayerFallback,
                    "Dùng trình phát nhúng của YouTube (đã chặn quảng cáo) khi luồng gốc bị từ chối") { AppSettings.webPlayerFallback = it }
            }
            item {
                Section("Tiết kiệm dữ liệu")
                ToggleRow(null, "Tiết kiệm dữ liệu khi dùng 4G/5G", AppSettings.dataSaver,
                    "Video tối đa 360p, âm thanh dung lượng nhỏ nhất, ảnh thu nhỏ cỡ nhỏ, không tải trước Shorts") {
                    AppSettings.dataSaver = it
                }
                ToggleRow(null, "Tự động chỉ phát âm thanh khi dùng 4G/5G", AppSettings.audioOnlyOnCellular,
                    "Không tải hình khi dùng dữ liệu di động") { AppSettings.audioOnlyOnCellular = it }
                ToggleRow(null, "Luôn chỉ phát âm thanh", AppSettings.audioOnlyMode,
                    "Bật/tắt nhanh bằng nút tai nghe trên trình phát") { com.dangdvd.dvdtube.player.PlayerController.switchAudioOnly(it) }
            }
            item {
                Section("Sức khỏe số")
                SettingRow(null, "Nhắc tôi nghỉ giải lao",
                    AppSettings.breakReminderMinutes.let { if (it == 0) "Tắt" else "Sau mỗi ${com.dangdvd.dvdtube.ui.player.sleepDurationTitle(it)}" }) {
                    dialog = SettingsDialog.BreakReminder
                }
                ToggleRow(null, "Nhắc tôi khi đến giờ đi ngủ", AppSettings.bedtimeReminder,
                    "Video tạm dừng và hiện lời nhắc trong khung giờ này") { AppSettings.bedtimeReminder = it }
                if (AppSettings.bedtimeReminder) {
                    SettingRow(null, "Bắt đầu", clockText(AppSettings.bedtimeStart)) { dialog = SettingsDialog.BedtimeStart }
                    SettingRow(null, "Kết thúc", clockText(AppSettings.bedtimeEnd)) { dialog = SettingsDialog.BedtimeEnd }
                }
                SettingRow(null, "Thời gian xem của bạn", null) { Router.open(Route.WatchTime()) }
            }
            item {
                Section("SponsorBlock")
                ToggleRow(null, "Tự động bỏ qua đoạn tài trợ", AppSettings.sponsorBlockEnabled, "Dữ liệu cộng đồng từ sponsor.ajay.app") {
                    AppSettings.sponsorBlockEnabled = it
                }
                if (AppSettings.sponsorBlockEnabled) {
                    SettingRow(null, "Loại đoạn cần bỏ qua", "${AppSettings.sponsorBlockCategories.size} loại") { dialog = SettingsDialog.SponsorCategories }
                }
            }
            item {
                Section("Tải xuống")
                SettingRow(null, "Chất lượng tải xuống", AppSettings.downloadQuality.title) { dialog = SettingsDialog.DownloadQuality }
                ToggleRow(null, "Chỉ tải xuống qua Wi-Fi", AppSettings.downloadOnWifiOnly) { AppSettings.downloadOnWifiOnly = it }
            }
            item {
                Section("Thông báo")
                ToggleRow(null, "Video mới từ kênh đăng ký", AppSettings.notifyNewVideos, "Kiểm tra khoảng mỗi giờ") { enabled ->
                    AppSettings.notifyNewVideos = enabled
                    if (enabled && Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    NewVideoWorker.sync(context)
                    if (enabled) scope.launch { NewVideoWorker.checkForNewVideos(context) }
                }
            }
            item {
                Section("Tài khoản")
                if (AccountStore.isSignedIn) {
                    SettingRow(null, "Đang đăng nhập", AccountStore.profile?.name) { Router.showAccountSwitcher = true }
                    ToggleRow(null, "Lưu video đã xem vào nhật ký YouTube", AppSettings.syncWatchHistory) { AppSettings.syncWatchHistory = it }
                    SettingRow(null, "Đăng xuất", null) { AccountStore.signOut() }
                } else {
                    SettingRow(null, "Đăng nhập Google", null) { Router.signIn() }
                }
                AccountStore.lastError?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(horizontal = 20.dp))
                }
            }
            item {
                Section("Quyền riêng tư")
                ToggleRow(null, "Chế độ ẩn danh", AppSettings.isIncognito,
                    "Không lưu video đã xem và tìm kiếm (máy lẫn tài khoản). Tự tắt khi mở lại ứng dụng") { AppSettings.isIncognito = it }
                ToggleRow(null, "Lưu nhật ký xem trên máy", AppSettings.saveHistory) { AppSettings.saveHistory = it }
                SettingRow(null, "Nội dung đã ẩn",
                    "${com.dangdvd.dvdtube.core.storage.HiddenContentStore.videos.size + com.dangdvd.dvdtube.core.storage.HiddenContentStore.channels.size}") {
                    Router.open(Route.HiddenContent())
                }
                SettingRow(null, "Xóa nhật ký xem", "${LibraryStore.history.size} video") { dialog = SettingsDialog.ClearHistory }
                SettingRow(null, "Xóa lịch sử tìm kiếm", "${LibraryStore.searchHistory.size}") {
                    LibraryStore.clearSearchHistory()
                    Toasts.show("Đã xóa lịch sử tìm kiếm")
                }
            }
            item {
                Section("Nâng cao")
                SettingRow(null, "Cấu hình máy khách từ xa", if (AppSettings.remoteConfigUrl.isBlank()) "Mặc định" else "Tùy chỉnh") {
                    dialog = SettingsDialog.RemoteConfig
                }
                SettingRow(null, "Nhật ký chẩn đoán", null) { Router.open(Route.Diagnostics()) }
            }
            item {
                Section("Giới thiệu")
                SettingRow(null, "Phiên bản", versionText) {}
                Text(
                    "DVDTube phát video YouTube không quảng cáo bằng API công khai của YouTube. Ứng dụng không liên kết với Google.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
                androidx.compose.foundation.layout.Spacer(Modifier.heightIn(min = 24.dp))
            }
        }
    }

    when (dialog) {
        SettingsDialog.Language -> ChoiceDialog("Ngôn ngữ nội dung", AppSettings.languages, AppSettings.language, { dialog = null }) {
            AppSettings.language = it
        }
        SettingsDialog.Region -> ChoiceDialog("Khu vực", AppSettings.regions, AppSettings.region, { dialog = null }) { AppSettings.region = it }
        SettingsDialog.Theme -> ChoiceDialog("Giao diện", AppTheme.entries.map { it to it.title }, AppSettings.theme, { dialog = null }) {
            AppSettings.theme = it
        }
        SettingsDialog.WifiQuality -> ChoiceDialog("Chất lượng khi dùng Wi-Fi", VideoQuality.entries.map { it to it.title }, AppSettings.wifiQuality,
            { dialog = null }) { AppSettings.wifiQuality = it }
        SettingsDialog.CellularQuality -> ChoiceDialog("Chất lượng khi dùng dữ liệu di động", VideoQuality.entries.map { it to it.title },
            AppSettings.cellularQuality, { dialog = null }) { AppSettings.cellularQuality = it }
        SettingsDialog.DownloadQuality -> ChoiceDialog("Chất lượng tải xuống", VideoQuality.entries.filter { it != VideoQuality.AUTO }.map { it to it.title },
            AppSettings.downloadQuality, { dialog = null }) { AppSettings.downloadQuality = it }
        SettingsDialog.Speed -> ChoiceDialog("Tốc độ mặc định", AppSettings.speeds.map { it to if (it == 1f) "Chuẩn" else "${it}x" },
            AppSettings.playbackSpeed, { dialog = null }) { AppSettings.playbackSpeed = it }
        SettingsDialog.CaptionLanguage -> ChoiceDialog("Ngôn ngữ phụ đề", AppSettings.languages, AppSettings.captionLanguage, { dialog = null }) {
            AppSettings.captionLanguage = it
        }
        SettingsDialog.SponsorCategories -> {
            var selected by remember { mutableStateOf(AppSettings.sponsorBlockCategories.toSet()) }
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text("Loại đoạn cần bỏ qua") },
                text = {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        SponsorBlock.allCategories.forEach { (key, title) ->
                            Row(Modifier.fillMaxWidth().clickable {
                                selected = if (key in selected) selected - key else selected + key
                            }, verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = key in selected, onCheckedChange = {
                                    selected = if (it) selected + key else selected - key
                                })
                                Text(title)
                            }
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = { AppSettings.sponsorBlockCategories = selected.toList(); dialog = null }) { Text("Lưu") }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text("Hủy") } },
            )
        }
        SettingsDialog.RemoteConfig -> {
            var url by remember { mutableStateOf(AppSettings.remoteConfigUrl) }
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text("Cấu hình máy khách từ xa") },
                text = {
                    Column {
                        Text("Khi YouTube thay đổi, chỉ cần cập nhật tệp cấu hình JSON thay vì cài lại ứng dụng. Để trống để dùng địa chỉ mặc định.",
                            style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(url, { url = it }, singleLine = true, placeholder = { Text(APIConfig.DEFAULT_REMOTE_CONFIG_URL) },
                            modifier = Modifier.padding(top = 8.dp))
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        AppSettings.remoteConfigUrl = url.trim()
                        dialog = null
                        scope.launch {
                            APIConfig.refreshRemoteConfig()
                            Toasts.show("Đã cập nhật cấu hình")
                        }
                    }) { Text("Lưu và tải lại") }
                },
                dismissButton = {
                    TextButton(onClick = {
                        APIConfig.clearRemoteConfig()
                        dialog = null
                        Toasts.show("Đã dùng cấu hình tích hợp")
                    }) { Text("Dùng mặc định") }
                },
            )
        }
        SettingsDialog.DoubleTap -> ChoiceDialog("Chạm hai lần để tua", AppSettings.doubleTapOptions.map { it to "$it giây" },
            AppSettings.doubleTapSeconds, { dialog = null }) { AppSettings.doubleTapSeconds = it }
        SettingsDialog.BreakReminder -> BreakReminderDialog { dialog = null }
        SettingsDialog.BedtimeStart -> TimeDialog("Bắt đầu giờ đi ngủ", AppSettings.bedtimeStart, { dialog = null }) { AppSettings.bedtimeStart = it }
        SettingsDialog.BedtimeEnd -> TimeDialog("Kết thúc giờ đi ngủ", AppSettings.bedtimeEnd, { dialog = null }) { AppSettings.bedtimeEnd = it }
        SettingsDialog.CaptionSizeChoice -> ChoiceDialog("Cỡ chữ phụ đề", com.dangdvd.dvdtube.core.CaptionSize.entries.map { it to it.title },
            AppSettings.captionSize, { dialog = null }) { AppSettings.captionSize = it }
        SettingsDialog.CaptionBackground -> ChoiceDialog("Nền phụ đề", listOf(0f, 0.5f, 0.75f, 1f).map { it to captionBackgroundTitle(it) },
            AppSettings.captionBackground, { dialog = null }) { AppSettings.captionBackground = it }
        SettingsDialog.ClearHistory -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Xóa toàn bộ nhật ký xem trên máy?") },
            confirmButton = { TextButton(onClick = { LibraryStore.clearHistory(); dialog = null }) { Text("Xóa") } },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Hủy") } },
        )
        null -> {}
    }
}

@Composable
private fun <T> ChoiceDialog(title: String, options: List<Pair<T, String>>, selected: T, onDismiss: () -> Unit, onSelect: (T) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                options.forEach { (value, label) ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onSelect(value); onDismiss() }.padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = value == selected, onClick = { onSelect(value); onDismiss() })
                        Text(label)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Đóng") } },
    )
}

@Composable
fun DiagnosticsScreen() {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var refresh by remember { mutableIntStateOf(0) }
    val text = remember(refresh) { Log.text(versionText) }
    ScreenScaffold("Nhật ký chẩn đoán", actions = {
        IconButton(onClick = {
            clipboard.setText(AnnotatedString(text))
            Toasts.show("Đã sao chép nhật ký")
        }) { Icon(Icons.Default.ContentCopy, "Sao chép") }
        IconButton(onClick = { shareText(context, text, "Nhật ký DVDTube") }) { Icon(Icons.Default.Share, "Chia sẻ") }
        IconButton(onClick = { Log.clear(); refresh++ }) { Icon(Icons.Default.Delete, "Xóa") }
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Text("Nhật ký chỉ chứa địa chỉ API, mã trạng thái và lỗi — không có cookie hay dữ liệu tài khoản.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            HorizontalDivider()
            SelectionContainer(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
                Text(text, fontFamily = FontFamily.Monospace, fontSize = 11.sp, modifier = Modifier.padding(12.dp))
            }
        }
    }
}

private fun captionBackgroundTitle(value: Float): String = when {
    value <= 0f -> "Không có"
    value <= 0.5f -> "Mờ"
    value < 1f -> "Đậm"
    else -> "Đen"
}

/** Picks a time of day (minutes after midnight). */
@Composable
private fun TimeDialog(title: String, minutes: Int, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val state = androidx.compose.material3.rememberTimePickerState(initialHour = minutes / 60, initialMinute = minutes % 60, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { androidx.compose.material3.TimePicker(state = state) },
        confirmButton = { TextButton(onClick = { onPick(state.hour * 60 + state.minute); onDismiss() }) { Text("Lưu") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } },
    )
}
