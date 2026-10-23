import SwiftUI

struct ThumbnailView: View {
    let video: VideoItem
    var cornerRadius: CGFloat = 0
    var showProgress = true

    @Environment(LibraryStore.self) private var library

    var body: some View {
        RemoteImage(url: video.displayThumbnail)
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay(alignment: .bottomTrailing) {
                badge.padding(6)
            }
            .overlay(alignment: .bottom) {
                if showProgress, let progress = library.history.first(where: { $0.id == video.id })?.progress,
                   progress > 0.02 {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(Color.gray.opacity(0.6))
                            Rectangle().fill(Color.brand).frame(width: geo.size.width * progress)
                        }
                    }
                    .frame(height: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }

    @ViewBuilder
    private var badge: some View {
        if video.isLive {
            Label("TRỰC TIẾP", systemImage: "dot.radiowaves.left.and.right")
                .font(.caption2.weight(.bold))
                .labelStyle(.titleAndIcon)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(Color.red))
                .foregroundStyle(.white)
        } else if let duration = video.durationText {
            Text(duration)
                .font(.caption2.weight(.semibold).monospacedDigit())
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(Color.black.opacity(0.8)))
                .foregroundStyle(.white)
        }
    }
}

/// Large card used by the home feed, search, related videos and channel pages.
struct VideoCard: View {
    let video: VideoItem
    var queue: [VideoItem]?
    var showChannel = true

    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ThumbnailView(video: video)
            HStack(alignment: .top, spacing: 12) {
                if showChannel {
                    AvatarView(url: video.channelAvatar, size: 36, name: video.channelName ?? "")
                        .onTapGesture {
                            if let id = video.channelId {
                                router.openChannel(id: id, name: video.channelName ?? "", avatar: video.channelAvatar)
                            }
                        }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(video.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(showChannel ? video.metadataLine : [video.viewCountText, video.publishedText].compactMap { $0 }.joined(separator: " • "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                VideoMenu(video: video)
            }
            .padding(.horizontal, 12)
        }
        .contentShape(Rectangle())
        .onTapGesture { open() }
    }

    private func open() {
        if video.isShort {
            router.openShorts(queue?.filter(\.isShort) ?? [video], start: video)
        } else {
            player.play(video, queue: queue)
        }
    }
}

/// Compact row: small thumbnail on the left (library lists, playlists, queue).
struct VideoRow: View {
    let video: VideoItem
    var queue: [VideoItem]?
    var subtitle: String?
    var extraMenu: AnyView?

    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ThumbnailView(video: video, cornerRadius: 8)
                .frame(width: 160)
            VStack(alignment: .leading, spacing: 4) {
                Text(video.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(subtitle ?? video.metadataLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            VideoMenu(video: video, extra: extraMenu)
        }
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture {
            if video.isShort {
                router.openShorts(queue?.filter(\.isShort) ?? [video], start: video)
            } else {
                player.play(video, queue: queue)
            }
        }
    }
}

struct VideoMenu: View {
    let video: VideoItem
    var extra: AnyView?

    @Environment(PlayerManager.self) private var player
    @Environment(LibraryStore.self) private var library
    @Environment(DownloadManager.self) private var downloads
    @Environment(Router.self) private var router

    var body: some View {
        Menu {
            Button {
                player.addToQueue(video)
            } label: {
                Label("Thêm vào hàng đợi", systemImage: "text.badge.plus")
            }
            Button {
                library.toggleWatchLater(video)
                player.showToast(library.isInWatchLater(video.id) ? "Đã lưu vào Xem sau" : "Đã xóa khỏi Xem sau")
            } label: {
                Label(library.isInWatchLater(video.id) ? "Xóa khỏi Xem sau" : "Lưu vào Xem sau", systemImage: "clock")
            }
            Button {
                router.playlistSheetVideo = video
            } label: {
                Label("Lưu vào danh sách phát", systemImage: "text.badge.star")
            }
            if !video.isLive {
                Button {
                    downloads.download(video)
                } label: {
                    Label(downloads.isDownloaded(video.id) ? "Đã tải xuống" : "Tải xuống", systemImage: "arrow.down.circle")
                }
                .disabled(downloads.isDownloaded(video.id) || downloads.states[video.id] != nil)
            }
            ShareLink(item: video.shareURL) {
                Label("Chia sẻ", systemImage: "square.and.arrow.up")
            }
            if let channelId = video.channelId {
                Button {
                    router.openChannel(id: channelId, name: video.channelName ?? "", avatar: video.channelAvatar)
                } label: {
                    Label("Đi tới kênh", systemImage: "person.crop.square")
                }
            }
            if let extra { extra }
        } label: {
            Image(systemName: "ellipsis")
                .rotationEffect(.degrees(90))
                .font(.subheadline)
                .foregroundStyle(.primary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
    }
}

struct ShortsShelf: View {
    let shorts: [VideoItem]
    var title = "Shorts"

    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: "bolt.horizontal.fill")
                .font(.headline)
                .padding(.horizontal, 12)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 8) {
                    ForEach(shorts) { short in
                        ShortsCard(video: short)
                            .frame(width: 160)
                            .onTapGesture { router.openShorts(shorts, start: short) }
                    }
                }
                .padding(.horizontal, 12)
            }
        }
    }
}

struct ShortsCard: View {
    let video: VideoItem

    var body: some View {
        RemoteImage(url: video.shortsThumbnail)
            .aspectRatio(9 / 16, contentMode: .fit)
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(video.title)
                        .font(.footnote.weight(.semibold))
                        .lineLimit(2)
                    if let views = video.viewCountText {
                        Text(views).font(.caption2)
                    }
                }
                .foregroundStyle(.white)
                .shadow(radius: 3)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom))
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
    }
}

struct ChannelRow: View {
    let channel: ChannelItem

    @Environment(LibraryStore.self) private var library
    @Environment(Router.self) private var router

    var body: some View {
        HStack(spacing: 16) {
            AvatarView(url: channel.avatar, size: 72, name: channel.name)
            VStack(alignment: .leading, spacing: 3) {
                Text(channel.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                if let handle = channel.handle {
                    Text(handle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                if let subscribers = channel.subscriberText {
                    Text(subscribers).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            SubscribeButton(channel: channel, compact: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture { router.open(.channel(channel)) }
    }
}

struct SubscribeButton: View {
    let channel: ChannelItem
    var compact = false

    @Environment(LibraryStore.self) private var library

    var body: some View {
        let subscribed = library.isSubscribed(channel.id)
        Button {
            withAnimation(.snappy) { library.toggleSubscription(channel) }
        } label: {
            HStack(spacing: 4) {
                if subscribed { Image(systemName: "bell") }
                Text(subscribed ? "Đã đăng ký" : "Đăng ký")
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, compact ? 12 : 16)
            .padding(.vertical, 8)
            .foregroundStyle(subscribed ? Color.primary : Color(.systemBackground))
            .background(Capsule().fill(subscribed ? Color(.secondarySystemFill) : Color.primary))
        }
        .buttonStyle(.plain)
    }
}

struct PlaylistRow: View {
    let playlist: PlaylistItem

    @Environment(Router.self) private var router

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(url: playlist.thumbnail)
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(width: 160)
                .overlay(alignment: .bottomTrailing) {
                    if let count = playlist.videoCountText {
                        Label(count, systemImage: "list.and.film")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(RoundedRectangle(cornerRadius: 4).fill(Color.black.opacity(0.8)))
                            .foregroundStyle(.white)
                            .padding(5)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(playlist.title).font(.subheadline.weight(.medium)).lineLimit(2)
                Text([playlist.channelName, "Danh sách phát"].compactMap { $0 }.joined(separator: " • "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture { router.open(.playlist(playlist)) }
    }
}

/// Renders any feed item in the style of the official app.
struct FeedItemView: View {
    let item: FeedItem
    var queue: [VideoItem]?
    var compact = false

    var body: some View {
        switch item {
        case .video(let video):
            if compact {
                VideoRow(video: video, queue: queue)
            } else {
                VideoCard(video: video, queue: queue)
            }
        case .channel(let channel):
            ChannelRow(channel: channel)
        case .playlist(let playlist):
            PlaylistRow(playlist: playlist)
        case .shorts(let shorts):
            ShortsShelf(shorts: shorts)
        }
    }
}

/// Vertical list of feed items with infinite scrolling.
struct FeedList: View {
    let items: [FeedItem]
    var isLoadingMore = false
    var compact = false
    var onReachEnd: (() -> Void)?

    var body: some View {
        let videos = items.compactMap(\.video)
        LazyVStack(spacing: compact ? 12 : 20) {
            ForEach(items) { item in
                FeedItemView(item: item, queue: videos, compact: compact)
                    .onAppear {
                        if item.id == items.last?.id { onReachEnd?() }
                    }
            }
            if isLoadingMore {
                ProgressView().padding()
            }
        }
    }
}
