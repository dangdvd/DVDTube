import AVFoundation
import CoreImage
import MediaPlayer
import SwiftUI
import UIKit

// MARK: - Ambient mode

/// Shrinks a video frame to a tiny, already blurred image: scaled up on screen it is a soft glow
/// of the frame's colours, without any blur work while the page scrolls or animates.
/// Thread-safe; call it off the main thread.
enum AmbientSampler {
    private static let context = CIContext(options: [.cacheIntermediates: false])

    static func tinyImage(from buffer: CVPixelBuffer) -> UIImage? {
        tinyImage(from: CIImage(cvPixelBuffer: buffer))
    }

    static func tinyImage(from image: UIImage) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }
        return tinyImage(from: CIImage(cgImage: cgImage))
    }

    private static func tinyImage(from image: CIImage) -> UIImage? {
        let width = image.extent.width
        guard width > 0 else { return nil }
        let scale = 48 / width
        let small = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let blurred = small.clampedToExtent()
            .applyingGaussianBlur(sigma: 2.5)
            .cropped(to: small.extent)
        guard let cgImage = context.createCGImage(blurred, from: small.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

/// "Chế độ môi trường": the colours of the video glow softly below the player (dark appearance).
struct AmbientGlowView: View {
    let playerHeight: CGFloat

    @Environment(PlayerManager.self) private var player

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let image = player.ambientImage {
                    Image(uiImage: image)
                        .resizable()
                        .interpolation(.high)
                        .id(ObjectIdentifier(image))
                        .transition(.opacity)
                }
            }
            .frame(width: geo.size.width * 1.35, height: playerHeight * 1.35 + 80)
            .opacity(0.55)
            .frame(width: geo.size.width, height: playerHeight + 80, alignment: .center)
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: playerHeight / (playerHeight + 80)),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                )
            )
            .animation(.easeInOut(duration: 1), value: player.ambientImage.map { ObjectIdentifier($0) })
        }
        .frame(height: playerHeight + 80)
        .allowsHitTesting(false)
    }
}

// MARK: - Swipe for brightness / volume

/// What the fullscreen swipe on the left/right edge controls.
enum SwipeControl: Equatable {
    case brightness(Double)
    case volume(Double)
}

/// Screen brightness, restored to the user's own level when fullscreen ends.
@MainActor
enum ScreenBrightness {
    private static var original: CGFloat?

    private static var screen: UIScreen? {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.screen }.first
    }

    static var value: Double { Double(screen?.brightness ?? 0.5) }

    static func set(_ value: Double) {
        guard let screen else { return }
        if original == nil { original = screen.brightness }
        screen.brightness = CGFloat(min(max(value, 0), 1))
    }

    static func restore() {
        guard let original, let screen else { return }
        screen.brightness = original
        self.original = nil
    }
}

/// System volume through a (nearly) invisible `MPVolumeView`, which also keeps iOS from
/// showing its own volume HUD over the video.
@MainActor
final class SystemVolume {
    static let shared = SystemVolume()

    let view: MPVolumeView = {
        let view = MPVolumeView(frame: CGRect(x: -100, y: -100, width: 40, height: 40))
        view.alpha = 0.01
        view.isUserInteractionEnabled = false
        return view
    }()

    var value: Double { Double(AVAudioSession.sharedInstance().outputVolume) }

    func set(_ value: Double) {
        guard let slider = view.subviews.compactMap({ $0 as? UISlider }).first else { return }
        slider.value = Float(min(max(value, 0), 1))
        slider.sendActions(for: .valueChanged)
    }
}

/// Puts the shared `MPVolumeView` into the view hierarchy (it only works inside a window).
struct VolumeViewHost: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let container = UIView(frame: .zero)
        container.isUserInteractionEnabled = false
        container.addSubview(SystemVolume.shared.view)
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        if SystemVolume.shared.view.superview !== uiView { uiView.addSubview(SystemVolume.shared.view) }
    }
}

/// Icon + bar shown while swiping for brightness or volume.
struct SwipeControlHUD: View {
    let control: SwipeControl

    private var value: Double {
        switch control {
        case .brightness(let value), .volume(let value): return value
        }
    }

    private var icon: String {
        switch control {
        case .brightness(let value): return value < 0.5 ? "sun.min.fill" : "sun.max.fill"
        case .volume(let value): return value <= 0.01 ? "speaker.slash.fill" : (value < 0.5 ? "speaker.wave.1.fill" : "speaker.wave.3.fill")
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 22)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.3))
                    Capsule().fill(Color.white).frame(width: geo.size.width * CGFloat(min(max(value, 0), 1)))
                }
            }
            .frame(width: 120, height: 4)
            Text("\(Int((value * 100).rounded()))%")
                .font(.caption.monospacedDigit().weight(.semibold))
                .frame(width: 40, alignment: .trailing)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Capsule().fill(Color.black.opacity(0.65)))
        .allowsHitTesting(false)
    }
}
