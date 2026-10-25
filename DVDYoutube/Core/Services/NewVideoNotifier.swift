import BackgroundTasks
import Foundation
import UserNotifications

/// Local notifications for new uploads from subscribed channels. iOS wakes the app in
/// the background from time to time (Background App Refresh); each run compares the
/// latest uploads with the ones already seen.
enum NewVideoNotifier {
    static let taskIdentifier = "com.dangdvd.dvdtube.refresh"
    static let enabledKey = "notify.newVideos"
    private static let seenKey = "notify.seenVideoIds"

    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }

    /// Must run before the app finishes launching.
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            handle(task)
        }
    }

    static func schedule() {
        // Also used by "Tự động tải" (automatic downloads of subscribed channels).
        guard isEnabled || AutoDownloadSettings.isEnabledFlag else { return }
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule()
        let completion = CompletionOnce(task)
        let work = Task {
            if isEnabled { _ = await checkForNewVideos() }
            await AutoDownloader.runInBackground()
            completion.finish(success: true)
        }
        task.expirationHandler = {
            work.cancel()
            completion.finish(success: false)
        }
    }

    /// Fetches the latest uploads and notifies about unseen ones. Returns how many were new.
    @discardableResult
    static func checkForNewVideos() async -> Int {
        let videos = await latestSubscriptionVideos()
        guard !videos.isEmpty else { return 0 }
        let sorted = videos.sorted { ($0.publishedDate ?? .distantPast) > ($1.publishedDate ?? .distantPast) }
        await MainActor.run { WidgetBridge.setNewVideos(sorted) }
        let defaults = UserDefaults.standard
        let seen = Set(defaults.stringArray(forKey: seenKey) ?? [])
        let isFirstRun = seen.isEmpty
        let fresh = videos.filter { !seen.contains($0.id) && !$0.isShort }

        // Remember everything we have seen (bounded), so nothing is announced twice.
        let updated = Array((videos.map(\.id) + Array(seen)).prefix(600))
        defaults.set(updated, forKey: seenKey)

        // The first run only records the current state instead of announcing old videos.
        guard !isFirstRun, !fresh.isEmpty else { return 0 }
        for video in fresh.prefix(5) {
            await post(video)
        }
        Log.debug("new video check: \(fresh.count) new")
        return fresh.count
    }

    private static func latestSubscriptionVideos() async -> [VideoItem] {
        let service = YouTubeService.shared
        if AuthSession.shared.isAuthenticated,
           let page = try? await service.accountFeed("FEsubscriptions") {
            return Array(page.videos.prefix(40))
        }
        let channels = await MainActor.run { Array(LibraryStore.shared.subscriptions.prefix(25)) }
        return await withTaskGroup(of: [VideoItem].self) { group in
            for channel in channels {
                group.addTask { Array((try? await RSSFeed.videos(channelId: channel.id))?.prefix(3) ?? []) }
            }
            var all: [VideoItem] = []
            for await list in group { all.append(contentsOf: list) }
            let twoDaysAgo = Date().addingTimeInterval(-2 * 86_400)
            return all.filter { ($0.publishedDate ?? Date()) > twoDaysAgo }
        }
    }

    private static func post(_ video: VideoItem) async {
        let content = UNMutableNotificationContent()
        content.title = video.channelName ?? "Video mới"
        content.body = video.title
        content.sound = .default
        content.userInfo = ["videoId": video.id]
        content.threadIdentifier = video.channelId ?? "new-videos"
        if let url = video.displayThumbnail,
           let result = try? await URLSession.shared.data(from: url) {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(video.id).jpg")
            if (try? result.0.write(to: file)) != nil,
               let attachment = try? UNNotificationAttachment(identifier: "thumbnail", url: file) {
                content.attachments = [attachment]
            }
        }
        let request = UNNotificationRequest(identifier: "video-\(video.id)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    /// `setTaskCompleted` must be called exactly once.
    private final class CompletionOnce: @unchecked Sendable {
        private let task: BGAppRefreshTask
        private let lock = NSLock()
        private var done = false

        init(_ task: BGAppRefreshTask) { self.task = task }

        func finish(success: Bool) {
            lock.lock()
            defer { lock.unlock() }
            guard !done else { return }
            done = true
            task.setTaskCompleted(success: success)
        }
    }
}
