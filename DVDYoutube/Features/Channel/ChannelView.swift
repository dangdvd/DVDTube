import SwiftUI

struct ChannelView: View {
    let channel: ChannelItem

    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router
    @State private var page: ChannelPage?
    @State private var error: String?
    @State private var tab: ChannelTab = .videos
    @State private var models: [ChannelTab: FeedModel] = [:]
    @State private var showDescription = false

    private var info: ChannelItem { page?.channel ?? channel }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                header
                Section {
                    tabContent
                        .padding(.top, 12)
                } header: {
                    tabBar
                }
            }
        }
        .refreshable { await load(force: true) }
        .navigationTitle(info.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: URL(string: "https://www.youtube.com/channel/\(info.id)")!) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showDescription) {
            NavigationStack {
                ScrollView {
                    Text(DescriptionFormatter.attributed(page?.description ?? ""))
                        .font(.subheadline)
                        .textSelection(.enabled)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .navigationTitle("Giới thiệu")
                .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let banner = page?.banner {
                RemoteImage(url: banner)
                    .aspectRatio(5.3, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 12)
            }
            HStack(spacing: 14) {
                AvatarView(url: info.avatar, size: 72, name: info.name)
                VStack(alignment: .leading, spacing: 4) {
                    Text(info.name).font(.title2.weight(.bold)).lineLimit(2)
                    Text([info.handle, info.subscriberText].compactMap { $0 }.joined(separator: " • "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let videos = info.videoCountText {
                        Text(videos).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)

            if let description = page?.description, !description.isEmpty {
                HStack(alignment: .bottom) {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .contentShape(Rectangle())
                .onTapGesture { showDescription = true }
            }

            SubscribeButtonWide(channel: info)
                .padding(.horizontal, 12)

            if let error, page == nil {
                ErrorStateView(message: error) { Task { await load(force: true) } }
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 22) {
                ForEach(ChannelTab.allCases) { item in
                    Button {
                        tab = item
                        Task { await model(for: item)?.load() }
                    } label: {
                        VStack(spacing: 8) {
                            Text(item.title)
                                .font(.subheadline.weight(tab == item ? .semibold : .regular))
                                .foregroundStyle(tab == item ? Color.primary : Color.secondary)
                            Rectangle()
                                .fill(tab == item ? Color.primary : Color.clear)
                                .frame(height: 2)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .background(.bar)
        .overlay(alignment: .bottom) { Divider() }
    }

    @ViewBuilder
    private var tabContent: some View {
        if let model = models[tab] {
            if model.isLoading && model.items.isEmpty {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            } else if let error = model.error, model.items.isEmpty {
                ErrorStateView(message: error) { Task { await model.load(force: true) } }
            } else if model.items.isEmpty {
                ContentUnavailableView("Kênh này chưa có nội dung ở mục này", systemImage: "tray")
                    .padding(.top, 30)
            } else if tab == .shorts {
                let shorts = model.videos
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 3), spacing: 3) {
                    ForEach(shorts) { short in
                        ShortsCard(video: short)
                            .onTapGesture { router.openShorts(shorts, start: short) }
                            .onAppear {
                                if short.id == shorts.last?.id { Task { await model.loadMore() } }
                            }
                    }
                }
                .padding(.horizontal, 3)
            } else {
                FeedList(items: decorated(model.items), isLoadingMore: model.isLoadingMore, compact: tab == .playlists) {
                    Task { await model.loadMore() }
                }
            }
        } else if page == nil, error == nil {
            LoadingStateView()
        } else {
            Color.clear.frame(height: 1).onAppear { _ = model(for: tab) }
        }
    }

    /// Channel tabs omit the channel on each item; fill it in for menus and history.
    private func decorated(_ items: [FeedItem]) -> [FeedItem] {
        items.map { item in
            guard case .video(var video) = item else { return item }
            video.channelName = video.channelName ?? info.name
            video.channelId = video.channelId ?? info.id
            video.channelAvatar = video.channelAvatar ?? info.avatar
            return .video(video)
        }
    }

    @discardableResult
    private func model(for tab: ChannelTab) -> FeedModel? {
        if let existing = models[tab] { return existing }
        guard let page else { return nil }
        let id = page.channel.id
        let params = page.tabParams[tab]
        let model = FeedModel { try await YouTubeService.shared.channelTab(id, tab: tab, params: params) }
        models[tab] = model
        Task { await model.load() }
        return model
    }

    private func load(force: Bool = false) async {
        guard force || page == nil else { return }
        do {
            let loaded = try await YouTubeService.shared.channel(channel.id, tab: .videos)
            page = loaded
            error = nil
            let videosModel = FeedModel { try await YouTubeService.shared.channelTab(loaded.channel.id, tab: .videos, params: loaded.tabParams[.videos]) }
            videosModel.replace(with: loaded.initialPage)
            models = [.videos: videosModel]
            if tab != .videos { model(for: tab) }
            library.updateSubscription(loaded.channel)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct SubscribeButtonWide: View {
    let channel: ChannelItem

    @Environment(LibraryStore.self) private var library
    @Environment(AccountStore.self) private var account

    var body: some View {
        let subscribed = account.isSignedIn ? account.isSubscribed(channel.id) : library.isSubscribed(channel.id)
        Button {
            toggleSubscription(channel, subscribed: subscribed, account: account, library: library)
        } label: {
            Label(subscribed ? "Đã đăng ký" : "Đăng ký", systemImage: subscribed ? "bell.fill" : "plus")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .foregroundStyle(subscribed ? Color.primary : Color(.systemBackground))
                .background(Capsule().fill(subscribed ? Color(.secondarySystemFill) : Color.primary))
        }
        .buttonStyle(.plain)
    }
}
