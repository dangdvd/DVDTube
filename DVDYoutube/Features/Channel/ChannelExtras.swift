import SwiftUI

/// The channel's "Posts" (community) tab.
struct ChannelPostsSection: View {
    let channelId: String
    let params: String?

    @State private var posts: [ChannelPost] = []
    @State private var continuation: String?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            if isLoading && posts.isEmpty {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            } else if let error, posts.isEmpty {
                ErrorStateView(message: error) { Task { await load() } }
            } else if loaded, posts.isEmpty {
                ContentUnavailableView("Kênh này chưa có bài đăng nào", systemImage: "text.bubble")
                    .padding(.top, 30)
            }
            ForEach(posts) { post in
                PostCard(post: post)
                    .onAppear {
                        if post.id == posts.last?.id { Task { await loadMore() } }
                    }
            }
            if isLoadingMore {
                ProgressView().frame(maxWidth: .infinity).padding()
            }
        }
        .padding(.horizontal, 12)
        .task { if !loaded { await load() } }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            let page = try await YouTubeService.shared.channelPosts(channelId, params: params)
            posts = page.posts
            continuation = page.continuation
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        isLoading = false
    }

    private func loadMore() async {
        guard let token = continuation, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        guard let page = try? await YouTubeService.shared.channelPostsMore(token) else {
            continuation = nil
            return
        }
        let known = Set(posts.map(\.id))
        posts += page.posts.filter { !known.contains($0.id) }
        continuation = page.continuation == token ? nil : page.continuation
    }
}

/// One community post: text, images, an attached video or a poll.
struct PostCard: View {
    let post: ChannelPost

    @Environment(PlayerManager.self) private var player
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                AvatarView(url: post.authorAvatar, size: 32, name: post.authorName)
                VStack(alignment: .leading, spacing: 2) {
                    Text(post.authorName).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let published = post.publishedText {
                        Text(published).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if !post.text.isEmpty {
                Text(DescriptionFormatter.attributed(post.text))
                    .font(.subheadline)
                    .lineLimit(expanded ? nil : 5)
                    .onTapGesture { expanded.toggle() }
                if !expanded, post.text.count > 240 || post.text.filter({ $0 == "\n" }).count > 4 {
                    Button("Xem thêm") { expanded = true }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                }
            }
            if post.images.count == 1, let url = post.images.first {
                RemoteImage(url: url, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .frame(height: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else if post.images.count > 1 {
                TabView {
                    ForEach(post.images, id: \.self) { url in
                        RemoteImage(url: url, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .tabViewStyle(.page)
                .frame(height: 300)
            }
            if let video = post.video {
                Button {
                    player.play(video)
                } label: {
                    HStack(spacing: 10) {
                        ThumbnailView(video: video, cornerRadius: 8, showProgress: false)
                            .frame(width: 140)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(video.title).font(.subheadline.weight(.medium)).lineLimit(2)
                            Text(video.metadataLine).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
            }
            if !post.pollChoices.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(post.pollChoices.enumerated()), id: \.offset) { _, choice in
                        Text(choice)
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(RoundedRectangle(cornerRadius: 8).stroke(Color(.separator)))
                    }
                    if let votes = post.pollVotesText {
                        Text(votes).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            HStack(spacing: 18) {
                Label(post.likeCountText ?? "0", systemImage: "hand.thumbsup")
                if let comments = post.commentCountText {
                    Label(comments, systemImage: "text.bubble")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemBackground)))
    }
}

/// The channel's "About" panel: description, links and details.
struct ChannelAboutSection: View {
    let channelId: String
    let params: String?
    let token: String?
    var fallbackDescription: String?

    @State private var about: ChannelAbout?
    @State private var isLoading = false
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if isLoading && about == nil {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            } else if let error, about == nil, fallbackDescription == nil {
                ErrorStateView(message: error) { Task { await load() } }
            } else {
                let description = about?.description ?? fallbackDescription
                if let description, !description.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Mô tả").font(.headline)
                        Text(DescriptionFormatter.attributed(description))
                            .font(.subheadline)
                            .textSelection(.enabled)
                    }
                }
                if let links = about?.links, !links.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Liên kết").font(.headline)
                        ForEach(links) { link in
                            Link(destination: link.url) {
                                HStack(spacing: 10) {
                                    Image(systemName: "link")
                                        .frame(width: 22)
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(link.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                                        Text(link.displayText).font(.caption).foregroundStyle(Color.brand).lineLimit(1)
                                    }
                                }
                            }
                        }
                    }
                }
                if let about {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Thông tin khác").font(.headline)
                        detail("globe", about.canonicalURL)
                        detail("person.2", about.subscriberCountText)
                        detail("play.rectangle", about.videoCountText)
                        detail("chart.line.uptrend.xyaxis", about.viewCountText)
                        detail("info.circle", about.joinedDateText)
                        detail("mappin.and.ellipse", about.country)
                    }
                } else if loaded, description == nil {
                    ContentUnavailableView("Không có thông tin giới thiệu", systemImage: "info.circle")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .task { if !loaded { await load() } }
    }

    @ViewBuilder
    private func detail(_ icon: String, _ text: String?) -> some View {
        if let text, !text.isEmpty {
            HStack(spacing: 10) {
                Image(systemName: icon).frame(width: 22).foregroundStyle(.secondary)
                Text(text).font(.subheadline).textSelection(.enabled)
            }
        }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            about = try await YouTubeService.shared.channelAbout(channelId, params: params, token: token)
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        isLoading = false
    }
}

/// Search inside one channel (the channel's search tab).
struct ChannelSearchView: View {
    let channel: ChannelItem

    @State private var query = ""
    @State private var model: FeedModel?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            if let model {
                if model.isLoading && model.items.isEmpty {
                    LoadingStateView()
                } else if let error = model.error, model.items.isEmpty {
                    ErrorStateView(message: error) { Task { await model.load(force: true) } }
                } else if model.hasLoaded, model.items.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    FeedList(items: model.items, isLoadingMore: model.isLoadingMore) {
                        Task { await model.loadMore() }
                    }
                    .padding(.top, 4)
                }
            } else {
                ContentUnavailableView("Tìm trong \(channel.name)", systemImage: "magnifyingglass",
                                       description: Text("Nhập từ khóa để tìm video của kênh này."))
                    .padding(.top, 40)
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Tìm trong kênh", text: $query)
                        .focused($focused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                        .onSubmit(search)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(Capsule().fill(Color(.secondarySystemFill)))
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { if model == nil { focused = true } }
    }

    private func search() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        focused = false
        let id = channel.id
        let newModel = FeedModel { try await YouTubeService.shared.channelSearch(id, query: text) }
        model = newModel
        Task { await newModel.load() }
    }
}
