import Foundation

enum SearchFilter: String, CaseIterable, Identifiable {
    case all, videos, shorts, channels, playlists, live, recent

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Tất cả"
        case .videos: return "Video"
        case .shorts: return "Shorts"
        case .channels: return "Kênh"
        case .playlists: return "Danh sách phát"
        case .live: return "Trực tiếp"
        case .recent: return "Mới tải lên"
        }
    }

    var params: String? {
        switch self {
        case .all: return nil
        case .videos: return "EgIQAQ%3D%3D"
        case .shorts: return "EgIQCQ%3D%3D"
        case .channels: return "EgIQAg%3D%3D"
        case .playlists: return "EgIQAw%3D%3D"
        case .live: return "EgJAAQ%3D%3D"
        case .recent: return "CAI%3D"
        }
    }
}

/// Feed categories shown as chips on the home screen.
enum HomeCategory: String, CaseIterable, Identifiable {
    case all, music, gaming, live, podcasts, news, sports, learning, movies

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Tất cả"
        case .music: return "Âm nhạc"
        case .gaming: return "Trò chơi"
        case .live: return "Trực tiếp"
        case .podcasts: return "Podcast"
        case .news: return "Tin tức"
        case .sports: return "Thể thao"
        case .learning: return "Học tập"
        case .movies: return "Phim"
        }
    }
}

/// High level API used by the UI.
final class YouTubeService {
    static let shared = YouTubeService()

    private let api = InnerTube.shared

    // MARK: Search

    func search(_ query: String, filter: SearchFilter = .all) async throws -> FeedPage {
        try await search(query, params: filter.params)
    }

    /// Search with raw `params` (filters built by `SearchFilters`).
    func search(_ query: String, params: String?) async throws -> FeedPage {
        var page = ItemParser.page(try await api.search(query: query, params: params))
        page.kind = .search
        return page
    }

    func searchMore(_ token: String) async throws -> FeedPage {
        var page = ItemParser.page(try await api.searchContinuation(token))
        page.kind = .search
        return page
    }

    /// Next page of any feed, using the endpoint the token came from.
    func more(_ token: String, kind: ContinuationKind) async throws -> FeedPage {
        switch kind {
        case .browse: return try await browseMore(token)
        case .search: return try await searchMore(token)
        case .next: return try await relatedMore(token)
        }
    }

    func suggestions(_ query: String) async -> [String] {
        await api.suggestions(for: query)
    }

    // MARK: Browse

    func browseMore(_ token: String) async throws -> FeedPage {
        ItemParser.page(try await api.browseContinuation(token))
    }

    func trendingMusic() async throws -> [VideoItem] {
        ItemParser.chartVideos(try await api.charts(type: "TRENDING_VIDEOS"))
    }

    func trendingMovieTrailers() async throws -> [VideoItem] {
        ItemParser.chartVideos(try await api.charts(type: "TRENDING_MOVIES"))
    }

    func category(_ category: HomeCategory) async throws -> FeedPage {
        switch category {
        case .all:
            return try await search(APIConfig.hl == "vi" ? "thịnh hành" : "trending", filter: .videos)
        case .music:
            let music = try await trendingMusic()
            if !music.isEmpty { return FeedPage(items: music.map(FeedItem.video), continuation: nil) }
            return try await search(APIConfig.hl == "vi" ? "nhạc mới" : "new music", filter: .videos)
        case .gaming:
            // The "Gaming" destination channel has a trending tab.
            return ItemParser.page(try await api.browse(browseId: "UCOpNcN46UbXVtpKMrmU4Abg", params: "Egh0cmVuZGluZw%3D%3D"))
        case .live:
            // The "Live" destination channel.
            return ItemParser.page(try await api.browse(browseId: "UC4R8DWoMoI7CAwX8_LjQHig", params: "EgdsaXZldGFikgEDCKEK"))
        case .podcasts:
            return ItemParser.page(try await api.browse(browseId: "FEpodcasts_destination", params: "qgcCCAM%3D"))
        case .news:
            return try await search(APIConfig.hl == "vi" ? "tin tức" : "news", filter: .videos, recent: true)
        case .sports:
            return try await search(APIConfig.hl == "vi" ? "thể thao" : "sports highlights", filter: .videos, recent: true)
        case .learning:
            return try await search(APIConfig.hl == "vi" ? "kiến thức thú vị" : "learn something new", filter: .videos)
        case .movies:
            let trailers = try await trendingMovieTrailers()
            if !trailers.isEmpty { return FeedPage(items: trailers.map(FeedItem.video), continuation: nil) }
            return try await search(APIConfig.hl == "vi" ? "trailer phim" : "movie trailer", filter: .videos, recent: true)
        }
    }

    /// Search restricted to the current week.
    private func search(_ query: String, filter: SearchFilter, recent: Bool) async throws -> FeedPage {
        let params = recent ? "EgQIAxAB" : filter.params
        var page = ItemParser.page(try await api.search(query: query, params: params))
        page.kind = .search
        return page
    }

    // MARK: Watch

    func player(_ videoId: String) async throws -> PlayerInfo {
        try await api.player(videoId: videoId)
    }

    func watchInfo(_ videoId: String) async throws -> WatchInfo {
        WatchParser.parse(try await api.next(videoId: videoId), videoId: videoId)
    }

    func relatedMore(_ token: String) async throws -> FeedPage {
        var page = ItemParser.page(try await api.nextContinuation(token))
        page.kind = .next
        return page
    }

    func comments(_ token: String) async throws -> (page: CommentsPage, sortOptions: [CommentsParser.SortOption]) {
        CommentsParser.parse(try await api.nextContinuation(token))
    }

    /// Every video of a playlist (up to `limit`), loading all its pages.
    func allPlaylistVideos(_ id: String, limit: Int = 200) async throws -> [VideoItem] {
        let first = try await playlist(id).page
        var videos = first.videos
        var token = first.continuation
        var pages = 0
        while let current = token, videos.count < limit, pages < 20 {
            let page = try await browseMore(current)
            let known = Set(videos.map(\.id))
            videos += page.videos.filter { !known.contains($0.id) }
            token = page.continuation == current ? nil : page.continuation
            pages += 1
        }
        return Array(videos.prefix(limit))
    }

    // MARK: Channels & playlists

    func channel(_ id: String, tab: ChannelTab = .videos) async throws -> ChannelPage {
        let browseId = try await resolveChannelId(id)
        let json = try await api.browse(browseId: browseId, params: tab.defaultParams)
        return ChannelParser.parse(json, channelId: browseId, tab: tab)
    }

    func channelTab(_ id: String, tab: ChannelTab, params: String?) async throws -> FeedPage {
        let json = try await api.browse(browseId: id, params: params ?? tab.defaultParams)
        return ChannelParser.parse(json, channelId: id, tab: tab).initialPage
    }

    func channelPosts(_ id: String, params: String?) async throws -> ChannelPostsPage {
        ChannelParser.posts(try await api.browse(browseId: id, params: params ?? ChannelTab.posts.defaultParams))
    }

    func channelPostsMore(_ token: String) async throws -> ChannelPostsPage {
        ChannelParser.posts(try await api.browseContinuation(token))
    }

    /// The "About" panel: from the about tab, else from the header's description continuation.
    func channelAbout(_ id: String, params: String?, token: String?) async throws -> ChannelAbout? {
        var firstError: Error?
        do {
            let json = try await api.browse(browseId: id, params: params ?? ChannelTab.about.defaultParams)
            if let about = ChannelParser.about(json) { return about }
            if let found = json.findFirst("aboutChannelRenderer").findFirst("continuationCommand")["token"].string,
               let about = ChannelParser.about(try await api.browseContinuation(found)) {
                return about
            }
        } catch {
            firstError = error
        }
        if let token {
            return ChannelParser.about(try await api.browseContinuation(token))
        }
        if let firstError { throw firstError }
        return nil
    }

    /// Videos of one channel matching `query` (the channel's search tab).
    func channelSearch(_ id: String, query: String) async throws -> FeedPage {
        ItemParser.page(try await api.browse(browseId: id, params: ChannelTab.searchParams, query: query))
    }

    func playlist(_ id: String) async throws -> PlaylistPage {
        let browseId = id.hasPrefix("VL") ? id : "VL" + id
        return PlaylistParser.parse(try await api.browse(browseId: browseId), playlistId: id)
    }

    /// Accepts a `UC…` id, an `@handle` or a channel URL.
    func resolveChannelId(_ value: String) async throws -> String {
        if value.hasPrefix("UC"), value.count == 24 { return value }
        let url = value.hasPrefix("http") ? value : "https://www.youtube.com/" + (value.hasPrefix("@") ? value : "@" + value)
        let json = try await api.resolveURL(url)
        return json.at("endpoint", "browseEndpoint", "browseId").string ?? value
    }

    /// Latest uploads of a channel for the subscriptions feed.
    func latestVideos(channel: ChannelItem) async -> [VideoItem] {
        if let videos = try? await RSSFeed.videos(channelId: channel.id), !videos.isEmpty {
            return videos.map { video in
                var video = video
                video.channelAvatar = video.channelAvatar ?? channel.avatar
                return video
            }
        }
        guard let page = try? await channelTab(channel.id, tab: .videos, params: nil) else { return [] }
        let now = Date()
        return page.videos.map { video in
            var video = video
            video.channelName = video.channelName ?? channel.name
            video.channelId = video.channelId ?? channel.id
            video.channelAvatar = video.channelAvatar ?? channel.avatar
            video.publishedDate = RelativeDateParser.date(from: video.publishedText, now: now)
            return video
        }
    }

    // MARK: Account (signed in)

    func accountProfile() async throws -> AccountProfile? {
        AccountParser.profile(try await api.accountMenu())
    }

    /// Signed-in Google accounts and their brand channels.
    func accountIdentities() async throws -> [AccountIdentity] {
        var firstError: Error?
        do {
            let identities = AccountParser.identities(try await api.accountSwitcher())
            Log.debug("account switcher: \(identities.count) identities")
            if !identities.isEmpty { return identities }
        } catch {
            firstError = error
        }
        do {
            let identities = AccountParser.identities(try await api.accountsList())
            Log.debug("accounts list: \(identities.count) identities")
            return identities
        } catch {
            throw firstError ?? error
        }
    }

    /// Any account page by browse id: FEwhat_to_watch (home), FEsubscriptions, FEchannels,
    /// FEhistory, FEplaylist_aggregation, VLWL (watch later), VLLL (liked videos).
    func accountFeed(_ browseId: String) async throws -> FeedPage {
        let page = ItemParser.page(try await api.browse(browseId: browseId))
        Log.debug("account \(browseId): \(page.items.count) items, more=\(page.continuation != nil)\(page.message.map { ", notice: \($0)" } ?? "")")
        return page
    }

    func accountPlaylistOptions(videoId: String) async throws -> [AccountPlaylistOption] {
        AccountParser.playlistOptions(try await api.addToPlaylistOptions(videoId: videoId))
    }

    func accountNotifications() async throws -> [AccountNotification] {
        let items = AccountParser.notifications(try await api.notificationMenu())
        Log.debug("notifications: \(items.count)")
        return items
    }

    /// Every channel the account is subscribed to.
    func accountSubscriptions() async throws -> [ChannelItem] {
        var page = try await accountFeed("FEchannels")
        var channels = page.items.compactMap { item -> ChannelItem? in
            if case .channel(let channel) = item { return channel }
            return nil
        }
        var pages = 0
        while let token = page.continuation, pages < 10 {
            page = try await browseMore(token)
            channels += page.items.compactMap { item -> ChannelItem? in
                if case .channel(let channel) = item { return channel }
                return nil
            }
            pages += 1
        }
        return channels
    }

    // MARK: Links

    /// Extracts a video id from any YouTube URL (watch, youtu.be, shorts, live, embed).
    static func videoId(from text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed), let host = components.host?.lowercased(),
              host.contains("youtu") else { return nil }
        if let v = components.queryItems?.first(where: { $0.name == "v" })?.value { return v }
        let parts = components.path.split(separator: "/").map(String.init)
        if host.contains("youtu.be") { return parts.first }
        if parts.count >= 2, ["shorts", "live", "embed", "v"].contains(parts[0]) { return parts[1] }
        return nil
    }
}

/// Turns "2 ngày trước" / "3 weeks ago" into an approximate date for sorting.
enum RelativeDateParser {
    static func date(from text: String?, now: Date = Date()) -> Date? {
        guard let text = text?.lowercased() else { return nil }
        let digits = text.components(separatedBy: CharacterSet.decimalDigits.inverted).first { !$0.isEmpty }
        let amount = Double(digits ?? "1") ?? 1
        let units: [(keys: [String], seconds: Double)] = [
            (["giây", "second"], 1),
            (["phút", "minute"], 60),
            (["giờ", "hour"], 3600),
            (["ngày", "day"], 86_400),
            (["tuần", "week"], 604_800),
            (["tháng", "month"], 2_592_000),
            (["năm", "year"], 31_536_000),
        ]
        for unit in units where unit.keys.contains(where: { text.contains($0) }) {
            return now.addingTimeInterval(-amount * unit.seconds)
        }
        return nil
    }
}
