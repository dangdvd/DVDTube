import Foundation
import UIKit
import WidgetKit

/// Data for the home-screen widgets (`DVDTubeWidget`): "Tiếp tục xem" and new videos from
/// subscriptions, written as JSON + small thumbnails into the App Group container. The
/// widget opens `dvdtube://watch?v=<id>`.
enum WidgetBridge {
    static let appGroup = "group.com.dangdvd.dvdtube"

    /// Must match `WidgetPayload` in the widget extension.
    struct Payload: Codable {
        struct Item: Codable {
            var id: String
            var title: String
            var channel: String?
            var progress: Double
            var durationText: String?
            /// File name of the thumbnail in the container's `thumbs` folder.
            var image: String?
            var thumbnailURL: String?
        }

        var updatedAt: Date
        var continueWatching: [Item]
        var newVideos: [Item]
    }

    @MainActor private static var updateTask: Task<Void, Never>?
    @MainActor private static var newVideos: [VideoItem] = []
    /// What the widget shows now (ids + progress in 5 % steps): unchanged data is not rewritten.
    @MainActor private static var lastSignature = ""
    private static let newVideosKey = "widget.newVideos"

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    /// The subscription feed was loaded: its newest videos for the widget.
    @MainActor
    static func setNewVideos(_ videos: [VideoItem]) {
        let fresh = Array(videos.filter { !$0.isShort && !$0.isLive }.prefix(8))
        guard fresh.map(\.id) != newVideos.map(\.id) else { return }
        newVideos = fresh
        UserDefaults.standard.set(try? JSONEncoder().encode(fresh), forKey: newVideosKey)
        scheduleUpdate()
    }

    /// History or subscriptions changed: rewrite the widget data a moment later.
    @MainActor
    static func scheduleUpdate() {
        guard containerURL != nil else { return }
        updateTask?.cancel()
        updateTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            await write()
        }
    }

    @MainActor
    private static func write() async {
        guard let container = containerURL else { return }
        if newVideos.isEmpty, let data = UserDefaults.standard.data(forKey: newVideosKey),
           let stored = try? JSONDecoder().decode([VideoItem].self, from: data) {
            newVideos = stored
        }
        let unfinished = LibraryStore.shared.history.filter { entry in
            !entry.video.isShort && !entry.video.isLive && entry.progress > 0.01 && entry.progress < 0.95 && entry.position > 10
        }
        let continuing = Array(unfinished.prefix(6))
        let continuingIds = Set(continuing.map(\.id))
        let fresh = newVideos.filter { !continuingIds.contains($0.id) }.prefix(6)
        let signature = continuing.map { "\($0.id):\(Int($0.progress * 20))" }.joined(separator: ",") + "|"
            + fresh.map(\.id).joined(separator: ",")
        guard signature != lastSignature else { return }
        lastSignature = signature

        let folder = container.appendingPathComponent("thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var keep = Set<String>()

        func item(_ video: VideoItem, progress: Double) async -> Payload.Item {
            let title = await DeArrow.shared.cachedTitle(for: video.id) ?? video.title
            var imageName: String?
            if let url = video.displayThumbnail {
                let name = "\(video.id).jpg"
                let file = folder.appendingPathComponent(name)
                if FileManager.default.fileExists(atPath: file.path) {
                    imageName = name
                } else if let image = await ImageLoader.shared.image(for: url), let data = Self.smallJPEG(image) {
                    if (try? data.write(to: file, options: .atomic)) != nil { imageName = name }
                }
                if imageName != nil { keep.insert(name) }
            }
            return Payload.Item(id: video.id, title: title, channel: video.channelName, progress: progress,
                                durationText: video.durationText, image: imageName,
                                thumbnailURL: video.displayThumbnail?.absoluteString)
        }

        var continueItems: [Payload.Item] = []
        for entry in continuing { continueItems.append(await item(entry.video, progress: entry.progress)) }
        var newItems: [Payload.Item] = []
        for video in fresh { newItems.append(await item(video, progress: LibraryStore.shared.watchProgress(video.id) ?? 0)) }

        let payload = Payload(updatedAt: Date(), continueWatching: continueItems, newVideos: newItems)
        guard let data = try? JSONEncoder().encode(payload) else { return }
        try? data.write(to: container.appendingPathComponent("widget.json"), options: .atomic)

        // Thumbnails no longer used.
        if let files = try? FileManager.default.contentsOfDirectory(atPath: folder.path) {
            for file in files where !keep.contains(file) {
                try? FileManager.default.removeItem(at: folder.appendingPathComponent(file))
            }
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// About 360 px wide: widgets have little memory.
    @MainActor
    private static func smallJPEG(_ image: UIImage) -> Data? {
        let width: CGFloat = 360
        let scale = min(1, width / max(image.size.width, 1))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        guard size.width > 0, size.height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.jpegData(compressionQuality: 0.75)
    }
}
