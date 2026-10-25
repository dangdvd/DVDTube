import Foundation

/// The on-device library in the shape that is synced between devices.
struct LibrarySnapshot {
    var subscriptions: [ChannelItem]
    var history: [HistoryEntry]
    var watchLater: [VideoItem]
    var liked: [VideoItem]
    var playlists: [LocalPlaylist]
    var searchHistory: [String]
}

/// "Đồng bộ thư viện": the `dvdtube-library` JSON shared by every DVDTube platform and the
/// merge rules (union — deletions are not propagated).
enum LibrarySync {
    static let format = "dvdtube-library"
    static let historyLimit = 1000
    static let searchLimit = 50

    enum Failure: LocalizedError {
        case notALibrary
        var errorDescription: String? { "Tệp này không phải thư viện DVDTube." }
    }

    struct Summary {
        var channels = 0
        var videos = 0
        var playlists = 0

        var isEmpty: Bool { channels == 0 && videos == 0 && playlists == 0 }

        var text: String {
            guard !isEmpty else { return "Thư viện đã đồng bộ, không có gì mới." }
            var parts: [String] = []
            if channels > 0 { parts.append("\(channels) kênh") }
            if videos > 0 { parts.append("\(videos) video") }
            if playlists > 0 { parts.append("\(playlists) danh sách phát") }
            return "Đã thêm " + parts.joined(separator: ", ")
        }
    }

    // MARK: JSON

    static func export(_ library: LibrarySnapshot, device: String) -> Data {
        let root: [String: Any] = [
            "format": format,
            "version": 1,
            "exportedAt": CrossJSON.milliseconds(Date()),
            "device": device,
            "platform": CrossJSON.platform,
            "subscriptions": library.subscriptions.map { CrossJSON.channel($0) },
            "history": library.history.map { entry -> [String: Any] in
                [
                    "video": CrossJSON.video(entry.video),
                    "watchedAt": CrossJSON.milliseconds(entry.watchedAt),
                    "position": entry.position.isFinite ? entry.position : 0,
                    "duration": entry.duration.isFinite ? entry.duration : 0,
                ]
            },
            "watchLater": library.watchLater.map { CrossJSON.video($0) },
            "liked": library.liked.map { CrossJSON.video($0) },
            "playlists": library.playlists.map { playlist -> [String: Any] in
                [
                    "id": playlist.id.uuidString.lowercased(),
                    "name": playlist.name,
                    "videos": playlist.videos.map { CrossJSON.video($0) },
                    "createdAt": CrossJSON.milliseconds(playlist.createdAt),
                ]
            },
            "searchHistory": library.searchHistory,
        ]
        return (try? JSONSerialization.data(withJSONObject: root)) ?? Data()
    }

    /// Reads a library file from any platform (unknown keys ignored, missing arrays accepted).
    static func parse(_ data: Data) throws -> (library: LibrarySnapshot, device: String?) {
        guard let json = try? JNode(data: data), json["format"].string == format else { throw Failure.notALibrary }
        let history = json["history"].array.compactMap { node -> HistoryEntry? in
            guard let video = CrossJSON.video(from: node["video"]) else { return nil }
            return HistoryEntry(
                video: video,
                watchedAt: CrossJSON.date(milliseconds: node["watchedAt"]) ?? Date(timeIntervalSince1970: 0),
                position: max(node["position"].double ?? 0, 0),
                duration: max(node["duration"].double ?? 0, 0)
            )
        }
        let playlists = json["playlists"].array.compactMap { node -> LocalPlaylist? in
            let name = (node["name"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { return nil }
            return LocalPlaylist(
                id: node["id"].string.flatMap(UUID.init(uuidString:)) ?? UUID(),
                name: name,
                videos: unique(node["videos"].array.compactMap { CrossJSON.video(from: $0) }),
                createdAt: CrossJSON.date(milliseconds: node["createdAt"]) ?? Date()
            )
        }
        let library = LibrarySnapshot(
            subscriptions: json["subscriptions"].array.compactMap { CrossJSON.channel(from: $0) },
            history: history,
            watchLater: unique(json["watchLater"].array.compactMap { CrossJSON.video(from: $0) }),
            liked: unique(json["liked"].array.compactMap { CrossJSON.video(from: $0) }),
            playlists: playlists,
            searchHistory: json["searchHistory"].array.compactMap(\.string).filter { !$0.isEmpty }
        )
        return (library, json["device"].string)
    }

    private static func unique(_ videos: [VideoItem]) -> [VideoItem] {
        var seen = Set<String>()
        return videos.filter { seen.insert($0.id).inserted }
    }

    // MARK: Merge

    static func merge(local: LibrarySnapshot, remote: LibrarySnapshot) -> (LibrarySnapshot, Summary) {
        var summary = Summary()

        // Subscriptions: union by channel id, keeping the entry that knows more.
        var subscriptions = local.subscriptions
        var channelIndex: [String: Int] = [:]
        for (index, channel) in subscriptions.enumerated() where channelIndex[channel.id] == nil { channelIndex[channel.id] = index }
        for channel in remote.subscriptions {
            if let index = channelIndex[channel.id] {
                if filledFields(channel) > filledFields(subscriptions[index]) { subscriptions[index] = channel }
            } else {
                channelIndex[channel.id] = subscriptions.count
                subscriptions.append(channel)
                summary.channels += 1
            }
        }

        // History: per video the entry watched last (with its position), newest first.
        var byVideo: [String: HistoryEntry] = [:]
        for entry in local.history {
            if let existing = byVideo[entry.id], existing.watchedAt >= entry.watchedAt { continue }
            byVideo[entry.id] = entry
        }
        let localIds = Set(byVideo.keys)
        for entry in remote.history {
            if let existing = byVideo[entry.id] {
                if entry.watchedAt > existing.watchedAt {
                    var newer = entry
                    if newer.duration <= 0 { newer.duration = existing.duration }
                    byVideo[entry.id] = newer
                }
            } else {
                byVideo[entry.id] = entry
                if !localIds.contains(entry.id) { summary.videos += 1 }
            }
        }
        let history = Array(byVideo.values.sorted { $0.watchedAt > $1.watchedAt }.prefix(historyLimit))

        // Watch later / liked: local order, then what only the other device has.
        let watchLater = union(local.watchLater, remote.watchLater, added: &summary.videos)
        let liked = union(local.liked, remote.liked, added: &summary.videos)

        // Playlists: matched by id, else by name; videos are united.
        var playlists = local.playlists
        for remotePlaylist in remote.playlists {
            let name = normalizedName(remotePlaylist.name)
            if let index = playlists.firstIndex(where: { $0.id == remotePlaylist.id })
                ?? playlists.firstIndex(where: { normalizedName($0.name) == name }) {
                playlists[index].videos = union(playlists[index].videos, remotePlaylist.videos, added: &summary.videos)
            } else {
                playlists.append(remotePlaylist)
                summary.playlists += 1
            }
        }

        // Searches: local first, then the other device's (case-insensitive), at most 50.
        var searches = local.searchHistory
        var seenSearches = Set(searches.map { $0.lowercased() })
        for query in remote.searchHistory where seenSearches.insert(query.lowercased()).inserted {
            searches.append(query)
        }

        let merged = LibrarySnapshot(
            subscriptions: subscriptions, history: history, watchLater: watchLater, liked: liked,
            playlists: playlists, searchHistory: Array(searches.prefix(searchLimit))
        )
        return (merged, summary)
    }

    private static func union(_ local: [VideoItem], _ remote: [VideoItem], added: inout Int) -> [VideoItem] {
        var result = local
        var seen = Set(local.map(\.id))
        for video in remote where seen.insert(video.id).inserted {
            result.append(video)
            added += 1
        }
        return result
    }

    private static func normalizedName(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func filledFields(_ channel: ChannelItem) -> Int {
        [channel.name.isEmpty ? nil : channel.name, channel.avatar?.absoluteString, channel.handle,
         channel.subscriberText, channel.videoCountText].compactMap { $0 }.count
    }

    // MARK: Applying

    /// Merges `remote` into the on-device library and saves it.
    @MainActor
    static func apply(_ remote: LibrarySnapshot) -> Summary {
        let (merged, summary) = merge(local: LibraryStore.shared.snapshot, remote: remote)
        LibraryStore.shared.replace(with: merged)
        Log.debug("library sync: +\(summary.channels) channels, +\(summary.videos) videos, +\(summary.playlists) playlists")
        return summary
    }

    /// `DVDTube-thu-vien-YYYYMMDD.json` in the temporary folder, for the share sheet.
    @MainActor
    static func exportFile() throws -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("DVDTube-thu-vien-\(formatter.string(from: Date())).json")
        try export(LibraryStore.shared.snapshot, device: CrossJSON.deviceName).write(to: url, options: .atomic)
        return url
    }
}
