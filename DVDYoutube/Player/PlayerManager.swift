import AVFoundation
import AVKit
import MediaPlayer
import Observation
import UIKit
import WebKit

/// Owns the one `AVPlayer` used for regular videos and everything around it:
/// queue, history, captions, SponsorBlock, Now Playing, background audio and PiP.
@MainActor
@Observable
final class PlayerManager {
    static let shared = PlayerManager()

    // MARK: Published state

    private(set) var currentVideo: VideoItem?
    private(set) var playerInfo: PlayerInfo?
    private(set) var watchInfo: WatchInfo?
    private(set) var watchInfoError: String?
    private(set) var playbackError: String?
    private(set) var isLoading = false
    private(set) var isPlaying = false
    private(set) var isBuffering = false
    private(set) var currentTime: Double = 0
    private(set) var duration: Double = 0
    private(set) var bufferedTime: Double = 0
    private(set) var adWaitRemaining = 0
    private(set) var isLocalPlayback = false
    /// True while the official web embed is used because the native stream was refused.
    private(set) var usesWebPlayer = false
    private(set) var webFallbackReason: String?
    @ObservationIgnored private weak var webView: WKWebView?

    var isExpanded = false {
        didSet { OrientationController.setAllowed(isExpanded ? .allButUpsideDown : .portrait) }
    }

    private(set) var quality: VideoQuality = .auto
    private(set) var rate: Float = 1

    private(set) var captionTracks: [CaptionTrack] = []
    private(set) var selectedCaption: CaptionTrack?
    private(set) var captionTranslation: String?
    private(set) var currentCaption: String?
    @ObservationIgnored private var captionCues: [CaptionCue] = []

    private(set) var sponsorSegments: [SponsorSegment] = []
    private(set) var toastMessage: String?

    private(set) var queue: [VideoItem] = []
    private(set) var queueIndex = 0
    private(set) var isPiPActive = false

    var hasNext: Bool { queueIndex + 1 < queue.count || nextAutoplayVideo != nil }
    var hasPrevious: Bool { queueIndex > 0 || currentTime > 5 }

    // MARK: Internals

    @ObservationIgnored let player = AVPlayer()
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var watchTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var skippedSegments = Set<Double>()
    @ObservationIgnored private var lastHistorySave = Date.distantPast
    @ObservationIgnored private var fallbackStage = 0
    @ObservationIgnored private var pendingSeek: Double?
    @ObservationIgnored private weak var playerLayer: AVPlayerLayer?
    @ObservationIgnored private var pipController: AVPictureInPictureController?
    @ObservationIgnored private let pipDelegate = PiPDelegate()
    @ObservationIgnored private var artworkTask: Task<Void, Never>?
    @ObservationIgnored private var nowPlayingArtwork: MPMediaItemArtwork?

    @ObservationIgnored private let settings: AppSettings
    @ObservationIgnored private let library: LibraryStore
    @ObservationIgnored private let service = YouTubeService.shared

    private init() {
        settings = AppSettings.shared
        library = LibraryStore.shared
        player.allowsExternalPlayback = true
        player.automaticallyWaitsToMinimizeStalling = true
        rate = Float(settings.playbackSpeed)
        player.defaultRate = rate
        pipDelegate.owner = self
        setupObservers()
        setupRemoteCommands()
    }

    // MARK: - Public API

    func play(_ video: VideoItem, queue newQueue: [VideoItem]? = nil, startAt: Double? = nil) {
        ShortsPlayer.shared.pause()
        if video.id == currentVideo?.id, playbackError == nil, newQueue == nil {
            isExpanded = true
            if !isPlaying { resume() }
            return
        }
        saveProgress()
        if let newQueue {
            queue = newQueue
            queueIndex = newQueue.firstIndex { $0.id == video.id } ?? 0
        } else if let index = queue.firstIndex(where: { $0.id == video.id }) {
            queueIndex = index
        } else {
            queue = [video]
            queueIndex = 0
        }
        start(video, startAt: startAt)
        isExpanded = true
    }

    func playQueueItem(at index: Int) {
        guard queue.indices.contains(index) else { return }
        saveProgress()
        queueIndex = index
        start(queue[index], startAt: nil)
    }

    func addToQueue(_ video: VideoItem) {
        guard currentVideo != nil else {
            play(video)
            return
        }
        queue.removeAll { $0.id == video.id && $0.id != currentVideo?.id }
        queue.append(video)
        showToast("Đã thêm vào hàng đợi")
    }

    func playNext() {
        if queueIndex + 1 < queue.count {
            playQueueItem(at: queueIndex + 1)
        } else if let next = nextAutoplayVideo {
            saveProgress()
            queue.append(next)
            queueIndex = queue.count - 1
            start(next, startAt: nil)
        }
    }

    func playPrevious() {
        if currentTime > 5 || queueIndex == 0 {
            seek(to: 0)
        } else {
            playQueueItem(at: queueIndex - 1)
        }
    }

    func togglePlayPause() {
        isPlaying ? pause() : resume()
    }

    func resume() {
        if usesWebPlayer {
            webCommand("playVideo")
            return
        }
        if player.currentItem == nil, let video = currentVideo {
            start(video, startAt: currentTime)
            return
        }
        if duration > 0, currentTime >= duration - 0.5 { seek(to: 0) }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.playImmediately(atRate: rate)
    }

    func pause() {
        if usesWebPlayer { webCommand("pauseVideo") }
        player.pause()
        saveProgress()
    }

    func seek(to seconds: Double) {
        let target = max(0, duration > 0 ? min(seconds, duration - 0.25) : seconds)
        currentTime = target
        if usesWebPlayer {
            webCommand("seekTo", arguments: "[\(target), true]")
            return
        }
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        updateNowPlayingTime()
    }

    func skip(by seconds: Double) {
        seek(to: currentTime + seconds)
    }

    func close() {
        saveProgress()
        loadTask?.cancel()
        watchTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentVideo = nil
        playerInfo = nil
        watchInfo = nil
        usesWebPlayer = false
        queue = []
        isExpanded = false
        isPlaying = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func retry() {
        guard let video = currentVideo else { return }
        start(video, startAt: currentTime > 0 ? currentTime : nil)
    }

    func setQuality(_ quality: VideoQuality) {
        self.quality = quality
        applyQuality(to: player.currentItem)
        if fallbackStage >= 2, let video = currentVideo {
            // Composition playback cannot adapt: rebuild it at the new quality.
            start(video, startAt: currentTime)
        }
    }

    func setRate(_ rate: Float) {
        self.rate = rate
        player.defaultRate = rate
        if isPlaying { player.rate = rate }
        settings.playbackSpeed = Double(rate)
        updateNowPlayingTime()
    }

    func selectCaption(_ track: CaptionTrack?, translateTo language: String? = nil) {
        selectedCaption = track
        captionTranslation = language
        captionCues = []
        currentCaption = nil
        settings.captionsEnabled = track != nil
        guard let track else { return }
        let videoId = currentVideo?.id
        Task {
            let cues = (try? await CaptionLoader.load(track: track, translateTo: language)) ?? []
            guard self.currentVideo?.id == videoId, self.selectedCaption == track else { return }
            self.captionCues = cues
            if cues.isEmpty { self.showToast("Không tải được phụ đề") }
        }
    }

    func refreshWatchInfo() {
        guard let video = currentVideo else { return }
        loadWatchInfo(video.id)
    }

    // MARK: - Loading

    private func start(_ video: VideoItem, startAt: Double?) {
        loadTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentVideo = video
        playerInfo = nil
        playbackError = nil
        currentTime = startAt ?? 0
        duration = Double(video.durationSeconds ?? 0)
        bufferedTime = 0
        adWaitRemaining = 0
        sponsorSegments = []
        skippedSegments = []
        captionTracks = []
        selectedCaption = nil
        captionCues = []
        currentCaption = nil
        fallbackStage = 0
        isLocalPlayback = false
        usesWebPlayer = false
        webFallbackReason = nil
        quality = defaultQuality()
        isLoading = true
        pendingSeek = startAt ?? (settings.resumePlayback ? library.resumePosition(for: video.id) : nil)
        if settings.saveHistory { library.recordWatch(video, position: pendingSeek ?? 0, duration: duration) }
        updateNowPlayingInfo()
        loadWatchInfo(video.id)

        loadTask = Task { [weak self] in
            await self?.loadStream(for: video)
        }
    }

    private func defaultQuality() -> VideoQuality {
        NetworkMonitor.shared.isExpensive ? settings.cellularQuality : settings.wifiQuality
    }

    private func loadWatchInfo(_ videoId: String) {
        watchTask?.cancel()
        watchInfo = nil
        watchInfoError = nil
        watchTask = Task { [weak self] in
            do {
                let info = try await YouTubeService.shared.watchInfo(videoId)
                guard let self, !Task.isCancelled, self.currentVideo?.id == videoId else { return }
                self.watchInfo = info
                self.enrichCurrentVideo(with: info)
                if let channel = info.channel, let subscribed = info.isSubscribed {
                    AccountStore.shared.noteSubscription(channelId: channel.id, subscribed: subscribed)
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.watchInfoError = error.localizedDescription
            }
        }
    }

    private func loadStream(for video: VideoItem) async {
        if let local = DownloadManager.shared.localFileURL(for: video.id) {
            isLocalPlayback = true
            startItem(AVPlayerItem(url: local))
            return
        }
        do {
            let info = try await service.player(video.id)
            guard !Task.isCancelled, currentVideo?.id == video.id else { return }
            playerInfo = info
            Log.debug("stream \(video.id): hls=\(info.hlsURL != nil) adaptive=\(info.adaptiveFormats.count) muxed=\(info.muxedFormats.count) captions=\(info.captions.count) adWait=\(Int(info.availableAt.timeIntervalSinceNow))s")
            captionTracks = info.captions
            if duration <= 0, let length = info.lengthSeconds { duration = Double(length) }
            enrichCurrentVideo(with: info)

            var remaining = info.availableAt.timeIntervalSinceNow
            while remaining > 0.3 {
                adWaitRemaining = Int(remaining.rounded(.up))
                try await Task.sleep(nanoseconds: UInt64(min(remaining, 1) * 1_000_000_000))
                guard !Task.isCancelled else { return }
                remaining = info.availableAt.timeIntervalSinceNow
            }
            adWaitRemaining = 0

            guard let item = await makeItem(info: info, stage: fallbackStage) else {
                throw InnerTubeError.noStreams
            }
            guard !Task.isCancelled, currentVideo?.id == video.id else { return }
            startItem(item)
            loadExtras(for: video.id, info: info)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, currentVideo?.id == video.id else { return }
            Log.debug("stream \(video.id) failed: \(error.localizedDescription)")
            if shouldUseWebFallback(for: error) {
                switchToWebPlayer(reason: error.localizedDescription)
                return
            }
            isLoading = false
            playbackError = error.localizedDescription
        }
    }

    /// Stage 0: HLS (adaptive, best). Stage 1: muxed progressive. Stage 2: video+audio composition.
    private func makeItem(info: PlayerInfo, stage: Int) async -> AVPlayerItem? {
        var stage = stage
        while stage <= 2 {
            switch stage {
            case 0:
                if let hls = info.hlsURL {
                    fallbackStage = 0
                    return AVPlayerItem(url: hls)
                }
            case 1:
                if let muxed = info.muxedFormats.filter({ $0.isH264 || $0.mimeType.contains("mp4") })
                    .max(by: { ($0.height ?? 0) < ($1.height ?? 0) }) {
                    fallbackStage = 1
                    return AVPlayerItem(url: muxed.url)
                }
            default:
                if let item = try? await makeCompositionItem(info: info) {
                    fallbackStage = 2
                    return item
                }
            }
            stage += 1
        }
        return nil
    }

    private func makeCompositionItem(info: PlayerInfo) async throws -> AVPlayerItem {
        guard let video = info.bestVideo(maxHeight: quality.maxHeight ?? 1080), let audio = info.bestAudio else {
            throw InnerTubeError.noStreams
        }
        let videoAsset = AVURLAsset(url: video.url)
        let audioAsset = AVURLAsset(url: audio.url)
        let videoTracks = try await videoAsset.loadTracks(withMediaType: .video)
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        let videoDuration = try await videoAsset.load(.duration)
        let audioDuration = try await audioAsset.load(.duration)
        guard let videoTrack = videoTracks.first, let audioTrack = audioTracks.first else {
            throw InnerTubeError.noStreams
        }
        let composition = AVMutableComposition()
        let length = CMTimeMinimum(videoDuration, audioDuration)
        let range = CMTimeRange(start: .zero, duration: length)
        try composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)?
            .insertTimeRange(range, of: videoTrack, at: .zero)
        try composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)?
            .insertTimeRange(range, of: audioTrack, at: .zero)
        return AVPlayerItem(asset: composition)
    }

    private func startItem(_ item: AVPlayerItem) {
        applyQuality(to: item)
        observe(item)
        player.replaceCurrentItem(with: item)
        try? AVAudioSession.sharedInstance().setActive(true)
        if let seek = pendingSeek, seek > 0 {
            player.seek(to: CMTime(seconds: seek, preferredTimescale: 600))
            currentTime = seek
        }
        pendingSeek = nil
        player.playImmediately(atRate: rate)
        updateNowPlayingInfo()
    }

    private func loadExtras(for videoId: String, info: PlayerInfo) {
        if settings.sponsorBlockEnabled, !info.isLive {
            let categories = settings.sponsorBlockCategories
            Task {
                let segments = await SponsorBlock.segments(videoId: videoId, categories: categories)
                guard self.currentVideo?.id == videoId else { return }
                self.sponsorSegments = segments
            }
        }
        if settings.captionsEnabled, !info.captions.isEmpty {
            let preferred = settings.captionLanguage
            if let exact = info.captions.first(where: { $0.languageCode.hasPrefix(preferred) && !$0.isAutoGenerated })
                ?? info.captions.first(where: { $0.languageCode.hasPrefix(preferred) }) {
                selectCaption(exact)
            } else if let translatable = info.captions.first(where: \.isTranslatable) {
                selectCaption(translatable, translateTo: preferred)
            }
        }
    }

    private func applyQuality(to item: AVPlayerItem?) {
        guard let item else { return }
        if let height = quality.maxHeight {
            let side = Double(height) * 16 / 9
            item.preferredMaximumResolution = CGSize(width: side, height: side)
            item.preferredPeakBitRate = quality.peakBitRate
        } else {
            item.preferredMaximumResolution = .zero
            item.preferredPeakBitRate = 0
        }
    }

    private func enrichCurrentVideo(with info: PlayerInfo) {
        guard var video = currentVideo, video.id == info.videoId else { return }
        if video.title.isEmpty { video.title = info.title }
        video.channelName = video.channelName ?? info.author
        video.channelId = video.channelId ?? info.channelId
        video.thumbnail = video.thumbnail ?? info.thumbnail
        video.isLive = info.isLive
        if video.durationSeconds == nil, let length = info.lengthSeconds, !info.isLive {
            video.durationSeconds = length
            video.durationText = formatDuration(length)
        }
        currentVideo = video
        replaceInQueue(video)
        updateNowPlayingInfo()
    }

    private func enrichCurrentVideo(with info: WatchInfo) {
        guard var video = currentVideo, video.id == info.videoId else { return }
        if video.title.isEmpty { video.title = info.title }
        if let channel = info.channel {
            video.channelName = video.channelName ?? channel.name
            video.channelId = video.channelId ?? channel.id
            video.channelAvatar = video.channelAvatar ?? channel.avatar
        }
        video.viewCountText = video.viewCountText ?? info.shortViewCountText
        video.publishedText = video.publishedText ?? info.relativeDateText
        currentVideo = video
        replaceInQueue(video)
        if let channel = info.channel { library.updateSubscription(channel) }
    }

    private func replaceInQueue(_ video: VideoItem) {
        if queue.indices.contains(queueIndex), queue[queueIndex].id == video.id { queue[queueIndex] = video }
    }

    private var nextAutoplayVideo: VideoItem? {
        guard settings.autoplay, let related = watchInfo?.related.videos else { return nil }
        let recent = Set(library.history.prefix(50).map(\.id)).union(queue.map(\.id))
        return related.first { !recent.contains($0.id) && !$0.isLive && !$0.isShort } ?? related.first { !$0.isShort }
    }

    // MARK: - Observation

    private func observe(_ item: AVPlayerItem) {
        observations = [
            item.observe(\.status, options: [.new]) { [weak self] item, _ in
                Task { @MainActor in self?.handleStatus(of: item) }
            },
        ]
        observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            Task { @MainActor in self?.handleTimeControl(player.timeControlStatus) }
        })
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.handleEnded() }
        }
    }

    private func handleStatus(of item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        switch item.status {
        case .readyToPlay:
            Log.debug("item ready (stage \(fallbackStage)), duration \(item.duration.seconds)")
            isLoading = false
            playbackError = nil
            let seconds = item.duration.seconds
            if seconds.isFinite, seconds > 0 { duration = seconds }
            updateNowPlayingInfo()
        case .failed:
            let message = item.error?.localizedDescription ?? "Không phát được video."
            Log.debug("item failed at stage \(fallbackStage): \(item.error.map { String(describing: $0) } ?? "unknown")")
            if let info = playerInfo, fallbackStage < 2, !isLocalPlayback {
                // Try the next way of playing the same video.
                let resumeAt = currentTime
                fallbackStage += 1
                loadTask = Task { [weak self] in
                    guard let self else { return }
                    if let next = await self.makeItem(info: info, stage: self.fallbackStage), !Task.isCancelled {
                        self.pendingSeek = resumeAt
                        self.startItem(next)
                    } else {
                        self.isLoading = false
                        self.playbackError = message
                    }
                }
            } else if settings.webPlayerFallback, !isLocalPlayback {
                switchToWebPlayer(reason: message)
            } else {
                isLoading = false
                playbackError = message
            }
        default:
            break
        }
    }

    private func handleTimeControl(_ status: AVPlayer.TimeControlStatus) {
        isPlaying = status == .playing || status == .waitingToPlayAtSpecifiedRate
        isBuffering = status == .waitingToPlayAtSpecifiedRate
        if status == .playing { isLoading = false }
        updateNowPlayingTime()
    }

    private func handleEnded() {
        saveProgress(completed: true)
        if hasNext, settings.autoplay || queueIndex + 1 < queue.count {
            playNext()
        } else {
            isPlaying = false
        }
    }

    private func setupObservers() {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            Task { @MainActor in self?.tick(time.seconds) }
        }
    }

    private func tick(_ seconds: Double) {
        guard seconds.isFinite, player.currentItem != nil else { return }
        if Log.verbose, Int(seconds) / 5 != Int(currentTime) / 5 {
            Log.debug("playing \(currentVideo?.id ?? "?") at \(Int(seconds))s, buffered \(Int(bufferedTime))s")
        }
        currentTime = seconds
        if seconds > 10, let id = currentVideo?.id {
            AccountStore.shared.reportWatched(id, duration: duration)
        }
        if let item = player.currentItem {
            if let range = item.loadedTimeRanges.first?.timeRangeValue {
                bufferedTime = range.end.seconds
            }
            let total = item.duration.seconds
            if total.isFinite, total > 0, abs(total - duration) > 1 { duration = total }
        }

        if let segment = sponsorSegments.first(where: { seconds >= $0.start && seconds < $0.end - 0.5 }),
           !skippedSegments.contains(segment.start) {
            skippedSegments.insert(segment.start)
            seek(to: segment.end)
            showToast("Đã bỏ qua: \(SponsorBlock.title(for: segment.category))")
        }

        if !captionCues.isEmpty {
            let active = captionCues.filter { seconds >= $0.start && seconds < $0.end }.suffix(2)
            let text = active.map(\.text).joined(separator: "\n")
            let caption = text.isEmpty ? nil : text
            if caption != currentCaption { currentCaption = caption }
        }

        if Date().timeIntervalSince(lastHistorySave) > 10 {
            saveProgress()
        }
    }

    private func saveProgress(completed: Bool = false) {
        guard let video = currentVideo, currentTime > 0 || completed else { return }
        lastHistorySave = Date()
        library.updatePosition(videoId: video.id, position: completed ? duration : currentTime, duration: duration)
    }

    // MARK: - Web player fallback

    private func shouldUseWebFallback(for error: Error) -> Bool {
        guard settings.webPlayerFallback, !isLocalPlayback else { return false }
        switch error as? InnerTubeError {
        case .loginRequired, .noStreams, .http: return true
        case .unplayable, .invalidResponse: return false
        case nil: return !(error is URLError)
        }
    }

    func switchToWebPlayer(reason: String? = nil) {
        guard currentVideo != nil else { return }
        Log.debug("switching to web player: \(reason ?? "manual")")
        loadTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        pendingSeek = currentTime > 1 ? currentTime : pendingSeek
        usesWebPlayer = true
        webFallbackReason = reason
        playbackError = nil
        adWaitRemaining = 0
        isLoading = true
    }

    func switchToNativePlayer() {
        guard let video = currentVideo else { return }
        usesWebPlayer = false
        start(video, startAt: currentTime > 1 ? currentTime : nil)
    }

    /// Start offset for the embed (resume position or where native playback stopped).
    var webStartTime: Double { pendingSeek ?? 0 }

    func registerWebView(_ webView: WKWebView) {
        self.webView = webView
    }

    func handleWebEvent(_ event: WebPlayerEvent) {
        guard usesWebPlayer else { return }
        if let error = event.error, !error.isEmpty {
            if playbackError != error { Log.debug("web player error: \(error)") }
            isLoading = false
            playbackError = error
            return
        }
        if event.time >= 0, !event.isAd {
            if Log.verbose, Int(event.time) / 5 != Int(currentTime) / 5 {
                Log.debug("web playing \(currentVideo?.id ?? "?") at \(Int(event.time))s")
            }
            currentTime = event.time
            if event.time > 0 { isLoading = false }
        }
        if event.isAd { Log.debug("web player: skipping an ad") }
        if event.duration > 0, !event.isAd { duration = event.duration }
        isPlaying = !event.paused
        if Date().timeIntervalSince(lastHistorySave) > 10 { saveProgress() }
        updateNowPlayingTime()
    }

    private func webCommand(_ name: String, arguments: String = "[]") {
        webView?.evaluateJavaScript("dvdCommand('\(name)', \(arguments))", completionHandler: nil)
    }

    // MARK: - Toasts

    func showToast(_ message: String) {
        toastMessage = message
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled else { return }
            self.toastMessage = nil
        }
    }

    // MARK: - Player layer, background & Picture in Picture

    func attach(layer: AVPlayerLayer) {
        guard playerLayer !== layer else { return }
        playerLayer = layer
        layer.player = player
        if AVPictureInPictureController.isPictureInPictureSupported() {
            let controller = AVPictureInPictureController(playerLayer: layer)
            controller?.delegate = pipDelegate
            controller?.canStartPictureInPictureAutomaticallyFromInline = settings.autoPictureInPicture
            pipController = controller
        }
    }

    var isPiPPossible: Bool { pipController?.isPictureInPicturePossible ?? false }

    func togglePictureInPicture() {
        guard let controller = pipController else { return }
        if controller.isPictureInPictureActive {
            controller.stopPictureInPicture()
        } else {
            controller.canStartPictureInPictureAutomaticallyFromInline = settings.autoPictureInPicture
            controller.startPictureInPicture()
        }
    }

    func updateAutoPiP() {
        pipController?.canStartPictureInPictureAutomaticallyFromInline = settings.autoPictureInPicture
    }

    fileprivate func pipDidChange(active: Bool) {
        isPiPActive = active
        if !active, UIApplication.shared.applicationState == .active, currentVideo != nil {
            isExpanded = true
        }
    }

    fileprivate func restoreFromPiP() {
        isExpanded = true
    }

    /// Detaching the video layer lets audio keep playing while the app is in the background.
    func appDidEnterBackground() {
        saveProgress()
        guard currentVideo != nil else { return }
        if !settings.backgroundPlayback, !isPiPActive {
            pause()
            return
        }
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !self.isPiPActive, UIApplication.shared.applicationState == .background else { return }
            self.playerLayer?.player = nil
        }
    }

    func appWillEnterForeground() {
        playerLayer?.player = player
        // Like the official app: opening the app while the floating PiP window is shown
        // ends PiP and continues the video in the full player.
        if let controller = pipController, controller.isPictureInPictureActive {
            isExpanded = true
            controller.stopPictureInPicture()
        }
    }

    // MARK: - Now Playing & remote commands

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.togglePlayPause() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.playNext() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.playPrevious() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in self?.seek(to: position) }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: 10) }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: -10) }
            return .success
        }
    }

    private func updateNowPlayingInfo() {
        guard let video = currentVideo else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: video.title,
            MPMediaItemPropertyArtist: video.channelName ?? "",
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
            MPNowPlayingInfoPropertyIsLiveStream: video.isLive,
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0
        if let artwork = nowPlayingArtwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        loadArtwork(for: video)
    }

    private func updateNowPlayingTime() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    @ObservationIgnored private var artworkVideoId: String?

    private func loadArtwork(for video: VideoItem) {
        guard artworkVideoId != video.id, let url = video.displayThumbnail else { return }
        artworkVideoId = video.id
        nowPlayingArtwork = nil
        artworkTask?.cancel()
        artworkTask = Task {
            guard let image = await ImageLoader.shared.image(for: url), !Task.isCancelled,
                  self.currentVideo?.id == video.id else { return }
            self.nowPlayingArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                info[MPMediaItemPropertyArtwork] = self.nowPlayingArtwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
    }
}

private final class PiPDelegate: NSObject, AVPictureInPictureControllerDelegate {
    weak var owner: PlayerManager?

    func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.owner?.pipDidChange(active: true) }
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.owner?.pipDidChange(active: false) }
    }

    func pictureInPictureController(_ controller: AVPictureInPictureController,
                                    failedToStartPictureInPictureWithError error: Error) {
        Task { @MainActor in self.owner?.pipDidChange(active: false) }
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        Task { @MainActor in
            self.owner?.restoreFromPiP()
            completionHandler(true)
        }
    }
}
