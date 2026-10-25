import SwiftUI

struct PlaylistView: View {
    let playlist: PlaylistItem

    @Environment(LibraryStore.self) private var library
    @Environment(PlayerManager.self) private var player
    @Environment(DownloadManager.self) private var downloads
    @State private var info: PlaylistItem?
    @State private var confirmDownload = false
    @State private var preparingDownload = false
    @State private var model: FeedModel?
    @State private var error: String?

    private var current: PlaylistItem { info ?? playlist }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let model {
                    if model.isLoading && model.items.isEmpty {
                        LoadingStateView()
                    } else {
                        FeedList(items: model.items, isLoadingMore: model.isLoadingMore, compact: true) {
                            Task { await model.loadMore() }
                        }
                    }
                } else if let error {
                    ErrorStateView(message: error) { Task { await load() } }
                } else {
                    LoadingStateView()
                }
            }
            .padding(.vertical, 8)
        }
        .navigationTitle(current.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: URL(string: "https://www.youtube.com/playlist?list=\(playlist.id)")!) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .task { if model == nil { await load() } }
        .confirmationDialog("Tải xuống cả danh sách phát?", isPresented: $confirmDownload, titleVisibility: .visible) {
            Button("Video (\(AppSettings.shared.downloadQuality.title))") { Task { await downloadAll(audioOnly: false) } }
            Button("Chỉ âm thanh (m4a)") { Task { await downloadAll(audioOnly: true) } }
        } message: {
            Text("Các video được tải lần lượt; xem tiến trình trong Nội dung tải xuống.")
        }
    }

    /// Loads every page of the playlist (up to 200 videos) and queues them for download.
    private func downloadAll(audioOnly: Bool) async {
        preparingDownload = true
        defer { preparingDownload = false }
        do {
            let videos = try await YouTubeService.shared.allPlaylistVideos(playlist.id)
            downloads.downloadAll(videos, audioOnly: audioOnly)
        } catch {
            player.showToast("Không tải được danh sách: \(error.localizedDescription)")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            RemoteImage(url: current.thumbnail)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            Text(current.title).font(.title2.weight(.bold))
            Text([current.channelName, current.videoCountText].compactMap { $0 }.joined(separator: " • "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let videos = model?.videos, !videos.isEmpty {
                PlayAllButtons(videos: videos, playlistId: playlist.id)
                Button {
                    let copy = library.createPlaylist(named: current.title)
                    for video in videos { library.add(video, to: copy.id) }
                    player.showToast("Đã lưu \(videos.count) video vào thư viện")
                } label: {
                    Label("Lưu bản sao vào thư viện", systemImage: "square.and.arrow.down.on.square")
                        .font(.subheadline)
                }
                Button {
                    confirmDownload = true
                } label: {
                    HStack(spacing: 6) {
                        Label("Tải xuống tất cả", systemImage: "arrow.down.circle")
                        if preparingDownload { ProgressView().controlSize(.small) }
                    }
                    .font(.subheadline)
                }
                .disabled(preparingDownload)
            }
        }
        .padding(.horizontal, 12)
    }

    private func load() async {
        do {
            let page = try await YouTubeService.shared.playlist(playlist.id)
            var merged = page.playlist
            merged.thumbnail = merged.thumbnail ?? playlist.thumbnail
            merged.channelName = merged.channelName ?? playlist.channelName
            merged.videoCountText = merged.videoCountText ?? playlist.videoCountText
            info = merged
            let feed = FeedModel { try await YouTubeService.shared.playlist(playlist.id).page }
            feed.replace(with: page.page)
            model = feed
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
