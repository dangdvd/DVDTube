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
    @State private var createParams: String?
    @State private var replyTarget: Comment?
    @State private var draft = ""
    @State private var isPosting = false
    @FocusState private var composerFocused: Bool
    @Environment(AccountStore.self) private var account

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(comments) { comment in
                        VStack(alignment: .leading, spacing: 10) {
                            CommentRow(comment: comment, onReply: replyAction(for: comment))
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
            .safeAreaInset(edge: .bottom) {
                if account.isSignedIn, createParams != nil || replyTarget != nil {
                    composer
                }
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
                CommentRow(comment: reply, isReply: true, onReply: replyAction(for: comment))
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
            if let params = result.page.createParams { createParams = params }
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

    private func replyAction(for comment: Comment) -> (() -> Void)? {
        guard account.isSignedIn, comment.replyParams != nil else { return nil }
        return {
            replyTarget = comment
            composerFocused = true
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let target = replyTarget {
                HStack {
                    Text("Phản hồi \(target.authorName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        replyTarget = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 10) {
                AvatarView(url: account.profile?.avatar, size: 30, name: account.profile?.name ?? "")
                TextField(replyTarget == nil ? "Viết bình luận…" : "Viết phản hồi…", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($composerFocused)
                Button {
                    Task { await post() }
                } label: {
                    if isPosting {
                        ProgressView()
                    } else {
                        Image(systemName: "paperplane.fill")
                    }
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isPosting)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func post() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isPosting = true
        defer { isPosting = false }
        let target = replyTarget
        do {
            if let target, let params = target.replyParams {
                _ = try await InnerTube.shared.createReply(text, params: params)
            } else if let params = createParams {
                _ = try await InnerTube.shared.createComment(text, params: params)
            } else {
                return
            }
            let mine = Comment(
                id: "local-\(UUID().uuidString)",
                authorName: account.profile?.handle ?? account.profile?.name ?? "Bạn",
                authorAvatar: account.profile?.avatar,
                text: text,
                publishedText: "Vừa xong",
                isPinned: false,
                isCreator: false,
                isHearted: false
            )
            if let target {
                replies[target.id, default: []].insert(mine, at: 0)
            } else {
                comments.insert(mine, at: 0)
            }
            draft = ""
            replyTarget = nil
            composerFocused = false
            PlayerManager.shared.showToast(target == nil ? "Đã đăng bình luận" : "Đã đăng phản hồi")
        } catch {
            PlayerManager.shared.showToast("Không đăng được: \(error.localizedDescription)")
        }
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
    var onReply: (() -> Void)?

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
                    if let onReply {
                        Button("Phản hồi", action: onReply)
                            .font(.caption.weight(.semibold))
                            .buttonStyle(.plain)
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
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var showCreate = false
    @State private var newName = ""
    @State private var accountPlaylists: [AccountPlaylistOption] = []
    @State private var loadingAccount = false
    @State private var showCreateOnAccount = false

    var body: some View {
        NavigationStack {
            List {
                Button {
                    LibraryActions.toggleWatchLater(video)
                } label: {
                    checkRow("Xem sau", icon: "clock", checked: LibraryActions.isInWatchLater(video.id))
                }
                if account.isSignedIn {
                    Section("Danh sách phát trên YouTube") {
                        if loadingAccount && accountPlaylists.isEmpty {
                            ProgressView()
                        }
                        ForEach(accountPlaylists) { option in
                            Button {
                                Task { await toggle(option) }
                            } label: {
                                checkRow(option.title, icon: "play.square.stack", checked: option.containsVideo)
                            }
                        }
                        Button {
                            newName = ""
                            showCreateOnAccount = true
                        } label: {
                            Label("Danh sách phát mới trên YouTube", systemImage: "plus")
                        }
                    }
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
            .task {
                guard account.isSignedIn else { return }
                loadingAccount = true
                accountPlaylists = (try? await YouTubeService.shared.accountPlaylistOptions(videoId: video.id)) ?? []
                loadingAccount = false
            }
            .alert("Danh sách phát mới trên YouTube", isPresented: $showCreateOnAccount) {
                TextField("Tên danh sách phát", text: $newName)
                Button("Hủy", role: .cancel) {}
                Button("Tạo") {
                    let name = newName.trimmingCharacters(in: .whitespaces)
                    guard !name.isEmpty else { return }
                    Task {
                        do {
                            _ = try await InnerTube.shared.createPlaylist(title: name, videoId: video.id)
                            player.showToast("Đã tạo \(name) (riêng tư) và lưu video")
                            accountPlaylists = (try? await YouTubeService.shared.accountPlaylistOptions(videoId: video.id)) ?? accountPlaylists
                        } catch {
                            player.showToast("Không tạo được danh sách phát")
                        }
                    }
                }
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

    private func toggle(_ option: AccountPlaylistOption) async {
        guard let index = accountPlaylists.firstIndex(where: { $0.id == option.id }) else { return }
        let add = !option.containsVideo
        accountPlaylists[index].containsVideo = add
        do {
            if add {
                try await InnerTube.shared.editPlaylist(option.id, add: video.id)
            } else {
                try await InnerTube.shared.editPlaylist(option.id, remove: video.id)
            }
            player.showToast(add ? "Đã lưu vào \(option.title)" : "Đã xóa khỏi \(option.title)")
        } catch {
            accountPlaylists[index].containsVideo = !add
            player.showToast("Không cập nhật được danh sách phát")
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

/// "Show transcript": the caption track as a list, tap a line to jump there.
struct TranscriptSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var cues: [CaptionCue] = []
    @State private var track: CaptionTrack?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if cues.isEmpty {
                        Text("Không tải được bản chép lời.").foregroundStyle(.secondary)
                    }
                    ForEach(Array(cues.enumerated()), id: \.offset) { index, cue in
                        let active = player.currentTime >= cue.start && player.currentTime < cue.end
                        Button {
                            player.seek(to: cue.start)
                        } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Text(formatTime(cue.start))
                                    .font(.caption.monospacedDigit())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Color(.tertiarySystemFill)))
                                Text(cue.text)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .listRowBackground(active ? Color.brand.opacity(0.15) : Color.clear)
                        .id(index)
                    }
                }
                .listStyle(.plain)
                .onChange(of: activeIndex) { _, index in
                    if let index { withAnimation { proxy.scrollTo(index, anchor: .center) } }
                }
            }
            .navigationTitle(track.map { "Bản chép lời • \($0.name)" } ?? "Bản chép lời")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if player.captionTracks.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            ForEach(player.captionTracks) { option in
                                Button(option.name) { Task { await load(option) } }
                            }
                        } label: {
                            Image(systemName: "globe")
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
        }
        .task {
            let preferred = AppSettings.shared.captionLanguage
            let initial = player.selectedCaption
                ?? player.captionTracks.first { $0.languageCode.hasPrefix(preferred) && !$0.isAutoGenerated }
                ?? player.captionTracks.first { !$0.isAutoGenerated }
                ?? player.captionTracks.first
            if let initial { await load(initial) } else { isLoading = false }
        }
    }

    private var activeIndex: Int? {
        cues.lastIndex { player.currentTime >= $0.start }
    }

    private func load(_ option: CaptionTrack) async {
        isLoading = true
        track = option
        cues = (try? await CaptionLoader.load(track: option, translateTo: nil)) ?? []
        isLoading = false
    }
}
