import AVKit
import SwiftUI

/// Video + YouTube-style controls (tap to show, double tap to skip 10 s, scrubber,
/// quality/speed/captions, AirPlay, PiP, fullscreen).
struct PlayerSurface: View {
    enum Mode { case mini, inline, fullscreen }

    let mode: Mode
    let insets: EdgeInsets

    @Environment(PlayerManager.self) private var player
    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var skipFeedback: SkipFeedback?
    @State private var feedbackTask: Task<Void, Never>?
    @State private var showSettings = false
    @State private var showSleepTimer = false
    @State private var scrubTime: Double?
    @State private var showUnlock = false
    /// Fullscreen swipe on the left (brightness) or right (volume) edge, shown live.
    @State private var swipeTarget: SwipeTarget?
    @State private var swipeStartValue: Double = 0
    @State private var swipeHUD: SwipeControl?
    @State private var swipeHideTask: Task<Void, Never>?

    private enum SwipeTarget { case brightness, volume, none }

    private struct SkipFeedback: Equatable {
        var forward: Bool
        var seconds: Int
    }

    var body: some View {
        ZStack {
            if player.usesWebPlayer, let videoId = player.currentVideo?.id {
                WebPlayerView(
                    videoId: videoId,
                    startAt: player.webStartTime,
                    onEvent: { player.handleWebEvent($0) },
                    onWebView: { player.registerWebView($0) }
                )
                .allowsHitTesting(mode != .mini)
            } else {
                PlayerLayerView(
                    player: player.player,
                    gravity: mode == .fullscreen && player.videoFill ? .resizeAspectFill : .resizeAspect
                ) { layer in
                    player.attach(layer: layer)
                }
            }

            if player.isCasting {
                CastingBackdrop(compact: mode == .mini)
            } else if player.isAudioOnly && !player.usesWebPlayer {
                AudioOnlyBackdrop(compact: mode == .mini)
            } else if showPoster {
                RemoteImage(url: player.currentVideo?.displayThumbnail, contentMode: .fit)
                    .background(Color.black)
            }

            if mode == .mini {
                if player.isLoading || player.isBuffering {
                    ProgressView().tint(.white)
                }
            } else if player.usesWebPlayer {
                webPlayerChrome
                if player.isLoading && player.playbackError == nil {
                    ProgressView().controlSize(.large).tint(.white).allowsHitTesting(false)
                }
                if let error = player.playbackError { errorOverlay(error) }
            } else {
                captionLayer
                gestureLayer
                if !player.isScreenLocked, controlsVisible || player.playbackError != nil || (!player.isPlaying && !player.isLoading) {
                    controls
                        .transition(.opacity)
                }
                if (player.isLoading || player.isBuffering) && player.playbackError == nil && player.adWaitRemaining == 0 {
                    ProgressView()
                        .controlSize(.large)
                        .tint(.white)
                        .allowsHitTesting(false)
                }
                if player.adWaitRemaining > 0 { adWaitBanner }
                if let error = player.playbackError { errorOverlay(error) }
                if let skipFeedback { skipFeedbackView(skipFeedback) }
                if player.isSpeedBoosted { speedBoostBadge }
                if let next = player.upNext { upNextOverlay(next) }
            }
            if mode != .mini {
                if player.showsStats { StatsOverlay().padding(mode == .fullscreen ? 24 : 8) }
                if player.isScreenLocked { lockOverlay }
                if mode == .fullscreen, let swipeHUD {
                    VStack {
                        SwipeControlHUD(control: swipeHUD)
                            .padding(.top, max(insets.top, 16) + 24)
                        Spacer()
                    }
                    .allowsHitTesting(false)
                    .transition(.opacity)
                }
            }
        }
        .background(Color.black)
        .clipped()
        .animation(.easeInOut(duration: 0.2), value: controlsVisible)
        .sheet(isPresented: $showSettings) {
            PlayerSettingsSheet()
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showSleepTimer) {
            NavigationStack { SleepTimerView() }
                .presentationDetents([.medium, .large])
        }
        .onChange(of: player.isPlaying) { _, playing in
            if playing { scheduleHide() } else { controlsVisible = true }
        }
        .onChange(of: player.isScreenLocked) { _, locked in
            if locked { controlsVisible = false }
        }
        .onChange(of: player.currentVideo?.id) { _, _ in
            controlsVisible = true
            scheduleHide()
        }
    }

    /// Minimal overlay for the web fallback (the embed draws its own controls).
    private var webPlayerChrome: some View {
        VStack {
            HStack {
                Button {
                    if mode == .fullscreen {
                        player.exitFullscreen()
                    } else {
                        withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) { player.isExpanded = false }
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Color.black.opacity(0.5)))
                }
                Spacer()
                Menu {
                    if let reason = player.webFallbackReason {
                        Text(reason)
                    }
                    Button {
                        player.switchToNativePlayer()
                    } label: {
                        Label("Thử lại trình phát gốc", systemImage: "arrow.clockwise")
                    }
                    Button {
                        toggleFullscreen()
                    } label: {
                        Label(mode == .fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình",
                              systemImage: "arrow.up.left.and.arrow.down.right")
                    }
                    if mode == .fullscreen {
                        Button {
                            player.rotateFullscreen(clockwise: false)
                        } label: {
                            Label("Xoay ngược chiều kim đồng hồ", systemImage: "rotate.left")
                        }
                        Button {
                            player.rotateFullscreen(clockwise: true)
                        } label: {
                            Label("Xoay theo chiều kim đồng hồ", systemImage: "rotate.right")
                        }
                    }
                } label: {
                    Label("Trình phát web", systemImage: "globe")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color.black.opacity(0.5)))
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, mode == .fullscreen ? max(insets.leading, 12) : 6)
            .padding(.top, mode == .fullscreen ? max(insets.top, 6) : 6)
            Spacer()
        }
    }

    private func toggleFullscreen() {
        if mode == .fullscreen { player.exitFullscreen() } else { player.enterFullscreen() }
    }

    private var showPoster: Bool {
        if player.isRestoredSession { return true }
        return player.currentTime < 0.1 && !player.isPlaying && player.playbackError == nil
            && (player.isLoading || player.adWaitRemaining > 0)
    }

    // MARK: Gestures

    private var gestureLayer: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                tapRegion(forward: false)
                tapRegion(forward: true)
            }
            // Fullscreen: a vertical swipe on the left edge sets the brightness, on the right edge
            // the volume. Simultaneous with the taps, so the bar follows the finger as it moves.
            .simultaneousGesture(
                swipeControlGesture(size: geo.size),
                including: mode == .fullscreen && AppSettings.shared.swipeControls && !player.isScreenLocked ? .all : .subviews
            )
        }
        // Touch and hold: 2x speed until the finger is lifted.
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.45)
                .sequenced(before: DragGesture(minimumDistance: 0))
                .onChanged { value in
                    if case .second(true, _) = value { player.beginSpeedBoost() }
                }
                .onEnded { _ in player.endSpeedBoost() }
        )
        // Pinch in fullscreen to fill the screen or fit the whole picture.
        .gesture(
            MagnifyGesture().onEnded { value in
                player.setVideoFill(value.magnification > 1)
            },
            including: mode == .fullscreen ? .all : .subviews
        )
    }

    private var speedBoostBadge: some View {
        VStack {
            Label("2x", systemImage: "forward.fill")
                .font(.caption.weight(.bold))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.black.opacity(0.6)))
                .foregroundStyle(.white)
                .padding(.top, mode == .fullscreen ? max(insets.top, 20) : 10)
            Spacer()
        }
        .allowsHitTesting(false)
    }

    private func upNextOverlay(_ next: VideoItem) -> some View {
        let thumbWidth: CGFloat = mode == .fullscreen ? 220 : 110
        return ZStack {
            Color.black.opacity(0.8)
            VStack(spacing: mode == .fullscreen ? 14 : 8) {
                Text("Tiếp theo sau \(player.upNextCountdown) giây")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
                HStack(spacing: 12) {
                    RemoteImage(url: next.displayThumbnail)
                        .frame(width: thumbWidth, height: thumbWidth * 9 / 16)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(next.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        Text(next.channelName ?? "")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: 260, alignment: .leading)
                }
                HStack(spacing: 12) {
                    Button("Hủy") { player.cancelUpNext() }
                        .buttonStyle(.bordered)
                        .tint(.white)
                    Button {
                        player.playUpNextNow()
                    } label: {
                        Label("Phát ngay", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .controlSize(.small)
            }
            .foregroundStyle(.white)
            .padding()
        }
    }

    /// "Lock screen": every touch is ignored except the unlock button.
    private var lockOverlay: some View {
        ZStack {
            Color.black.opacity(0.001)
                .contentShape(Rectangle())
                .onTapGesture {
                    withAnimation { showUnlock = true }
                    Task {
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        withAnimation { showUnlock = false }
                    }
                }
            if showUnlock {
                Button {
                    player.isScreenLocked = false
                    showUnlock = false
                    controlsVisible = true
                    scheduleHide()
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "lock.open.fill").font(.title2)
                        Text("Nhấn để mở khóa").font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(16)
                    .background(Circle().fill(Color.black.opacity(0.6)).frame(width: 130, height: 130))
                }
                .buttonStyle(.plain)
                .transition(.opacity)
            }
        }
    }

    private func swipeControlGesture(size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                if swipeTarget == nil {
                    let fraction = value.startLocation.x / max(size.width, 1)
                    if abs(value.translation.height) <= abs(value.translation.width) {
                        swipeTarget = SwipeTarget.none
                    } else if fraction < 0.35 {
                        swipeTarget = .brightness
                        swipeStartValue = ScreenBrightness.value
                    } else if fraction > 0.65 {
                        swipeTarget = .volume
                        swipeStartValue = SystemVolume.shared.value
                    } else {
                        swipeTarget = SwipeTarget.none
                    }
                }
                guard let target = swipeTarget, target != .none else { return }
                let level = min(max(swipeStartValue - Double(value.translation.height / max(size.height * 0.7, 1)), 0), 1)
                swipeHideTask?.cancel()
                if target == .brightness {
                    ScreenBrightness.set(level)
                    swipeHUD = .brightness(level)
                } else {
                    SystemVolume.shared.set(level)
                    swipeHUD = .volume(level)
                }
            }
            .onEnded { _ in
                let wasControlling = swipeTarget == .brightness || swipeTarget == .volume
                swipeTarget = nil
                guard wasControlling else { return }
                swipeHideTask?.cancel()
                swipeHideTask = Task {
                    try? await Task.sleep(nanoseconds: 800_000_000)
                    guard !Task.isCancelled else { return }
                    withAnimation { swipeHUD = nil }
                }
            }
    }

    private func tapRegion(forward: Bool) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                let seconds = Double(AppSettings.shared.doubleTapSeconds)
                player.skip(by: forward ? seconds : -seconds)
                showSkipFeedback(forward: forward)
            }
            .onTapGesture {
                controlsVisible.toggle()
                if controlsVisible { scheduleHide() }
            }
    }

    private func showSkipFeedback(forward: Bool) {
        let seconds = (skipFeedback?.forward == forward ? skipFeedback?.seconds ?? 0 : 0) + AppSettings.shared.doubleTapSeconds
        skipFeedback = SkipFeedback(forward: forward, seconds: seconds)
        feedbackTask?.cancel()
        feedbackTask = Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { skipFeedback = nil }
        }
    }

    private func skipFeedbackView(_ feedback: SkipFeedback) -> some View {
        HStack {
            if feedback.forward { Spacer() }
            VStack(spacing: 4) {
                Image(systemName: feedback.forward ? "goforward" : "gobackward")
                    .font(.title2.weight(.semibold))
                Text("\(feedback.seconds) giây")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(18)
            .background(Circle().fill(Color.black.opacity(0.45)))
            .padding(.horizontal, 36)
            if !feedback.forward { Spacer() }
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, player.isPlaying, scrubTime == nil, !showSettings, !showSleepTimer else { return }
            controlsVisible = false
        }
    }

    // MARK: Controls

    private var controls: some View {
        ZStack {
            Color.black.opacity(0.45)
                .allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                centerButtons
                Spacer(minLength: 0)
                bottomBar
            }
            .padding(.leading, mode == .fullscreen ? max(insets.leading, 16) : 4)
            .padding(.trailing, mode == .fullscreen ? max(insets.trailing, 16) : 4)
            .padding(.top, mode == .fullscreen ? max(insets.top, 12) : 2)
            .padding(.bottom, mode == .fullscreen ? max(insets.bottom, 12) : 0)
        }
        .foregroundStyle(.white)
    }

    private var topBar: some View {
        HStack(spacing: 6) {
            if mode == .fullscreen {
                Button {
                    player.exitFullscreen()
                } label: {
                    Image(systemName: "chevron.down").controlIcon()
                }
                Text(player.currentVideo?.title ?? "")
                    .font(.headline)
                    .lineLimit(1)
            } else {
                Button {
                    withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) { player.isExpanded = false }
                } label: {
                    Image(systemName: "chevron.down").controlIcon()
                }
            }
            if let label = player.sleepTimerLabel {
                Button {
                    showSleepTimer = true
                } label: {
                    Label(label, systemImage: "moon.zzz.fill")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color.black.opacity(0.5)))
                }
            }
            Spacer()
            if !player.isCasting, !player.isLocalPlayback {
                Button {
                    player.setAudioOnly(!player.isAudioOnly)
                } label: {
                    Image(systemName: player.isAudioOnly ? "headphones.circle.fill" : "headphones")
                        .controlIcon()
                }
                .accessibilityLabel(player.isAudioOnly ? "Bật lại hình" : "Chỉ phát âm thanh")
            }
            Button {
                player.toggleAutoplay()
            } label: {
                Image(systemName: player.autoplayEnabled ? "autostartstop" : "autostartstop.slash")
                    .controlIcon()
            }
            CastButton()
            RoutePickerView()
                .frame(width: 36, height: 36)
            if !player.captionTracks.isEmpty, !player.isCasting {
                Button {
                    if player.selectedCaption == nil {
                        let preferred = AppSettings.shared.captionLanguage
                        let track = player.captionTracks.first { $0.languageCode.hasPrefix(preferred) }
                            ?? player.captionTracks.first
                        let translate = track.map { !$0.languageCode.hasPrefix(preferred) && $0.isTranslatable } ?? false
                        player.selectCaption(track, translateTo: translate ? preferred : nil)
                    } else {
                        player.selectCaption(nil)
                    }
                } label: {
                    Image(systemName: player.selectedCaption == nil ? "captions.bubble" : "captions.bubble.fill")
                        .controlIcon()
                }
            }
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape").controlIcon()
            }
        }
        .buttonStyle(.plain)
    }

    private var centerButtons: some View {
        HStack(spacing: mode == .fullscreen ? 72 : 48) {
            Button { player.playPrevious() } label: {
                Image(systemName: "backward.end.fill")
                    .font(.title2)
                    .opacity(player.hasPrevious ? 1 : 0.4)
            }
            .disabled(!player.hasPrevious)

            Button { player.togglePlayPause() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: mode == .fullscreen ? 44 : 36))
                    .frame(width: 64, height: 64)
                    .opacity(player.isLoading && !player.isPlaying ? 0 : 1)
            }

            Button { player.playNext() } label: {
                Image(systemName: "forward.end.fill")
                    .font(.title2)
                    .opacity(player.hasNext ? 1 : 0.4)
            }
            .disabled(!player.hasNext)
        }
        .buttonStyle(.plain)
    }

    private var bottomBar: some View {
        VStack(spacing: 2) {
            HStack(spacing: 8) {
                if player.currentVideo?.isLive == true {
                    Label("TRỰC TIẾP", systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.brand)
                } else {
                    Text("\(formatTime(scrubTime ?? player.currentTime)) / \(formatTime(player.duration))")
                        .font(.caption.monospacedDigit())
                }
                if let chapter = currentChapter {
                    Text("• \(chapter.title)")
                        .font(.caption)
                        .lineLimit(1)
                }
                if let target = player.jumpAheadTarget, scrubTime == nil {
                    Button {
                        player.seek(to: target)
                        scheduleHide()
                    } label: {
                        Label("Tua tới đoạn hay", systemImage: "forward.fill")
                            .font(.caption2.weight(.semibold))
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(Color.white.opacity(0.22)))
                    }
                    .fixedSize()
                    .accessibilityHint("Tua tới đoạn được xem lại nhiều nhất")
                }
                Spacer()
                if player.isPiPPossible {
                    Button { player.togglePictureInPicture() } label: {
                        Image(systemName: "pip.enter").controlIcon(size: 17)
                    }
                }
                Button {
                    player.isScreenLocked = true
                } label: {
                    Image(systemName: "lock").controlIcon(size: 17)
                }
                .accessibilityLabel("Khóa màn hình")
                if mode == .fullscreen {
                    Button { player.rotateFullscreen(clockwise: false) } label: {
                        Image(systemName: "rotate.left").controlIcon(size: 17)
                    }
                    .accessibilityLabel("Xoay ngược chiều kim đồng hồ")
                    Button { player.rotateFullscreen(clockwise: true) } label: {
                        Image(systemName: "rotate.right").controlIcon(size: 17)
                    }
                    .accessibilityLabel("Xoay theo chiều kim đồng hồ")
                }
                Button {
                    toggleFullscreen()
                } label: {
                    Image(systemName: mode == .fullscreen
                        ? "arrow.down.right.and.arrow.up.left"
                        : "arrow.up.left.and.arrow.down.right")
                        .controlIcon(size: 17)
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)

            if player.currentVideo?.isLive != true {
                if let info = player.watchInfo, info.videoId == player.currentVideo?.id,
                   !info.heatMarkers.isEmpty, player.duration > 0 {
                    // "Most replayed": how much each part of the video is rewatched.
                    HeatmapGraph(markers: info.heatMarkers, duration: player.duration)
                        .fill(Color.white.opacity(scrubTime == nil ? 0.3 : 0.55))
                        .frame(height: mode == .fullscreen ? 36 : 24)
                        .padding(.horizontal, mode == .fullscreen ? 4 : 0)
                        .padding(.bottom, -14)
                        .allowsHitTesting(false)
                        .animation(.easeInOut(duration: 0.2), value: scrubTime == nil)
                }
                SeekBar(
                    current: player.currentTime,
                    duration: player.duration,
                    buffered: player.bufferedTime,
                    segments: player.sponsorSegments,
                    chapters: player.watchInfo?.chapters ?? [],
                    onScrub: { time in
                        scrubTime = time
                        if time == nil { scheduleHide() }
                    },
                    onSeek: { time in player.seek(to: time) }
                )
                .padding(.horizontal, mode == .fullscreen ? 4 : 0)
                .overlay(alignment: .bottomLeading) {
                    if let time = scrubTime, let storyboard = player.playerInfo?.storyboard, player.duration > 0 {
                        GeometryReader { geo in
                            let width: CGFloat = mode == .fullscreen ? 200 : 140
                            let height = width * CGFloat(storyboard.height) / CGFloat(storyboard.width)
                            let x = min(max(geo.size.width * CGFloat(time / player.duration) - width / 2, 0), max(geo.size.width - width, 0))
                            StoryboardPreview(storyboard: storyboard, time: time, duration: player.duration)
                                .frame(width: width, height: height + 20)
                                .offset(x: x, y: -(height + 26))
                        }
                        .allowsHitTesting(false)
                    }
                }
            }
        }
    }

    private var currentChapter: Chapter? {
        let time = Int(scrubTime ?? player.currentTime)
        return player.watchInfo?.chapters.last { $0.startSeconds <= time }
    }

    // MARK: Overlays

    private var captionLayer: some View {
        VStack {
            Spacer()
            if let caption = player.currentCaption {
                let style = AppSettings.shared
                Text(caption)
                    .font(.system(size: (mode == .fullscreen ? 20 : 15) * style.captionSize.scale, weight: .medium))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .shadow(color: .black, radius: style.captionBackground < 0.3 ? 2 : 0)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 4).fill(Color.black.opacity(style.captionBackground)))
                    .padding(.bottom, (controlsVisible ? (mode == .fullscreen ? 72 : 44) : 12)
                        + (mode == .fullscreen ? insets.bottom : 0))
                    .padding(.horizontal, 24)
            }
        }
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 0.2), value: controlsVisible)
    }

    private var adWaitBanner: some View {
        VStack(spacing: 8) {
            Image(systemName: "hand.raised.slash.fill")
                .font(.title2)
            Text("Không có quảng cáo — YouTube yêu cầu chờ \(player.adWaitRemaining) giây")
                .font(.footnote.weight(.medium))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(.white)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.7)))
        .padding()
        .allowsHitTesting(false)
    }

    private func errorOverlay(_ message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.title2)
            Text(message)
                .font(.footnote)
                .multilineTextAlignment(.center)
                .lineLimit(4)
            HStack {
                Button("Thử lại") {
                    if player.usesWebPlayer { player.switchToNativePlayer() } else { player.retry() }
                }
                .buttonStyle(.borderedProminent)
                if !player.usesWebPlayer, AppSettings.shared.webPlayerFallback {
                    Button("Trình phát web") { player.switchToWebPlayer(reason: message) }
                        .buttonStyle(.bordered)
                        .tint(.white)
                }
            }
            .controlSize(.small)
        }
        .foregroundStyle(.white)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
}

private extension Image {
    func controlIcon(size: CGFloat = 19) -> some View {
        font(.system(size: size, weight: .semibold))
            .frame(width: 38, height: 38)
            .contentShape(Rectangle())
    }
}

struct SeekBar: View {
    let current: Double
    let duration: Double
    let buffered: Double
    let segments: [SponsorSegment]
    let chapters: [Chapter]
    var onScrub: (Double?) -> Void
    var onSeek: (Double) -> Void

    @State private var dragTime: Double?

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let total = max(duration, 0.001)
            let shown = dragTime ?? current
            let fraction = CGFloat(min(max(shown / total, 0), 1))
            let barHeight: CGFloat = dragTime == nil ? 3 : 5
            let knob: CGFloat = dragTime == nil ? 12 : 18

            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.3)).frame(height: barHeight)
                Capsule().fill(Color.white.opacity(0.55))
                    .frame(width: width * CGFloat(min(max(buffered / total, 0), 1)), height: barHeight)
                ForEach(segments, id: \.start) { segment in
                    Rectangle()
                        .fill(Color.green.opacity(0.9))
                        .frame(width: max(2, width * CGFloat((segment.end - segment.start) / total)), height: barHeight)
                        .offset(x: width * CGFloat(segment.start / total))
                }
                Capsule().fill(Color.brand).frame(width: width * fraction, height: barHeight)
                ForEach(chapters.dropFirst()) { chapter in
                    Rectangle()
                        .fill(Color.black.opacity(0.8))
                        .frame(width: 2, height: barHeight)
                        .offset(x: width * CGFloat(Double(chapter.startSeconds) / total))
                }
                Circle()
                    .fill(Color.brand)
                    .frame(width: knob, height: knob)
                    .offset(x: width * fraction - knob / 2)
            }
            .frame(height: 28)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let time = Double(min(max(value.location.x / max(width, 1), 0), 1)) * duration
                        dragTime = time
                        onScrub(time)
                    }
                    .onEnded { value in
                        let time = Double(min(max(value.location.x / max(width, 1), 0), 1)) * duration
                        onSeek(time)
                        dragTime = nil
                        onScrub(nil)
                    }
            )
            .animation(.easeOut(duration: 0.15), value: dragTime == nil)
        }
        .frame(height: 28)
    }
}

/// YouTube's "Most replayed" graph: a smooth outline over the seek bar.
struct HeatmapGraph: Shape {
    let markers: [HeatMarker]
    let duration: Double

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard duration > 0, !markers.isEmpty else { return path }
        let points = markers.map { marker in
            CGPoint(x: rect.minX + rect.width * CGFloat(min((marker.start + marker.duration / 2) / duration, 1)),
                    y: rect.maxY - rect.height * CGFloat(marker.intensity))
        }
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: points[0].y))
        var previous = CGPoint(x: rect.minX, y: points[0].y)
        for point in points {
            let middle = CGPoint(x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2)
            path.addQuadCurve(to: middle, control: previous)
            previous = point
        }
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: previous.y), control: previous)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

struct PlayerSettingsSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Chất lượng") {
                    ForEach(VideoQuality.allCases) { quality in
                        checkRow(quality.title, selected: player.quality == quality) {
                            player.setQuality(quality)
                        }
                    }
                }
                Section {
                    Toggle(isOn: Binding(get: { player.isAudioOnly }, set: { player.setAudioOnly($0) })) {
                        Label("Chỉ phát âm thanh", systemImage: "headphones")
                    }
                    .disabled(player.isCasting || player.usesWebPlayer)
                    NavigationLink {
                        SleepTimerView()
                    } label: {
                        HStack {
                            Label("Hẹn giờ tắt", systemImage: "moon.zzz")
                            Spacer()
                            Text(player.sleepTimerLabel ?? "Tắt").foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    Button {
                        player.isScreenLocked = true
                        dismiss()
                    } label: {
                        Label("Khóa màn hình", systemImage: "lock")
                    }
                    Toggle(isOn: Binding(get: { player.showsStats }, set: { player.showsStats = $0 })) {
                        Label("Thống kê chi tiết", systemImage: "chart.bar.doc.horizontal")
                    }
                } footer: {
                    Text("Chỉ phát âm thanh không tải hình ảnh nên tốn ít dữ liệu 4G hơn nhiều (khoảng 1 MB/phút, hoặc 0,4 MB/phút khi bật Tiết kiệm dữ liệu).")
                }
                if !player.audioTracks.isEmpty {
                    Section("Bản âm thanh") {
                        ForEach(player.audioTracks) { track in
                            let lowered = track.name.lowercased()
                            let marked = track.isOriginal && !lowered.contains("original") && !lowered.contains("gốc")
                            checkRow(track.name + (marked ? " (gốc)" : ""), selected: player.currentAudioTrackID == track.id) {
                                player.selectAudioTrack(track)
                            }
                        }
                    }
                }
                Section {
                    NavigationLink {
                        EqualizerView()
                    } label: {
                        HStack {
                            Label("Bộ chỉnh âm (EQ)", systemImage: "slider.vertical.3")
                            Spacer()
                            Text(settings.eqPresetName).foregroundStyle(.secondary)
                        }
                    }
                    Toggle(isOn: Binding(
                        get: { settings.stableVolume },
                        set: {
                            settings.stableVolume = $0
                            player.updateNormalization()
                        }
                    )) {
                        Label("Âm lượng ổn định", systemImage: "speaker.wave.2")
                    }
                } header: {
                    Text("Âm thanh")
                } footer: {
                    Text("Âm lượng ổn định giảm tiếng các video quá to về cùng mức với các video khác.")
                }
                Section("Tốc độ phát") {
                    ForEach(AppSettings.speeds, id: \.self) { speed in
                        checkRow(speed == 1 ? "Bình thường" : String(format: "%gx", speed), selected: abs(Double(player.rate) - speed) < 0.01) {
                            player.setRate(Float(speed))
                        }
                    }
                    VStack(alignment: .leading) {
                        Text("Tùy chỉnh: \(String(format: "%.2fx", player.rate))")
                            .font(.subheadline)
                        Slider(
                            value: Binding(get: { Double(player.rate) }, set: { player.setRate(Float(($0 * 20).rounded() / 20)) }),
                            in: 0.25...4, step: 0.05
                        )
                    }
                }
                Section("Phụ đề") {
                    checkRow("Tắt", selected: player.selectedCaption == nil) { player.selectCaption(nil) }
                    ForEach(player.captionTracks) { track in
                        checkRow(track.name, selected: player.selectedCaption == track && player.captionTranslation == nil) {
                            player.selectCaption(track)
                        }
                    }
                    if let source = player.captionTracks.first(where: \.isTranslatable) {
                        let language = AppSettings.shared.captionLanguage
                        let name = AppSettings.languages.first { $0.code == language }?.name ?? language
                        checkRow("Tự động dịch → \(name)", selected: player.captionTranslation == language) {
                            player.selectCaption(source, translateTo: language)
                        }
                    }
                    if player.captionTracks.isEmpty {
                        Text("Video này không có phụ đề").foregroundStyle(.secondary)
                    }
                }
                Section("Khác") {
                    Toggle("Phát lặp lại", isOn: Binding(
                        get: { player.isLooping },
                        set: { player.setLooping($0) }
                    ))
                }
                Section {
                    if player.usesWebPlayer {
                        Button("Thử lại trình phát gốc (không quảng cáo)") {
                            player.switchToNativePlayer()
                            dismiss()
                        }
                    } else {
                        Button("Chuyển sang trình phát web") {
                            player.switchToWebPlayer(reason: "Chọn thủ công")
                            dismiss()
                        }
                    }
                } header: {
                    Text("Trình phát")
                } footer: {
                    Text("Trình phát web là phương án dự phòng khi YouTube từ chối luồng phát gốc; quảng cáo trong đó được tự động ẩn và bỏ qua.")
                }
                if !player.sponsorSegments.isEmpty {
                    Section("SponsorBlock") {
                        ForEach(player.sponsorSegments, id: \.start) { segment in
                            Button {
                                player.seek(to: segment.start)
                                dismiss()
                            } label: {
                                HStack {
                                    Text(SponsorBlock.title(for: segment.category))
                                    Spacer()
                                    Text("\(formatTime(segment.start)) – \(formatTime(segment.end))")
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Tùy chọn phát")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Xong") { dismiss() }
                }
            }
        }
    }

    private func checkRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title).foregroundStyle(.primary)
                Spacer()
                if selected {
                    Image(systemName: "checkmark").foregroundStyle(Color.brand)
                }
            }
        }
    }
}

/// One frame of the storyboard sprite sheet, shown above the scrubber while seeking.
struct StoryboardPreview: View {
    let storyboard: Storyboard
    let time: Double
    let duration: Double

    @State private var sheet: UIImage?
    @State private var sheetURL: URL?

    var body: some View {
        let frame = storyboard.frame(at: time, duration: duration)
        VStack(spacing: 4) {
            ZStack {
                Rectangle().fill(Color.black)
                if let frame, sheetURL == frame.url, let image = crop(frame.rect) {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                }
            }
            .aspectRatio(CGFloat(storyboard.width) / CGFloat(storyboard.height), contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.white, lineWidth: 1.5))
            Text(formatTime(time))
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(.white)
                .shadow(radius: 2)
        }
        .task(id: frame?.url) {
            guard let url = frame?.url else { return }
            if let cached = ImageLoader.shared.cached(url) {
                sheet = cached
            } else {
                sheet = await ImageLoader.shared.image(for: url)
            }
            sheetURL = url
        }
    }

    private func crop(_ rect: CGRect) -> UIImage? {
        guard let cgImage = sheet?.cgImage,
              rect.maxX <= CGFloat(cgImage.width), rect.maxY <= CGFloat(cgImage.height),
              let cropped = cgImage.cropping(to: rect) else { return nil }
        return UIImage(cgImage: cropped)
    }
}
