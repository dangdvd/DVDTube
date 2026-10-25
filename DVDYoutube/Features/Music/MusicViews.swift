import SwiftUI

/// "Nghe nhạc": YouTube Music search (songs, videos, albums, artists, playlists) and recent
/// songs. Songs play audio-only by default and follow each other without a gap.
struct MusicHomeView: View {
    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router
    @Environment(AppSettings.self) private var settings

    @State private var query = ""
    @State private var submitted: String?
    @State private var kind: MusicSearchKind = .songs
    @State private var results: [MusicItem] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var recents: MusicRecents { MusicRecents.shared }

    var body: some View {
        List {
            Section {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Tìm bài hát, nghệ sĩ, album…", text: $query)
                        .focused($focused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                        .onSubmit { submit() }
                    if !query.isEmpty {
                        Button {
                            query = ""
                            submitted = nil
                            results = []
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .disabled(ParentalControls.shared.searchDisabled)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(MusicSearchKind.allCases) { item in
                            Button {
                                kind = item
                                if submitted != nil { runSearch() }
                            } label: {
                                Text(item.title)
                                    .font(.subheadline.weight(.medium))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .foregroundStyle(kind == item ? Color(.systemBackground) : Color.primary)
                                    .background(Capsule().fill(kind == item ? Color.primary : Color(.secondarySystemFill)))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 8, trailing: 12))
            }
            .listRowSeparator(.hidden)

            if player.musicSession, let current = player.currentVideo {
                Section {
                    Button {
                        router.showMusicPlayer = true
                    } label: {
                        HStack(spacing: 12) {
                            RemoteImage(url: current.displayThumbnail)
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Đang phát").font(.caption).foregroundStyle(Color.brand)
                                Text(current.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(current.channelName ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Image(systemName: player.isPlaying ? "waveform" : "play.fill").foregroundStyle(Color.brand)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            if submitted != nil {
                Section {
                    if isLoading && results.isEmpty {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    } else if let error, results.isEmpty {
                        Text(error).foregroundStyle(.secondary)
                    } else if results.isEmpty {
                        Text("Không có kết quả").foregroundStyle(.secondary)
                    }
                    ForEach(results) { item in
                        MusicItemRow(item: item, queue: results.filter(\.isPlayable))
                    }
                } header: {
                    Text(kind.title)
                }
            } else {
                Section {
                    if recents.items.isEmpty {
                        Text("Bài hát bạn nghe trong chế độ Nghe nhạc sẽ hiện ở đây.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(recents.items) { video in
                        MusicVideoRow(video: video, queue: recents.items)
                    }
                } header: {
                    HStack {
                        Text("Gần đây")
                        Spacer()
                        if !recents.items.isEmpty {
                            Button("Xóa") { recents.clear() }
                                .font(.footnote)
                                .textCase(nil)
                        }
                    }
                } footer: {
                    Text(settings.musicAudioOnly
                        ? "Nghe nhạc chỉ phát âm thanh để tiết kiệm dữ liệu và pin (đổi trong Cài đặt › Nghe nhạc)."
                        : "Nghe nhạc phát cả hình (đổi trong Cài đặt › Nghe nhạc).")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Nghe nhạc")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if player.musicSession, player.currentVideo != nil {
                    Button { router.showMusicPlayer = true } label: { Image(systemName: "music.note") }
                        .accessibilityLabel("Đang phát")
                }
            }
        }
        .onAppear {
            if submitted == nil, recents.items.isEmpty, !ParentalControls.shared.searchDisabled { focused = true }
        }
    }

    private func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        submitted = trimmed
        LibraryStore.shared.addSearch(trimmed)
        runSearch()
    }

    private func runSearch() {
        guard let text = submitted else { return }
        let searchKind = kind
        searchTask?.cancel()
        isLoading = true
        error = nil
        results = []
        searchTask = Task {
            do {
                let items = try await MusicService.search(text, kind: searchKind)
                guard !Task.isCancelled else { return }
                results = items
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

/// One search result / shelf item: songs play in music mode, the rest open their page.
struct MusicItemRow: View {
    let item: MusicItem
    var queue: [MusicItem] = []

    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

    var body: some View {
        Button {
            open()
        } label: {
            HStack(spacing: 12) {
                RemoteImage(url: item.thumbnail)
                    .frame(width: item.kind == .video ? 80 : 52, height: 52)
                    .clipShape(item.kind == .artist ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 6)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title).font(.subheadline.weight(.medium)).lineLimit(2)
                    if !item.subtitle.isEmpty {
                        Text(item.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if item.isPlayable, player.currentVideo?.id == item.id {
                    Image(systemName: "waveform").foregroundStyle(Color.brand)
                } else if !item.isPlayable {
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if item.isPlayable {
                Button {
                    player.startRadio(from: item.video)
                } label: {
                    Label("Radio từ bài này", systemImage: "dot.radiowaves.left.and.right")
                }
                Button {
                    player.playAfterCurrent(item.video)
                } label: {
                    Label("Phát tiếp theo", systemImage: "text.line.first.and.arrowtriangle.forward")
                }
                Button {
                    player.addToQueue(item.video)
                } label: {
                    Label("Thêm vào hàng đợi", systemImage: "text.badge.plus")
                }
                Button {
                    router.playlistSheetVideo = item.video
                } label: {
                    Label("Lưu vào danh sách phát", systemImage: "text.badge.star")
                }
            }
        }
    }

    private func open() {
        switch item.kind {
        case .song, .video:
            let videos = queue.isEmpty ? [item.video] : queue.map(\.video)
            player.playMusic(item.video, queue: videos)
            router.showMusicPlayer = true
        case .album:
            router.open(.musicAlbum(browseId: item.id, title: item.title))
        case .artist:
            router.open(.musicArtist(browseId: item.id, name: item.title))
        case .playlist:
            let id = item.id.hasPrefix("VL") ? String(item.id.dropFirst(2)) : item.id
            router.open(.playlist(PlaylistItem(id: id, title: item.title, thumbnail: item.thumbnail, channelName: item.artist)))
        }
    }
}

/// A recent song.
struct MusicVideoRow: View {
    let video: VideoItem
    var queue: [VideoItem]

    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

    var body: some View {
        Button {
            player.playMusic(video, queue: queue)
            router.showMusicPlayer = true
        } label: {
            HStack(spacing: 12) {
                RemoteImage(url: video.displayThumbnail)
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 2) {
                    Text(video.title).font(.subheadline.weight(.medium)).lineLimit(2)
                    Text([video.channelName, video.durationText].compactMap { $0 }.joined(separator: " • "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                if player.currentVideo?.id == video.id {
                    Image(systemName: "waveform").foregroundStyle(Color.brand)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                player.startRadio(from: video)
            } label: {
                Label("Radio từ bài này", systemImage: "dot.radiowaves.left.and.right")
            }
        }
    }
}

/// Album (`MPRE…`) track list.
struct MusicAlbumView: View {
    let browseId: String
    let title: String

    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router
    @State private var page: MusicPage?
    @State private var error: String?

    var body: some View {
        List {
            if let page {
                Section {
                    VStack(spacing: 10) {
                        RemoteImage(url: page.thumbnail)
                            .frame(width: 200, height: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        Text(page.title.isEmpty ? title : page.title).font(.title3.weight(.bold)).multilineTextAlignment(.center)
                        if let subtitle = page.subtitle {
                            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if !page.tracks.isEmpty {
                            HStack(spacing: 10) {
                                Button {
                                    let videos = page.tracks.map(\.video)
                                    if let first = videos.first { player.playMusic(first, queue: videos) }
                                    router.showMusicPlayer = true
                                } label: {
                                    Label("Phát", systemImage: "play.fill").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.borderedProminent)
                                Button {
                                    let videos = page.tracks.map(\.video).shuffled()
                                    if let first = videos.first { player.playMusic(first, queue: videos) }
                                    router.showMusicPlayer = true
                                } label: {
                                    Label("Trộn bài", systemImage: "shuffle").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }
                ForEach(page.shelves) { shelf in
                    Section(shelf.title) {
                        ForEach(shelf.items) { item in
                            MusicItemRow(item: item, queue: shelf.items.filter(\.isPlayable))
                        }
                    }
                }
            } else if let error {
                Text(error).foregroundStyle(.secondary)
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard page == nil else { return }
            do {
                page = try await MusicService.page(browseId: browseId)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// Artist (`UC…`) page: top songs, albums, singles… Falls back to the channel page.
struct MusicArtistView: View {
    let browseId: String
    let name: String

    @Environment(Router.self) private var router
    @State private var page: MusicPage?
    @State private var error: String?

    var body: some View {
        List {
            if let page, !page.shelves.isEmpty {
                Section {
                    HStack(spacing: 14) {
                        AvatarView(url: page.thumbnail, size: 72, name: page.title.isEmpty ? name : page.title)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(page.title.isEmpty ? name : page.title).font(.title3.weight(.bold))
                            if let subtitle = page.subtitle {
                                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                    Button {
                        router.openChannel(id: browseId, name: name)
                    } label: {
                        Label("Mở trang kênh", systemImage: "person.crop.square")
                    }
                }
                ForEach(page.shelves) { shelf in
                    Section(shelf.title) {
                        ForEach(shelf.items.prefix(20)) { item in
                            MusicItemRow(item: item, queue: shelf.items.filter(\.isPlayable))
                        }
                    }
                }
            } else if page != nil || error != nil {
                Section {
                    Text(error ?? "Không đọc được trang nghệ sĩ.").foregroundStyle(.secondary)
                    Button("Mở trang kênh") { router.openChannel(id: browseId, name: name) }
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard page == nil else { return }
            do {
                page = try await MusicService.page(browseId: browseId)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Now playing

/// The music player: artwork, seek bar, ⏮ ⏯ ⏭, shuffle / repeat, queue, lyrics, radio,
/// sleep timer and EQ.
struct MusicPlayerView: View {
    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var showLyrics = false
    @State private var showQueue = false
    @State private var showSleepTimer = false
    @State private var showEqualizer = false
    @State private var scrub: Double?

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                ScrollView {
                    VStack(spacing: 18) {
                        if let video = player.currentVideo {
                            if showLyrics {
                                LyricsPanel(videoId: video.id)
                                    .frame(height: min(geo.size.width, 380))
                            } else {
                                artwork(video, side: min(geo.size.width - 48, 360))
                            }
                            VStack(spacing: 4) {
                                DeArrowTitle(video: video)
                                    .font(.title3.weight(.bold))
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)
                                Text(video.channelName ?? "")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            seekBar
                            transport
                            secondaryControls(video)
                        } else {
                            ContentUnavailableView("Chưa phát bài nào", systemImage: "music.note")
                        }
                    }
                    .padding(24)
                }
            }
            .navigationTitle(player.radioId != nil ? "Radio" : "Đang phát")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { dismiss() } label: { Image(systemName: "chevron.down") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                        player.isExpanded = true
                    } label: {
                        Image(systemName: "rectangle.expand.vertical")
                    }
                    .accessibilityLabel("Mở trang xem")
                }
            }
        }
        .sheet(isPresented: $showQueue) {
            QueueSheet().presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showSleepTimer) {
            NavigationStack { SleepTimerView() }.presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showEqualizer) {
            NavigationStack {
                EqualizerView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Xong") { showEqualizer = false } }
                    }
            }
        }
    }

    private func artwork(_ video: VideoItem, side: CGFloat) -> some View {
        RemoteImage(url: video.displayThumbnail, contentMode: .fill)
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
            .overlay {
                if player.isLoading || player.isBuffering { ProgressView().controlSize(.large) }
            }
            .overlay {
                if let error = player.playbackError {
                    VStack(spacing: 8) {
                        Text(error).font(.footnote).multilineTextAlignment(.center)
                        Button("Thử lại") { player.retry() }.buttonStyle(.borderedProminent)
                    }
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(.ultraThinMaterial))
                }
            }
            .padding(.top, 8)
    }

    private var seekBar: some View {
        VStack(spacing: 2) {
            Slider(
                value: Binding(get: { scrub ?? player.currentTime }, set: { scrub = $0 }),
                in: 0...max(player.duration, max(player.currentTime, 1)),
                onEditingChanged: { editing in
                    if !editing, let target = scrub {
                        player.seek(to: target)
                        scrub = nil
                    }
                }
            )
            HStack {
                Text(formatTime(scrub ?? player.currentTime))
                Spacer()
                Text(formatTime(player.duration))
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }

    private var transport: some View {
        HStack(spacing: 30) {
            Button { player.toggleShuffle() } label: {
                Image(systemName: "shuffle")
                    .font(.title3)
                    .foregroundStyle(player.isShuffled ? Color.brand : Color.secondary)
            }
            Button { player.playPrevious() } label: {
                Image(systemName: "backward.end.fill").font(.title2)
            }
            Button { player.togglePlayPause() } label: {
                Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 64))
            }
            Button { player.playNext() } label: {
                Image(systemName: "forward.end.fill").font(.title2)
                    .opacity(player.hasNext || player.radioId != nil ? 1 : 0.4)
            }
            Button { player.cycleRepeatMode() } label: {
                Image(systemName: player.repeatMode == .one ? "repeat.1" : "repeat")
                    .font(.title3)
                    .foregroundStyle(player.repeatMode == .off ? Color.secondary : Color.brand)
            }
        }
        .buttonStyle(.plain)
    }

    private func secondaryControls(_ video: VideoItem) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 10) {
            control(showLyrics ? "photo" : "quote.bubble", showLyrics ? "Ảnh bìa" : "Lời bài hát") {
                showLyrics.toggle()
            }
            control("list.bullet", "Hàng đợi") { showQueue = true }
            control("dot.radiowaves.left.and.right", "Radio từ bài này") { player.startRadio(from: video) }
            control("moon.zzz", player.sleepTimerLabel.map { "Hẹn giờ \($0)" } ?? "Hẹn giờ tắt") { showSleepTimer = true }
            control("slider.vertical.3", settings.eqEnabled ? "EQ: \(settings.eqPresetName)" : "EQ") { showEqualizer = true }
            control(player.isAudioOnly ? "play.rectangle" : "headphones", player.isAudioOnly ? "Bật hình" : "Chỉ âm thanh") {
                player.setAudioOnly(!player.isAudioOnly)
            }
        }
    }

    private func control(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.title3)
                Text(title).font(.caption2.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground)))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Lyrics

/// "Lời bài hát": timed lines are highlighted and scrolled with the song.
struct LyricsPanel: View {
    let videoId: String

    @Environment(PlayerManager.self) private var player
    @State private var lyrics: Lyrics?
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        Group {
            if let lyrics {
                if lyrics.isTimed {
                    timed(lyrics)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(lyrics.text)
                                .font(.body)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                            if let source = lyrics.source {
                                Text(source).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding()
                    }
                }
            } else if loaded {
                VStack(spacing: 8) {
                    Image(systemName: "text.quote").font(.largeTitle).foregroundStyle(.secondary)
                    Text(error ?? "Chưa có lời bài hát cho bài này")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(.secondarySystemBackground)))
        .task(id: videoId) {
            lyrics = nil
            loaded = false
            error = nil
            do {
                let found = try await MusicService.lyrics(videoId: videoId)
                guard !Task.isCancelled else { return }
                lyrics = found
            } catch {
                guard !Task.isCancelled else { return }
                self.error = "Không tải được lời bài hát. \(error.localizedDescription)"
            }
            loaded = true
        }
    }

    private func timed(_ lyrics: Lyrics) -> some View {
        let isCurrentVideo = player.currentVideo?.id == videoId
        let time = isCurrentVideo ? player.currentTime : -1
        let current = lyrics.lines.lastIndex { $0.start <= time + 0.2 }
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(lyrics.lines.enumerated()), id: \.offset) { index, line in
                        Text(line.text.isEmpty ? "♪" : line.text)
                            .font(.title3.weight(index == current ? .bold : .medium))
                            .foregroundStyle(index == current ? Color.primary : Color.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id(index)
                            .onTapGesture {
                                if isCurrentVideo { player.seek(to: line.start) }
                            }
                    }
                    if let source = lyrics.source {
                        Text(source).font(.caption).foregroundStyle(.secondary).padding(.top, 8)
                    }
                }
                .padding()
            }
            .onChange(of: current) { _, index in
                guard let index else { return }
                withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(index, anchor: .center) }
            }
        }
    }
}

/// "Lời bài hát" on the normal watch page (any video).
struct LyricsSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let video = player.currentVideo {
                    LyricsPanel(videoId: video.id).padding()
                } else {
                    ContentUnavailableView("Chưa phát video nào", systemImage: "music.note")
                }
            }
            .navigationTitle("Lời bài hát")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } }
            }
        }
    }
}
