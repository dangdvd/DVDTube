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
        var text = url.absoluteString
        if url.scheme == "dvdtube" {
            text = text.replacingOccurrences(of: "dvdtube://", with: "https://www.youtube.com/")
        }
        if let id = YouTubeService.videoId(from: text) {
            player.play(VideoItem(id: id, title: ""))
        }
    }
}

extension Color {
    /// Brand accent (a warm red-pink, deliberately not YouTube's red).
    static let brand = Color(red: 1.0, green: 0.24, blue: 0.35)
}
