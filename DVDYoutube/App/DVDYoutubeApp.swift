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
    /// Scanned codes (TV sign-in, library sync) waiting for the user's confirmation.
    @State private var links = DeepLinks.shared

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
                .task {
                    ParentalControls.shared.startMonitoring()
                    AlarmScheduler.shared.startMonitoring()
                    CrashReports.shared.start()
                    WidgetBridge.scheduleUpdate()
                    await APIConfig.refreshRemoteConfig()
                    await UpdateChecker.shared.checkIfDue()
                }
                .onOpenURL { url in links.open(url) }
                .alert("Đăng nhập trên TV?", isPresented: Binding(
                    get: { links.tvLogin != nil },
                    set: { if !$0 { links.tvLogin = nil } }
                ), presenting: links.tvLogin) { request in
                    Button("Gửi") { links.sendTVLogin(request) }
                    Button("Hủy", role: .cancel) {}
                } message: { request in
                    Text("Gửi phiên đăng nhập YouTube của \(account.profile?.name ?? "tài khoản này") tới \"\(request.tvName)\" (\(request.host)) qua Wi-Fi nội bộ. Dữ liệu được mã hoá bằng khoá trong mã QR. Chỉ làm vậy với TV của bạn.")
                }
                .alert("Chưa đăng nhập", isPresented: Binding(
                    get: { links.tvLoginNeedsAccount },
                    set: { links.tvLoginNeedsAccount = $0 }
                )) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text("Hãy đăng nhập tài khoản Google trong DVDTube trên điện thoại trước, rồi quét lại mã trên TV.")
                }
                .alert("Đồng bộ thư viện với \(links.syncRequest?.name ?? "thiết bị kia")?", isPresented: Binding(
                    get: { links.syncRequest != nil },
                    set: { if !$0 { links.syncRequest = nil } }
                ), presenting: links.syncRequest) { request in
                    Button("Đồng bộ") { links.confirmSync(request) }
                    Button("Hủy", role: .cancel) {}
                } message: { request in
                    Text("Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nội dung đã tìm của hai thiết bị sẽ được gộp qua Wi-Fi nội bộ (\(request.host)), mã hóa bằng khóa trong mã QR. Không gửi tài khoản hay cookie.")
                }
                .alert("Đồng bộ thư viện", isPresented: Binding(
                    get: { links.syncResult != nil },
                    set: { if !$0 { links.syncResult = nil } }
                )) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(links.syncResult ?? "")
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                player.appDidEnterBackground()
                shorts.pause()
                ParentalControls.shared.saveUsage()
                NewVideoNotifier.schedule()
            case .active:
                player.appWillEnterForeground()
                Task { await AutoDownloader.run() }
            default:
                break
            }
        }
    }
}

extension Color {
    /// Brand accent (a warm red-pink, deliberately not YouTube's red).
    static let brand = Color(red: 1.0, green: 0.24, blue: 0.35)
}
