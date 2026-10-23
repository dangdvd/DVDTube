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
            .overlay(alignment: .bottom) {
                if page.isPasskeyPage { passkeyBanner }
            }
            .animation(.easeInOut(duration: 0.2), value: page.isPasskeyPage)
        }
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
                Label("Đăng nhập bằng mật khẩu", systemImage: "key.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16).fill(.regularMaterial))
        .padding(12)
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

/// `WKWebView` showing Google's sign-in page, reporting youtube.com cookies once the
/// session is established.
/// Watches Google's sign-in page for the passkey step and can switch it to the password.
@MainActor
@Observable
final class SignInPageController {
    private(set) var isPasskeyPage = false
    @ObservationIgnored weak var webView: WKWebView?
    @ObservationIgnored private var timer: Timer?

    /// The passkey prompt is on screen and no password field is.
    private static let detectScript = """
    (function () {
      var text = ((document.body && document.body.innerText) || '').normalize('NFC');
      var passkey = /khoá đăng nhập|khóa đăng nhập|passkey/i.test(text);
      return passkey && !document.querySelector('input[type=password]');
    })()
    """

    /// "Try another way", then "Enter your password".
    private static let passwordScript = """
    (function () {
      function click(pattern) {
        var items = document.querySelectorAll('button,[role=button],[role=link],li,a,div[jsaction]');
        for (var i = 0; i < items.length; i++) {
          var text = (items[i].innerText || '').normalize('NFC').trim();
          if (text.length > 0 && text.length < 60 && pattern.test(text)) { items[i].click(); return true; }
        }
        return false;
      }
      var password = /nhập mật khẩu|enter your password/i;
      if (click(password)) return 'password';
      if (click(/thử cách khác|try another way/i)) {
        setTimeout(function () { click(password); }, 1500);
        return 'another way';
      }
      return 'none';
    })()
    """

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
        webView?.evaluateJavaScript(Self.passwordScript) { result, _ in
            Log.debug("sign-in: switch to password -> \(result as? String ?? "?")")
        }
    }
}

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
