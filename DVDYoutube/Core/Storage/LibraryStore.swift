import Foundation
import Observation

struct HistoryEntry: Codable, Identifiable, Hashable {
    var video: VideoItem
    var watchedAt: Date
    var position: Double
    var duration: Double

    var id: String { video.id }

    var progress: Double {
        guard duration > 0 else { return 0 }
        return min(max(position / duration, 0), 1)
    }
}

struct LocalPlaylist: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var name: String
    var videos: [VideoItem]
    var createdAt: Date = Date()
}

private struct LibraryData: Codable {
    var subscriptions: [ChannelItem] = []
    var history: [HistoryEntry] = []
    var watchLater: [VideoItem] = []
    var liked: [VideoItem] = []
    var playlists: [LocalPlaylist] = []
    var searchHistory: [String] = []
}

/// Everything that would normally live in a Google account: subscriptions, history,
/// likes and playlists. Stored locally as JSON — nothing leaves the device.
@MainActor
@Observable
final class LibraryStore {
    static let shared = LibraryStore()

    private(set) var subscriptions: [ChannelItem] = []
    private(set) var history: [HistoryEntry] = []
    private(set) var watchLater: [VideoItem] = []
    private(set) var liked: [VideoItem] = []
    private(set) var playlists: [LocalPlaylist] = []
    private(set) var searchHistory: [String] = []

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let fileURL: URL

    private init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        fileURL = folder.appendingPathComponent("library.json")
        if let data = try? Data(contentsOf: fileURL),
           let stored = try? JSONDecoder().decode(LibraryData.self, from: data) {
            subscriptions = stored.subscriptions
            history = stored.history
            watchLater = stored.watchLater
            liked = stored.liked
            playlists = stored.playlists
            searchHistory = stored.searchHistory
        }
    }

    // MARK: Persistence

    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = LibraryData(
            subscriptions: subscriptions, history: history, watchLater: watchLater,
            liked: liked, playlists: playlists, searchHistory: searchHistory
        )
        let url = fileURL
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: Subscriptions

    func isSubscribed(_ channelId: String?) -> Bool {
        guard let channelId else { return false }
        return subscriptions.contains { $0.id == channelId }
    }

    func toggleSubscription(_ channel: ChannelItem) {
        if let index = subscriptions.firstIndex(where: { $0.id == channel.id }) {
            subscriptions.remove(at: index)
        } else {
            subscriptions.insert(channel, at: 0)
        }
        scheduleSave()
    }

    func updateSubscription(_ channel: ChannelItem) {
        guard let index = subscriptions.firstIndex(where: { $0.id == channel.id }) else { return }
        var updated = subscriptions[index]
        updated.name = channel.name.isEmpty ? updated.name : channel.name
        updated.avatar = channel.avatar ?? updated.avatar
        updated.subscriberText = channel.subscriberText ?? updated.subscriberText
        updated.handle = channel.handle ?? updated.handle
        guard updated != subscriptions[index] else { return }
        subscriptions[index] = updated
        scheduleSave()
    }

    /// Imports a Google Takeout `subscriptions.csv` (Channel Id, Channel Url, Channel Title).
    @discardableResult
    func importSubscriptions(csv: String) -> Int {
        var added = 0
        for line in csv.components(separatedBy: .newlines).dropFirst() {
            let columns = line.split(separator: ",", maxSplits: 2, omittingEmptySubsequences: false).map {
                $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            }
            guard columns.count >= 3, columns[0].hasPrefix("UC"), !isSubscribed(columns[0]) else { continue }
            subscriptions.append(ChannelItem(id: columns[0], name: columns[2]))
            added += 1
        }
        if added > 0 { scheduleSave() }
        return added
    }

    func exportSubscriptionsCSV() -> String {
        var lines = ["Channel Id,Channel Url,Channel Title"]
        for channel in subscriptions {
            let name = channel.name.replacingOccurrences(of: ",", with: " ")
            lines.append("\(channel.id),http://www.youtube.com/channel/\(channel.id),\(name)")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: History

    func recordWatch(_ video: VideoItem, position: Double, duration: Double) {
        guard AppSettings.shared.saveHistory else { return }
        var entry = HistoryEntry(video: video, watchedAt: Date(), position: position, duration: duration)
        if let index = history.firstIndex(where: { $0.id == video.id }) {
            let existing = history.remove(at: index)
            if duration <= 0 { entry.duration = existing.duration }
        }
        history.insert(entry, at: 0)
        if history.count > 1000 { history.removeLast(history.count - 1000) }
        scheduleSave()
    }

    func updatePosition(videoId: String, position: Double, duration: Double) {
        guard let index = history.firstIndex(where: { $0.id == videoId }) else { return }
        history[index].position = position
        if duration > 0 { history[index].duration = duration }
        scheduleSave()
    }

    func resumePosition(for videoId: String) -> Double? {
        guard let entry = history.first(where: { $0.id == videoId }),
              entry.position > 10, entry.duration <= 0 || entry.position < entry.duration - 10
        else { return nil }
        return entry.position
    }

    func removeFromHistory(_ videoId: String) {
        history.removeAll { $0.id == videoId }
        scheduleSave()
    }

    func clearHistory() {
        history.removeAll()
        scheduleSave()
    }

    // MARK: Watch later & likes

    func isInWatchLater(_ videoId: String) -> Bool { watchLater.contains { $0.id == videoId } }

    func toggleWatchLater(_ video: VideoItem) {
        if let index = watchLater.firstIndex(where: { $0.id == video.id }) {
            watchLater.remove(at: index)
        } else {
            watchLater.insert(video, at: 0)
        }
        scheduleSave()
    }

    func isLiked(_ videoId: String) -> Bool { liked.contains { $0.id == videoId } }

    private(set) var disliked: Set<String> = []

    func toggleDislike(_ video: VideoItem) {
        if disliked.remove(video.id) == nil {
            disliked.insert(video.id)
            if isLiked(video.id) { toggleLike(video) }
        }
    }

    func toggleLike(_ video: VideoItem) {
        if let index = liked.firstIndex(where: { $0.id == video.id }) {
            liked.remove(at: index)
        } else {
            liked.insert(video, at: 0)
        }
        scheduleSave()
    }

    // MARK: Playlists

    @discardableResult
    func createPlaylist(named name: String, with video: VideoItem? = nil) -> LocalPlaylist {
        let playlist = LocalPlaylist(name: name, videos: video.map { [$0] } ?? [])
        playlists.insert(playlist, at: 0)
        scheduleSave()
        return playlist
    }

    func add(_ video: VideoItem, to playlistId: UUID) {
        guard let index = playlists.firstIndex(where: { $0.id == playlistId }),
              !playlists[index].videos.contains(where: { $0.id == video.id }) else { return }
        playlists[index].videos.append(video)
        scheduleSave()
    }

    func remove(_ videoId: String, from playlistId: UUID) {
        guard let index = playlists.firstIndex(where: { $0.id == playlistId }) else { return }
        playlists[index].videos.removeAll { $0.id == videoId }
        scheduleSave()
    }

    func movePlaylistVideos(_ playlistId: UUID, from source: IndexSet, to destination: Int) {
        guard let index = playlists.firstIndex(where: { $0.id == playlistId }) else { return }
        playlists[index].videos.move(fromOffsets: source, toOffset: destination)
        scheduleSave()
    }

    func renamePlaylist(_ playlistId: UUID, to name: String) {
        guard let index = playlists.firstIndex(where: { $0.id == playlistId }) else { return }
        playlists[index].name = name
        scheduleSave()
    }

    func deletePlaylist(_ playlistId: UUID) {
        playlists.removeAll { $0.id == playlistId }
        scheduleSave()
    }

    func playlist(_ id: UUID) -> LocalPlaylist? { playlists.first { $0.id == id } }

    // MARK: Search history

    func addSearch(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        searchHistory.removeAll { $0.caseInsensitiveCompare(trimmed) == .orderedSame }
        searchHistory.insert(trimmed, at: 0)
        if searchHistory.count > 50 { searchHistory.removeLast() }
        scheduleSave()
    }

    func removeSearch(_ query: String) {
        searchHistory.removeAll { $0 == query }
        scheduleSave()
    }

    func clearSearchHistory() {
        searchHistory.removeAll()
        scheduleSave()
    }
}
