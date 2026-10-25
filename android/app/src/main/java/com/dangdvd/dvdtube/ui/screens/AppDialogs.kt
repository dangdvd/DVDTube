package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.LogExport
import com.dangdvd.dvdtube.core.services.AppUpdater
import com.dangdvd.dvdtube.player.Toasts

/** "Có bản mới v1.0.N" with the release notes. */
@Composable
fun UpdateDialog() {
    val release = AppUpdater.available ?: return
    val context = LocalContext.current
    val progress = AppUpdater.progress
    AlertDialog(
        onDismissRequest = { if (progress == null) AppUpdater.available = null },
        icon = { Icon(Icons.Default.SystemUpdate, null) },
        title = { Text("Có bản mới v${release.version}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 360.dp)) {
                Text("Bạn đang dùng v${AppUpdater.currentVersion}. Bản cập nhật cài đè lên bản hiện tại và giữ nguyên dữ liệu.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (release.notes.isNotBlank()) {
                    Text(release.notes, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
                }
                if (progress != null) {
                    LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().padding(top = 14.dp))
                    Text("Đang tải… ${(progress * 100).toInt()}%", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 4.dp))
                }
            }
        },
        confirmButton = {
            TextButton(enabled = progress == null, onClick = { AppUpdater.downloadAndInstall(context, release) }) {
                Text(if (release.apkUrl == null) "Mở trang tải" else "Cập nhật")
            }
        },
        dismissButton = {
            TextButton(onClick = {
                if (progress != null) AppUpdater.cancelDownload()
                AppUpdater.available = null
            }) { Text(if (progress != null) "Hủy tải" else "Để sau") }
        },
    )
}

/** "Gửi nhật ký lỗi": share the scrubbed log file or copy it. */
@Composable
fun LogExportDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Gửi nhật ký lỗi") },
        text = {
            Text(
                "Tệp nhật ký gồm phiên bản ứng dụng, thiết bị, tóm tắt cài đặt, loại mạng, các dòng nhật ký và lỗi gần đây. " +
                    "Cookie, mã đăng nhập, email và khoá ghép nối đã được xóa; không có nhật ký xem hay tìm kiếm.",
            )
        },
        confirmButton = {
            TextButton(onClick = {
                onDismiss()
                LogExport.share(context)
            }) { Text("Chia sẻ tệp") }
        },
        dismissButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(LogExport.build(context)))
                Toasts.show("Đã sao chép nhật ký")
                onDismiss()
            }) { Text("Sao chép") }
        },
    )
}
