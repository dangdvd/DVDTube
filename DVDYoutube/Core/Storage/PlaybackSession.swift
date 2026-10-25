import Foundation
import Observation

/// The current video, position, queue and playlist, saved so the next launch can bring them
/// back (paused) in the mini player.
enum PlaybackSessionStore {
    struct Session: Codable {
        var video: VideoItem
        var position: Double
        var queue: [VideoItem]
        var index: Int
        var playlistId: String?
        var music: Bool
        var savedAt: Date
    }

    private static var fileURL: URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("playback-session.json")
    }

    static func save(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    static func load() -> Session? {
        guard let data = try? Data(contentsOf: fileURL),
              let session = try? JSONDecoder().decode(Session.self, from: data) else { return nil }
        // Something from weeks ago is not "where I left off" any more.
        guard Date().timeIntervalSince(session.savedAt) < 30 * 86_400 else { return nil }
        return session
    }

    static func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}

/// Songs recently played in music mode ("Gần đây" on the music screen).
@MainActor
@Observable
final class MusicRecents {
    static let shared = MusicRecents()

    private(set) var items: [VideoItem] = []
    private static let key = "music.recents"

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let list = try? JSONDecoder().decode([VideoItem].self, from: data) {
            items = list
        }
    }

    func add(_ video: VideoItem) {
        guard !AppSettings.shared.isIncognito, AppSettings.shared.saveHistory else { return }
        var entry = video
        if entry.title.isEmpty, let existing = items.first(where: { $0.id == video.id }) { entry = existing }
        guard !entry.title.isEmpty else { return }
        items.removeAll { $0.id == video.id }
        items.insert(entry, at: 0)
        if items.count > 40 { items.removeLast(items.count - 40) }
        UserDefaults.standard.set(try? JSONEncoder().encode(items), forKey: Self.key)
    }

    func clear() {
        items = []
        UserDefaults.standard.removeObject(forKey: Self.key)
    }
}
