import SwiftUI
import WebKit

/// Sign in with Google on Google's own page; once YouTube's session cookies exist,
/// they are handed to `AccountStore`. A manual cookies.txt import is offered as a
/// fallback because Google sometimes refuses logins from in-app browsers.
struct GoogleSignInView: View {
    enum Mode { case web, manual }

    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .web
    @State private var isFinishing = false
    @State private var errorMessage: String?
    @State private var cookieText = ""

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
            .navigationTitle("Đăng nhập Google")
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
            Text("Mật khẩu được nhập trực tiếp trên trang của Google. Sau khi đăng nhập, ứng dụng chỉ lưu phiên YouTube (cookie) trong Keychain của máy.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground))
            GoogleLoginWebView { cookies in
                guard !isFinishing else { return }
                Task { await finish(with: cookies, fromWebLogin: true) }
            }
        }
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
        let error = await account.completeSignIn(cookies: cookies, fromWebLogin: fromWebLogin)
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
private struct GoogleLoginWebView: UIViewRepresentable {
    var onSignedIn: ([String: String]) -> Void

    private static let loginURL = URL(string:
        "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true"
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

    func makeCoordinator() -> Coordinator { Coordinator(onSignedIn: onSignedIn) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = Self.safariUserAgent
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: Self.loginURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onSignedIn = onSignedIn
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onSignedIn: ([String: String]) -> Void
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
