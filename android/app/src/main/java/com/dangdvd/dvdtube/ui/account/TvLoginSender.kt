package com.dangdvd.dvdtube.ui.account

import android.content.Context
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.TvLogin
import com.dangdvd.dvdtube.core.innertube.AuthSession
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Router
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** "Đăng nhập cho TV": scans the QR code shown by DVDTube on the TV with Google's code scanner. */
fun scanTvLoginCode(context: Context) {
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { barcode ->
            val invite = barcode.rawValue?.let(TvLogin::parse)
            if (invite == null) Toasts.show("Đây không phải mã đăng nhập DVDTube trên TV") else Router.tvLoginInvite = invite
        }
        .addOnFailureListener { error ->
            Log.debug("tv login scanner: ${error.message}")
            Toasts.show("Không mở được trình quét mã QR (cần Google Play services)")
        }
}

/** Confirms, then sends this phone's YouTube session to the TV that showed the QR code. */
@Composable
fun TvLoginDialog(invite: TvLogin.Invite, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var sending by remember { mutableStateOf(false) }

    if (!AccountStore.isSignedIn) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Chưa đăng nhập") },
            text = { Text("Hãy đăng nhập tài khoản Google trong DVDTube trên điện thoại trước, rồi quét lại mã trên TV.") },
            confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        )
        return
    }

    val account = AccountStore.profile?.name ?: "tài khoản của bạn"
    AlertDialog(
        onDismissRequest = { if (!sending) onDismiss() },
        title = { Text("Đăng nhập trên TV?") },
        text = {
            Text(
                "Gửi phiên đăng nhập YouTube của $account tới \"${invite.tvName}\" (${invite.address}) qua Wi-Fi nội bộ. " +
                    "Dữ liệu được mã hoá bằng khoá trong mã QR. Chỉ làm vậy với TV của bạn.",
            )
        },
        confirmButton = {
            TextButton(
                enabled = !sending,
                onClick = {
                    sending = true
                    scope.launch {
                        try {
                            TvLogin.send(invite, AuthSession.cookieList)
                            Toasts.show("Đã đăng nhập DVDTube trên TV")
                            onDismiss()
                        } catch (cancel: CancellationException) {
                            throw cancel
                        } catch (error: Exception) {
                            Toasts.show(error.message ?: "Không kết nối được tới TV. Điện thoại và TV phải cùng mạng Wi-Fi.")
                            sending = false
                        }
                    }
                },
            ) {
                if (sending) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Đang gửi…")
                    }
                } else {
                    Text("Gửi")
                }
            }
        },
        dismissButton = { TextButton(enabled = !sending, onClick = onDismiss) { Text("Hủy") } },
    )
}
