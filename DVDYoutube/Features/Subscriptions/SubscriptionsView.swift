import Observation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
@Observable
final class SubscriptionFeedModel {
    private(set) var videos: [VideoItem] = []
    private(set) var isLoading = false
    private(set) var lastUpdated: Date?
    @ObservationIgnored private var loadedChannelIds: Set<String> = []
    @ObservationIgnored private var loadedAccountFeed = false

    func load(force: Bool = false) async {
        if AuthSession.shared.isAuthenticated {
            // Signed in: YouTube's own subscription feed for the account.
            guard !isLoading, force || !loadedAccountFeed else { return }
            isLoading = true
            defer { isLoading = false }
            if let page = try? await YouTubeService.shared.accountFeed("FEsubscriptions") {
                let now = Date()
                videos = page.videos.map { video in
                    var video = video
                    video.publishedDate = video.publishedDate ?? RelativeDateParser.date(from: video.publishedText, now: now)
                    return video
                }
                loadedAccountFeed = true
                lastUpdated = now
                WidgetBridge.setNewVideos(videos)
            }
            return
        }
        loadedAccountFeed = false
        let channels = LibraryStore.shared.subscriptions
        let ids = Set(channels.map(\.id))
        guard !isLoading, force || ids != loadedChannelIds || lastUpdated == nil else { return }
        guard !channels.isEmpty else {
            videos = []
            loadedChannelIds = []
            return
        }
        isLoading = true
        let service = YouTubeService.shared
        let collected: [VideoItem] = await withTaskGroup(of: [VideoItem].self) { group in
            var all: [VideoItem] = []
            var pending = channels.makeIterator()
            // Limit concurrency so dozens of subscriptions don't trigger rate limiting.
            for _ in 0..<6 {
                if let channel = pending.next() {
                    group.addTask { Array(await service.latestVideos(channel: channel).prefix(15)) }
                }
            }
            for await list in group {
                all.append(contentsOf: list)
                if let channel = pending.next() {
                    group.addTask { Array(await service.latestVideos(channel: channel).prefix(15)) }
                }
            }
            return all
        }
        var seen = Set<String>()
        videos = collected
            .filter { seen.insert($0.id).inserted }
            .sorted { ($0.publishedDate ?? .distantPast) > ($1.publishedDate ?? .distantPast) }
        loadedChannelIds = ids
        lastUpdated = Date()
        isLoading = false
        WidgetBridge.setNewVideos(videos)
    }
}

struct SubscriptionsView: View {
    enum Filter: String, CaseIterable, Identifiable {
        case all = "Tất cả", today = "Hôm nay", videos = "Video", shorts = "Shorts"
        var id: String { rawValue }
    }

    @Environment(LibraryStore.self) private var library
    @Environment(AccountStore.self) private var account
    @Environment(Router.self) private var router
    @State private var model = SubscriptionFeedModel()
    @State private var filter: Filter = .all
    @State private var showImporter = false
    @State private var importMessage: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Color.clear.frame(height: 0).id("top")
                    if channels.isEmpty && model.videos.isEmpty && !model.isLoading {
                        emptyState
                    } else {
                        channelStrip
                        filterChips
                        feed
                    }
                }
            }
            .refreshable { await model.load(force: true) }
            .onChange(of: router.reselectCounter[.subscriptions]) { _, _ in
                withAnimation { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .navigationTitle("Kênh đăng ký")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { AppLogo() }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    router.open(account.isSignedIn
                        ? .accountFeed(title: "Kênh đăng ký", browseId: "FEchannels")
                        : .subscriptionsManager)
                } label: { Image(systemName: "person.2") }
                Button { router.open(.search) } label: { Image(systemName: "magnifyingglass") }
            }
        }
        .task(id: account.isSignedIn ? -1 : library.subscriptions.count) { await model.load() }
        .onChange(of: account.sessionKey) { oldKey, newKey in
            guard oldKey != "signed-out", newKey != "signed-out" else { return }
            Task { await model.load(force: true) }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.commaSeparatedText, .plainText, .text]) { result in
            importCSV(result)
        }
        .alert("Nhập kênh đăng ký", isPresented: Binding(get: { importMessage != nil }, set: { if !$0 { importMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(importMessage ?? "")
        }
    }

    /// The account's channels when signed in, otherwise the on-device list.
    private var channels: [ChannelItem] {
        account.isSignedIn ? account.subscribedChannels : library.subscriptions
    }

    private var channelStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(channels) { channel in
                    Button {
                        router.open(.channel(channel))
                    } label: {
                        VStack(spacing: 6) {
                            AvatarView(url: channel.avatar, size: 56, name: channel.name)
                            Text(channel.name)
                                .font(.caption2)
                                .lineLimit(1)
                                .frame(width: 64)
                        }
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    router.open(account.isSignedIn
                        ? .accountFeed(title: "Kênh đăng ký", browseId: "FEchannels")
                        : .subscriptionsManager)
                } label: {
                    Text("Tất cả")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.brand)
                        .padding(.horizontal, 6)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Filter.allCases) { item in
                    Button {
                        filter = item
                    } label: {
                        Text(item.rawValue)
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .foregroundStyle(filter == item ? Color(.systemBackground) : Color.primary)
                            .background(RoundedRectangle(cornerRadius: 8).fill(filter == item ? Color.primary : Color(.secondarySystemFill)))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    private var filteredVideos: [VideoItem] {
        switch filter {
        case .all: return model.videos
        case .today:
            let dayAgo = Date().addingTimeInterval(-86_400)
            return model.videos.filter { ($0.publishedDate ?? .distantPast) > dayAgo }
        case .videos: return model.videos.filter { !$0.isShort }
        case .shorts: return model.videos.filter(\.isShort)
        }
    }

    @ViewBuilder
    private var feed: some View {
        let videos = filteredVideos
        if model.isLoading && model.videos.isEmpty {
            LoadingStateView()
        } else if videos.isEmpty {
            ContentUnavailableView("Không có video mới", systemImage: "tray", description: Text("Kéo xuống để làm mới."))
                .padding(.top, 40)
        } else if filter == .shorts {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)], spacing: 4) {
                ForEach(videos) { video in
                    ShortsCard(video: video)
                        .onTapGesture { router.openShorts(videos, start: video) }
                }
            }
            .padding(.horizontal, 4)
        } else {
            LazyVStack(spacing: 20) {
                ForEach(videos) { video in
                    VideoCard(video: video, queue: videos.filter { !$0.isShort })
                        .castSwipeActions(video)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            ContentUnavailableView(
                "Chưa có kênh đăng ký",
                systemImage: "play.square.stack",
                description: Text("Nhấn \"Đăng ký\" trên một kênh để xem video mới nhất của kênh tại đây. Đăng ký được lưu ngay trên máy, không cần tài khoản Google.")
            )
            if !account.isSignedIn {
                Button {
                    router.signIn()
                } label: {
                    Label("Đăng nhập tài khoản Google", systemImage: "person.crop.circle.badge.plus")
                }
                .buttonStyle(.borderedProminent)
            }
            Button {
                showImporter = true
            } label: {
                Label("Nhập từ Google Takeout (subscriptions.csv)", systemImage: "square.and.arrow.down")
            }
            .buttonStyle(.bordered)
            Button {
                router.open(.search)
            } label: {
                Label("Tìm kênh", systemImage: "magnifyingglass")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.top, 60)
        .padding(.horizontal)
    }

    private func importCSV(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let text = try? String(contentsOf: url, encoding: .utf8) else {
                importMessage = "Không đọc được tệp."
                return
            }
            let count = library.importSubscriptions(csv: text)
            importMessage = count > 0 ? "Đã nhập \(count) kênh." : "Không tìm thấy kênh mới trong tệp."
        case .failure(let error):
            importMessage = error.localizedDescription
        }
    }
}

struct SubscriptionsManagerView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    @State private var query = ""
    @State private var showImporter = false
    @State private var message: String?

    var body: some View {
        List {
            ForEach(filtered) { channel in
                Button {
                    router.open(.channel(channel))
                } label: {
                    HStack(spacing: 12) {
                        AvatarView(url: channel.avatar, size: 40, name: channel.name)
                        VStack(alignment: .leading) {
                            Text(channel.name).foregroundStyle(.primary)
                            if let subscribers = channel.subscriberText {
                                Text(subscribers).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .swipeActions {
                    Button("Hủy đăng ký", role: .destructive) { library.toggleSubscription(channel) }
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if library.subscriptions.isEmpty {
                ContentUnavailableView("Chưa có kênh nào", systemImage: "person.2.slash")
            }
        }
        .searchable(text: $query, prompt: "Tìm trong kênh đăng ký")
        .navigationTitle("Kênh đăng ký (\(library.subscriptions.count))")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { showImporter = true } label: {
                        Label("Nhập từ CSV (Google Takeout)", systemImage: "square.and.arrow.down")
                    }
                    if let file = exportFile() {
                        ShareLink(item: file) {
                            Label("Xuất ra CSV", systemImage: "square.and.arrow.up")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.commaSeparatedText, .plainText, .text]) { result in
            if case .success(let url) = result {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                if let text = try? String(contentsOf: url, encoding: .utf8) {
                    let count = library.importSubscriptions(csv: text)
                    message = "Đã nhập \(count) kênh."
                }
            }
        }
        .alert("Nhập kênh", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    private var filtered: [ChannelItem] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return library.subscriptions.sorted { $0.name.localizedCompare($1.name) == .orderedAscending } }
        return library.subscriptions.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private func exportFile() -> URL? {
        guard !library.subscriptions.isEmpty else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("subscriptions.csv")
        try? library.exportSubscriptionsCSV().write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
