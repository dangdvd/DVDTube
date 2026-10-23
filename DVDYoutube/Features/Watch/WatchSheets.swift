import SwiftUI

enum DescriptionFormatter {
    /// Makes URLs and "1:23" timestamps tappable.
    static func attributed(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        let nsText = text as NSString
        let fullRange = NSRange(location: 0, length: nsText.length)

        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
            for match in detector.matches(in: text, range: fullRange) {
                guard let url = match.url,
                      let range = Range(match.range, in: text),
                      let target = Range(range, in: result) else { continue }
                result[target].link = url
            }
        }
        if let regex = try? NSRegularExpression(pattern: #"(?<![\d:/])(\d{1,2}:)?\d{1,2}:\d{2}(?![\d:])"#) {
            for match in regex.matches(in: text, range: fullRange) {
                guard let range = Range(match.range, in: text),
                      let target = Range(range, in: result),
                      result[target].link == nil,
                      let seconds = parseDuration(String(text[range])),
                      let url = URL(string: "dvdtube-seek://\(seconds)") else { continue }
                result[target].link = url
            }
        }
        return result
    }
}

private struct WatchLinkHandler: ViewModifier {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content.environment(\.openURL, OpenURLAction { url in
            if url.scheme == "dvdtube-seek", let seconds = Double(url.host ?? "") {
                player.seek(to: seconds)
                dismiss()
                return .handled
            }
            if let id = YouTubeService.videoId(from: url.absoluteString) {
                dismiss()
                player.play(VideoItem(id: id, title: ""))
                return .handled
            }
            return .systemAction
        })
    }
}

extension View {
    func handlesWatchLinks() -> some View { modifier(WatchLinkHandler()) }
}

struct DescriptionSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    let info = player.watchInfo
                    Text(info?.title ?? player.currentVideo?.title ?? "")
                        .font(.title3.weight(.semibold))

                    HStack(spacing: 0) {
                        stat(info?.likeCountText ?? "–", "Lượt thích")
                        stat(info?.viewCountText ?? player.currentVideo?.viewCountText ?? "–", "Lượt xem")
                        stat(info?.dateText ?? player.currentVideo?.publishedText ?? "–", "Ngày đăng")
                    }

                    if let chapters = info?.chapters, !chapters.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Chương").font(.headline)
                            ForEach(chapters) { chapter in
                                Button {
                                    player.seek(to: Double(chapter.startSeconds))
                                    dismiss()
                                } label: {
                                    HStack {
                                        Text(formatDuration(chapter.startSeconds))
                                            .font(.footnote.monospacedDigit())
                                            .foregroundStyle(Color.brand)
                                            .frame(width: 64, alignment: .leading)
                                        Text(chapter.title).font(.footnote).foregroundStyle(.primary)
                                        Spacer()
                                    }
                                }
                            }
                        }
                    }

                    let description = info?.description ?? player.playerInfo?.shortDescription ?? ""
                    if !description.isEmpty {
                        Text(DescriptionFormatter.attributed(description))
                            .font(.subheadline)
                            .textSelection(.enabled)
                    }

                    if let channel = info?.channel {
                        Divider()
                        ChannelRow(channel: channel)
                            .padding(.horizontal, -16)
                    }
                }
                .padding()
            }
            .navigationTitle("Nội dung mô tả")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
        }
        .handlesWatchLinks()
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct CommentsSheet: View {
    let initialToken: String
    let countText: String?

    @Environment(\.dismiss) private var dismiss
    @State private var comments: [Comment] = []
    @State private var continuation: String?
    @State private var isLoading = false
    @State private var error: String?
    @State private var sortOptions: [CommentsParser.SortOption] = []
    @State private var selectedSort: String?
    @State private var replies: [String: [Comment]] = [:]
    @State private var replyTokens: [String: String] = [:]
    @State private var loadingReplies: Set<String> = []
    @State private var headerCount: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(comments) { comment in
                        VStack(alignment: .leading, spacing: 10) {
                            CommentRow(comment: comment)
                            if let token = comment.repliesToken {
                                repliesSection(for: comment, token: token)
                            }
                        }
                        .onAppear {
                            if comment.id == comments.last?.id { Task { await loadMore() } }
                        }
                    }
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity).padding()
                    } else if let error, comments.isEmpty {
                        ErrorStateView(message: error) { Task { await load(token: initialToken, reset: true) } }
                    } else if comments.isEmpty {
                        Text("Chưa có bình luận nào.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding()
                    }
                }
                .padding()
            }
            .navigationTitle(headerCount ?? countText.map { "Bình luận \($0)" } ?? "Bình luận")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !sortOptions.isEmpty {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            ForEach(sortOptions, id: \.token) { option in
                                Button {
                                    selectedSort = option.title
                                    Task { await load(token: option.token, reset: true) }
                                } label: {
                                    if selectedSort == option.title {
                                        Label(option.title, systemImage: "checkmark")
                                    } else {
                                        Text(option.title)
                                    }
                                }
                            }
                        } label: {
                            Image(systemName: "line.3.horizontal.decrease")
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
        }
        .handlesWatchLinks()
        .task { await load(token: initialToken, reset: true) }
    }

    @ViewBuilder
    private func repliesSection(for comment: Comment, token: String) -> some View {
        let loaded = replies[comment.id] ?? []
        VStack(alignment: .leading, spacing: 12) {
            ForEach(loaded) { reply in
                CommentRow(comment: reply, isReply: true)
            }
            let nextToken = loaded.isEmpty ? token : replyTokens[comment.id]
            if let nextToken {
                Button {
                    Task { await loadReplies(for: comment.id, token: nextToken) }
                } label: {
                    HStack(spacing: 6) {
                        if loadingReplies.contains(comment.id) {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.turn.down.right")
                        }
                        Text(loaded.isEmpty ? "\(comment.replyCountText ?? "") phản hồi" : "Hiện thêm phản hồi")
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.brand)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 40)
    }

    private func load(token: String, reset: Bool) async {
        isLoading = true
        error = nil
        if reset {
            comments = []
            continuation = nil
            replies = [:]
            replyTokens = [:]
        }
        do {
            let result = try await YouTubeService.shared.comments(token)
            comments.append(contentsOf: result.page.comments)
            continuation = result.page.continuation
            if let count = result.page.countText { headerCount = count }
            if !result.sortOptions.isEmpty {
                sortOptions = result.sortOptions
                if selectedSort == nil { selectedSort = result.sortOptions.first?.title }
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func loadMore() async {
        guard let token = continuation, !isLoading else { return }
        continuation = nil
        await load(token: token, reset: false)
    }

    private func loadReplies(for commentId: String, token: String) async {
        guard !loadingReplies.contains(commentId) else { return }
        loadingReplies.insert(commentId)
        defer { loadingReplies.remove(commentId) }
        guard let result = try? await YouTubeService.shared.comments(token) else { return }
        replies[commentId, default: []].append(contentsOf: result.page.comments)
        replyTokens[commentId] = result.page.continuation
    }
}

struct CommentRow: View {
    let comment: Comment
    var isReply = false

    @State private var expanded = false
    @Environment(Router.self) private var router

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: comment.authorAvatar, size: isReply ? 24 : 32, name: comment.authorName)
                .onTapGesture {
                    if let id = comment.authorChannelId { router.openChannel(id: id, name: comment.authorName) }
                }
            VStack(alignment: .leading, spacing: 4) {
                if comment.isPinned {
                    Label("Đã ghim", systemImage: "pin.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 4) {
                    Text(comment.authorName)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, comment.isCreator ? 6 : 0)
                        .padding(.vertical, comment.isCreator ? 2 : 0)
                        .background(Capsule().fill(comment.isCreator ? Color(.tertiarySystemFill) : .clear))
                    if let published = comment.publishedText {
                        Text("• \(published)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(DescriptionFormatter.attributed(comment.text))
                    .font(.subheadline)
                    .lineLimit(expanded ? nil : 5)
                    .onTapGesture { expanded.toggle() }
                HStack(spacing: 16) {
                    Label(comment.likeCountText ?? "", systemImage: "hand.thumbsup")
                    if comment.isHearted {
                        Image(systemName: "heart.fill").foregroundStyle(.red)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
    }
}

struct SaveToPlaylistSheet: View {
    let video: VideoItem

    @Environment(LibraryStore.self) private var library
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var showCreate = false
    @State private var newName = ""

    var body: some View {
        NavigationStack {
            List {
                Button {
                    library.toggleWatchLater(video)
                } label: {
                    checkRow("Xem sau", icon: "clock", checked: library.isInWatchLater(video.id))
                }
                ForEach(library.playlists) { playlist in
                    let contains = playlist.videos.contains { $0.id == video.id }
                    Button {
                        if contains {
                            library.remove(video.id, from: playlist.id)
                        } else {
                            library.add(video, to: playlist.id)
                        }
                    } label: {
                        checkRow(playlist.name, icon: "music.note.list", checked: contains)
                    }
                }
                Button {
                    newName = ""
                    showCreate = true
                } label: {
                    Label("Danh sách phát mới", systemImage: "plus")
                }
            }
            .navigationTitle("Lưu video vào…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
            .alert("Danh sách phát mới", isPresented: $showCreate) {
                TextField("Tên danh sách phát", text: $newName)
                Button("Hủy", role: .cancel) {}
                Button("Tạo") {
                    let name = newName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    library.createPlaylist(named: name, with: video)
                    player.showToast("Đã lưu vào \(name)")
                }
            }
        }
    }

    private func checkRow(_ title: String, icon: String, checked: Bool) -> some View {
        HStack {
            Label(title, systemImage: icon).foregroundStyle(.primary)
            Spacer()
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(checked ? Color.brand : .secondary)
        }
    }
}
