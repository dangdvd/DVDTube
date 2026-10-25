package com.dangdvd.dvdtube.ui.account

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.dangdvd.dvdtube.core.AccountNotification
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.AuthSession
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.ErrorState
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.LoadingState
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.components.pagedFeed
import com.dangdvd.dvdtube.ui.rememberRouteModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private const val CONTINUE = "https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Dm%26hl%3Dvi%26next%3D%252F"
private const val LOGIN_URL = "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=$CONTINUE&hl=vi"
private const val ADD_ACCOUNT_URL = "https://accounts.google.com/AddSession?service=youtube&uilel=3&continue=$CONTINUE&hl=vi"

/** The passkey prompt is on screen, with no visible password field or password option. */
private const val DETECT_PASSKEY_SCRIPT = """
(function () {
  function shown(el) {
    if (!el || el.getAttribute('aria-hidden') === 'true') return false;
    var r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden';
  }
  var text = ((document.body && document.body.innerText) || '').normalize('NFC');
  if (!/khoá đăng nhập|khóa đăng nhập|passkey/i.test(text)) return false;
  var fields = document.querySelectorAll('input[type=password]');
  for (var i = 0; i < fields.length; i++) if (shown(fields[i])) return false;
  return !/(^|\n)\s*(nhập mật khẩu|enter your password)/i.test(text);
})()
"""

/**
 * One step towards the password: "done" once a password field shows, otherwise taps
 * "Enter your password" or "Try another way" ("password" / "another way"), "waiting" while
 * the last tap is still loading, "none" when neither is on the page. Google only reacts to
 * taps on the button itself, so the events go to the element holding the label and bubble
 * up through its handlers.
 */
private const val PASSWORD_SCRIPT = """
(function () {
  function shown(el) {
    if (!el || el.getAttribute('aria-hidden') === 'true') return false;
    var r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && getComputedStyle(el).visibility !== 'hidden';
  }
  function find(pattern) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      var text = node.data.normalize('NFC').replace(/\s+/g, ' ').trim();
      if (text.length > 0 && text.length < 80 && pattern.test(text) && shown(node.parentElement)) return node.parentElement;
    }
    return null;
  }
  function tap(el) {
    var target = el.closest('button,a,[role=button],[role=link],[jsaction]') || el;
    target.scrollIntoView({ block: 'center' });
    var r = el.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0,
                 clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    function fire(type, Kind, extra) {
      try { el.dispatchEvent(new Kind(type, Object.assign({}, base, extra))); } catch (e) {}
    }
    var pointer = window.PointerEvent || MouseEvent;
    fire('pointerdown', pointer, { pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 });
    fire('mousedown', MouseEvent, { buttons: 1 });
    if (target.focus) target.focus();
    fire('pointerup', pointer, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    fire('mouseup', MouseEvent, {});
    fire('click', MouseEvent, {});
  }
  var fields = document.querySelectorAll('input[type=password]');
  for (var i = 0; i < fields.length; i++) if (shown(fields[i])) return 'done';
  var step = 'password';
  var item = find(/^(nhập mật khẩu|enter your password)/i);
  if (!item) { step = 'another way'; item = find(/^(thử cách khác|try another way)$/i); }
  if (!item) return 'none';
  var last = window.__dvdtubeTap;
  if (last && last.step === step && Date.now() - last.at < 2500) return 'waiting';
  window.__dvdtubeTap = { step: step, at: Date.now() };
  tap(item);
  return step;
})()
"""

/** Works through "Try another way" › "Enter your password" on Google's page once the user asks. */
private class PasswordSwitch {
    var active by mutableStateOf(false)
        private set
    private var deadline = 0L
    private var missedSteps = 0
    private var openedSelection = false

    fun start(view: WebView) {
        active = true
        deadline = System.currentTimeMillis() + 25_000
        missedSteps = 0
        openedSelection = false
        advance(view)
    }

    fun advance(view: WebView) {
        if (!active) return
        if (System.currentTimeMillis() > deadline) {
            Log.debug("sign-in: switch to password -> gave up")
            active = false
            return
        }
        view.evaluateJavascript(PASSWORD_SCRIPT) { result -> handle(view, result?.trim('"') ?: "?") }
    }

    private fun handle(view: WebView, step: String) {
        if (!active) return
        if (step != "waiting") Log.debug("sign-in: switch to password -> $step")
        when (step) {
            "done" -> active = false
            "password", "waiting" -> Unit
            // The taps did not move the page on: open Google's list of sign-in methods.
            else -> if (++missedSteps >= 3) openSelectionPage(view)
        }
    }

    /** `…/challenge/pk…?TL=…` → `…/challenge/selection?TL=…`, the "Try another way" list. */
    private fun openSelectionPage(view: WebView) {
        if (openedSelection) return
        val uri = view.url?.let(android.net.Uri::parse) ?: return
        val path = uri.path ?: return
        val index = path.indexOf("/challenge/")
        if (index < 0 || path.endsWith("/challenge/selection")) return
        openedSelection = true
        missedSteps = 0
        deadline = System.currentTimeMillis() + 20_000
        Log.debug("sign-in: switch to password -> opening the sign-in options")
        view.loadUrl(uri.buildUpon().path(path.substring(0, index) + "/challenge/selection").build().toString())
    }
}

/**
 * Google rejects sign-in from user agents that look like an embedded web view ("; wv"),
 * so present the user agent of Chrome on Android instead.
 */
private fun chromeUserAgent(webView: WebView): String =
    webView.settings.userAgentString.replace("; wv)", ")").replace(Regex("Version/\\S+ "), "")

/**
 * Sign in with Google on Google's own page; once YouTube's session cookies exist they are
 * handed to [AccountStore]. A manual cookies.txt import is offered as a fallback.
 */
@Composable
fun SignInDialog(addingAccount: Boolean, onDismiss: () -> Unit) {
    var manual by remember { mutableStateOf(false) }
    var finishing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var cookieText by remember { mutableStateOf("") }
    var progress by remember { mutableStateOf(0) }
    var loginWebView by remember { mutableStateOf<WebView?>(null) }
    var passkeyPage by remember { mutableStateOf(false) }
    val passwordSwitch = remember { PasswordSwitch() }
    // Google's passkey step cannot work inside an app: watch for it and offer the password.
    LaunchedEffect(loginWebView, manual) {
        val view = loginWebView ?: return@LaunchedEffect
        while (true) {
            kotlinx.coroutines.delay(1000)
            if (!manual) passwordSwitch.advance(view)
            if (manual || view.url?.contains("google") != true) {
                passkeyPage = false
                continue
            }
            view.evaluateJavascript(DETECT_PASSKEY_SCRIPT) { result -> passkeyPage = result == "true" }
        }
    }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    fun finish(cookies: Map<String, String>, fromWebLogin: Boolean) {
        if (finishing) return
        finishing = true
        error = null
        scope.launch {
            val message = AccountStore.completeSignIn(cookies, fromWebLogin, addingAccount)
            finishing = false
            if (message == null) onDismiss() else error = message
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                TopAppBar(
                    title = { Text(if (addingAccount) "Thêm tài khoản" else "Đăng nhập Google") },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Đóng") } },
                    actions = {
                        TextButton(onClick = { manual = !manual }) { Text(if (manual) "Trang Google" else "Nhập cookie") }
                    },
                )
                if (finishing) LinearProgressIndicator(Modifier.fillMaxWidth())
                else if (!manual && progress in 1..99) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxWidth())
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(12.dp))
                }
                if (manual) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                        Text("Cookie youtube.com", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(cookieText, { cookieText = it }, Modifier.fillMaxWidth().height(200.dp),
                            placeholder = { Text("Dán nội dung cookies.txt hoặc chuỗi \"tên=giá trị; …\"") })
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 10.dp)) {
                            OutlinedButton(onClick = { clipboard.getText()?.text?.let { cookieText = it } }) {
                                Icon(Icons.Default.ContentPaste, null)
                                Spacer(Modifier.width(6.dp))
                                Text("Dán")
                            }
                            Button(
                                onClick = { finish(AuthSession.parseCookieText(cookieText), fromWebLogin = false) },
                                enabled = cookieText.isNotBlank() && !finishing,
                            ) { Text("Đăng nhập bằng cookie") }
                        }
                        Text(
                            "1. Mở cửa sổ ẩn danh trên máy tính và đăng nhập youtube.com.\n" +
                                "2. Dùng tiện ích trình duyệt \"Get cookies.txt LOCALLY\" để xuất cookie của youtube.com.\n" +
                                "3. Đóng cửa sổ ẩn danh (để trình duyệt không làm mới cookie), rồi dán nội dung tệp vào đây.\n" +
                                "Chấp nhận cả định dạng cookies.txt hoặc chuỗi \"tên=giá trị; …\".",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    Text(
                        "Mật khẩu được nhập trực tiếp trên trang của Google. Sau khi đăng nhập, ứng dụng chỉ lưu phiên YouTube (cookie) đã mã hóa trên máy.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                    GoogleLoginWebView(
                        addingAccount,
                        onProgress = { progress = it },
                        onWebView = { loginWebView = it },
                        modifier = Modifier.weight(1f),
                    ) { cookies -> finish(cookies, fromWebLogin = true) }
                    // Below the page rather than over it, so Google's own buttons stay visible.
                    if (passkeyPage) {
                        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(14.dp)) {
                            Text("Khóa đăng nhập không dùng được ở đây", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Khóa đăng nhập chỉ dùng được trong trình duyệt và ứng dụng của Google. Hãy đăng nhập bằng mật khẩu (trình quản lý mật khẩu có thể tự điền) hoặc chọn \"Thử cách khác\" › \"Nhấn Có trên điện thoại\".",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 6.dp),
                            )
                            Button(
                                onClick = { loginWebView?.let(passwordSwitch::start) },
                                enabled = !passwordSwitch.active,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                if (passwordSwitch.active) {
                                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Text("Đang chuyển sang mật khẩu…")
                                } else {
                                    Text("Đăng nhập bằng mật khẩu")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Google's sign-in page in a WebView (also used by the TV interface, where it is D-pad driven). */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun GoogleLoginWebView(
    addingAccount: Boolean,
    onProgress: (Int) -> Unit,
    onWebView: (WebView) -> Unit,
    modifier: Modifier = Modifier,
    onSignedIn: (Map<String, String>) -> Unit,
) {
    AndroidView(
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.userAgentString = chromeUserAgent(this)
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                var reported = false
                webChromeClient = object : android.webkit.WebChromeClient() {
                    override fun onProgressChanged(view: WebView?, newProgress: Int) = onProgress(newProgress)
                }
                webViewClient = object : WebViewClient() {
                    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) = check(url)
                    override fun onPageFinished(view: WebView?, url: String?) = check(url)

                    private fun check(url: String?) {
                        if (reported) return
                        val host = url?.let { android.net.Uri.parse(it).host }?.lowercase() ?: return
                        if (!host.endsWith("youtube.com")) return
                        val cookies = AuthSession.parseCookieHeader(CookieManager.getInstance().getCookie("https://www.youtube.com"))
                        if (!AuthSession.hasAuthCookies(cookies)) return
                        reported = true
                        CookieManager.getInstance().flush()
                        onSignedIn(cookies)
                    }
                }
                loadUrl(if (addingAccount) ADD_ACCOUNT_URL else LOGIN_URL)
                onWebView(this)
            }
        },
        modifier = modifier.fillMaxSize(),
    )
}

// MARK: Account switcher

@Composable
fun AccountSwitcherSheet(onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(AccountStore.identities.isEmpty()) }
    LaunchedEffect(Unit) {
        AccountStore.loadIdentities()
        loading = false
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
            val profile = AccountStore.profile
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(profile?.avatar, 48.dp, profile?.name ?: "")
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(profile?.name ?: "Tài khoản", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    listOfNotNull(profile?.handle, profile?.email).firstOrNull()?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    profile?.channelId?.let { id ->
                        Text("Xem kênh", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(top = 4.dp).clickable { onDismiss(); Router.openChannel(id, profile.name) })
                    }
                }
            }
            HorizontalDivider()
            Text("Tài khoản và kênh", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(16.dp, 12.dp, 16.dp, 4.dp))
            if (loading && AccountStore.identities.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            AccountStore.identities.forEach { identity ->
                Row(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = !identity.isSelected) {
                            com.dangdvd.dvdtube.core.ParentalControls.guard("Nhập mã PIN để chuyển tài khoản") {
                                com.dangdvd.dvdtube.core.storage.AppScope.launch { AccountStore.switchTo(identity) }
                            }
                            onDismiss()
                        }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(identity.avatar, 36.dp, identity.name)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(identity.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val detail = listOfNotNull(
                            identity.byline ?: identity.email,
                            if (identity.isBrandAccount) "Kênh thương hiệu" else null,
                        ).joinToString(" • ")
                        if (detail.isNotEmpty()) {
                            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                    if (identity.isSelected) Icon(Icons.Default.Check, "Đang dùng", tint = Brand)
                }
            }
            HorizontalDivider(Modifier.padding(top = 8.dp))
            Row(
                Modifier.fillMaxWidth().clickable { com.dangdvd.dvdtube.core.AppSettings.isIncognito = !com.dangdvd.dvdtube.core.AppSettings.isIncognito }
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.VisibilityOff, null)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text("Bật chế độ ẩn danh")
                    Text("Không lưu video đã xem và tìm kiếm. Tự tắt khi mở lại ứng dụng.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                androidx.compose.material3.Switch(
                    checked = com.dangdvd.dvdtube.core.AppSettings.isIncognito,
                    onCheckedChange = { com.dangdvd.dvdtube.core.AppSettings.isIncognito = it },
                )
            }
            Row(
                Modifier.fillMaxWidth().clickable { onDismiss(); Router.signIn(addingAccount = true) }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.PersonAdd, null)
                Spacer(Modifier.width(16.dp))
                Text("Thêm tài khoản")
            }
            Row(
                Modifier.fillMaxWidth().clickable {
                    onDismiss()
                    com.dangdvd.dvdtube.core.ParentalControls.guard("Nhập mã PIN để đăng xuất") { AccountStore.signOut() }
                }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null)
                Spacer(Modifier.width(16.dp))
                Text("Đăng xuất")
            }
        }
    }
}

// MARK: Notifications

class NotificationsModel {
    var items by mutableStateOf<List<AccountNotification>?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    suspend fun load() {
        error = null
        try {
            items = YouTubeService.accountNotifications()
            AccountStore.markNotificationsSeen()
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            error = failure.message ?: "Không tải được thông báo."
        }
    }
}

@Composable
fun NotificationsScreen() {
    val model = remember(AccountStore.sessionKey) { NotificationsModel() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(model) { model.load() }
    ScreenScaffold("Thông báo") { padding ->
        val items = model.items
        when {
            !AccountStore.isSignedIn -> EmptyState(Icons.Outlined.Notifications, "Đăng nhập để xem thông báo", modifier = Modifier.padding(padding))
            items == null && model.error != null -> ErrorState(model.error ?: "", Modifier.padding(padding)) { scope.launch { model.load() } }
            items == null -> LoadingState(Modifier.padding(padding))
            items.isEmpty() -> EmptyState(Icons.Outlined.Notifications, "Không có thông báo", modifier = Modifier.padding(padding))
            else -> LazyColumn(Modifier.fillMaxSize().padding(padding)) {
                items(items, key = { it.id }) { notification ->
                    Row(
                        Modifier.fillMaxWidth()
                            .background(if (notification.isRead) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                            .clickable(enabled = notification.videoId != null) {
                                notification.videoId?.let { PlayerController.play(VideoItem(id = it)) }
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Box(Modifier.size(8.dp).padding(top = 2.dp).clip(RoundedCornerShape(50))
                            .background(if (notification.isRead) MaterialTheme.colorScheme.surface else Brand))
                        Spacer(Modifier.width(6.dp))
                        Avatar(notification.avatar, 40.dp)
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text(notification.message, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            notification.timeText?.let {
                                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        notification.thumbnail?.let { RemoteImage(it, Modifier.width(96.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp))) }
                    }
                }
            }
        }
    }
}

// MARK: Account feeds (history, playlists, channels…)

@Composable
fun AccountFeedScreen(route: Route.AccountFeed) {
    val model = rememberRouteModel(route.key + AccountStore.sessionKey) { FeedModel { YouTubeService.accountFeed(route.browseId) } }
    val scope = rememberCoroutineScope()
    ScreenScaffold(route.title) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            pagedFeed(model, scope, compact = true, emptyTitle = "Không có nội dung")
        }
    }
}
