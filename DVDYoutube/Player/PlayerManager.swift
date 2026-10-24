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
        didSet {
            if !isExpanded {
                isPortraitFullscreen = false
                fullscreenQuarterTurns = 0
            }
            if fullscreenQuarterTurns == 0 { OrientationController.setAllowed(fullscreenOrientations) }
        }
    }
    /// Fullscreen kept upright, for videos taller than they are wide.
    private(set) var isPortraitFullscreen = false
    /// Clockwise quarter turns of the fullscreen player, picked with its rotate buttons.
    private(set) var fullscreenQuarterTurns = 0
    /// Size of the picture being played, once the player knows it.
    private(set) var videoSize: CGSize = .zero

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

    // Extras of the official player.
    private(set) var isLooping = false
    private(set) var sleepTimerEnd: Date?
    private(set) var sleepAtEndOfVideo = false
    private(set) var isSpeedBoosted = false
    private(set) var videoFill = false
    private(set) var upNext: VideoItem?
    private(set) var upNextCountdown = 0
    /// Seconds left on the sleep timer (updated every second while it runs).
    private(set) var sleepRemaining: Int?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?

    /// Audio only: the picture is not downloaded at all (saves mobile data).
    private(set) var isAudioOnly = false
    /// What the user chose in the player during this session (wins over the automatic rule).
    @ObservationIgnored private var audioOnlyChoice: Bool?
    /// How the audio-only stream is played (for "Stats for nerds").
    @ObservationIgnored private var audioDescription = ""
    /// Audio playlists found in HLS manifests, by manifest URL and size.
    @ObservationIgnored private var audioPlaylists: [String: HLSAudio.Rendition] = [:]
    /// Languages of a dubbed video ("Bản âm thanh") and the one playing.
    private(set) var audioTracks: [AudioTrackOption] = []
    private(set) var currentAudioTrackID: String?
    /// Language picked by the user, kept for the next videos of this session.
    @ObservationIgnored private var preferredAudioLanguage: String?
    /// The current item plays an MP4 stream through the equalizer.
    private(set) var usesEqualizerStream = false
    @ObservationIgnored private var equalizerBlockedVideoId: String?
    @ObservationIgnored private var equalizerNoticeVideoId: String?
    /// Data sources of the equalizer stream (AVFoundation holds them weakly).
    @ObservationIgnored private var chunkLoaders: [ChunkedResourceLoader] = []
    /// Player volume = stable-volume gain × sleep-timer fade.
    @ObservationIgnored private var normalizationGain: Float = 1
    @ObservationIgnored private var fadeGain: Float = 1
    /// Ambient mode: a tiny copy of the current frame, refreshed every ~2 s.
    private(set) var ambientImage: UIImage?
    @ObservationIgnored private var ambientOutput: AVPlayerItemVideoOutput?
    @ObservationIgnored private var ambientTask: Task<Void, Never>?
    @ObservationIgnored private var ambientWanted = false
    @ObservationIgnored private var ambientThumbnailVideoId: String?
    @ObservationIgnored private let ambientQueue = DispatchQueue(label: "ambient.sampler", qos: .utility)
    /// Touches on the video are ignored until unlocked (YouTube's "Lock screen").
    var isScreenLocked = false
    /// "Stats for nerds" overlay.
    var showsStats = false

    /// Digital wellbeing reminders ("Take a break", bedtime).
    enum Reminder: Identifiable {
        case takeBreak, bedtime
        var id: Self { self }
    }
    var reminder: Reminder?
    @ObservationIgnored private var continuousWatch: Double = 0
    @ObservationIgnored private var lastPlayingAt = Date.distantPast
    @ObservationIgnored private var bedtimeSnoozedUntil = Date.distantPast
    @ObservationIgnored private var bedtimeDismissedNight: String?
    @ObservationIgnored private var wellbeingTask: Task<Void, Never>?
    @ObservationIgnored private var upNextTask: Task<Void, Never>?

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
        startWellbeingLoop()
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

    // MARK: Fullscreen

    /// Width / height of the video: from the stream's formats, else the picture being played.
    var videoAspectRatio: Double? {
        let formats = (playerInfo?.adaptiveFormats ?? []) + (playerInfo?.muxedFormats ?? [])
        if let format = formats.first(where: { $0.isVideo && ($0.width ?? 0) > 0 && ($0.height ?? 0) > 0 }),
           let width = format.width, let height = format.height {
            return Double(width) / Double(height)
        }
        if videoSize.width > 0, videoSize.height > 0 { return videoSize.width / videoSize.height }
        return nil
    }

    var isVerticalVideo: Bool {
        if let ratio = videoAspectRatio { return ratio < 1 }
        return currentVideo?.isShort == true
    }

    /// Like the official app: wide videos turn the screen sideways, vertical ones stay
    /// upright and fill the whole screen.
    func enterFullscreen() {
        if isVerticalVideo {
            isPortraitFullscreen = true
            OrientationController.setAllowed(.portrait)
        } else {
            OrientationController.rotate(toLandscape: true)
        }
    }

    func exitFullscreen() {
        resetFullscreenRotation()
        if isPortraitFullscreen {
            isPortraitFullscreen = false
            OrientationController.setAllowed(fullscreenOrientations)
        } else {
            OrientationController.rotate(toLandscape: false)
        }
    }

    /// Turns the fullscreen picture and controls a quarter turn, e.g. to watch lying down.
    /// The screen stays in its current orientation meanwhile, whichever way the phone is held.
    func rotateFullscreen(clockwise: Bool) {
        fullscreenQuarterTurns = (fullscreenQuarterTurns + (clockwise ? 1 : 3)) % 4
        if fullscreenQuarterTurns == 0 {
            OrientationController.setAllowed(fullscreenOrientations)
        } else {
            OrientationController.lockCurrent()
        }
    }

    func resetFullscreenRotation() {
        guard fullscreenQuarterTurns != 0 else { return }
        fullscreenQuarterTurns = 0
        OrientationController.setAllowed(fullscreenOrientations)
    }

    private var fullscreenOrientations: UIInterfaceOrientationMask {
        isExpanded && !isPortraitFullscreen ? .allButUpsideDown : .portrait
    }

    /// A wide video coming up in portrait fullscreen turns the screen sideways
    /// (unless the player was turned by hand).
    private func matchFullscreenToVideo() {
        guard isPortraitFullscreen, fullscreenQuarterTurns == 0, let ratio = videoAspectRatio, ratio > 1 else { return }
        isPortraitFullscreen = false
        OrientationController.rotate(toLandscape: true)
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

    /// "Play next": right after the current video.
    func playAfterCurrent(_ video: VideoItem) {
        guard let current = currentVideo else {
            play(video)
            return
        }
        guard video.id != current.id else { return }
        queue.removeAll { $0.id == video.id }
        queueIndex = queue.firstIndex { $0.id == current.id } ?? 0
        queue.insert(video, at: min(queueIndex + 1, queue.count))
        showToast("Sẽ phát tiếp theo")
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
        if isCasting {
            CastManager.shared.play()
            return
        }
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
        if isCasting {
            CastManager.shared.pause()
            saveProgress()
            return
        }
        if usesWebPlayer { webCommand("pauseVideo") }
        player.pause()
        saveProgress()
    }

    func seek(to seconds: Double) {
        let target = max(0, duration > 0 ? min(seconds, duration - 0.25) : seconds)
        currentTime = target
        if isCasting {
            CastManager.shared.seek(to: target)
            updateNowPlayingTime()
            return
        }
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
        if isCasting { CastManager.shared.stopMedia() }
        cancelUpNext()
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
        upNextTask?.cancel()
        upNext = nil
        isLooping = false
        isSpeedBoosted = false
        loadTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        currentVideo = video
        playerInfo = nil
        videoSize = .zero
        audioTracks = []
        currentAudioTrackID = nil
        usesEqualizerStream = false
        ambientImage = nil
        normalizationGain = 1
        applyVolume()
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
        isAudioOnly = wantsAudioOnly
        audioDescription = ""
        isLoading = true
        pendingSeek = startAt ?? (settings.resumePlayback ? library.resumePosition(for: video.id) : nil)
        if settings.saveHistory, !settings.isIncognito {
            library.recordWatch(video, position: pendingSeek ?? 0, duration: duration)
        }
        let interval = NSNumber(value: settings.doubleTapSeconds)
        MPRemoteCommandCenter.shared().skipForwardCommand.preferredIntervals = [interval]
        MPRemoteCommandCenter.shared().skipBackwardCommand.preferredIntervals = [interval]
        updateNowPlayingInfo()
        loadWatchInfo(video.id)

        if isCasting {
            // Plays on the TV; the phone only shows the controls.
            isLoading = false
            CastManager.shared.load(video, info: nil, startAt: pendingSeek ?? 0)
            pendingSeek = nil
            return
        }

        loadTask = Task { [weak self] in
            await self?.loadStream(for: video)
        }
    }

    private func defaultQuality() -> VideoQuality {
        var quality = NetworkMonitor.shared.isExpensive ? settings.cellularQuality : settings.wifiQuality
        // Data saver: at most 360p on mobile data.
        if settings.savesData, quality == .auto || quality.rawValue > 360 { quality = .p360 }
        return quality
    }

    /// Audio only for the next video: the user's choice in this session, otherwise the settings.
    private var wantsAudioOnly: Bool {
        audioOnlyChoice ?? (settings.audioOnlyMode || (settings.audioOnlyOnCellular && NetworkMonitor.shared.isExpensive))
    }

    /// Switches between video and audio only, continuing from the same position.
    func setAudioOnly(_ on: Bool) {
        audioOnlyChoice = on
        settings.audioOnlyMode = on
        guard on != isAudioOnly else { return }
        isAudioOnly = on
        showToast(on ? "Chỉ phát âm thanh — không tải hình, tiết kiệm dữ liệu" : "Đã bật lại hình")
        guard currentVideo != nil, !isCasting, !usesWebPlayer, !isLocalPlayback else { return }
        reloadStream()
    }

    /// Rebuilds the player item for the current video (after switching audio only).
    private func reloadStream() {
        guard let video = currentVideo else { return }
        let resumeAt = currentTime
        loadTask?.cancel()
        isLoading = true
        playbackError = nil
        quality = isAudioOnly ? quality : defaultQuality()
        loadTask = Task { [weak self] in
            guard let self else { return }
            if let info = self.playerInfo, info.videoId == video.id, info.availableAt <= Date() {
                self.fallbackStage = 0
                let item = await self.makeItem(info: info, stage: self.isAudioOnly ? -1 : 0)
                guard !Task.isCancelled, self.currentVideo?.id == video.id else { return }
                if let item {
                    self.pendingSeek = resumeAt
                    self.startItem(item)
                } else {
                    self.isLoading = false
                    self.playbackError = "Không phát được video."
                }
            } else {
                self.pendingSeek = resumeAt
                await self.loadStream(for: video)
            }
        }
    }

    /// The audio-only rendition of an HLS manifest (cached per manifest).
    private func audioRendition(master: URL) async -> HLSAudio.Rendition? {
        let preferSmall = settings.savesData
        let language = preferredAudioLanguage
        let key = master.absoluteString + (preferSmall ? "#small" : "#best") + "#" + (language ?? "")
        if let cached = audioPlaylists[key] { return cached }
        guard let result = try? await URLSession.shared.data(from: master),
              (result.1 as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        let text = String(decoding: result.0, as: UTF8.self)
        guard let rendition = HLSAudio.pick(from: text, base: master, preferSmall: preferSmall, language: language) else {
            Log.debug("audio only: the HLS manifest has no audio-only playlist")
            return nil
        }
        if audioPlaylists.count > 20 { audioPlaylists.removeAll() }
        audioPlaylists[key] = rendition
        return rendition
    }

    /// The AAC stream: the largest normally, the smallest with data saver on mobile data.
    private func audioFormat(in info: PlayerInfo) -> StreamFormat? {
        info.preferredAudio(language: preferredAudioLanguage, smallest: settings.savesData)
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
            if DownloadManager.shared.isAudioDownload(video.id) { isAudioOnly = true }
            let item = await localItem(local)
            guard !Task.isCancelled, currentVideo?.id == video.id else { return }
            startItem(item)
            return
        }
        do {
            let info = try await service.player(video.id)
            guard !Task.isCancelled, currentVideo?.id == video.id else { return }
            playerInfo = info
            matchFullscreenToVideo()
            updateAudioTracks(from: info)
            updateNormalization()
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

            guard let item = await makeItem(info: info, stage: isAudioOnly ? -1 : fallbackStage) else {
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

    /// Stage -1: audio only. Stage 0: HLS (adaptive, best). Stage 1: muxed progressive.
    /// Stage 2: video+audio composition.
    private func makeItem(info: PlayerInfo, stage: Int) async -> AVPlayerItem? {
        var stage = stage
        usesEqualizerStream = false
        if stage <= 0, settings.eqIsActive {
            if !info.isLive, equalizerBlockedVideoId != info.videoId, let item = await makeEqualizerItem(info: info) {
                return item
            }
            noteEqualizerUnavailable(info.videoId)
        }
        while stage <= 2 {
            switch stage {
            case -1:
                // Segmented HLS audio starts at once; the single progressive file is only
                // a fallback (YouTube sends it at about playback speed, so it starts slowly).
                if let hls = info.hlsURL, let rendition = await audioRendition(master: hls) {
                    fallbackStage = -1
                    audioDescription = "HLS" + (rendition.itag.map { " itag \($0)" } ?? "")
                    Log.debug("audio only \(info.videoId): \(audioDescription)")
                    return AVPlayerItem(url: rendition.url)
                }
                if let audio = audioFormat(in: info) {
                    fallbackStage = -1
                    audioDescription = "AAC \(audio.bitrate / 1000) kbps"
                    Log.debug("audio only \(info.videoId): progressive \(audioDescription)")
                    return AVPlayerItem(url: audio.url)
                }
            case 0:
                if let hls = info.hlsURL {
                    fallbackStage = 0
                    // Audio only without a separate audio stream (live): the smallest video.
                    if isAudioOnly { quality = .p144 }
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
        guard let video = info.bestVideo(maxHeight: quality.maxHeight ?? 1080),
              let audio = info.preferredAudio(language: preferredAudioLanguage) else {
            throw InnerTubeError.noStreams
        }
        let composition = try await Self.composition(video: AVURLAsset(url: video.url), audio: AVURLAsset(url: audio.url))
        return AVPlayerItem(asset: composition.asset)
    }

    /// Picture of one asset + sound of another, as one composition.
    private static func composition(video videoAsset: AVURLAsset, audio audioAsset: AVURLAsset) async throws
        -> (asset: AVMutableComposition, audioTrack: AVMutableCompositionTrack?) {
        // Both files are read at the same time: each needs its own round trips before playback.
        async let videoTracksLoad = videoAsset.loadTracks(withMediaType: .video)
        async let audioTracksLoad = audioAsset.loadTracks(withMediaType: .audio)
        async let videoDurationLoad = videoAsset.load(.duration)
        async let audioDurationLoad = audioAsset.load(.duration)
        let videoTracks = try await videoTracksLoad
        let audioTracks = try await audioTracksLoad
        let videoDuration = try await videoDurationLoad
        let audioDuration = try await audioDurationLoad
        guard let videoTrack = videoTracks.first, let audioTrack = audioTracks.first else {
            throw InnerTubeError.noStreams
        }
        let composition = AVMutableComposition()
        let length = CMTimeMinimum(videoDuration, audioDuration)
        let range = CMTimeRange(start: .zero, duration: length)
        try composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)?
            .insertTimeRange(range, of: videoTrack, at: .zero)
        let compositionAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        try compositionAudio?.insertTimeRange(range, of: audioTrack, at: .zero)
        return (composition, compositionAudio)
    }

    // MARK: Equalizer streams

    /// The same video as an MP4 stream with the equalizer tap (audio taps don't work on HLS).
    /// Data comes through `ChunkedResourceLoader` so it starts as fast as HLS.
    private func makeEqualizerItem(info: PlayerInfo) async -> AVPlayerItem? {
        do {
            if isAudioOnly {
                guard let format = audioFormat(in: info), let source = ChunkedResourceLoader.asset(for: format),
                      let track = try await source.asset.loadTracks(withMediaType: .audio).first,
                      let mix = EqualizerTap.audioMix(for: track) else { return nil }
                let item = AVPlayerItem(asset: source.asset)
                item.audioMix = mix
                chunkLoaders = [source.loader]
                fallbackStage = -1
                audioDescription = "AAC \(format.bitrate / 1000) kbps"
                usesEqualizerStream = true
                Log.debug("equalizer stream \(info.videoId): audio itag \(format.itag)")
                return item
            }
            if let video = info.bestVideo(maxHeight: quality.maxHeight ?? 1080),
               let audio = info.preferredAudio(language: preferredAudioLanguage),
               let videoSource = ChunkedResourceLoader.asset(for: video),
               let audioSource = ChunkedResourceLoader.asset(for: audio) {
                let composition = try await Self.composition(video: videoSource.asset, audio: audioSource.asset)
                if let track = composition.audioTrack, let mix = EqualizerTap.audioMix(for: track) {
                    let item = AVPlayerItem(asset: composition.asset)
                    item.audioMix = mix
                    chunkLoaders = [videoSource.loader, audioSource.loader]
                    fallbackStage = 2
                    usesEqualizerStream = true
                    Log.debug("equalizer stream \(info.videoId): video itag \(video.itag) + audio itag \(audio.itag)")
                    return item
                }
            }
            if let muxed = info.muxedFormats.filter({ $0.isH264 || $0.mimeType.contains("mp4") })
                .max(by: { ($0.height ?? 0) < ($1.height ?? 0) }),
               let source = ChunkedResourceLoader.asset(for: muxed),
               let track = try await source.asset.loadTracks(withMediaType: .audio).first,
               let mix = EqualizerTap.audioMix(for: track) {
                let item = AVPlayerItem(asset: source.asset)
                item.audioMix = mix
                chunkLoaders = [source.loader]
                fallbackStage = 1
                usesEqualizerStream = true
                Log.debug("equalizer stream \(info.videoId): muxed itag \(muxed.itag)")
                return item
            }
        } catch {
            Log.debug("equalizer stream \(info.videoId) failed: \(error.localizedDescription)")
        }
        return nil
    }

    /// A downloaded file, through the equalizer when it is on.
    private func localItem(_ url: URL) async -> AVPlayerItem {
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        usesEqualizerStream = false
        if settings.eqIsActive, let track = try? await asset.loadTracks(withMediaType: .audio).first,
           let mix = EqualizerTap.audioMix(for: track) {
            item.audioMix = mix
            usesEqualizerStream = true
        }
        return item
    }

    private func noteEqualizerUnavailable(_ videoId: String) {
        guard equalizerNoticeVideoId != videoId else { return }
        equalizerNoticeVideoId = videoId
        showToast("EQ không áp dụng được cho video này")
    }

    /// The equalizer was switched on/off (or to/from flat): change the stream if needed.
    /// Band changes while it is on apply live without this.
    func equalizerSettingsChanged() {
        guard let video = currentVideo, !isCasting, !usesWebPlayer, player.currentItem != nil else { return }
        let isLive = playerInfo?.isLive ?? video.isLive
        let wants = settings.eqIsActive && !isLive && equalizerBlockedVideoId != video.id
        guard wants != usesEqualizerStream else { return }
        if isLocalPlayback {
            guard let url = DownloadManager.shared.localFileURL(for: video.id) else { return }
            let resumeAt = currentTime
            loadTask?.cancel()
            loadTask = Task { [weak self] in
                guard let self else { return }
                let item = await self.localItem(url)
                guard !Task.isCancelled, self.currentVideo?.id == video.id else { return }
                self.pendingSeek = resumeAt
                self.startItem(item)
            }
            return
        }
        reloadStream()
    }

    // MARK: Audio tracks

    private func updateAudioTracks(from info: PlayerInfo) {
        audioTracks = info.audioTracks
        guard !audioTracks.isEmpty else {
            currentAudioTrackID = nil
            return
        }
        currentAudioTrackID = audioTracks.first { AudioLanguage.matches($0.id, preferredAudioLanguage) }?.id
            ?? audioTracks.first(where: \.isOriginal)?.id
            ?? audioTracks.first?.id
    }

    /// "Bản âm thanh": switches the dubbed language (and keeps it for the next videos).
    func selectAudioTrack(_ track: AudioTrackOption) {
        preferredAudioLanguage = track.id
        currentAudioTrackID = track.id
        showToast("Bản âm thanh: \(track.name)")
        guard currentVideo != nil, !isCasting, !usesWebPlayer, !isLocalPlayback else { return }
        if fallbackStage == 0, !usesEqualizerStream, let item = player.currentItem {
            Task { await applyAudioSelection(to: item) }
        } else {
            reloadStream()
        }
    }

    /// HLS: the audible media selection option in the preferred language. Also lists the
    /// languages when the stream info had no track names.
    private func applyAudioSelection(to item: AVPlayerItem) async {
        guard let group = try? await item.asset.loadMediaSelectionGroup(for: .audible), group.options.count > 1 else { return }
        if audioTracks.isEmpty {
            var seen = Set<String>()
            audioTracks = group.options.compactMap { option in
                let id = option.extendedLanguageTag ?? option.locale?.identifier ?? option.displayName
                guard seen.insert(id).inserted else { return nil }
                let name = option.displayName
                return AudioTrackOption(id: id, name: name, isOriginal: name.lowercased().contains("original"))
            }
            if audioTracks.count < 2 { audioTracks = [] }
            if currentAudioTrackID == nil {
                currentAudioTrackID = item.currentMediaSelection.selectedMediaOption(in: group)
                    .map { $0.extendedLanguageTag ?? $0.locale?.identifier ?? $0.displayName }
            }
        }
        guard let language = preferredAudioLanguage, item === player.currentItem else { return }
        let name = audioTracks.first { $0.id == language }?.name
        let option = group.options.first { AudioLanguage.matches($0.extendedLanguageTag ?? $0.locale?.identifier, language) }
            ?? group.options.first { $0.displayName == name }
        if let option { item.select(option, in: group) }
    }

    // MARK: Stable volume

    private func applyVolume() {
        player.volume = normalizationGain * fadeGain
    }

    /// Turns loud videos down to YouTube's reference loudness ("Âm lượng ổn định").
    func updateNormalization() {
        if settings.stableVolume, let loudness = playerInfo?.loudnessDb, loudness > 0 {
            normalizationGain = Float(min(1, pow(10, -loudness / 20)))
        } else {
            normalizationGain = 1
        }
        applyVolume()
    }

    // MARK: Most replayed

    /// Start of the most replayed part still ahead ("Tua tới đoạn hay").
    var jumpAheadTarget: Double? {
        guard let info = watchInfo, info.videoId == currentVideo?.id, currentVideo?.isLive != true,
              !info.heatMarkers.isEmpty else { return nil }
        let ahead = info.heatMarkers.filter { $0.start + $0.duration > currentTime }
        guard let top = ahead.max(by: { $0.intensity < $1.intensity }), top.intensity >= 0.6,
              top.start > currentTime + 10 else { return nil }
        return top.start
    }

    // MARK: Ambient mode

    /// Samples the picture for the ambient glow while the watch page shows it.
    func setAmbientSampling(_ on: Bool) {
        guard on != ambientWanted else { return }
        ambientWanted = on
        ambientTask?.cancel()
        ambientTask = nil
        guard on else { return }
        attachAmbientOutput(to: player.currentItem)
        loadAmbientThumbnail()
        ambientTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.sampleAmbientFrame()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func attachAmbientOutput(to item: AVPlayerItem?) {
        guard let item, ambientWanted, !isAudioOnly else { return }
        if let output = ambientOutput, item.outputs.contains(output) { return }
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
        ])
        item.add(output)
        ambientOutput = output
    }

    private func sampleAmbientFrame() {
        if ambientImage == nil { loadAmbientThumbnail() }
        guard let item = player.currentItem, let output = ambientOutput, item.outputs.contains(output),
              isPlaying || ambientImage == nil,
              let buffer = output.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil) else { return }
        let videoId = currentVideo?.id
        // Scaling and blurring happen off the main thread so scrolling never waits for them.
        ambientQueue.async { [weak self] in
            guard let image = AmbientSampler.tinyImage(from: buffer) else { return }
            DispatchQueue.main.async {
                guard let self, self.ambientWanted, self.currentVideo?.id == videoId else { return }
                self.ambientImage = image
            }
        }
    }

    /// Until a frame is available (or in audio-only mode): the glow of the thumbnail.
    private func loadAmbientThumbnail() {
        guard ambientWanted, ambientImage == nil, let video = currentVideo, ambientThumbnailVideoId != video.id,
              let url = video.displayThumbnail else { return }
        ambientThumbnailVideoId = video.id
        let queue = ambientQueue
        Task { [weak self] in
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return }
            let tiny: UIImage? = await withCheckedContinuation { continuation in
                queue.async {
                    continuation.resume(returning: UIImage(data: data).flatMap(AmbientSampler.tinyImage(from:)))
                }
            }
            guard let self, let tiny, self.ambientWanted, self.ambientImage == nil, self.currentVideo?.id == video.id else { return }
            self.ambientImage = tiny
        }
    }

    private func startItem(_ item: AVPlayerItem) {
        // Spectral keeps the pitch at every speed from 0.25x to 4x.
        item.audioTimePitchAlgorithm = .spectral
        if !usesEqualizerStream {
            chunkLoaders.forEach { $0.cancelAll() }
            chunkLoaders = []
        }
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
        guard settings.autoplay, let all = watchInfo?.related.videos else { return nil }
        let related = all.filter { !HiddenContentStore.shared.isHidden($0) }
        let recent = Set(library.history.prefix(50).map(\.id)).union(queue.map(\.id))
        return related.first { !recent.contains($0.id) && !$0.isLive && !$0.isShort } ?? related.first { !$0.isShort }
    }

    // MARK: - Observation

    private func observe(_ item: AVPlayerItem) {
        observations = [
            item.observe(\.status, options: [.new]) { [weak self] item, _ in
                Task { @MainActor in self?.handleStatus(of: item) }
            },
            item.observe(\.presentationSize, options: [.new]) { [weak self] item, _ in
                let size = item.presentationSize
                Task { @MainActor in
                    guard let self, item === self.player.currentItem, size.width > 0, size != self.videoSize else { return }
                    self.videoSize = size
                    self.matchFullscreenToVideo()
                }
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
            if fallbackStage == 0, !usesEqualizerStream {
                Task { await applyAudioSelection(to: item) }
            }
            // Only now: a video output attached before the first frame can delay the start.
            attachAmbientOutput(to: item)
        case .failed:
            let message = item.error?.localizedDescription ?? "Không phát được video."
            Log.debug("item failed at stage \(fallbackStage): \(item.error.map { String(describing: $0) } ?? "unknown")")
            if usesEqualizerStream, let info = playerInfo, !isLocalPlayback {
                // Back to the normal stream, without the equalizer for this video.
                equalizerBlockedVideoId = info.videoId
                let resumeAt = currentTime
                loadTask = Task { [weak self] in
                    guard let self else { return }
                    if let next = await self.makeItem(info: info, stage: self.isAudioOnly ? -1 : 0), !Task.isCancelled {
                        self.pendingSeek = resumeAt
                        self.startItem(next)
                    } else {
                        self.isLoading = false
                        self.playbackError = message
                    }
                }
            } else if let info = playerInfo, fallbackStage < 2, !isLocalPlayback {
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
        if isLooping {
            seek(to: 0)
            if isCasting { CastManager.shared.play() } else { player.playImmediately(atRate: rate) }
            return
        }
        if sleepAtEndOfVideo {
            sleepAtEndOfVideo = false
            isPlaying = false
            showToast("Đã hết giờ hẹn – tạm dừng phát")
            return
        }
        let hasQueued = queueIndex + 1 < queue.count
        guard settings.autoplay || hasQueued,
              let next = hasQueued ? queue[queueIndex + 1] : nextAutoplayVideo else {
            isPlaying = false
            return
        }
        // "Up next" card with a short countdown, like the official app.
        isPlaying = false
        upNext = next
        upNextCountdown = 5
        upNextTask?.cancel()
        upNextTask = Task { [weak self] in
            for remaining in stride(from: 5, through: 1, by: -1) {
                guard let self, !Task.isCancelled else { return }
                self.upNextCountdown = remaining
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
            guard let self, !Task.isCancelled, self.upNext != nil else { return }
            self.upNext = nil
            self.playNext()
        }
    }

    // MARK: - Player extras

    func cancelUpNext() {
        upNextTask?.cancel()
        upNext = nil
    }

    func playUpNextNow() {
        upNextTask?.cancel()
        upNext = nil
        playNext()
    }

    func setLooping(_ on: Bool) {
        isLooping = on
        showToast(on ? "Đã bật phát lặp lại" : "Đã tắt phát lặp lại")
    }

    /// `nil` turns the timer off, `0` stops at the end of the current video.
    func setSleepTimer(minutes: Int?) {
        sleepTask?.cancel()
        sleepTimerEnd = nil
        sleepRemaining = nil
        sleepAtEndOfVideo = false
        fadeGain = 1
        applyVolume()
        guard let minutes else {
            showToast("Đã tắt hẹn giờ")
            return
        }
        if minutes == 0 {
            sleepAtEndOfVideo = true
            showToast("Sẽ dừng khi hết video này")
            return
        }
        startSleepCountdown(until: Date().addingTimeInterval(Double(minutes) * 60))
        showToast(minutes >= 60 && minutes % 60 == 0
            ? "Video sẽ dừng sau \(minutes / 60) giờ"
            : "Video sẽ dừng sau \(minutes) phút")
    }

    /// Adds time to a running timer (or starts one).
    func extendSleepTimer(minutes: Int) {
        let base = max(sleepTimerEnd ?? Date(), Date())
        sleepTask?.cancel()
        sleepAtEndOfVideo = false
        fadeGain = 1
        applyVolume()
        startSleepCountdown(until: base.addingTimeInterval(Double(minutes) * 60))
        showToast("Đã thêm \(minutes) phút")
    }

    var sleepTimerLabel: String? {
        if sleepAtEndOfVideo { return "Hết video" }
        guard let remaining = sleepRemaining else { return nil }
        return formatTime(Double(remaining))
    }

    private func startSleepCountdown(until end: Date) {
        sleepTimerEnd = end
        sleepRemaining = max(Int(end.timeIntervalSinceNow.rounded(.up)), 0)
        sleepTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self, !Task.isCancelled else { return }
                let remaining = end.timeIntervalSinceNow
                self.sleepRemaining = max(Int(remaining.rounded(.up)), 0)
                // Fade the sound out over the last 10 seconds, like a sleep timer should.
                if remaining > 0, remaining <= 10 {
                    self.fadeGain = Float(remaining / 10)
                    self.applyVolume()
                }
                if remaining <= 0 {
                    self.sleepTimerEnd = nil
                    self.sleepRemaining = nil
                    self.pause()
                    self.fadeGain = 1
                    self.applyVolume()
                    self.showToast("Đã hết giờ hẹn — đã dừng phát")
                    return
                }
            }
        }
    }

    // MARK: - Digital wellbeing

    private func startWellbeingLoop() {
        wellbeingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                self?.wellbeingTick()
            }
        }
    }

    private static func nightKey(_ date: Date) -> String {
        WatchTimeStore.dayKey(date.addingTimeInterval(-12 * 3600))
    }

    private func wellbeingTick() {
        let now = Date()
        guard isPlaying else {
            // A long pause counts as a break.
            if now.timeIntervalSince(lastPlayingAt) > 15 * 60 { continuousWatch = 0 }
            return
        }
        lastPlayingAt = now
        WatchTimeStore.shared.add(seconds: 1, at: now)
        continuousWatch += 1
        guard reminder == nil, !isPiPActive, UIApplication.shared.applicationState == .active else { return }
        let breakMinutes = settings.breakReminderMinutes
        if breakMinutes > 0, continuousWatch >= Double(breakMinutes * 60) {
            continuousWatch = 0
            pause()
            reminder = .takeBreak
            return
        }
        if settings.bedtimeReminder, settings.isBedtime(now), now >= bedtimeSnoozedUntil,
           bedtimeDismissedNight != Self.nightKey(now) {
            pause()
            reminder = .bedtime
        }
    }

    /// `snoozeMinutes`: remind again later (bedtime); otherwise not again tonight.
    func dismissReminder(_ kind: Reminder, snoozeMinutes: Int? = nil) {
        if kind == .bedtime {
            if let snoozeMinutes {
                bedtimeSnoozedUntil = Date().addingTimeInterval(Double(snoozeMinutes) * 60)
            } else {
                bedtimeDismissedNight = Self.nightKey(Date())
            }
        }
        reminder = nil
    }

    // MARK: - Stats for nerds

    var playbackMethod: String {
        if isCasting { return "Chromecast" }
        if usesWebPlayer { return "Trình phát web" }
        let equalizer = usesEqualizerStream ? " + EQ" : ""
        if isLocalPlayback { return "Tệp đã tải xuống" + equalizer }
        switch fallbackStage {
        case -1: return "Chỉ âm thanh (\(audioDescription))" + equalizer
        case 0: return isAudioOnly ? "HLS 144p (chỉ âm thanh)" : "HLS"
        case 1: return "MP4 ghép sẵn" + equalizer
        default: return "Hình + tiếng ghép trên máy" + equalizer
        }
    }

    var statsLines: [(String, String)] {
        var lines: [(String, String)] = [
            ("Video", currentVideo?.id ?? "–"),
            ("Cách phát", playbackMethod),
        ]
        if let item = player.currentItem {
            let size = item.presentationSize
            if size.width > 0 { lines.append(("Độ phân giải", "\(Int(size.width))×\(Int(size.height))")) }
            if let event = item.accessLog()?.events.last {
                if event.indicatedBitrate > 0 { lines.append(("Bitrate luồng", "\(Int(event.indicatedBitrate / 1000)) kbps")) }
                if event.observedBitrate > 0 { lines.append(("Tốc độ mạng", "\(Int(event.observedBitrate / 1000)) kbps")) }
                if event.numberOfDroppedVideoFrames > 0 { lines.append(("Khung hình bị bỏ", "\(event.numberOfDroppedVideoFrames)")) }
                lines.append(("Đã tải", ByteCountFormatter.string(fromByteCount: event.numberOfBytesTransferred, countStyle: .file)))
            }
        }
        lines.append(("Bộ đệm", String(format: "%.1f giây", max(bufferedTime - currentTime, 0))))
        lines.append(("Chất lượng", quality.title))
        lines.append(("Tốc độ phát", String(format: "%gx", rate)))
        lines.append(("Mạng", NetworkMonitor.shared.isExpensive ? "Dữ liệu di động" : "Wi-Fi"))
        if settings.savesData { lines.append(("Tiết kiệm dữ liệu", "Đang bật")) }
        return lines
    }

    /// Touch and hold the video to watch at 2x until released.
    func beginSpeedBoost() {
        guard isPlaying, !usesWebPlayer, !isCasting, !isSpeedBoosted else { return }
        isSpeedBoosted = true
        player.rate = 2
    }

    func endSpeedBoost() {
        guard isSpeedBoosted else { return }
        isSpeedBoosted = false
        if isPlaying { player.rate = rate }
    }

    /// Pinch in fullscreen: fill the screen (cropping) or fit the whole picture.
    func setVideoFill(_ fill: Bool) {
        guard fill != videoFill else { return }
        videoFill = fill
        showToast(fill ? "Thu phóng để lấp đầy màn hình" : "Kích thước gốc")
    }

    func toggleAutoplay() {
        settings.autoplay.toggle()
        showToast(settings.autoplay ? "Tự động phát: Bật" : "Tự động phát: Tắt")
    }

    var autoplayEnabled: Bool { settings.autoplay }

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
        guard let video = currentVideo, currentTime > 0 || completed, !settings.isIncognito else { return }
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

    // MARK: - Chromecast

    var isCasting: Bool { CastManager.shared.isConnected }

    /// Sends the current video to a TV, continuing from the current position.
    func cast(to device: CastManager.Device) {
        CastManager.shared.connect(to: device, video: currentVideo, startAt: currentTime)
    }

    /// The TV took over: stop local playback (the phone becomes a remote).
    func castDidConnect() {
        loadTask?.cancel()
        if usesWebPlayer {
            webCommand("pauseVideo")
            usesWebPlayer = false
        }
        player.pause()
        player.replaceCurrentItem(with: nil)
        endSpeedBoost()
        isLoading = false
        isBuffering = false
        playbackError = nil
        adWaitRemaining = 0
        if let device = CastManager.shared.device { showToast("Đang phát trên \(device.name)") }
    }

    func applyCastStatus(time: Double, duration: Double?, playing: Bool, buffering: Bool) {
        guard currentVideo != nil else { return }
        currentTime = time
        if let duration, duration > 0 { self.duration = duration }
        isPlaying = playing
        isBuffering = buffering
        if time > 10, let id = currentVideo?.id {
            AccountStore.shared.reportWatched(id, duration: self.duration)
        }
        if Date().timeIntervalSince(lastHistorySave) > 10 { saveProgress() }
        updateNowPlayingTime()
    }

    func castDidFinish() {
        handleEnded()
    }

    /// Casting stopped: the phone continues from the same position when play is pressed.
    func castDidEnd() {
        isPlaying = false
        isBuffering = false
        saveProgress()
        updateNowPlayingTime()
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
        guard currentVideo != nil, !isCasting else { return }
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
        CastManager.shared.appWillEnterForeground()
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
            Task { @MainActor in self?.skip(by: Double(AppSettings.shared.doubleTapSeconds)) }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skip(by: -Double(AppSettings.shared.doubleTapSeconds)) }
            return .success
        }
    }

    private func updateNowPlayingInfo() {
        guard let video = currentVideo else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: video.title,
            MPMediaItemPropertyArtist: video.channelName ?? "",
            MPNowPlayingInfoPropertyMediaType: (isAudioOnly ? MPNowPlayingInfoMediaType.audio : .video).rawValue,
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
