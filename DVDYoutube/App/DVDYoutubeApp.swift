import SwiftUI

@main
struct DVDYoutubeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    @State private var settings = AppSettings.shared
    @State private var library = LibraryStore.shared
    @State private var player = PlayerManager.shared
    @State private var shorts = ShortsPlayer.shared
    @State private var downloads = DownloadManager.shared
    @State private var router = Router.shared
    @State private var account = AccountStore.shared
    /// A scanned "sign in on the TV" code waiting for the user's confirmation.
    @State private var tvLogin: TVLoginRequest?
    @State private var tvLoginNeedsAccount = false

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
                .environment(library)
                .environment(player)
                .environment(shorts)
                .environment(downloads)
                .environment(router)
                .environment(account)
                .preferredColorScheme(settings.theme == .system ? nil : (settings.theme == .dark ? .dark : .light))
                .tint(.brand)
                .task { await APIConfig.refreshRemoteConfig() }
                .onOpenURL { url in handleOpen(url) }
                .alert("Đăng nhập trên TV?", isPresented: Binding(
                    get: { tvLogin != nil },
                    set: { if !$0 { tvLogin = nil } }
                ), presenting: tvLogin) { request in
                    Button("Gửi") { sendTVLogin(request) }
                    Button("Hủy", role: .cancel) {}
                } message: { request in
                    Text("Gửi phiên đăng nhập YouTube của \(account.profile?.name ?? "tài khoản này") tới \"\(request.tvName)\" (\(request.host)) qua Wi-Fi nội bộ. Dữ liệu được mã hoá bằng khoá trong mã QR. Chỉ làm vậy với TV của bạn.")
                }
                .alert("Chưa đăng nhập", isPresented: $tvLoginNeedsAccount) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text("Hãy đăng nhập tài khoản Google trong DVDTube trên điện thoại trước, rồi quét lại mã trên TV.")
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                player.appDidEnterBackground()
                shorts.pause()
                NewVideoNotifier.schedule()
            case .active:
                player.appWillEnterForeground()
            default:
                break
            }
        }
    }

    /// `dvdtube://watch?v=ID` or any shared YouTube link opened with the app.
    private func handleOpen(_ url: URL) {
        if url.scheme == "dvdtube", url.host == "tv-login" {
            guard let request = TVLoginRequest(url: url) else {
                player.showToast("Mã QR đăng nhập TV không hợp lệ")
                return
            }
            if account.isSignedIn, AuthSession.shared.isAuthenticated {
                tvLogin = request
            } else {
                tvLoginNeedsAccount = true
            }
            return
        }
        var text = url.absoluteString
        if url.scheme == "dvdtube" {
            text = text.replacingOccurrences(of: "dvdtube://", with: "https://www.youtube.com/")
        }
        if let id = YouTubeService.videoId(from: text) {
            player.play(VideoItem(id: id, title: ""))
        }
    }
}

extension DVDYoutubeApp {
    private func sendTVLogin(_ request: TVLoginRequest) {
        let cookies = AuthSession.shared.cookieSnapshot
        Task {
            do {
                let name = try await TVLoginSender.send(request, cookies: cookies)
                player.showToast(name.isEmpty ? "Đã đăng nhập DVDTube trên TV" : "Đã đăng nhập trên TV: \(name)")
            } catch {
                player.showToast(error.localizedDescription)
            }
        }
    }
}

extension Color {
    /// Brand accent (a warm red-pink, deliberately not YouTube's red).
    static let brand = Color(red: 1.0, green: 0.24, blue: 0.35)
}
