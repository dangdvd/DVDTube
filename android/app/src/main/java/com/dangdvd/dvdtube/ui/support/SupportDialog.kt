package com.dangdvd.dvdtube.ui.support

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.dangdvd.dvdtube.R
import com.dangdvd.dvdtube.ui.Brand
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The author's bank account for "Ủng hộ tác giả" (same as the VietQR in R.drawable.donate_qr). */
object Donation {
    const val ACCOUNT_NAME = "DANG VAN DANG"
    const val ACCOUNT_NUMBER = "19033516270019"
    const val BANK_NAME = "Techcombank"
    /** Bank code used by VietQR's deeplinks (`ba=<account>@<bank>`). */
    private const val BANK_CODE = "tcb"
    private const val TRANSFER_NOTE = "Ung ho DVDTube"

    /**
     * Bank apps VietQR's deeplink service opens with the recipient, name and note filled in
     * (app ids of https://api.vietqr.io/v2/android-app-deeplinks).
     */
    val autofillApps = listOf(
        "mb" to "MB Bank", "bidv" to "BIDV", "icb" to "VietinBank", "acb" to "ACB", "ocb" to "OCB",
    )

    /**
     * Bank apps the deeplink only opens: they accept no transfer details from other apps,
     * so the account number is copied and the QR saved to the gallery before opening them.
     */
    val otherApps = listOf(
        "vcb" to "Vietcombank", "tcb" to "Techcombank", "vba" to "Agribank", "vpb" to "VPBank",
        "tpb" to "TPBank", "stb" to "Sacombank", "vib-2" to "VIB", "hdb" to "HDBank",
        "shb" to "SHB", "msb" to "MSB", "seab" to "SeABank", "lpb" to "LPBank",
        "eib" to "Eximbank", "cake" to "Cake", "timo" to "Timo",
    )

    /** "1903 3516 2700 19", as printed under the QR code. */
    val formattedAccountNumber = ACCOUNT_NUMBER.chunked(4).joinToString(" ")

    /** Opens the bank app with the transfer to the author filled in (the amount is left to the user). */
    fun bankAppLink(appId: String): Uri = Uri.parse("https://dl.vietqr.io/pay").buildUpon()
        .appendQueryParameter("app", appId)
        .appendQueryParameter("ba", "$ACCOUNT_NUMBER@$BANK_CODE")
        .appendQueryParameter("tn", TRANSFER_NOTE)
        .appendQueryParameter("bn", ACCOUNT_NAME)
        .build()

    /** Copies the QR card into Pictures/DVDTube so a bank app can scan it from the gallery. */
    suspend fun saveQrToGallery(context: Context): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, "DVDTube-ung-ho-tac-gia.png")
                put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/DVDTube")
                }
            }
            val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else {
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            }
            val uri = resolver.insert(collection, values) ?: error("insert failed")
            resolver.openOutputStream(uri)?.use { out ->
                context.resources.openRawResource(R.drawable.donate_qr).use { it.copyTo(out) }
            } ?: error("no output stream")
            true
        }.getOrDefault(false)
    }
}

/**
 * "Ủng hộ tác giả": the author's VietQR, plus links that open a bank app on this phone
 * for people who have no second device to scan the code with.
 */
@Composable
fun SupportDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var qrSaved by remember { mutableStateOf(false) }
    // A bank app that can't be filled in: the steps are shown before leaving for it.
    var guideApp by remember { mutableStateOf<Pair<String, String>?>(null) }

    fun openBankApp(id: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Donation.bankAppLink(id)))
        } catch (_: ActivityNotFoundException) {
            status = "Không có trình duyệt để mở liên kết. Hãy lưu mã QR rồi quét từ ảnh."
        }
    }

    fun saveQr() {
        saving = true
        scope.launch {
            qrSaved = Donation.saveQrToGallery(context)
            status = if (qrSaved) {
                "Đã lưu vào Ảnh › Pictures/DVDTube. Mở ứng dụng ngân hàng › Quét QR › chọn ảnh vừa lưu."
            } else {
                "Không lưu được ảnh vào thư viện."
            }
            saving = false
        }
    }

    @Composable
    fun BankGrid(apps: List<Pair<String, String>>) {
        apps.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { app ->
                    OutlinedButton(
                        onClick = {
                            // Also handy when an app fills in less than asked: the number is ready to paste.
                            clipboard.setText(AnnotatedString(Donation.ACCOUNT_NUMBER))
                            if (app in Donation.autofillApps) {
                                openBankApp(app.first)
                            } else {
                                guideApp = app
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text(app.second, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }

    guideApp?.let { app ->
        val name = app.second
        AlertDialog(
            onDismissRequest = { guideApp = null },
            title = { Text("Mở $name") },
            text = {
                Text("$name chưa cho phép ứng dụng khác điền sẵn người nhận. DVDTube sẽ sao chép số tài khoản và lưu mã QR " +
                    "vào ảnh, rồi mở $name. Trong ứng dụng, chọn một cách:\n\n" +
                    "• Quét QR › biểu tượng ảnh › chọn ảnh mã QR vừa lưu (nhanh nhất)\n" +
                    "• Chuyển tiền › dán số tài khoản ${Donation.formattedAccountNumber}, ngân hàng ${Donation.BANK_NAME}")
            },
            confirmButton = {
                TextButton(onClick = {
                    guideApp = null
                    clipboard.setText(AnnotatedString(Donation.ACCOUNT_NUMBER))
                    scope.launch {
                        if (!qrSaved) qrSaved = Donation.saveQrToGallery(context)
                        openBankApp(app.first)
                    }
                }) { Text("Mở $name") }
            },
            dismissButton = { TextButton(onClick = { guideApp = null }) { Text("Hủy") } },
        )
    }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2000)
            copied = false
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                TopAppBar(
                    title = { Text("Ủng hộ tác giả") },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Đóng") } },
                )
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Column(
                        Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(Icons.Default.Favorite, null, Modifier.size(44.dp), tint = Brand)
                        Spacer(Modifier.height(10.dp))
                        Text("Cảm ơn bạn đã dùng DVDTube!", style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "DVDTube miễn phí và không có quảng cáo. Nếu thấy ứng dụng hữu ích, bạn có thể ủng hộ tác giả " +
                                "một ly cà phê để có thêm động lực duy trì và phát triển ứng dụng. Mọi sự ủng hộ, dù nhỏ, đều rất đáng quý.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(20.dp))
                        Image(
                            painterResource(R.drawable.donate_qr),
                            "Mã QR chuyển khoản VietQR tới ${Donation.ACCOUNT_NAME}",
                            Modifier.widthIn(max = 300.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)),
                        )
                        Spacer(Modifier.height(10.dp))
                        Text("Quét mã bằng ứng dụng ngân hàng hoặc ví điện tử có hỗ trợ VietQR.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center)
                        Spacer(Modifier.height(20.dp))

                        Column(
                            Modifier.fillMaxWidth()
                                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(14.dp))
                                .padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            AccountRow("Chủ tài khoản", Donation.ACCOUNT_NAME)
                            AccountRow("Ngân hàng", Donation.BANK_NAME)
                            AccountRow("Số tài khoản", Donation.formattedAccountNumber)
                            OutlinedButton(
                                onClick = {
                                    clipboard.setText(AnnotatedString(Donation.ACCOUNT_NUMBER))
                                    copied = true
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(if (copied) Icons.Default.Check else Icons.Default.ContentCopy, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(if (copied) "Đã sao chép số tài khoản" else "Sao chép số tài khoản")
                            }
                        }
                        Spacer(Modifier.height(24.dp))

                        Column(Modifier.fillMaxWidth()) {
                            Text("Chuyển khoản ngay trên điện thoại này", style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(4.dp))
                            Text("Chọn ứng dụng ngân hàng bạn đang dùng.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(12.dp))
                            GroupTitle(Icons.Default.Verified, "Tự điền sẵn người nhận")
                            BankGrid(Donation.autofillApps)
                            Text("Ứng dụng mở ra với số tài khoản, tên người nhận và nội dung đã điền sẵn, bạn chỉ cần nhập số tiền.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(16.dp))
                            GroupTitle(Icons.Default.ContentPaste, "Ngân hàng khác")
                            BankGrid(Donation.otherApps)
                            Text("Các ứng dụng này không cho ứng dụng khác điền sẵn người nhận. DVDTube sao chép số tài khoản " +
                                "và lưu mã QR vào ảnh trước khi mở, để bạn dán số tài khoản hoặc quét QR từ ảnh.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(20.dp))
                            Button(
                                onClick = { saveQr() },
                                enabled = !saving,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.Download, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Lưu mã QR vào thư viện ảnh")
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(status ?: "Mở ứng dụng ngân hàng › Quét QR › chọn ảnh mã QR vừa lưu trong thư viện.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GroupTitle(icon: ImageVector, title: String) {
    Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(18.dp), tint = Brand)
        Spacer(Modifier.width(6.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AccountRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}
