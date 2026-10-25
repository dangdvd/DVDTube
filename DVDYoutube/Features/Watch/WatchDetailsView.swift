import SwiftUI

/// Everything below the player on the watch page.
struct WatchDetailsView: View {
    let bottomInset: CGFloat

    @Environment(PlayerManager.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(DownloadManager.self) private var downloads
    @Environment(Router.self) private var router
    @Environment(AppSettings.self) private var settings

    @State private var showDescription = false
    @State private var showComments = false
    @State private var showQueue = false
    @State private var showTranscript = false
    @State private var showLiveChat = false
    @State private var showSleepTimer = false
    @State private var showLyrics = false
    @State private var relatedMore: [FeedItem] = []
    @State private var relatedToken: String?
    @State private var loadingMore = false
    /// Dislike count from Return YouTube Dislike.
    @State private var dislikeCount: Int?

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
                        if player.queue.count > 1 || DVDCast.shared.isConnected {
                            queueCard
                        }
                        if let chat = player.watchInfo?.liveChat {
                            liveChatCard(chat)
                        }
                        if !ParentalControls.shared.commentsHidden {
                            commentsCard
                        }
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
            .task(id: player.currentVideo?.id) {
                dislikeCount = nil
                guard settings.showDislikes, let id = player.currentVideo?.id else { return }
                let count = await ReturnDislike.dislikes(videoId: id)
                if player.currentVideo?.id == id { dislikeCount = count }
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
        .sheet(isPresented: $showLyrics) {
            LyricsSheet()
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: Sections

    private func header(_ video: VideoItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            DeArrowTitle(video: video, fallback: player.watchInfo?.title.isEmpty == false ? player.watchInfo!.title : video.title)
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
                pill("quote.bubble", "Lời bài hát") { showLyrics = true }
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
                HStack(spacing: 6) {
                    Image(systemName: disliked ? "hand.thumbsdown.fill" : "hand.thumbsdown")
                    if settings.showDislikes, let dislikeCount {
                        Text(NumberText.compact(dislikeCount + (disliked ? 1 : 0)))
                    }
                }
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
        case .queued:
            pill("clock.arrow.circlepath", "Đang chờ") { downloads.cancel(video.id) }
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
                Menu {
                    Section("Video") {
                        ForEach([VideoQuality.p1080, .p720, .p480, .p360]) { quality in
                            Button(quality.title + (quality == settings.downloadQuality ? " (mặc định)" : "")) {
                                downloads.download(video, quality: quality)
                            }
                        }
                    }
                    Button {
                        downloads.download(video, audioOnly: true)
                    } label: {
                        Label("Chỉ âm thanh (m4a)", systemImage: "headphones")
                    }
                } label: {
                    pillLabel("arrow.down.to.line", "Tải xuống")
                }
                .buttonStyle(.plain)
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
                    Text(DVDCast.shared.isConnected ? "Hàng đợi trên \(DVDCast.shared.receiver?.name ?? "TV")" : "Hàng đợi")
                        .font(.subheadline.weight(.semibold))
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

/// The queue: tap to play, swipe right for "Phát tiếp theo", swipe left to remove, "Sửa" to drag
/// items into another order. While casting to DVDTube it is the TV's / PC's queue, shared with
/// every phone connected to it (karaoke).
struct QueueSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss
    private var cast: DVDCast { DVDCast.shared }

    var body: some View {
        NavigationStack {
            List {
                if cast.isConnected || player.queue.count > 1 {
                    Section {
                        if cast.isConnected, let name = cast.receiver?.name {
                            Label("Hàng đợi trên \(name): mọi điện thoại kết nối với \(name) đều thêm, xóa và đổi thứ tự được.",
                                  systemImage: cast.receiver?.icon ?? "tv")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        if player.queue.count > 1 {
                            Button(role: .destructive) {
                                player.clearUpcoming()
                            } label: {
                                Label("Xóa các video sắp phát", systemImage: "trash")
                            }
                        }
                    }
                }
                Section {
                    ForEach(Array(player.queue.enumerated()), id: \.element.id) { index, video in
                        row(index: index, video: video)
                            .deleteDisabled(index == player.queueIndex)
                            .swipeActions(edge: .leading) {
                                if index != player.queueIndex, index != player.queueIndex + 1 {
                                    Button {
                                        player.prioritizeQueueItem(at: index)
                                    } label: {
                                        Label("Phát tiếp theo", systemImage: "text.line.first.and.arrowtriangle.forward")
                                    }
                                    .tint(.blue)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                if index != player.queueIndex {
                                    Button(role: .destructive) {
                                        player.removeQueueItem(at: index)
                                    } label: {
                                        Label("Xóa", systemImage: "trash")
                                    }
                                }
                            }
                            .contextMenu {
                                if index != player.queueIndex {
                                    Button {
                                        player.playQueueItem(at: index)
                                    } label: {
                                        Label("Phát ngay", systemImage: "play.fill")
                                    }
                                    Button {
                                        player.prioritizeQueueItem(at: index)
                                    } label: {
                                        Label("Phát tiếp theo", systemImage: "text.line.first.and.arrowtriangle.forward")
                                    }
                                }
                                if index > 0 {
                                    Button {
                                        player.moveQueueItem(from: index, to: index - 1)
                                    } label: {
                                        Label("Chuyển lên", systemImage: "arrow.up")
                                    }
                                }
                                if index < player.queue.count - 1 {
                                    Button {
                                        player.moveQueueItem(from: index, to: index + 1)
                                    } label: {
                                        Label("Chuyển xuống", systemImage: "arrow.down")
                                    }
                                }
                                if index != player.queueIndex {
                                    Button(role: .destructive) {
                                        player.removeQueueItem(at: index)
                                    } label: {
                                        Label("Xóa khỏi hàng đợi", systemImage: "trash")
                                    }
                                }
                            }
                    }
                    .onMove { source, destination in
                        guard let from = source.first else { return }
                        player.moveQueueItem(from: from, to: destination > from ? destination - 1 : destination)
                    }
                    .onDelete { offsets in
                        for index in offsets.sorted(by: >) { player.removeQueueItem(at: index) }
                    }
                } footer: {
                    if player.queue.count > 1 {
                        Text("Vuốt sang phải để phát tiếp theo, sang trái để xóa. Nhấn Sửa rồi kéo ≡ để đổi thứ tự, hoặc nhấn giữ một video để xem thêm lựa chọn.")
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Hàng đợi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if player.queue.count > 1 {
                    ToolbarItem(placement: .topBarLeading) { EditButton() }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
        }
    }

    private func row(index: Int, video: VideoItem) -> some View {
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
