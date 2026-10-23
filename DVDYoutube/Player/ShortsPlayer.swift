import AVFoundation
import Observation

/// A second, lightweight player dedicated to the Shorts feed (looping, prefetching).
@MainActor
@Observable
final class ShortsPlayer {
    static let shared = ShortsPlayer()

    @ObservationIgnored let player = AVPlayer()

    private(set) var currentId: String?
    private(set) var isPlaying = false
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var progress: Double = 0
    /// Shorts shown through the web embed because YouTube refused the native stream.
    private(set) var webFallbackIds: Set<String> = []
    /// After a bot check, skip the player API for a while instead of hammering it.
    @ObservationIgnored private var blockedUntil = Date.distantPast

    @ObservationIgnored private var cache: [String: PlayerInfo] = [:]
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var loopObserver: NSObjectProtocol?
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var pausedByUser = false

    private init() {
        player.automaticallyWaitsToMinimizeStalling = true
        statusObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            Task { @MainActor in
                guard let self else { return }
                self.isPlaying = player.timeControlStatus != .paused
                if player.timeControlStatus == .playing { self.isLoading = false }
            }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self, let item = self.player.currentItem else { return }
                let total = item.duration.seconds
                if total.isFinite, total > 0 { self.progress = time.seconds / total }
            }
        }
    }

    func play(_ video: VideoItem) {
        PlayerManager.shared.pause()
        pausedByUser = false
        guard currentId != video.id else {
            resume()
            return
        }
        currentId = video.id
        error = nil
        progress = 0
        isLoading = true
        player.pause()
        player.replaceCurrentItem(with: nil)
        loadTask?.cancel()
        if AppSettings.shared.webPlayerFallback, Date() < blockedUntil || webFallbackIds.contains(video.id) {
            webFallbackIds.insert(video.id)
            isLoading = false
            return
        }
        loadTask = Task { [weak self] in
            guard let self else { return }
            do {
                let info = try await self.info(for: video.id)
                var remaining = info.availableAt.timeIntervalSinceNow
                while remaining > 0.3 {
                    try await Task.sleep(nanoseconds: UInt64(min(remaining, 1) * 1_000_000_000))
                    remaining = info.availableAt.timeIntervalSinceNow
                }
                guard !Task.isCancelled, self.currentId == video.id else { return }
                guard let url = info.hlsURL ?? info.muxedFormats.first?.url else { throw InnerTubeError.noStreams }
                Log.debug("short \(video.id): playing \(info.hlsURL != nil ? "HLS" : "muxed")")
                let item = AVPlayerItem(url: url)
                item.preferredMaximumResolution = CGSize(width: 1920, height: 1920)
                self.replaceItem(item)
                if AppSettings.shared.saveHistory {
                    var watched = video
                    watched.isShort = true
                    watched.title = watched.title.isEmpty ? info.title : watched.title
                    watched.channelName = watched.channelName ?? info.author
                    watched.channelId = watched.channelId ?? info.channelId
                    LibraryStore.shared.recordWatch(watched, position: 0, duration: Double(info.lengthSeconds ?? 0))
                }
            } catch is CancellationError {
                return
            } catch {
                guard self.currentId == video.id else { return }
                self.isLoading = false
                if AppSettings.shared.webPlayerFallback, case InnerTubeError.loginRequired = error {
                    Log.debug("short \(video.id): bot check, using web player")
                    self.blockedUntil = Date().addingTimeInterval(300)
                    self.webFallbackIds.insert(video.id)
                } else {
                    self.error = error.localizedDescription
                }
            }
        }
    }

    /// Resolves the stream of an upcoming Short so swiping to it starts instantly.
    func prefetch(_ video: VideoItem) {
        guard cache[video.id] == nil, Date() >= blockedUntil else { return }
        Task { _ = try? await self.info(for: video.id) }
    }

    func cachedInfo(_ id: String) -> PlayerInfo? { cache[id] }

    func usesWebPlayer(_ id: String) -> Bool { webFallbackIds.contains(id) }

    func toggle() {
        if isPlaying {
            pausedByUser = true
            player.pause()
        } else {
            pausedByUser = false
            resume()
        }
    }

    func resume() {
        guard !pausedByUser else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
    }

    func pause() {
        player.pause()
    }

    func stop() {
        loadTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentId = nil
    }

    private func replaceItem(_ item: AVPlayerItem) {
        if let loopObserver { NotificationCenter.default.removeObserver(loopObserver) }
        loopObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.player.seek(to: .zero)
                self?.player.play()
            }
        }
        player.replaceCurrentItem(with: item)
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
    }

    private func info(for id: String) async throws -> PlayerInfo {
        if let cached = cache[id], (cached.expiresAt ?? .distantFuture) > Date().addingTimeInterval(60) {
            return cached
        }
        let info = try await YouTubeService.shared.player(id)
        cache[id] = info
        if cache.count > 40, let oldest = cache.keys.first(where: { $0 != currentId }) { cache[oldest] = nil }
        return info
    }
}
