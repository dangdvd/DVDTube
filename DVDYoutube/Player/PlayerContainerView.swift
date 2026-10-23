import AVKit
import SwiftUI

/// The watch page and the mini player are the same view in two layouts. Keeping the
/// video surface at a stable position in the hierarchy means the `AVPlayerLayer`
/// (and Picture in Picture) survives expanding and collapsing.
struct PlayerContainerView: View {
    static let miniHeight: CGFloat = 60
    static let tabBarHeight: CGFloat = 49

    @Environment(PlayerManager.self) private var player
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

        VStack(spacing: 0) {
            if expanded, !fullscreen {
                Color.black.frame(height: insets.top)
            }
            HStack(spacing: 0) {
                let turns = fullscreen ? player.fullscreenQuarterTurns : 0
                let sideways = turns % 2 == 1
                PlayerSurface(mode: fullscreen ? .fullscreen : (expanded ? .inline : .mini),
                              insets: Self.rotate(insets, quarterTurns: turns))
                    .frame(width: sideways ? videoHeight : videoWidth, height: sideways ? videoWidth : videoHeight)
                    .gesture(swipeGesture(fullscreen: fullscreen),
                             including: expanded && !player.isScreenLocked ? .all : .subviews)
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
        .background(expanded ? Color(.systemBackground) : Color(.secondarySystemBackground))
        .overlay(alignment: .top) {
            if !expanded { Divider() }
        }
        .shadow(color: .black.opacity(expanded ? 0 : 0.15), radius: 6, y: -2)
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
    /// fullscreen and down for the mini player; in fullscreen swipe down to exit.
    private func swipeGesture(fullscreen: Bool) -> some Gesture {
        DragGesture(minimumDistance: 24)
            .onChanged { value in
                guard !fullscreen, abs(value.translation.height) > abs(value.translation.width) else { return }
                if value.translation.height > 0 { dragOffset = value.translation.height }
            }
            .onEnded { value in
                let dy = value.translation.height
                let predicted = value.predictedEndTranslation.height
                let isVertical = abs(dy) > abs(value.translation.width)
                let swipedUp = isVertical && (dy < -50 || predicted < -200)
                let swipedDown = isVertical && (dy > (fullscreen ? 50 : 120) || predicted > (fullscreen ? 200 : 300))
                withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) {
                    dragOffset = 0
                    if fullscreen {
                        if swipedDown { player.exitFullscreen() }
                    } else if swipedUp {
                        player.enterFullscreen()
                    } else if swipedDown {
                        player.isExpanded = false
                    }
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
