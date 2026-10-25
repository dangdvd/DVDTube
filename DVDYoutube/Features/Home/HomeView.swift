import Observation
import SwiftUI

/// "For you" feed built entirely on-device: videos related to what you watched,
/// fresh uploads from your subscriptions, Shorts and trending as a fallback.
@MainActor
@Observable
final class HomeFeedModel {
    private(set) var items: [FeedItem] = []
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var hasLoaded = false
    @ObservationIgnored private var trendingContinuation: String?
    @ObservationIgnored private var trendingKind: ContinuationKind = .search
    private(set) var isLoadingMore = false

    func load(force: Bool = false) async {
        guard force || (!hasLoaded && !isLoading) else { return }
        isLoading = true
        error = nil
        let service = YouTubeService.shared
        let library = LibraryStore.shared
        let seeds = Array(library.history.filter { !$0.video.isShort }.prefix(4).map(\.video.id))
        let channels = Array(library.subscriptions.prefix(10))
        let watched = Set(library.history.prefix(200).map(\.id))

        async let relatedLists: [[VideoItem]] = withTaskGroup(of: [VideoItem].self) { group in
            for seed in seeds {
                group.addTask { (try? await service.watchInfo(seed))?.related.videos ?? [] }
            }
            var lists: [[VideoItem]] = []
            for await list in group { lists.append(list) }
            return lists
        }
        async let subscriptionVideos: [VideoItem] = withTaskGroup(of: [VideoItem].self) { group in
            for channel in channels {
                group.addTask { Array(await service.latestVideos(channel: channel).filter { !$0.isShort }.prefix(3)) }
            }
            var all: [VideoItem] = []
            for await list in group { all.append(contentsOf: list) }
            let weekAgo = Date().addingTimeInterval(-7 * 86_400)
            return all.filter { ($0.publishedDate ?? .distantPast) > weekAgo }
                .sorted { ($0.publishedDate ?? .distantPast) > ($1.publishedDate ?? .distantPast) }
        }
        async let trendingPage: FeedPage? = try? await service.category(.all)
        async let shortsPage: FeedPage? = try? await service.search(
            APIConfig.hl == "vi" ? "shorts việt nam" : "shorts", filter: .shorts
        )

        let related = await relatedLists
        let fresh = await subscriptionVideos
        let trending = await trendingPage
        let shorts = await shortsPage
        if Task.isCancelled {
            // The view went away mid-load (e.g. a screen was pushed); `.task` reloads on return.
            isLoading = false
            return
        }

        var seen = Set<String>()
        var result: [FeedItem] = []
        func add(_ video: VideoItem) {
            guard !video.isShort, !watched.contains(video.id), seen.insert(video.id).inserted else { return }
            result.append(.video(video))
        }

        // Interleave: one fresh subscription upload, then two recommendations, repeat.
        var recommendationLists = related.map { $0.makeIterator() }
        var freshIterator = fresh.makeIterator()
        var exhausted = false
        while !exhausted {
            exhausted = true
            if let video = freshIterator.next() { add(video); exhausted = false }
            for index in recommendationLists.indices {
                for _ in 0..<2 {
                    if let video = recommendationLists[index].next() { add(video); exhausted = false }
                }
            }
        }
        for item in trending?.items ?? [] {
            if let video = item.video { add(video) }
        }

        let shortItems = (shorts?.items ?? []).flatMap { item -> [VideoItem] in
            switch item {
            case .video(let video) where video.isShort: return [video]
            case .shorts(let list): return list
            default: return []
            }
        }
        if !shortItems.isEmpty {
            result.insert(.shorts(Array(shortItems.prefix(12))), at: min(3, result.count))
        }

        if result.isEmpty, trending == nil {
            error = "Không thể kết nối tới YouTube. Kiểm tra mạng và thử lại."
        }
        Log.debug("home: related=\(related.map(\.count)) fresh=\(fresh.count) trending=\(trending?.items.count ?? -1) shorts=\(shortItems.count) total=\(result.count)")
        items = result
        trendingContinuation = trending?.continuation
        trendingKind = trending?.kind ?? .search
        hasLoaded = true
        isLoading = false
    }

    func loadMore() async {
        guard let token = trendingContinuation, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        guard let page = try? await YouTubeService.shared.more(token, kind: trendingKind) else {
            trendingContinuation = nil
            return
        }
        let existing = Set(items.map(\.id))
        items.append(contentsOf: page.items.filter { !existing.contains($0.id) })
        trendingContinuation = page.continuation == token ? nil : page.continuation
    }
}

struct HomeView: View {
    @Environment(Router.self) private var router
    @Environment(AccountStore.self) private var account
    @State private var category: HomeCategory = .all
    @State private var forYou = HomeFeedModel()
    @State private var categoryModels: [HomeCategory: FeedModel] = [:]
    /// The account's own YouTube home ("FEwhat_to_watch") when signed in.
    @State private var accountHome = FeedModel { try await YouTubeService.shared.accountFeed("FEwhat_to_watch") }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        IncognitoBanner()
                            .padding(.top, 8)
                        content
                            .padding(.top, 8)
                    } header: {
                        chips
                    }
                }
                .id("top")
            }
            .refreshable { await reload() }
            .onChange(of: router.reselectCounter[.home]) { _, _ in
                withAnimation { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { AppLogo() }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if account.isSignedIn {
                    Button { router.showUpload = true } label: { Image(systemName: "plus.app") }
                        .accessibilityLabel("Tải video lên")
                    NotificationBell()
                }
                Button { router.open(.music) } label: { Image(systemName: "music.note") }
                    .accessibilityLabel("Nghe nhạc")
                Button { router.open(.search) } label: { Image(systemName: "magnifyingglass") }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: account.isSignedIn) {
            if account.isSignedIn {
                await accountHome.load()
            } else {
                await forYou.load()
            }
        }
        .onChange(of: account.sessionKey) { oldKey, newKey in
            // Switched to another Google account or brand channel.
            guard oldKey != "signed-out", newKey != "signed-out" else { return }
            categoryModels = [:]
            Task { await accountHome.load(force: true) }
        }
        .onChange(of: account.isSignedIn) { _, signedIn in
            // Personalised results differ per account. Reload the same model in place
            // (replacing it raced with the `.task` above and left the feed unloaded).
            categoryModels = [:]
            if signedIn, accountHome.hasLoaded {
                Task { await accountHome.load(force: true) }
            }
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(HomeCategory.allCases) { item in
                    Button {
                        category = item
                        Task { await model(for: item)?.load() }
                    } label: {
                        Text(item.title)
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .foregroundStyle(category == item ? Color(.systemBackground) : Color.primary)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(category == item ? Color.primary : Color(.secondarySystemFill))
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }

    @ViewBuilder
    private var content: some View {
        if category == .all, account.isSignedIn {
            if accountHome.hasLoaded, accountHome.items.isEmpty, accountHome.error == nil {
                // YouTube returned no recommendations (typically: watch history is off).
                // Explain why and fall back to the on-device suggestions.
                accountNotice(accountHome.message)
                forYouFeed
                    .task { await forYou.load() }
            } else {
                CategoryFeed(model: accountHome)
            }
        } else if category == .all {
            forYouFeed
        } else if let model = categoryModels[category] {
            CategoryFeed(model: model)
        } else {
            LoadingStateView()
                .onAppear { _ = model(for: category) }
        }
    }

    @ViewBuilder
    private var forYouFeed: some View {
        if forYou.isLoading && forYou.items.isEmpty {
            LoadingStateView()
        } else if let error = forYou.error, forYou.items.isEmpty {
            ErrorStateView(message: error) { Task { await forYou.load(force: true) } }
        } else {
            FeedList(items: forYou.items, isLoadingMore: forYou.isLoadingMore, hidesDismissed: true) {
                Task { await forYou.loadMore() }
            }
        }
    }

    private func accountNotice(_ message: String?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill").foregroundStyle(Color.brand)
            VStack(alignment: .leading, spacing: 4) {
                Text("YouTube chưa có đề xuất cho tài khoản của bạn")
                    .font(.subheadline.weight(.semibold))
                Text(message ?? "Thường là do Nhật ký xem của tài khoản đang tắt. Bật lại tại myactivity.google.com hoặc trong ứng dụng YouTube, rồi kéo xuống để làm mới.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Tạm thời hiển thị đề xuất dựa trên những gì bạn xem trong ứng dụng này.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
        .padding(.horizontal, 12)
        .padding(.bottom, 12)
    }

    @discardableResult
    private func model(for category: HomeCategory) -> FeedModel? {
        guard category != .all else { return nil }
        if let existing = categoryModels[category] { return existing }
        let model = FeedModel { try await YouTubeService.shared.category(category) }
        categoryModels[category] = model
        Task { await model.load() }
        return model
    }

    private func reload() async {
        if category == .all, account.isSignedIn {
            await accountHome.load(force: true)
        } else if category == .all {
            await forYou.load(force: true)
        } else {
            await model(for: category)?.load(force: true)
        }
    }
}

private struct CategoryFeed: View {
    let model: FeedModel

    var body: some View {
        Group {
            feed
        }
        // Self-loading: a feed shown on screen is never left in the "not loaded" state.
        .task { await model.load() }
    }

    @ViewBuilder
    private var feed: some View {
        if (model.isLoading || !model.hasLoaded) && model.items.isEmpty && model.error == nil {
            LoadingStateView()
        } else if let error = model.error, model.items.isEmpty {
            ErrorStateView(message: error) { Task { await model.load(force: true) } }
        } else {
            FeedList(items: model.items, isLoadingMore: model.isLoadingMore, hidesDismissed: true) {
                Task { await model.loadMore() }
            }
        }
    }
}

struct AppLogo: View {
    var body: some View {
        HStack(spacing: 6) {
            Image("Logo")
                .resizable()
                .frame(width: 26, height: 26)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            Text("DVDTube")
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .tracking(-0.5)
        }
        .accessibilityLabel("DVDTube")
    }
}
