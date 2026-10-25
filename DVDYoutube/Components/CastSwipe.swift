import SwiftUI
import UIKit

extension View {
    /// While a DVDTube TV / PC is connected: swipe the video right for "Phát tiếp theo", left
    /// for "Thêm vào cuối hàng đợi" (like Apple Music), the action showing under the card.
    func castSwipeActions(_ video: VideoItem) -> some View {
        modifier(CastSwipeModifier(video: video))
    }
}

private struct CastSwipeModifier: ViewModifier {
    let video: VideoItem

    @Environment(PlayerManager.self) private var player
    @State private var offset: CGFloat = 0
    @State private var armed = false
    /// nil until the drag shows its direction; false for scrolling (left alone).
    @State private var horizontal: Bool?

    /// How far to drag for the action (about a third of a phone's width).
    private static let threshold: CGFloat = 110
    /// Drags starting this close to the screen edges belong to the system (back swipe).
    private static let edge: CGFloat = 30

    private var cast: DVDCast { DVDCast.shared }

    @ViewBuilder
    func body(content: Content) -> some View {
        if cast.isConnected, !video.isShort {
            content
                .offset(x: offset)
                .background { actionBackground }
                .simultaneousGesture(drag)
                .task { await showHintIfNeeded() }
        } else {
            content
        }
    }

    @ViewBuilder
    private var actionBackground: some View {
        if offset != 0 {
            let next = offset > 0
            HStack(spacing: 8) {
                Image(systemName: next ? "text.line.first.and.arrowtriangle.forward" : "text.append")
                    .font(.title3)
                Text(next ? "Phát tiếp theo" : "Thêm vào cuối hàng đợi")
                    .font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: next ? .leading : .trailing)
            .background((next ? Color.blue : Color.green).opacity(armed ? 1 : 0.55))
        }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 14, coordinateSpace: .global)
            .onChanged { value in
                if horizontal == nil {
                    let screen = UIScreen.main.bounds.width
                    let nearEdge = value.startLocation.x < Self.edge || value.startLocation.x > screen - Self.edge
                    horizontal = !nearEdge && abs(value.translation.width) > abs(value.translation.height) * 1.6
                }
                guard horizontal == true else { return }
                let x = value.translation.width
                // Past the threshold the card follows the finger more slowly.
                offset = abs(x) <= Self.threshold ? x : (x > 0 ? 1 : -1) * (Self.threshold + (abs(x) - Self.threshold) * 0.35)
                let nowArmed = abs(x) >= Self.threshold
                if nowArmed != armed {
                    armed = nowArmed
                    if nowArmed { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
                }
            }
            .onEnded { value in
                let act = horizontal == true && abs(value.translation.width) >= Self.threshold
                horizontal = nil
                armed = false
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { offset = 0 }
                if act { player.castQueue(video, next: value.translation.width > 0) }
            }
    }

    /// The first time a TV is connected, one card nudges right and left with a tip.
    @MainActor
    private func showHintIfNeeded() async {
        try? await Task.sleep(nanoseconds: 700_000_000)
        guard !Task.isCancelled, cast.claimSwipeHint() else { return }
        for x in [CGFloat(44), -44, 0] {
            withAnimation(.easeInOut(duration: 0.35)) { offset = x }
            try? await Task.sleep(nanoseconds: 420_000_000)
        }
        player.showToast("Mẹo: vuốt video sang phải để phát tiếp theo, sang trái để thêm vào cuối hàng đợi trên TV")
    }
}
