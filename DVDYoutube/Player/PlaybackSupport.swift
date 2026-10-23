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
