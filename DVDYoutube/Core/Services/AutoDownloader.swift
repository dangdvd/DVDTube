import Foundation
import Observation

/// Settings › Tải xuống › "Tự động tải video mới": the chosen channels' newest videos are
/// downloaded by themselves (best effort on iOS: when the app becomes active and in the
/// background refresh task), keeping at most N per channel.
@MainActor
@Observable
final class AutoDownloadSettings {
    static let shared = AutoDownloadSettings()

    var isEnabled: Bool { didSet { defaults.set(isEnabled, forKey: Self.enabledKey) } }
    private(set) var channels: [ChannelItem] = []
    var maxPerChannel: Int { didSet { defaults.set(maxPerChannel, forKey: "autoDownload.max") } }
    var wifiOnly: Bool { didSet { defaults.set(wifiOnly, forKey: "autoDownload.wifiOnly") } }
    var audioOnly: Bool { didSet { defaults.set(audioOnly, forKey: "autoDownload.audioOnly") } }

    static let enabledKey = "autoDownload.enabled"
    private static let channelsKey = "autoDownload.channels"
    private let defaults = UserDefaults.standard

    /// Readable from the background task without the main actor.
    nonisolated static var isEnabledFlag: Bool { UserDefaults.standard.bool(forKey: "autoDownload.enabled") }

    private init() {
        let d = UserDefaults.standard
        d.register(defaults: ["autoDownload.max": 3, "autoDownload.wifiOnly": true, "autoDownload.audioOnly": false])
        isEnabled = d.bool(forKey: Self.enabledKey)
        maxPerChannel = max(d.integer(forKey: "autoDownload.max"), 1)
        wifiOnly = d.bool(forKey: "autoDownload.wifiOnly")
        audioOnly = d.bool(forKey: "autoDownload.audioOnly")
        if let data = d.data(forKey: Self.channelsKey), let list = try? JSONDecoder().decode([ChannelItem].self, from: data) {
            channels = list
        }
    }

    func contains(_ channelId: String) -> Bool { channels.contains { $0.id == channelId } }

    func toggle(_ channel: ChannelItem) {
        if let index = channels.firstIndex(where: { $0.id == channel.id }) {
            channels.remove(at: index)
        } else {
            channels.append(channel)
        }
        defaults.set(try? JSONEncoder().encode(channels), forKey: Self.channelsKey)
    }
}

enum AutoDownloader {
    private static let handledKey = "autoDownload.handled"
    private static let lastRunKey = "autoDownload.lastRun"
    @MainActor private static var isRunning = false

    /// Videos already downloaded automatically once (deleted ones do not come back).
    private static var handled: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: handledKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue.prefix(3000)), forKey: handledKey) }
    }

    /// Looks for new videos and queues them. `force` skips the 30-minute pause between runs.
    @MainActor
    static func run(force: Bool = false) async {
        let settings = AutoDownloadSettings.shared
        guard settings.isEnabled, !settings.channels.isEmpty, !isRunning else { return }
        if settings.wifiOnly, NetworkMonitor.shared.isExpensive {
            Log.debug("auto download: waiting for Wi-Fi")
            return
        }
        let last = UserDefaults.standard.double(forKey: lastRunKey)
        if !force, last > 0, Date().timeIntervalSince1970 - last < 30 * 60 { return }
        isRunning = true
        defer { isRunning = false }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastRunKey)

        let limit = settings.maxPerChannel
        let channels = settings.channels
        let audioOnly = settings.audioOnly
        let service = YouTubeService.shared
        let latest: [(ChannelItem, [VideoItem])] = await withTaskGroup(of: (ChannelItem, [VideoItem]).self) { group in
            for channel in channels {
                group.addTask {
                    let videos = await service.latestVideos(channel: channel)
                    return (channel, videos)
                }
            }
            var all: [(ChannelItem, [VideoItem])] = []
            for await result in group { all.append(result) }
            return all
        }
        let done = handled
        let downloads = DownloadManager.shared
        var queued = 0
        for (channel, videos) in latest {
            let candidates = videos
                .filter { !$0.isShort && !$0.isLive && !isUpcoming($0) }
                .sorted { ($0.publishedDate ?? .distantPast) > ($1.publishedDate ?? .distantPast) }
                .prefix(limit)
            for video in candidates where !done.contains(video.id) && !downloads.isDownloaded(video.id)
                && !downloads.isQueuedOrRunning(video.id) {
                var item = video
                item.channelId = item.channelId ?? channel.id
                item.channelName = item.channelName ?? channel.name
                item.channelAvatar = item.channelAvatar ?? channel.avatar
                if downloads.enqueueAutomatic(item, audioOnly: audioOnly) { queued += 1 }
            }
        }
        Log.debug("auto download: \(channels.count) channel(s), \(queued) new video(s) queued")
    }

    /// From the background refresh task (any thread).
    static func runInBackground() async {
        guard AutoDownloadSettings.isEnabledFlag else { return }
        await run(force: true)
    }

    /// Called when an automatic download finished: remember it and drop the oldest beyond N.
    @MainActor
    static func didDownload(_ video: VideoItem) {
        var ids = handled
        ids.insert(video.id)
        handled = ids
        if let channelId = video.channelId {
            DownloadManager.shared.pruneAutomatic(channelId: channelId, keep: AutoDownloadSettings.shared.maxPerChannel)
        }
        WidgetBridge.scheduleUpdate()
    }

    /// Premieres and scheduled streams show up in the feed with 0 views before they start.
    private static func isUpcoming(_ video: VideoItem) -> Bool {
        if let date = video.publishedDate, date > Date().addingTimeInterval(60) { return true }
        guard let views = video.viewCountText?.trimmingCharacters(in: .whitespaces) else { return false }
        return views.hasPrefix("0 ")
    }
}
