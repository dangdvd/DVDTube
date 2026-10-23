import SwiftUI

/// Everything below the player on the watch page.
struct WatchDetailsView: View {
    let bottomInset: CGFloat

    @Environment(PlayerManager.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(DownloadManager.self) private var downloads
    @Environment(Router.self) private var router

    @State private var showDescription = false
    @State private var showComments = false
    @State private var showQueue = false
    @State private var showTranscript = false
    @State private var showLiveChat = false
    @State private var showSleepTimer = false
    @State private var relatedMore: [FeedItem] = []
    @State private var relatedToken: String?
    @State private var loadingMore = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Color.clear.frame(height: 0).id("top")
                    if let video = player.currentVideo {
                        header(video)
                        channelRow(video)
                        actionBar(video)
                        if let chapters = player.watchInfo?.chapters, !chapters.isEmpty {
                            chapterStrip(chapters)
                        }
                        if player.queue.count > 1 {
                            queueCard
                        }
                        if let chat = player.watchInfo?.liveChat {
                            liveChatCard(chat)
                        }
                        commentsCard
                        related
                    }
                }
                .padding(.top, 12)
                .padding(.bottom, bottomInset + 16)
            }
            .onChange(of: player.currentVideo?.id) { _, _ in
                relatedMore = []
                relatedToken = nil
                proxy.scrollTo("top", anchor: .top)
            }
            .onChange(of: player.watchInfo?.videoId) { _, _ in
                relatedToken = player.watchInfo?.related.continuation
            }
        }
        .sheet(isPresented: $showDescription) {
            DescriptionSheet()
                .presentationDetents([.large])
        }
        .sheet(isPresented: $showComments) {
            if let token = player.watchInfo?.commentsToken {
                CommentsSheet(initialToken: token, countText: player.watchInfo?.commentCountText)
                    .presentationDetents([.medium, .large])
                    .presentationContentInteraction(.scrolls)
            }
        }
        .sheet(isPresented: $showLiveChat) {
            if let chat = player.watchInfo?.liveChat {
                LiveChatSheet(info: chat)
                    .id(player.watchInfo?.videoId)
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .presentationContentInteraction(.scrolls)
            }
        }
        .sheet(isPresented: $showTranscript) {
            TranscriptSheet()
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showQueue) {
            QueueSheet()
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showSleepTimer) {
            NavigationStack { SleepTimerView() }
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: Sections

    private func header(_ video: VideoItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(player.watchInfo?.title.isEmpty == false ? player.watchInfo!.title : video.title)
                .font(.title3.weight(.semibold))
                .lineLimit(3)
            HStack(spacing: 6) {
                Text(statsLine(video))
                    .foregroundStyle(.secondary)
                Text("...thêm")
                    .fontWeight(.semibold)
            }
            .font(.caption)
            .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture { showDescription = true }
    }

    private func statsLine(_ video: VideoItem) -> String {
        let info = player.watchInfo
        return [info?.shortViewCountText ?? video.viewCountText, info?.relativeDateText ?? video.publishedText]
            .compactMap { $0 }
            .joined(separator: "  ")
    }

    private func channelRow(_ video: VideoItem) -> some View {
        let channel = player.watchInfo?.channel ?? video.channelId.map {
            ChannelItem(id: $0, name: video.channelName ?? "", avatar: video.channelAvatar)
        }
        return HStack(spacing: 10) {
            AvatarView(url: channel?.avatar ?? video.channelAvatar, size: 36, name: channel?.name ?? video.channelName ?? "")
            Text(channel?.name ?? video.channelName ?? "")
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            if let subscribers = channel?.subscriberText {
                Text(subscribers)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if let channel {
                SubscribeButton(channel: channel, compact: true)
            }
        }
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture {
            if let channel { router.open(.channel(channel)) }
        }
    }

    private func actionBar(_ video: VideoItem) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                likeDislikePill(video)
                Menu {
                    ShareLink(item: video.shareURL, subject: Text(video.title)) {
                        Label("Chia sẻ video", systemImage: "square.and.arrow.up")
                    }
                    if player.currentTime > 5, !video.isLive,
                       let atTime = URL(string: "https://youtu.be/\(video.id)?t=\(Int(player.currentTime))") {
                        ShareLink(item: atTime, subject: Text(video.title)) {
                            Label("Chia sẻ tại \(formatTime(player.currentTime))", systemImage: "clock")
                        }
                    }
                } label: {
                    pillLabel("arrowshape.turn.up.right", "Chia sẻ")
                }
                .buttonStyle(.plain)
                if !player.isCasting, !player.isLocalPlayback {
                    pill(player.isAudioOnly ? "headphones.circle.fill" : "headphones",
                         player.isAudioOnly ? "Bật hình" : "Chỉ âm thanh") {
                        player.setAudioOnly(!player.isAudioOnly)
                    }
                }
                pill("moon.zzz", player.sleepTimerLabel.map { "Hẹn giờ \($0)" } ?? "Hẹn giờ tắt") {
                    showSleepTimer = true
                }
                pill(LibraryActions.isInWatchLater(video.id) ? "clock.fill" : "clock", "Xem sau") {
                    LibraryActions.toggleWatchLater(video)
                }
                pill("text.badge.plus", "Lưu") {
                    router.playlistSheetVideo = video
                }
                if !video.isLive {
                    downloadPill(video)
                }
                if !player.captionTracks.isEmpty {
                    pill("text.quote", "Bản chép lời") { showTranscript = true }
                }
                if player.isPiPPossible {
                    pill("pip.enter", "PiP") { player.togglePictureInPicture() }
                }
            }
            .padding(.horizontal, 12)
        }
    }

    /// [👍 count | 👎] like the official app.
    private func likeDislikePill(_ video: VideoItem) -> some View {
        let reported = player.watchInfo?.videoId == video.id ? player.watchInfo?.likeStatus : nil
        let liked = LibraryActions.isLiked(video.id, reported: reported)
        let disliked = LibraryActions.isDisliked(video.id, reported: reported)
        return HStack(spacing: 0) {
            Button {
                LibraryActions.toggleLike(video, reported: reported)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: liked ? "hand.thumbsup.fill" : "hand.thumbsup")
                    Text(player.watchInfo?.likeCountText ?? "Thích")
                }
                .padding(.leading, 14)
                .padding(.trailing, 10)
                .padding(.vertical, 8)
            }
            Divider().frame(height: 20)
            Button {
                LibraryActions.toggleDislike(video, reported: reported)
            } label: {
                Image(systemName: disliked ? "hand.thumbsdown.fill" : "hand.thumbsdown")
                    .padding(.leading, 10)
                    .padding(.trailing, 14)
                    .padding(.vertical, 8)
            }
        }
        .font(.subheadline.weight(.medium))
        .buttonStyle(.plain)
        .background(Capsule().fill(Color(.secondarySystemFill)))
    }

    @ViewBuilder
    private func downloadPill(_ video: VideoItem) -> some View {
        switch downloads.states[video.id] {
        case .downloading(let progress):
            pill("arrow.down.circle", "\(Int(progress * 100))%") { downloads.cancel(video.id) }
        case .preparing, .merging:
            pill("hourglass", "Đang xử lý") { downloads.cancel(video.id) }
        case .failed:
            pill("exclamationmark.arrow.circlepath", "Thử lại") {
                downloads.cancel(video.id)
                downloads.download(video)
            }
        case nil:
            if downloads.isDownloaded(video.id) {
                pill("checkmark.circle.fill", "Đã tải") { router.open(.downloads) }
            } else {
                pill("arrow.down.to.line", "Tải xuống") { downloads.download(video) }
            }
        }
    }

    private func pill(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { pillLabel(icon, title) }
            .buttonStyle(.plain)
    }

    private func pillLabel(_ icon: String, _ title: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(title)
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Capsule().fill(Color(.secondarySystemFill)))
    }

    private func chapterStrip(_ chapters: [Chapter]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(chapters) { chapter in
                    Button {
                        player.seek(to: Double(chapter.startSeconds))
                    } label: {
                        HStack(spacing: 8) {
                            RemoteImage(url: chapter.thumbnail)
                                .frame(width: 72, height: 40)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(chapter.title).font(.caption.weight(.semibold)).lineLimit(2)
                                Text(formatDuration(chapter.startSeconds))
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(Color.brand)
                            }
                            .frame(width: 130, alignment: .leading)
                        }
                        .padding(6)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
        }
    }

    private var queueCard: some View {
        Button {
            showQueue = true
        } label: {
            HStack {
                Image(systemName: "list.bullet.rectangle")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hàng đợi").font(.subheadline.weight(.semibold))
                    Text("\(player.queueIndex + 1)/\(player.queue.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.secondary)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
    }

    private func liveChatCard(_ chat: LiveChatInfo) -> some View {
        Button {
            showLiveChat = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .foregroundStyle(chat.isReplay ? Color.secondary : Color.brand)
                VStack(alignment: .leading, spacing: 2) {
                    Text(chat.isReplay ? "Phát lại nội dung trò chuyện" : "Trò chuyện trực tiếp")
                        .font(.subheadline.weight(.semibold))
                    Text(chat.isReplay ? "Xem tin nhắn theo thời điểm của video" : "Nhấn để xem và tham gia trò chuyện")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
    }

    private var commentsCard: some View {
        Button {
            if player.watchInfo?.commentsToken != nil { showComments = true }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Bình luận").font(.subheadline.weight(.semibold))
                    if let count = player.watchInfo?.commentCountText {
                        Text(count).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(player.watchInfo == nil
                    ? "Đang tải…"
                    : (player.watchInfo?.commentsToken == nil ? "Bình luận đã bị tắt." : "Nhấn để xem bình luận"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private var related: some View {
        if let info = player.watchInfo {
            let items = info.related.items + relatedMore
            FeedList(items: items, isLoadingMore: loadingMore, hidesDismissed: true) {
                Task { await loadMoreRelated() }
            }
        } else if let error = player.watchInfoError {
            ErrorStateView(message: error) { player.refreshWatchInfo() }
        } else {
            LoadingStateView()
        }
    }

    private func loadMoreRelated() async {
        guard let token = relatedToken, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let page = try? await YouTubeService.shared.relatedMore(token) else {
            relatedToken = nil
            return
        }
        let existing = Set((player.watchInfo?.related.items ?? []).map(\.id) + relatedMore.map(\.id))
        relatedMore.append(contentsOf: page.items.filter { !existing.contains($0.id) })
        relatedToken = page.continuation == token ? nil : page.continuation
    }
}

struct QueueSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(player.queue.enumerated()), id: \.element.id) { index, video in
                    Button {
                        player.playQueueItem(at: index)
                        dismiss()
                    } label: {
                        HStack(spacing: 10) {
                            if index == player.queueIndex {
                                Image(systemName: "play.fill").foregroundStyle(Color.brand).frame(width: 16)
                            } else {
                                Text("\(index + 1)").font(.caption).foregroundStyle(.secondary).frame(width: 16)
                            }
                            ThumbnailView(video: video, cornerRadius: 6, showProgress: false).frame(width: 100)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(video.title).font(.subheadline).lineLimit(2)
                                Text(video.channelName ?? "").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Hàng đợi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
        }
    }
}
