package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.account.GoogleLoginWebView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Signed out: the two ways to sign in. Signed in: the account, its channels and sign out. */
@Composable
fun TvAccountScreen() {
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    LaunchedEffect(AccountStore.isSignedIn) {
        if (AccountStore.isSignedIn) AccountStore.loadIdentities()
    }
    LaunchedEffect(Unit) {
        delay(250)
        runCatching { first.requestFocus() }
    }

    if (!AccountStore.isSignedIn) {
        Column(Modifier.fillMaxSize().padding(horizontal = TvInsets.horizontal, vertical = TvInsets.vertical)) {
            Text("Đăng nhập YouTube", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(
                "Không bắt buộc. Khi đăng nhập, Trang chủ có đề xuất của tài khoản, Kênh đăng ký, Xem sau và lượt thích được đồng bộ. " +
                    "Video vẫn phát không quảng cáo.",
                style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText, modifier = Modifier.widthIn(max = 760.dp),
            )
            Spacer(Modifier.height(28.dp))
            TvOptionRow(
                "Đăng nhập bằng điện thoại (khuyên dùng)",
                subtitle = "TV hiện mã QR, quét bằng Camera trên iPhone hoặc ứng dụng DVDTube trên Android đã đăng nhập.",
                icon = Icons.Default.PhoneAndroid,
                onClick = { TvNav.open(TvRoute.Pairing()) },
                modifier = Modifier.widthIn(max = 760.dp).focusRequester(first),
            )
            TvOptionRow(
                "Đăng nhập trên TV",
                subtitle = "Nhập email và mật khẩu Google bằng điều khiển trên trang đăng nhập của Google.",
                icon = Icons.Default.Keyboard,
                onClick = { TvNav.open(TvRoute.WebSignIn()) },
                modifier = Modifier.widthIn(max = 760.dp),
            )
        }
        return
    }

    val profile = AccountStore.profile
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = TvInsets.horizontal, vertical = TvInsets.vertical),
    ) {
        item("profile") {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 20.dp)) {
                TvAvatar(profile?.avatar, 88.dp, profile?.name ?: "")
                Spacer(Modifier.width(20.dp))
                Column {
                    Text(profile?.name ?: "Tài khoản", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    listOfNotNull(profile?.handle, profile?.email).firstOrNull()?.let {
                        Text(it, style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText)
                    }
                }
            }
        }
        if (AccountStore.identities.isNotEmpty()) {
            item("identities-title") {
                Text("Tài khoản và kênh", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(vertical = 8.dp))
            }
            items(AccountStore.identities, key = { it.id }) { identity ->
                val detail = listOfNotNull(identity.byline ?: identity.email, if (identity.isBrandAccount) "Kênh thương hiệu" else null)
                    .joinToString(" • ")
                TvOptionRow(
                    identity.name,
                    subtitle = detail.ifEmpty { null },
                    selected = identity.isSelected,
                    icon = if (identity.isSelected) Icons.Default.Check else null,
                    onClick = { if (!identity.isSelected) scope.launch { AccountStore.switchTo(identity) } },
                    modifier = Modifier.widthIn(max = 760.dp).then(if (identity.isSelected) Modifier.focusRequester(first) else Modifier),
                )
            }
        }
        item("actions") {
            Row(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                TvButton("Làm mới", onClick = { scope.launch { AccountStore.refresh(); AccountStore.loadIdentities() } }, icon = Icons.Default.Refresh,
                    modifier = if (AccountStore.identities.isEmpty()) Modifier.focusRequester(first) else Modifier)
                TvButton("Đăng xuất", onClick = {
                    AccountStore.signOut()
                    Toasts.show("Đã đăng xuất")
                }, icon = Icons.AutoMirrored.Filled.Logout)
            }
        }
        AccountStore.lastError?.let { message ->
            item("error") {
                Text(message, color = Brand, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 16.dp))
            }
        }
    }
}

/** Shows the QR code a signed-in phone scans to sign this TV in. */
@Composable
fun TvPairingScreen() {
    val context = LocalContext.current
    var generation by remember { mutableIntStateOf(0) }
    val server = remember(generation) { TvPairingServer(context) }
    val buttonFocus = remember { FocusRequester() }
    DisposableEffect(server) {
        server.start()
        onDispose { server.stop() }
    }
    // The code expires after 10 minutes.
    var expired by remember(generation) { mutableStateOf(false) }
    LaunchedEffect(generation) {
        delay(10 * 60 * 1000L)
        expired = true
        server.stop()
    }
    LaunchedEffect(server.signedInName) {
        if (server.signedInName != null) Toasts.show("Đã đăng nhập: ${server.signedInName.orEmpty().ifEmpty { "tài khoản Google" }}")
    }
    LaunchedEffect(Unit) {
        delay(300)
        runCatching { buttonFocus.requestFocus() }
    }

    Row(
        Modifier.fillMaxSize().padding(horizontal = TvInsets.horizontal, vertical = TvInsets.vertical),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(320.dp).background(Color.White, RoundedCornerShape(16.dp)).padding(14.dp), contentAlignment = Alignment.Center) {
            val link = server.link
            when {
                server.signedInName != null -> Text("✓", color = Brand, style = MaterialTheme.typography.displayLarge)
                expired -> Text("Mã đã hết hạn", color = Color.Black, style = MaterialTheme.typography.titleLarge)
                link != null -> {
                    val image = remember(link) { TvPairingServer.qrCode(link) }
                    Image(image, "Mã QR đăng nhập", Modifier.fillMaxSize())
                }
                server.error != null -> Text(server.error ?: "", color = Color.Black, style = MaterialTheme.typography.bodyLarge)
                else -> CircularProgressIndicator(color = Brand)
            }
        }
        Spacer(Modifier.width(48.dp))
        Column(Modifier.weight(1f)) {
            val name = server.signedInName
            if (name != null) {
                Text("Đã đăng nhập", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(name.ifEmpty { "Tài khoản Google của bạn" }, style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(24.dp))
                TvButton("Xong", onClick = { TvNav.back() }, accent = true, modifier = Modifier.focusRequester(buttonFocus))
                LaunchedEffect(Unit) {
                    delay(100)
                    runCatching { buttonFocus.requestFocus() }
                }
                return@Column
            }
            Text("Đăng nhập bằng điện thoại", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            Step("1", "Đăng nhập tài khoản Google trong DVDTube trên điện thoại.")
            Step("2", "Quét mã bằng Camera trên iPhone, hoặc ứng dụng DVDTube trên Android (Bạn › Đăng nhập cho TV).")
            Step("3", "Xác nhận \"Gửi\" trên điện thoại. Điện thoại và TV phải cùng mạng Wi-Fi.")
            Spacer(Modifier.height(12.dp))
            Text(
                "Phiên đăng nhập được mã hoá bằng khoá chỉ có trong mã QR này và chỉ gửi qua mạng nội bộ tới TV. " +
                    (server.address?.let { "Địa chỉ TV: $it • ${server.tvName}" } ?: ""),
                style = MaterialTheme.typography.bodyMedium, color = TvColors.secondaryText,
            )
            if (server.isBusy) {
                Spacer(Modifier.height(12.dp))
                Text("Đang đăng nhập…", style = MaterialTheme.typography.titleMedium, color = Brand)
            }
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                TvButton("Tạo mã mới", onClick = { generation++ }, icon = Icons.Default.Refresh, modifier = Modifier.focusRequester(buttonFocus))
                TvButton("Đăng nhập trên TV", onClick = {
                    TvNav.back()
                    TvNav.open(TvRoute.WebSignIn())
                }, icon = Icons.Default.Keyboard)
            }
        }
    }
}

@Composable
private fun Step(number: String, text: String) {
    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(32.dp).background(Brand, RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
            Text(number, color = Color.White, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
    }
}

/** Google's own sign-in page, driven with the remote and the TV keyboard. */
@Composable
fun TvWebSignInScreen() {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }
    var finishing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(TvColors.surface).padding(horizontal = 32.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Đăng nhập trên trang Google", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(
                    message ?: "Dùng phím điều hướng để chọn ô, bấm OK để mở bàn phím. Bấm Quay lại để thoát.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (message != null) Brand else TvColors.secondaryText,
                )
            }
            if (finishing) CircularProgressIndicator(color = Brand, modifier = Modifier.size(28.dp))
        }
        GoogleLoginWebView(
            addingAccount = false,
            onProgress = {},
            onWebView = { view ->
                view.isFocusable = true
                view.isFocusableInTouchMode = true
                view.post { view.requestFocus() }
            },
            modifier = Modifier.weight(1f),
        ) { cookies ->
            if (finishing) return@GoogleLoginWebView
            finishing = true
            scope.launch {
                val error = AccountStore.completeSignIn(cookies, fromWebLogin = true)
                finishing = false
                if (error == null) {
                    Toasts.show("Đã đăng nhập")
                    TvNav.back()
                } else {
                    message = error
                }
            }
        }
    }
}
