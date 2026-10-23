import SwiftUI

struct LibraryView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(DownloadManager.self) private var downloads
    @Environment(Router.self) private var router
    @State private var showCreate = false
    @State private var newName = ""

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Image("Logo")
                        .resizable()
                        .frame(width: 56, height: 56)
                        .clipShape(Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Thư viện của bạn").font(.title3.weight(.bold))
                        Text("Không quảng cáo • Lưu trên thiết bị")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .listRowSeparator(.hidden)
            }

            if !library.history.isEmpty {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 10) {
                            ForEach(library.history.prefix(20)) { entry in
                                HistoryCard(entry: entry)
                                    .frame(width: 150)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .listRowInsets(EdgeInsets())
                } header: {
                    sectionHeader("Nhật ký xem") { router.open(.history) }
                }
            }

            Section {
                NavigationLink(value: Route.history) {
                    row("clock.arrow.circlepath", "Nhật ký xem", "\(library.history.count)")
                }
                NavigationLink(value: Route.watchLater) {
                    row("clock", "Xem sau", "\(library.watchLater.count) video")
                }
                NavigationLink(value: Route.liked) {
                    row("hand.thumbsup", "Video đã thích", "\(library.liked.count) video")
                }
                NavigationLink(value: Route.downloads) {
                    row("arrow.down.circle", "Nội dung tải xuống",
                        downloads.activeCount > 0 ? "Đang tải \(downloads.activeCount)" : "\(downloads.downloads.count) video")
                }
                NavigationLink(value: Route.subscriptionsManager) {
                    row("person.2", "Kênh đăng ký", "\(library.subscriptions.count) kênh")
                }
            }

            Section {
                ForEach(library.playlists) { playlist in
                    NavigationLink(value: Route.localPlaylist(playlist.id)) {
                        HStack(spacing: 12) {
                            RemoteImage(url: playlist.videos.first?.displayThumbnail)
                                .frame(width: 96, height: 54)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay {
                                    if playlist.videos.isEmpty {
                                        Image(systemName: "music.note.list").foregroundStyle(.secondary)
                                    }
                                }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(playlist.name).font(.subheadline.weight(.medium))
                                Text("\(playlist.videos.count) video").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .onDelete { offsets in
                    for index in offsets { library.deletePlaylist(library.playlists[index].id) }
                }
                Button {
                    newName = ""
                    showCreate = true
                } label: {
                    Label("Danh sách phát mới", systemImage: "plus")
                }
            } header: {
                Text("Danh sách phát")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Bạn")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { AppLogo() }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { router.open(.search) } label: { Image(systemName: "magnifyingglass") }
                NavigationLink(value: Route.settings) { Image(systemName: "gearshape") }
            }
        }
        .alert("Danh sách phát mới", isPresented: $showCreate) {
            TextField("Tên danh sách phát", text: $newName)
            Button("Hủy", role: .cancel) {}
            Button("Tạo") {
                let name = newName.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { library.createPlaylist(named: name) }
            }
        }
    }

    private func sectionHeader(_ title: String, action: @escaping () -> Void) -> some View {
        HStack {
            Text(title)
            Spacer()
            Button("Xem tất cả", action: action)
                .font(.footnote.weight(.semibold))
                .textCase(nil)
        }
    }

    private func row(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer()
            Text(detail).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct HistoryCard: View {
    let entry: HistoryEntry

    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ThumbnailView(video: entry.video, cornerRadius: 8)
            Text(entry.video.title)
                .font(.caption.weight(.medium))
                .lineLimit(2)
            Text(entry.video.channelName ?? "")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if entry.video.isShort {
                router.openShorts([entry.video], start: entry.video)
            } else {
                player.play(entry.video)
            }
        }
    }
}

struct HistoryView: View {
    @Environment(LibraryStore.self) private var library
    @State private var query = ""
    @State private var confirmClear = false

    var body: some View {
        List {
            ForEach(sections, id: \.title) { section in
                Section(section.title) {
                    ForEach(section.entries) { entry in
                        VideoRow(video: entry.video, queue: nil)
                            .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                            .swipeActions {
                                Button("Xóa", role: .destructive) { library.removeFromHistory(entry.id) }
                            }
                    }
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if library.history.isEmpty {
                ContentUnavailableView("Chưa có nhật ký xem", systemImage: "clock.arrow.circlepath",
                                       description: Text("Video bạn xem sẽ xuất hiện ở đây."))
            }
        }
        .searchable(text: $query, prompt: "Tìm trong nhật ký xem")
        .navigationTitle("Nhật ký xem")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) { confirmClear = true } label: { Image(systemName: "trash") }
                    .disabled(library.history.isEmpty)
            }
        }
        .confirmationDialog("Xóa toàn bộ nhật ký xem?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Xóa tất cả", role: .destructive) { library.clearHistory() }
        }
    }

    private var sections: [(title: String, entries: [HistoryEntry])] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let entries = trimmed.isEmpty ? library.history : library.history.filter {
            $0.video.title.localizedCaseInsensitiveContains(trimmed)
                || ($0.video.channelName ?? "").localizedCaseInsensitiveContains(trimmed)
        }
        let calendar = Calendar.current
        var result: [(title: String, entries: [HistoryEntry])] = []
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "vi_VN")
        formatter.dateFormat = "EEEE, d MMMM"
        for entry in entries {
            let title: String
            if calendar.isDateInToday(entry.watchedAt) {
                title = "Hôm nay"
            } else if calendar.isDateInYesterday(entry.watchedAt) {
                title = "Hôm qua"
            } else {
                title = formatter.string(from: entry.watchedAt).capitalized
            }
            if result.last?.title == title {
                result[result.count - 1].entries.append(entry)
            } else {
                result.append((title, [entry]))
            }
        }
        return result
    }
}

struct SavedVideosView: View {
    enum Kind { case watchLater, liked }
    let kind: Kind

    @Environment(LibraryStore.self) private var library
    @Environment(PlayerManager.self) private var player

    private var videos: [VideoItem] { kind == .watchLater ? library.watchLater : library.liked }

    var body: some View {
        List {
            if !videos.isEmpty {
                PlayAllButtons(videos: videos)
                    .listRowSeparator(.hidden)
            }
            ForEach(videos) { video in
                VideoRow(video: video, queue: videos)
                    .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    .swipeActions {
                        Button("Xóa", role: .destructive) {
                            if kind == .watchLater { library.toggleWatchLater(video) } else { library.toggleLike(video) }
                        }
                    }
            }
        }
        .listStyle(.plain)
        .overlay {
            if videos.isEmpty {
                ContentUnavailableView(
                    kind == .watchLater ? "Danh sách Xem sau trống" : "Chưa thích video nào",
                    systemImage: kind == .watchLater ? "clock" : "hand.thumbsup"
                )
            }
        }
        .navigationTitle(kind == .watchLater ? "Xem sau" : "Video đã thích")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PlayAllButtons: View {
    let videos: [VideoItem]

    @Environment(PlayerManager.self) private var player

    var body: some View {
        HStack(spacing: 10) {
            Button {
                if let first = videos.first { player.play(first, queue: videos) }
            } label: {
                Label("Phát tất cả", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.primary)
            .foregroundStyle(Color(.systemBackground))

            Button {
                let shuffled = videos.shuffled()
                if let first = shuffled.first { player.play(first, queue: shuffled) }
            } label: {
                Label("Trộn bài", systemImage: "shuffle").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(Color.primary)
        }
        .controlSize(.large)
    }
}

struct LocalPlaylistView: View {
    let playlistId: UUID

    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var showRename = false
    @State private var newName = ""
    @State private var confirmDelete = false

    var body: some View {
        let playlist = library.playlist(playlistId)
        let videos = playlist?.videos ?? []
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(playlist?.name ?? "").font(.title2.weight(.bold))
                    Text("\(videos.count) video • Riêng tư (trên thiết bị)").font(.caption).foregroundStyle(.secondary)
                    if !videos.isEmpty { PlayAllButtons(videos: videos).padding(.top, 6) }
                }
                .listRowSeparator(.hidden)
            }
            Section {
                ForEach(videos) { video in
                    VideoRow(video: video, queue: videos)
                        .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                }
                .onDelete { offsets in
                    for index in offsets { library.remove(videos[index].id, from: playlistId) }
                }
                .onMove { source, destination in
                    library.movePlaylistVideos(playlistId, from: source, to: destination)
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if videos.isEmpty {
                ContentUnavailableView("Danh sách phát trống", systemImage: "music.note.list",
                                       description: Text("Dùng menu ⋮ trên video để thêm vào danh sách này."))
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    EditButton()
                    Button {
                        newName = playlist?.name ?? ""
                        showRename = true
                    } label: { Label("Đổi tên", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = true } label: {
                        Label("Xóa danh sách phát", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .alert("Đổi tên danh sách phát", isPresented: $showRename) {
            TextField("Tên", text: $newName)
            Button("Hủy", role: .cancel) {}
            Button("Lưu") {
                let name = newName.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { library.renamePlaylist(playlistId, to: name) }
            }
        }
        .confirmationDialog("Xóa danh sách phát này?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Xóa", role: .destructive) {
                library.deletePlaylist(playlistId)
                dismiss()
            }
        }
    }
}

struct DownloadsView: View {
    @Environment(DownloadManager.self) private var downloads
    @Environment(PlayerManager.self) private var player
    @State private var confirmDeleteAll = false

    var body: some View {
        List {
            let active = downloads.states.sorted { $0.key < $1.key }
            if !active.isEmpty {
                Section("Đang tải") {
                    ForEach(active, id: \.key) { id, state in
                        HStack {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(id).font(.caption.monospaced()).foregroundStyle(.secondary)
                                switch state {
                                case .preparing: Text("Đang chuẩn bị…").font(.subheadline)
                                case .downloading(let progress):
                                    ProgressView(value: progress) { Text("\(Int(progress * 100))%").font(.caption) }
                                case .merging: Text("Đang ghép âm thanh và hình ảnh…").font(.subheadline)
                                case .failed(let message): Text(message).font(.caption).foregroundStyle(.red)
                                }
                            }
                            Spacer()
                            Button(role: .destructive) { downloads.cancel(id) } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            Section {
                ForEach(downloads.downloads) { entry in
                    VideoRow(
                        video: entry.video,
                        queue: downloads.downloads.map(\.video),
                        subtitle: [entry.video.channelName, entry.qualityLabel,
                                   ByteCountFormatter.string(fromByteCount: entry.fileSize, countStyle: .file)]
                            .compactMap { $0 }.joined(separator: " • ")
                    )
                    .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                    .swipeActions {
                        Button("Xóa", role: .destructive) { downloads.delete(entry.id) }
                    }
                }
            } footer: {
                if !downloads.downloads.isEmpty {
                    Text("Đã dùng \(ByteCountFormatter.string(fromByteCount: downloads.totalSize, countStyle: .file)). Các tệp cũng xem được trong ứng dụng Tệp › DVDTube › Downloads.")
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if downloads.downloads.isEmpty && downloads.states.isEmpty {
                ContentUnavailableView("Chưa có video tải xuống", systemImage: "arrow.down.circle",
                                       description: Text("Nhấn \"Tải xuống\" trên trang xem video để xem khi không có mạng."))
            }
        }
        .navigationTitle("Nội dung tải xuống")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) { confirmDeleteAll = true } label: { Image(systemName: "trash") }
                    .disabled(downloads.downloads.isEmpty)
            }
        }
        .confirmationDialog("Xóa tất cả video đã tải?", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
            Button("Xóa tất cả", role: .destructive) { downloads.deleteAll() }
        }
    }
}
