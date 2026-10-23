import AVFoundation
import AVKit
import Network
import UIKit
import UserNotifications

/// Tracks whether we are on Wi-Fi or a metered connection to pick the default quality.
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var expensive = false

    var isExpensive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return expensive
    }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            self.lock.lock()
            self.expensive = path.isExpensive || path.isConstrained
            self.lock.unlock()
        }
        monitor.start(queue: DispatchQueue(label: "network.monitor"))
    }
}

/// Allowed interface orientations; the watch page unlocks landscape like the official app.
enum OrientationController {
    private(set) static var mask: UIInterfaceOrientationMask = .portrait

    @MainActor
    static func setAllowed(_ newMask: UIInterfaceOrientationMask) {
        guard newMask != mask else { return }
        mask = newMask
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            if !newMask.contains(.landscapeLeft), scene.interfaceOrientation.isLandscape {
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
            }
        }
    }

    @MainActor
    static func rotate(toLandscape landscape: Bool) {
        if landscape { mask = .allButUpsideDown }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .landscapeRight : .portrait)) { _ in }
        }
    }

    @MainActor
    static var isLandscape: Bool {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.interfaceOrientation.isLandscape ?? false
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        configureAudioSession()
        NewVideoNotifier.register()
        UNUserNotificationCenter.current().delegate = self
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
        _ = NetworkMonitor.shared
        return true
    }

    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        OrientationController.mask
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    /// Tapping a "new video" notification opens the video.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let content = response.notification.request.content
        guard let videoId = content.userInfo["videoId"] as? String else { return }
        let title = content.body
        let channel = content.title
        await MainActor.run {
            PlayerManager.shared.play(VideoItem(id: videoId, title: title, channelName: channel))
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
    }
}

/// Hosts the `AVPlayerLayer` used for both the mini player and the full watch page.
final class PlayerLayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// Audio-only renditions of YouTube's HLS manifest (`#EXT-X-MEDIA:TYPE=AUDIO`): itag 233 ≈ 48 kbps,
/// 234 ≈ 128 kbps AAC in small segments, so audio-only playback starts right away.
enum HLSAudio {
    struct Rendition {
        let url: URL
        let itag: Int?
        let isDefault: Bool
    }

    static func renditions(in text: String, base: URL) -> [Rendition] {
        text.components(separatedBy: .newlines).compactMap { raw in
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("#EXT-X-MEDIA:"), line.contains("TYPE=AUDIO"),
                  let uri = attribute("URI", in: line),
                  let url = URL(string: uri, relativeTo: base)?.absoluteURL else { return nil }
            let text = url.absoluteString
            let itag = text.range(of: #"/itag/\d+"#, options: .regularExpression)
                .flatMap { Int(text[$0].split(separator: "/").last ?? "") }
            return Rendition(url: url, itag: itag, isDefault: attribute("DEFAULT", in: line) == "YES")
        }
    }

    /// The original-language rendition: the small one with data saver, otherwise the best one.
    static func pick(from text: String, base: URL, preferSmall: Bool) -> Rendition? {
        let all = renditions(in: text, base: base)
        guard !all.isEmpty else { return nil }
        let main = all.contains(where: \.isDefault) ? all.filter(\.isDefault) : all
        if let exact = main.first(where: { $0.itag == (preferSmall ? 233 : 234) }) { return exact }
        let sorted = main.sorted { ($0.itag ?? 0) < ($1.itag ?? 0) }
        return preferSmall ? sorted.first : sorted.last
    }

    private static func attribute(_ name: String, in line: String) -> String? {
        guard let range = line.range(of: "\(name)=") else { return nil }
        let rest = line[range.upperBound...]
        if rest.hasPrefix("\"") {
            let value = rest.dropFirst()
            return value.firstIndex(of: "\"").map { String(value[..<$0]) }
        }
        return String(rest.prefix { $0 != "," })
    }
}
