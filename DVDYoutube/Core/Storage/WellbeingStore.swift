import Foundation
import Observation

/// Seconds of video watched per day, for "Time watched" (kept for 30 days, on device only).
@MainActor
@Observable
final class WatchTimeStore {
    static let shared = WatchTimeStore()

    private(set) var secondsByDay: [String: Double] = [:]
    @ObservationIgnored private var pending: Double = 0
    @ObservationIgnored private var lastSave = Date()
    private static let key = "wellbeing.watchTime"

    private init() {
        secondsByDay = UserDefaults.standard.dictionary(forKey: Self.key) as? [String: Double] ?? [:]
    }

    static func dayKey(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    func add(seconds: Double, at date: Date = Date()) {
        secondsByDay[Self.dayKey(date), default: 0] += seconds
        pending += seconds
        if pending >= 30 || date.timeIntervalSince(lastSave) > 60 { save() }
    }

    func save() {
        pending = 0
        lastSave = Date()
        let cutoff = Self.dayKey(Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date())
        secondsByDay = secondsByDay.filter { $0.key >= cutoff }
        UserDefaults.standard.set(secondsByDay, forKey: Self.key)
    }

    func seconds(daysAgo: Int) -> Double {
        guard let date = Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date()) else { return 0 }
        return secondsByDay[Self.dayKey(date)] ?? 0
    }

    /// The last 7 days, oldest first.
    var lastWeek: [(date: Date, seconds: Double)] {
        (0..<7).reversed().compactMap { daysAgo in
            guard let date = Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date()) else { return nil }
            return (date, secondsByDay[Self.dayKey(date)] ?? 0)
        }
    }

    var dailyAverage: Double { lastWeek.map(\.seconds).reduce(0, +) / 7 }

    func reset() {
        secondsByDay = [:]
        save()
    }
}

/// Videos marked "Not interested" and channels marked "Don't recommend channel".
/// They are left out of the home feed, related videos and Shorts.
@MainActor
@Observable
final class HiddenContentStore {
    static let shared = HiddenContentStore()

    private(set) var videos: [VideoItem] = []
    private(set) var channels: [ChannelItem] = []
    @ObservationIgnored private var videoIds = Set<String>()
    @ObservationIgnored private var channelIds = Set<String>()
    private static let videosKey = "hidden.videos"
    private static let channelsKey = "hidden.channels"

    private init() {
        let decoder = JSONDecoder()
        if let data = UserDefaults.standard.data(forKey: Self.videosKey),
           let list = try? decoder.decode([VideoItem].self, from: data) {
            videos = list
        }
        if let data = UserDefaults.standard.data(forKey: Self.channelsKey),
           let list = try? decoder.decode([ChannelItem].self, from: data) {
            channels = list
        }
        rebuild()
    }

    var isEmpty: Bool { videos.isEmpty && channels.isEmpty }

    func isHidden(_ video: VideoItem) -> Bool {
        videoIds.contains(video.id) || (video.channelId.map(channelIds.contains) ?? false)
    }

    func isHidden(_ item: FeedItem) -> Bool {
        switch item {
        case .video(let video): return isHidden(video)
        case .channel(let channel): return channelIds.contains(channel.id)
        default: return false
        }
    }

    func filter(_ items: [FeedItem]) -> [FeedItem] {
        guard !isEmpty else { return items }
        return items.compactMap { item in
            if case .shorts(let list) = item {
                let kept = list.filter { !isHidden($0) }
                return kept.isEmpty ? nil : .shorts(kept)
            }
            return isHidden(item) ? nil : item
        }
    }

    func hide(_ video: VideoItem) {
        guard !videoIds.contains(video.id) else { return }
        videos.insert(video, at: 0)
        save()
    }

    func hideChannel(of video: VideoItem) {
        guard let id = video.channelId, !channelIds.contains(id) else { return }
        channels.insert(ChannelItem(id: id, name: video.channelName ?? id, avatar: video.channelAvatar), at: 0)
        save()
    }

    func unhide(videoId: String) {
        videos.removeAll { $0.id == videoId }
        save()
    }

    func unhide(channelId: String) {
        channels.removeAll { $0.id == channelId }
        save()
    }

    func clear() {
        videos = []
        channels = []
        save()
    }

    private func rebuild() {
        videoIds = Set(videos.map(\.id))
        channelIds = Set(channels.map(\.id))
    }

    private func save() {
        videos = Array(videos.prefix(500))
        rebuild()
        let encoder = JSONEncoder()
        UserDefaults.standard.set(try? encoder.encode(videos), forKey: Self.videosKey)
        UserDefaults.standard.set(try? encoder.encode(channels), forKey: Self.channelsKey)
    }
}
