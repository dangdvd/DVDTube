import Observation
import SwiftUI
import WebKit

/// Sign in with Google on Google's own page; once YouTube's session cookies exist,
/// they are handed to `AccountStore`. A manual cookies.txt import is offered as a
/// fallback because Google sometimes refuses logins from in-app browsers.
struct GoogleSignInView: View {
    enum Mode { case web, manual }

    /// Signs in one more Google account next to the current one (account switcher).
    var addsAccount = false

    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .web
    @State private var isFinishing = false
    @State private var errorMessage: String?
    @State private var cookieText = ""
    @State private var page = SignInPageController()

    var body: some View {
        NavigationStack {
            Group {
                switch mode {
                case .web: webLogin
                case .manual: manualImport
                }
            }
            .overlay {
                if isFinishing {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Đang kết nối tài khoản YouTube…").font(.footnote)
                    }
                    .padding(24)
                    .background(RoundedRectangle(cornerRadius: 16).fill(.regularMaterial))
                }
            }
            .navigationTitle(addsAccount ? "Thêm tài khoản" : "Đăng nhập Google")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Hủy") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            mode = .web
                        } label: {
                            Label("Đăng nhập trên trang Google", systemImage: "globe")
                        }
                        Button {
                            mode = .manual
                        } label: {
                            Label("Nhập cookie thủ công", systemImage: "doc.text")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .alert("Không đăng nhập được", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
                if mode == .web {
                    Button("Nhập cookie thủ công") { mode = .manual }
                }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private var webLogin: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Mật khẩu được nhập trực tiếp trên trang của Google. Sau khi đăng nhập, ứng dụng chỉ lưu phiên YouTube (cookie) trong Keychain của máy.")
                DisclosureGroup("Không dùng được khóa đăng nhập / Face ID?") {
                    Text("iOS chỉ cho dùng khóa đăng nhập (passkey) trong Safari và ứng dụng của chính Google, không cho trang đăng nhập bên trong ứng dụng khác. Khi Google đề nghị dùng khóa đăng nhập, chọn **Thử cách khác** rồi:\n• **Nhập mật khẩu** — chạm biểu tượng 🔑 trên bàn phím để điền mật khẩu đã lưu trong iCloud bằng Face ID, hoặc\n• **Nhấn Có trên điện thoại/máy tính bảng** đang đăng nhập Google.")
                        .padding(.top, 4)
                }
                .tint(.secondary)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground))
            GoogleLoginWebView(addsAccount: addsAccount, page: page) { cookies in
                guard !isFinishing else { return }
                Task { await finish(with: cookies, fromWebLogin: true) }
            }
            // Below the page rather than over it, so Google's own buttons stay visible.
            if page.isPasskeyPage { passkeyBanner }
        }
        .animation(.easeInOut(duration: 0.2), value: page.isPasskeyPage)
    }

    /// Shown on Google's passkey step, which cannot work inside an app on iOS.
    private var passkeyBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Khóa đăng nhập (Face ID) không dùng được ở đây", systemImage: "faceid")
                .font(.subheadline.weight(.semibold))
            Text("iOS chỉ cho dùng khóa đăng nhập trong Safari và ứng dụng của Google. Hãy đăng nhập bằng mật khẩu — chạm 🔑 trên bàn phím để điền mật khẩu đã lưu bằng Face ID — hoặc chọn \"Thử cách khác\" › \"Nhấn Có trên điện thoại\".")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                page.usePassword()
            } label: {
                HStack(spacing: 8) {
                    if page.isSwitching {
                        ProgressView().tint(.white)
                        Text("Đang chuyển sang mật khẩu…")
                    } else {
                        Label("Đăng nhập bằng mật khẩu", systemImage: "key.fill")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(page.isSwitching)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var manualImport: some View {
        Form {
            Section {
                TextEditor(text: $cookieText)
                    .font(.system(.caption, design: .monospaced))
                    .frame(minHeight: 180)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                Button("Dán từ bộ nhớ tạm") {
                    cookieText = UIPasteboard.general.string ?? cookieText
                }
                Button("Đăng nhập bằng cookie") {
                    Task { await finish(with: AuthSession.parseCookieText(cookieText), fromWebLogin: false) }
                }
                .disabled(cookieText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isFinishing)
            } header: {
                Text("Cookie youtube.com")
            } footer: {
                Text("""
                Dùng khi Google chặn đăng nhập trong ứng dụng:
                1. Trên máy tính, mở youtube.com (nên dùng cửa sổ ẩn danh) và đăng nhập.
                2. Dùng tiện ích trình duyệt "Get cookies.txt LOCALLY" để xuất cookie của youtube.com.
                3. Đóng cửa sổ ẩn danh (để trình duyệt không làm mới cookie), rồi dán nội dung tệp vào đây.
                Chấp nhận cả định dạng cookies.txt hoặc chuỗi "tên=giá trị; …".
                """)
            }
        }
    }

    private func finish(with cookies: [String: String], fromWebLogin: Bool) async {
        isFinishing = true
        let error = await account.completeSignIn(cookies: cookies, fromWebLogin: fromWebLogin, addingAccount: addsAccount)
        isFinishing = false
        if let error {
            errorMessage = error
        } else {
            dismiss()
        }
    }
}

/// Watches Google's sign-in page for the passkey step and can switch it to the password.
@MainActor
@Observable
final class SignInPageController {
    private(set) var isPasskeyPage = false
    /// Working through "Try another way" › "Enter your password" after the user asked for it.
    private(set) var isSwitching = false
    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var switchDeadline = Date.distantPast
    @ObservationIgnored private var missedSteps = 0
    @ObservationIgnored private var openedSelection = false

    /// The passkey prompt is on screen, with no visible password field or password option.
    private static let detectScript = #"""
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
    """#

    /// One step towards the password: "done" once a password field shows, otherwise taps
    /// "Enter your password" or "Try another way" ("password" / "another way"), "waiting"
    /// while the last tap is still loading, "none" when neither is on the page.
    /// Google only reacts to taps on the button itself, so the events go to the element
    /// holding the label and bubble up through its handlers.
    private static let passwordScript = #"""
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
    """#

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.check() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func check() {
        if isSwitching { advance() }
        guard let webView, webView.url?.host?.contains("google") == true else {
            if isPasskeyPage { isPasskeyPage = false }
            return
        }
        webView.evaluateJavaScript(Self.detectScript) { [weak self] result, _ in
            let found = (result as? Bool) ?? false
            Task { @MainActor in
                if self?.isPasskeyPage != found { self?.isPasskeyPage = found }
            }
        }
    }

    func usePassword() {
        isSwitching = true
        switchDeadline = Date().addingTimeInterval(25)
        missedSteps = 0
        openedSelection = false
        advance()
    }

    private func advance() {
        guard let webView, Date() < switchDeadline else {
            Log.debug("sign-in: switch to password -> gave up")
            isSwitching = false
            return
        }
        webView.evaluateJavaScript(Self.passwordScript) { [weak self] result, _ in
            let step = result as? String ?? "?"
            Task { @MainActor in self?.handle(step) }
        }
    }

    private func handle(_ step: String) {
        guard isSwitching else { return }
        if step != "waiting" { Log.debug("sign-in: switch to password -> \(step)") }
        switch step {
        case "done":
            isSwitching = false
        case "password", "waiting":
            break
        default:
            // The taps did not move the page on: open Google's list of sign-in methods.
            missedSteps += 1
            if missedSteps >= 3 { openSelectionPage() }
        }
    }

    /// `…/challenge/pk…?TL=…` → `…/challenge/selection?TL=…`, the "Try another way" list.
    private func openSelectionPage() {
        guard !openedSelection, let webView, let url = webView.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let range = components.path.range(of: "/challenge/.*$", options: .regularExpression),
              !components.path.hasSuffix("/challenge/selection")
        else { return }
        components.path.replaceSubrange(range, with: "/challenge/selection")
        guard let selection = components.url else { return }
        openedSelection = true
        missedSteps = 0
        switchDeadline = Date().addingTimeInterval(20)
        Log.debug("sign-in: switch to password -> opening the sign-in options")
        webView.load(URLRequest(url: selection))
    }
}

/// `WKWebView` showing Google's sign-in page, reporting youtube.com cookies once the
/// session is established.
private struct GoogleLoginWebView: UIViewRepresentable {
    var addsAccount = false
    var page: SignInPageController
    var onSignedIn: ([String: String]) -> Void

    private static let loginURL = URL(string:
        "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true"
        + "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Dm%26hl%3Dvi%26next%3D%252F"
        + "&hl=vi")!

    private static let addAccountURL = URL(string:
        "https://accounts.google.com/AddSession?service=youtube&uilel=3"
        + "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Dm%26hl%3Dvi%26next%3D%252F"
        + "&hl=vi")!

    /// Google rejects sign-in from user agents that look like an embedded web view, so
    /// present the same user agent as Safari on this iOS version.
    private static var safariUserAgent: String {
        let version = UIDevice.current.systemVersion
        let parts = version.split(separator: ".")
        let short = parts.prefix(2).joined(separator: ".")
        return "Mozilla/5.0 (iPhone; CPU iPhone OS \(version.replacingOccurrences(of: ".", with: "_")) like Mac OS X) "
            + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(short) Mobile/15E148 Safari/604.1"
    }

    func makeCoordinator() -> Coordinator {
        let coordinator = Coordinator(onSignedIn: onSignedIn)
        coordinator.page = page
        return coordinator
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = Self.safariUserAgent
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: addsAccount ? Self.addAccountURL : Self.loginURL))
        page.webView = webView
        page.start()
        return webView
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.page?.stop()
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onSignedIn = onSignedIn
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onSignedIn: ([String: String]) -> Void
        weak var page: SignInPageController?
        private var reported = false

        init(onSignedIn: @escaping ([String: String]) -> Void) {
            self.onSignedIn = onSignedIn
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !reported, let host = webView.url?.host?.lowercased(), host.hasSuffix("youtube.com") else { return }
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self, !self.reported else { return }
                let youtube = AuthSession.youtubeCookies(from: cookies)
                guard AuthSession.hasAuthCookies(youtube) else { return }
                self.reported = true
                DispatchQueue.main.async { self.onSignedIn(youtube) }
            }
        }
    }
}
