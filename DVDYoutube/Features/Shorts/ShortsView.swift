import SwiftUI

struct ShortsView: View {
    @Environment(ShortsPlayer.self) private var shorts
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library

    @State private var items: [VideoItem] = []
    @State private var currentId: String?
    @State private var continuation: String?
    @State private var queryIndex = 0
    @State private var isLoading = false
    @State private var error: String?
    @State private var details: [String: WatchInfo] = [:]

    private var queries: [String] {
        APIConfig.hl == "vi"
            ? ["shorts", "shorts việt nam", "hài hước shorts", "âm nhạc shorts", "ẩm thực shorts", "thể thao shorts"]
            : ["shorts", "funny shorts", "music shorts", "food shorts", "sports shorts"]
    }

    var body: some View {
        GeometryReader { geo in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(items) { item in
                        ShortPage(video: item, info: details[item.id], isActive: item.id == currentId)
                            .frame(width: geo.size.width, height: geo.size.height)
                            .id(item.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $currentId)
            .scrollIndicators(.hidden)
            .overlay {
                if items.isEmpty {
                    if let error {
                        ErrorStateView(message: error) { Task { await loadFeed(reset: true) } }
                            .environment(\.colorScheme, .dark)
                    } else {
                        ProgressView().tint(.white)
                    }
                }
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(Color.black)
        .toolbar(.hidden, for: .navigationBar)
        .toolbarBackground(.black, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarColorScheme(.dark, for: .tabBar)
        .onAppear {
            if let pending = router.consumePendingShorts() {
                items = pending.items
                currentId = pending.startId
                continuation = nil
                playCurrent()
            } else if items.isEmpty {
                Task { await loadFeed(reset: true) }
            } else {
                playCurrent()
            }
        }
        .onChange(of: router.pendingShorts?.startId) { _, _ in
            if let pending = router.consumePendingShorts() {
                items = pending.items
                currentId = pending.startId
                playCurrent()
            }
        }
        .onDisappear { shorts.pause() }
        .onChange(of: currentId) { _, _ in playCurrent() }
        .onChange(of: router.reselectCounter[.shorts]) { _, _ in
            Task { await loadFeed(reset: true) }
        }
    }

    private func playCurrent() {
        guard router.selectedTab == .shorts else { return }
        guard let id = currentId ?? items.first?.id, let index = items.firstIndex(where: { $0.id == id }) else { return }
        if currentId == nil { currentId = id }
        shorts.play(items[index])
        for next in items.dropFirst(index + 1).prefix(1) { shorts.prefetch(next) }
        loadDetails(for: items[index])
        if index >= items.count - 4 { Task { await loadFeed(reset: false) } }
    }

    private func loadDetails(for video: VideoItem) {
        guard details[video.id] == nil else { return }
        Task {
            if let info = try? await YouTubeService.shared.watchInfo(video.id) {
                details[video.id] = info
            }
        }
    }

    private func loadFeed(reset: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        if reset {
            continuation = nil
            queryIndex = Int.random(in: 0..<queries.count)
        }
        do {
            let page: FeedPage
            if let token = continuation {
                page = try await YouTubeService.shared.searchMore(token)
            } else {
                page = try await YouTubeService.shared.search(queries[queryIndex % queries.count], filter: .shorts)
                queryIndex += 1
            }
            continuation = page.continuation
            let watched = Set(library.history.prefix(300).filter { $0.video.isShort }.map(\.id))
            let existing = Set(items.map(\.id))
            var fresh = page.videos.filter { $0.isShort && !existing.contains($0.id) && !watched.contains($0.id) }
            if fresh.isEmpty { fresh = page.videos.filter { !existing.contains($0.id) } }
            fresh = fresh.map { video in
                var short = video
                short.isShort = true
                return short
            }
            if reset {
                items = fresh
                currentId = fresh.first?.id
                playCurrent()
            } else {
                items.append(contentsOf: fresh)
            }
            error = nil
        } catch {
            if items.isEmpty { self.error = error.localizedDescription }
        }
    }
}

private struct ShortPage: View {
    let video: VideoItem
    let info: WatchInfo?
    let isActive: Bool

    @Environment(ShortsPlayer.self) private var shorts
    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    @State private var showComments = false
    @State private var showDescription = false

    var body: some View {
        ZStack {
            RemoteImage(url: video.shortsThumbnail, contentMode: .fill)

            if isActive, shorts.usesWebPlayer(video.id) {
                WebPlayerView(videoId: video.id, loop: true)
            } else if isActive {
                PlayerLayerView(player: shorts.player, gravity: .resizeAspectFill)
                    .opacity(shorts.currentId == video.id && !shorts.isLoading ? 1 : 0)
            }

            if !(isActive && shorts.usesWebPlayer(video.id)) {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { shorts.toggle() }
            }

            if isActive, !shorts.isPlaying, !shorts.isLoading, shorts.error == nil, !shorts.usesWebPlayer(video.id) {
                Image(systemName: "play.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(.white.opacity(0.85))
                    .shadow(radius: 6)
                    .allowsHitTesting(false)
            }
            if isActive, shorts.isLoading {
                ProgressView().tint(.white).controlSize(.large)
            }
            if isActive, let error = shorts.error {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.title)
                    Text(error).font(.footnote).multilineTextAlignment(.center)
                    Button("Thử lại") { shorts.stop(); shorts.play(video) }
                        .buttonStyle(.borderedProminent)
                }
                .foregroundStyle(.white)
                .padding()
            }

            overlayInfo
        }
        .clipped()
        .sheet(isPresented: $showComments) {
            if let token = info?.commentsToken {
                CommentsSheet(initialToken: token, countText: info?.commentCountText)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private var channel: ChannelItem? {
        info?.channel ?? video.channelId.map { ChannelItem(id: $0, name: video.channelName ?? "", avatar: video.channelAvatar) }
    }

    private var overlayInfo: some View {
        VStack {
            Spacer()
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 10) {
                    if let channel {
                        HStack(spacing: 8) {
                            AvatarView(url: channel.avatar, size: 32, name: channel.name)
                            Text(channel.name.isEmpty ? "Kênh" : channel.name)
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(1)
                            SubscribeButton(channel: channel, compact: true)
                                .scaleEffect(0.85)
                        }
                        .onTapGesture { router.open(.channel(channel)) }
                    }
                    Text(info?.title.isEmpty == false ? info!.title : video.title)
                        .font(.subheadline)
                        .lineLimit(2)
                        .onTapGesture { showDescription.toggle() }
                    if showDescription, let description = info?.description, !description.isEmpty {
                        ScrollView {
                            Text(description).font(.caption)
                        }
                        .frame(maxHeight: 140)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(spacing: 22) {
                    actionButton(library.isLiked(video.id) ? "hand.thumbsup.fill" : "hand.thumbsup",
                                 info?.likeCountText ?? "Thích") {
                        library.toggleLike(video)
                    }
                    actionButton("text.bubble.fill", info?.commentCountText ?? "Bình luận") {
                        if info?.commentsToken != nil { showComments = true }
                    }
                    ShareLink(item: video.shareURL) {
                        actionLabel("arrowshape.turn.up.right.fill", "Chia sẻ")
                    }
                    actionButton("text.badge.plus", "Lưu") {
                        router.playlistSheetVideo = video
                    }
                }
                .buttonStyle(.plain)
            }
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.6), radius: 4)
            .padding(.horizontal, 12)
            .padding(.bottom, 14)

            if isActive {
                GeometryReader { geo in
                    Rectangle()
                        .fill(Color.white)
                        .frame(width: geo.size.width * CGFloat(min(max(shorts.progress, 0), 1)), height: 2)
                }
                .frame(height: 2)
            }
        }
        .background(alignment: .bottom) {
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                .frame(height: 260)
                .allowsHitTesting(false)
        }
    }

    private func actionButton(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { actionLabel(icon, title) }
    }

    private func actionLabel(_ icon: String, _ title: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 26))
            Text(title).font(.caption2.weight(.semibold)).lineLimit(1)
        }
        .frame(width: 60)
    }
}
