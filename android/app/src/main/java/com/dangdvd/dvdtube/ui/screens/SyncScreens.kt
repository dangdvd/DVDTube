package com.dangdvd.dvdtube.ui.screens

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.sync.LanSync
import com.dangdvd.dvdtube.core.sync.LibrarySync
import com.dangdvd.dvdtube.core.sync.SyncReceiver
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.tv.TvPairingServer
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.player.SettingRow
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Scans another device's "Đồng bộ thư viện" QR code with Google's code scanner. */
fun scanSyncCode(context: Context) {
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { barcode ->
            val invite = barcode.rawValue?.let(LanSync::parse)
            if (invite == null) Toasts.show("Đây không phải mã đồng bộ DVDTube") else Router.syncInvite = invite
        }
        .addOnFailureListener { error ->
            Log.debug("sync scanner: ${error.message}")
            Toasts.show("Không mở được trình quét mã QR (cần Google Play services)")
        }
}

/** Writes the library to the cache and opens the share sheet. */
private fun shareLibrary(context: Context) {
    val file = runCatching {
        val folder = File(context.cacheDir, "export").apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        File(folder, LibrarySync.exportFileName()).also { it.writeText(LibrarySync.toJson(LibrarySync.local())) }
    }.getOrNull()
    if (file == null) {
        Toasts.show("Không tạo được tệp thư viện")
        return
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val intent = Intent(Intent.ACTION_SEND).setType("application/json")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .putExtra(Intent.EXTRA_SUBJECT, file.name)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(Intent.createChooser(intent, "Xuất thư viện"))
    } catch (error: ActivityNotFoundException) {
        Toasts.show("Không có ứng dụng nào để chia sẻ tệp")
    }
}

/** Settings › "Đồng bộ & sao lưu". */
@Composable
fun SyncBackupScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showQr by remember { mutableStateOf(false) }
    var summary by remember { mutableStateOf<String?>(null) }
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        val text = LibrarySync.toJson(LibrarySync.local())
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) } != null }.getOrDefault(false)
            }
            Toasts.show(if (ok) "Đã xuất thư viện" else "Không ghi được tệp")
        }
    }
    val opener = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) } }.getOrNull()
            }
            val library = text?.let(LibrarySync::parse)
            if (library == null) {
                Toasts.show("Tệp này không phải thư viện DVDTube")
                return@launch
            }
            val result = LibrarySync.mergeIntoLocal(library)
            Toasts.show(result.text)
            summary = result.text
        }
    }
    ScreenScaffold("Đồng bộ & sao lưu") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Text(
                    "Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nhật ký tìm kiếm trên máy này " +
                        "(${LibraryStore.subscriptions.size} kênh, ${LibraryStore.history.size} video đã xem, ${LibraryStore.playlists.size} danh sách phát). " +
                        "Đồng bộ gộp hai thư viện lại với nhau, không xóa gì.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
                SettingsSectionTitle("Qua Wi-Fi giữa các thiết bị")
                SettingRow(Icons.Default.QrCode2, "Hiện mã QR để nhận", "Thiết bị kia quét mã này") { showQr = true }
                SettingRow(Icons.Default.QrCodeScanner, "Quét mã QR của thiết bị khác", null) { scanSyncCode(context) }
                SettingsSectionTitle("Bằng tệp")
                SettingRow(Icons.Default.Share, "Xuất thư viện", "Chia sẻ tệp") { shareLibrary(context) }
                SettingRow(Icons.Default.Save, "Lưu thư viện vào tệp", null) { saver.launch(LibrarySync.exportFileName()) }
                SettingRow(Icons.Default.FileUpload, "Nhập thư viện", "Chọn tệp .json") {
                    runCatching { opener.launch(arrayOf("application/json", "text/plain", "application/octet-stream", "*/*")) }
                        .onFailure { Toasts.show("Không mở được trình chọn tệp") }
                }
            }
        }
    }
    if (showQr) SyncReceiveDialog { showQr = false }
    summary?.let { text ->
        AlertDialog(
            onDismissRequest = { summary = null },
            icon = { androidx.compose.material3.Icon(Icons.Default.FileDownload, null) },
            title = { Text("Đã nhập thư viện") },
            text = { Text(text) },
            confirmButton = { TextButton(onClick = { summary = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun SettingsSectionTitle(title: String) {
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp))
}

/** This phone receives: a one-time QR code (10 minutes) that another device scans. */
@Composable
fun SyncReceiveDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val receiver = remember { SyncReceiver(context) }
    DisposableEffect(receiver) {
        receiver.start()
        onDispose { receiver.stop() }
    }
    var expired by remember { mutableStateOf(false) }
    LaunchedEffect(receiver) {
        delay(LanSync.LIFETIME_MS)
        expired = true
        receiver.stop()
    }
    val result = receiver.result
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (result != null) "Đã đồng bộ" else "Đồng bộ thư viện") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                when {
                    result != null -> Text(result.text)
                    expired -> Text("Mã đã hết hạn. Đóng và mở lại để tạo mã mới.")
                    receiver.error != null -> Text(receiver.error ?: "", color = MaterialTheme.colorScheme.error)
                    receiver.link != null -> {
                        val link = receiver.link ?: ""
                        val image = remember(link) { TvPairingServer.qrCode(link, 560) }
                        Box(Modifier.size(240.dp).background(Color.White, RoundedCornerShape(12.dp)).padding(10.dp)) {
                            Image(image, "Mã QR đồng bộ", Modifier.fillMaxSize())
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "Quét bằng DVDTube trên thiết bị kia (Cài đặt › Đồng bộ & sao lưu › Quét mã QR), hoặc Camera trên iPhone. " +
                                "Hai thiết bị phải cùng mạng Wi-Fi. Mã dùng một lần, hết hạn sau 10 phút.",
                            style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
                        )
                        receiver.address?.let {
                            Text("${receiver.deviceName} • $it", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                        }
                        if (receiver.isBusy) {
                            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("Đang đồng bộ…", color = Brand)
                            }
                        }
                    }
                    else -> CircularProgressIndicator()
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(if (result != null) "Xong" else "Đóng") } },
    )
}

/** "Đồng bộ thư viện với <name>?" after scanning / opening a `dvdtube://sync` link. */
@Composable
fun SyncConfirmDialog(invite: LanSync.Invite, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var sending by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    if (result != null) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Đã đồng bộ với ${invite.name}") },
            text = { Text(result ?: "") },
            confirmButton = { TextButton(onClick = onDismiss) { Text("Xong") } },
        )
        return
    }
    AlertDialog(
        onDismissRequest = { if (!sending) onDismiss() },
        title = { Text("Đồng bộ thư viện với ${invite.name}?") },
        text = {
            Text(
                "Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nhật ký tìm kiếm của hai thiết bị sẽ được gộp lại " +
                    "(${invite.address}, qua Wi-Fi nội bộ, mã hoá bằng khoá trong mã QR). Không có dữ liệu tài khoản nào được gửi.",
            )
        },
        confirmButton = {
            TextButton(enabled = !sending, onClick = {
                sending = true
                scope.launch {
                    try {
                        result = LanSync.send(invite).text
                    } catch (cancel: CancellationException) {
                        throw cancel
                    } catch (error: Exception) {
                        Toasts.show(error.message ?: "Không đồng bộ được.")
                        sending = false
                    }
                }
            }) {
                if (sending) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Text("Đang đồng bộ…")
                    }
                } else {
                    Text("Đồng bộ")
                }
            }
        },
        dismissButton = { TextButton(enabled = !sending, onClick = onDismiss) { Text("Hủy") } },
    )
}
