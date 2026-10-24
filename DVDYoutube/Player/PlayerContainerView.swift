import AVKit
import SwiftUI

/// The watch page and the mini player are the same view in two layouts. Keeping the
/// video surface at a stable position in the hierarchy means the `AVPlayerLayer`
/// (and Picture in Picture) survives expanding and collapsing.
struct PlayerContainerView: View {
    static let miniHeight: CGFloat = 60
    static let tabBarHeight: CGFloat = 49

    @Environment(PlayerManager.self) private var player
    @Environment(AppSettings.self) private var settings
    @Environment(\.colorScheme) private var colorScheme
    @State private var dragOffset: CGFloat = 0

    var body: some View {
        GeometryReader { outer in
            let insets = outer.safeAreaInsets
            GeometryReader { geo in
                layout(size: geo.size, insets: insets)
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder
    private func layout(size: CGSize, insets: EdgeInsets) -> some View {
        let expanded = player.isExpanded
        // Sideways for wide videos; vertical videos can also fill the screen upright.
        let fullscreen = expanded && (size.width > size.height || player.isPortraitFullscreen)
        let miniVideoWidth = Self.miniHeight * 16 / 9
        let videoWidth = expanded ? size.width : miniVideoWidth
        let videoHeight = fullscreen ? size.height : (expanded ? size.width * 9 / 16 : Self.miniHeight)
        let miniY = size.height - insets.bottom - Self.tabBarHeight - Self.miniHeight
        let showsAmbient = expanded && !fullscreen && colorScheme == .dark && settings.ambientMode && !player.isCasting

        VStack(spacing: 0) {
            if expanded, !fullscreen {
                Color.black.frame(height: insets.top)
            }
            HStack(spacing: 0) {
                let turns = fullscreen ? player.fullscreenQuarterTurns : 0
                let sideways = turns % 2 == 1
                let surfaceWidth = sideways ? videoHeight : videoWidth
                let surfaceHeight = sideways ? videoWidth : videoHeight
                PlayerSurface(mode: fullscreen ? .fullscreen : (expanded ? .inline : .mini),
                              insets: Self.rotate(insets, quarterTurns: turns))
                    .frame(width: surfaceWidth, height: surfaceHeight)
                    .background {
                        PageDragTracker(isEnabled: expanded && !fullscreen,
                                        onChanged: { dy in dragOffset = max(dy, 0) },
                                        onEnded: endPageDrag)
                    }
                    .gesture(fullscreenSwipeGesture(width: surfaceWidth),
                             including: fullscreen && !player.isScreenLocked ? .all : .subviews)
                    .rotationEffect(.degrees(Double(turns) * 90))
                    .frame(width: videoWidth, height: videoHeight)
                    .animation(.easeInOut(duration: 0.3), value: turns)
                if !expanded {
                    MiniPlayerBar()
                }
            }
            .frame(height: videoHeight)
            .background(Color.black)

            if expanded, !fullscreen {
                WatchDetailsView(bottomInset: insets.bottom)
                    .transition(.opacity)
            }
        }
        .frame(width: size.width, height: expanded ? size.height : Self.miniHeight, alignment: .top)
        .background(alignment: .top) {
            ZStack(alignment: .top) {
                expanded ? Color(.systemBackground) : Color(.secondarySystemBackground)
                if showsAmbient {
                    AmbientGlowView(playerHeight: videoHeight)
                        .padding(.top, insets.top)
                        .transition(.opacity)
                }
            }
        }
        .background {
            // The volume slider only works inside a window; it also hides iOS's own volume HUD.
            if fullscreen, settings.swipeControls {
                VolumeViewHost().frame(width: 1, height: 1)
            }
        }
        .onChange(of: showsAmbient, initial: true) { _, on in
            player.setAmbientSampling(on)
        }
        .onChange(of: fullscreen) { _, isFullscreen in
            if !isFullscreen { ScreenBrightness.restore() }
        }
        .overlay(alignment: .top) {
            if !expanded { Divider() }
        }
        // No shadow pass at all on the full-screen watch page (it would be redrawn while dragging).
        .shadow(color: .black.opacity(expanded ? 0 : 0.15), radius: expanded ? 0 : 6, y: expanded ? 0 : -2)
        .offset(y: expanded ? dragOffset : miniY)
        .animation(.spring(response: 0.38, dampingFraction: 0.9), value: expanded)
        .statusBarHidden(fullscreen)
        .persistentSystemOverlays(fullscreen ? .hidden : .automatic)
    }

    /// The screen's safe area as seen by a player turned clockwise by `quarterTurns`.
    static func rotate(_ insets: EdgeInsets, quarterTurns: Int) -> EdgeInsets {
        switch quarterTurns {
        case 1: return EdgeInsets(top: insets.trailing, leading: insets.top, bottom: insets.leading, trailing: insets.bottom)
        case 2: return EdgeInsets(top: insets.bottom, leading: insets.trailing, bottom: insets.top, trailing: insets.leading)
        case 3: return EdgeInsets(top: insets.leading, leading: insets.bottom, bottom: insets.trailing, trailing: insets.top)
        default: return insets
        }
    }

    /// Same gestures as the official app: on the portrait watch page swipe up for
    /// fullscreen and down for the mini player (the page follows the finger).
    private func endPageDrag(translation: CGSize, velocity: CGSize) {
        let dy = translation.height
        let predicted = dy + velocity.height * 0.25
        let isVertical = abs(dy) >= abs(translation.width)
        withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) {
            dragOffset = 0
            if isVertical && (dy < -50 || predicted < -200) {
                player.enterFullscreen()
            } else if isVertical && (dy > 120 || predicted > 300) {
                player.isExpanded = false
            }
        }
    }

    /// In fullscreen swipe down to exit. When enabled, a vertical swipe starting on the left 35%
    /// sets the brightness and on the right 35% the volume (handled in the player).
    private func fullscreenSwipeGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                if settings.swipeControls, !player.usesWebPlayer {
                    let fraction = value.startLocation.x / max(width, 1)
                    if fraction < 0.35 || fraction > 0.65 { return }
                }
                let dy = value.translation.height
                let isVertical = abs(dy) > abs(value.translation.width)
                guard isVertical, dy > 50 || value.predictedEndTranslation.height > 200 else { return }
                withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) {
                    player.exitFullscreen()
                }
            }
    }
}

struct MiniPlayerBar: View {
    @Environment(PlayerManager.self) private var player

    var body: some View {
        HStack(spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(player.currentVideo?.title ?? "")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if let label = player.sleepTimerLabel {
                        Label(label, systemImage: "moon.zzz.fill").monospacedDigit()
                        Text("•")
                    }
                    if player.isAudioOnly {
                        Image(systemName: "headphones")
                    }
                    Text(player.currentVideo?.channelName ?? "")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 10)

            Button {
                player.togglePlayPause()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)

            Button {
                withAnimation { player.close() }
            } label: {
                Image(systemName: "xmark")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .padding(.trailing, 4)
        }
        .frame(maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { player.isExpanded = true }
        .gesture(
            DragGesture(minimumDistance: 16).onEnded { value in
                if value.translation.height < -30 { player.isExpanded = true }
                if value.translation.width > 120 { withAnimation { player.close() } }
            }
        )
        .overlay(alignment: .bottom) {
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.brand)
                    .frame(width: geo.size.width * progress, height: 2)
            }
            .frame(height: 2)
        }
    }

    private var progress: CGFloat {
        guard player.duration > 0 else { return 0 }
        return CGFloat(min(max(player.currentTime / player.duration, 0), 1))
    }
}

/// `UIViewRepresentable` wrapper around the player layer view.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect
    var onLayer: ((AVPlayerLayer) -> Void)?

    func makeUIView(context: Context) -> PlayerLayerUIView {
        let view = PlayerLayerUIView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        onLayer?(view.playerLayer)
        return view
    }

    func updateUIView(_ view: PlayerLayerUIView, context: Context) {
        if view.playerLayer.videoGravity != gravity { view.playerLayer.videoGravity = gravity }
        if view.playerLayer.player == nil, UIApplication.shared.applicationState == .active {
            view.playerLayer.player = player
        }
    }
}

/// Drag on the watch page's video, tracked by UIKit in window coordinates. A SwiftUI drag
/// gesture on the video moves with the page it drags, so its translation fed back into the
/// offset and the page jumped back and forth every frame during a slow drag.
struct PageDragTracker: UIViewRepresentable {
    var isEnabled: Bool
    var onChanged: (CGFloat) -> Void
    var onEnded: (_ translation: CGSize, _ velocity: CGSize) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> AnchorView {
        let view = AnchorView()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: AnchorView, context: Context) {
        context.coordinator.tracker = self
    }

    static func dismantleUIView(_ view: AnchorView, coordinator: Coordinator) {
        coordinator.detach()
    }

    /// Marks where drags may start; the recognizer itself sits on the window's root view.
    final class AnchorView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(to: self)
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var tracker: PageDragTracker
        private weak var anchor: UIView?
        private var pan: UIPanGestureRecognizer?

        init(_ tracker: PageDragTracker) {
            self.tracker = tracker
        }

        func attach(to anchor: UIView) {
            self.anchor = anchor
            guard let host = anchor.window?.rootViewController?.view else {
                detach()
                return
            }
            if pan?.view === host { return }
            detach()
            let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            pan.cancelsTouchesInView = false
            pan.delaysTouchesEnded = false
            pan.delegate = self
            host.addGestureRecognizer(pan)
            self.pan = pan
        }

        func detach() {
            if let pan { pan.view?.removeGestureRecognizer(pan) }
            pan = nil
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard tracker.isEnabled, let anchor, anchor.window != nil else { return false }
            return anchor.bounds.contains(touch.location(in: anchor))
        }

        /// Only a mostly vertical drag moves the page (a sideways one may be the seek bar).
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
            let velocity = pan.velocity(in: nil)
            let translation = pan.translation(in: nil)
            return abs(velocity.y) + abs(translation.y) * 10 > abs(velocity.x) + abs(translation.x) * 10
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }

        @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
            let translation = pan.translation(in: nil)
            switch pan.state {
            case .began, .changed:
                tracker.onChanged(translation.y)
            case .ended:
                let velocity = pan.velocity(in: nil)
                tracker.onEnded(CGSize(width: translation.x, height: translation.y),
                                CGSize(width: velocity.x, height: velocity.y))
            case .cancelled, .failed:
                tracker.onEnded(.zero, .zero)
            default:
                break
            }
        }
    }
}

/// System AirPlay picker.
struct RoutePickerView: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = UIColor(Color.brand)
        view.prioritizesVideoDevices = true
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
