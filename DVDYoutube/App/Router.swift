import Observation
import SwiftUI

enum AppTab: Hashable {
    case home, shorts, subscriptions, library
}

enum Route: Hashable {
    case search
    case channel(ChannelItem)
    case playlist(PlaylistItem)
    case localPlaylist(UUID)
    case history
    case watchLater
    case liked
    case downloads
    case subscriptionsManager
    case settings
}

/// Navigation state for every tab, so the watch page can push a channel or playlist
/// onto whichever tab is visible (the same way the official app behaves).
@MainActor
@Observable
final class Router {
    static let shared = Router()

    var selectedTab: AppTab = .home {
        didSet {
            if selectedTab != .shorts { ShortsPlayer.shared.pause() }
        }
    }
    var homePath: [Route] = []
    var shortsPath: [Route] = []
    var subscriptionsPath: [Route] = []
    var libraryPath: [Route] = []

    /// Bumped when the user taps the already-selected tab (scroll to top / pop to root).
    private(set) var reselectCounter: [AppTab: Int] = [:]

    /// Video for which the "save to playlist" sheet is shown.
    var playlistSheetVideo: VideoItem?

    /// Shorts tapped somewhere else (search, home shelf, channel) to open in the Shorts tab.
    private(set) var pendingShorts: (items: [VideoItem], startId: String)?

    func openShorts(_ items: [VideoItem], start: VideoItem) {
        PlayerManager.shared.isExpanded = false
        pendingShorts = (items, start.id)
        selectedTab = .shorts
    }

    func consumePendingShorts() -> (items: [VideoItem], startId: String)? {
        defer { pendingShorts = nil }
        return pendingShorts
    }

    func open(_ route: Route) {
        PlayerManager.shared.isExpanded = false
        switch selectedTab {
        case .home: homePath.append(route)
        case .shorts:
            selectedTab = .home
            homePath.append(route)
        case .subscriptions: subscriptionsPath.append(route)
        case .library: libraryPath.append(route)
        }
    }

    func openChannel(id: String, name: String = "", avatar: URL? = nil) {
        open(.channel(ChannelItem(id: id, name: name, avatar: avatar)))
    }

    func reselect(_ tab: AppTab) {
        switch tab {
        case .home: if homePath.isEmpty { bump(tab) } else { homePath.removeAll() }
        case .shorts: bump(tab)
        case .subscriptions: if subscriptionsPath.isEmpty { bump(tab) } else { subscriptionsPath.removeAll() }
        case .library: if libraryPath.isEmpty { bump(tab) } else { libraryPath.removeAll() }
        }
    }

    private func bump(_ tab: AppTab) {
        reselectCounter[tab, default: 0] += 1
    }
}

extension View {
    /// Destinations shared by every tab's `NavigationStack`.
    func appDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .search: SearchView()
            case .channel(let channel): ChannelView(channel: channel)
            case .playlist(let playlist): PlaylistView(playlist: playlist)
            case .localPlaylist(let id): LocalPlaylistView(playlistId: id)
            case .history: HistoryView()
            case .watchLater: SavedVideosView(kind: .watchLater)
            case .liked: SavedVideosView(kind: .liked)
            case .downloads: DownloadsView()
            case .subscriptionsManager: SubscriptionsManagerView()
            case .settings: SettingsView()
            }
        }
    }
}
