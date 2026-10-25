import CryptoKit
import Foundation
import SwiftUI
import UIKit

/// DeArrow (https://dearrow.ajay.app): crowd-sourced titles and thumbnails that replace
/// clickbait. Uses the hash-prefix API, so the exact video id is never sent. Results are
/// cached for an hour (memory + a small disk file); at most 4 requests run at once and
/// only for items on screen. The original title / thumbnail always shows first.
actor DeArrow {
    static let shared = DeArrow()

    struct Branding: Codable {
        var title: String?
        var thumbnailTime: Double?
        var fetchedAt: Date
    }

    private var cache: [String: Branding] = [:]
    private var inFlight: [String: Task<Branding?, Never>] = [:]
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var loadedDisk = false
    private var saveScheduled = false
    /// Thumbnails that failed to load (kept to the original).
    private var badThumbnails = Set<String>()

    private static let ttl: TimeInterval = 3600
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.timeoutIntervalForRequest = 10
        return URLSession(configuration: configuration)
    }()

    private static var diskURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("dearrow.json")
    }

    // MARK: Public

    /// The replacement title, if DeArrow has one.
    func title(for videoId: String) async -> String? {
        await branding(for: videoId)?.title
    }

    /// Cached title only (no request), for places that can't wait.
    func cachedTitle(for videoId: String) -> String? {
        guard let entry = cache[videoId], Date().timeIntervalSince(entry.fetchedAt) < Self.ttl else { return nil }
        return entry.title
    }

    /// The replacement thumbnail, checked to load (otherwise nil: keep the original).
    func thumbnail(for videoId: String) async -> URL? {
        guard let time = await branding(for: videoId)?.thumbnailTime, !badThumbnails.contains(videoId) else { return nil }
        var components = URLComponents(string: "https://dearrow-thumb.ajay.app/api/v1/getThumbnail")!
        components.queryItems = [
            URLQueryItem(name: "videoID", value: videoId),
            URLQueryItem(name: "time", value: String(time)),
        ]
        guard let url = components.url else { return nil }
        if ImageLoader.shared.cached(url) != nil { return url }
        let image = await ImageLoader.shared.image(for: url)
        guard let image, image.size.width > 1, image.size.height > 1 else {
            badThumbnails.insert(videoId)
            return nil
        }
        return url
    }

    // MARK: Fetching

    private func branding(for videoId: String) async -> Branding? {
        loadDiskIfNeeded()
        if let entry = cache[videoId], Date().timeIntervalSince(entry.fetchedAt) < Self.ttl { return entry }
        if let task = inFlight[videoId] { return await task.value }
        let task = Task<Branding?, Never> { await self.fetch(videoId) }
        inFlight[videoId] = task
        let result = await task.value
        inFlight[videoId] = nil
        if let result {
            cache[videoId] = result
            if cache.count > 3000 {
                let cutoff = Date().addingTimeInterval(-Self.ttl)
                cache = cache.filter { $0.value.fetchedAt > cutoff }
            }
            scheduleSave()
        }
        return result
    }

    private func acquire() async {
        if running < 4 {
            running += 1
            return
        }
        await withCheckedContinuation { continuation in waiting.append(continuation) }
    }

    private func release() {
        if waiting.isEmpty {
            running -= 1
        } else {
            waiting.removeFirst().resume()
        }
    }

    private func fetch(_ videoId: String) async -> Branding? {
        await acquire()
        defer { release() }
        let digest = SHA256.hash(data: Data(videoId.utf8)).map { String(format: "%02x", $0) }.joined()
        guard let url = URL(string: "https://sponsor.ajay.app/api/branding/\(digest.prefix(4))") else { return nil }
        guard let (data, response) = try? await Self.session.data(from: url) else { return nil }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // 404: nothing submitted for this prefix.
        if status == 404 { return Branding(title: nil, thumbnailTime: nil, fetchedAt: Date()) }
        guard status == 200, let json = try? JNode(data: data) else { return nil }
        return Self.parse(json[videoId])
    }

    /// First title / thumbnail that is not the original and is trusted (votes ≥ 0 or locked).
    static func parse(_ entry: JNode) -> Branding {
        let title = entry["titles"].array.first { node in
            node["original"].bool == false && ((node["votes"].int ?? 0) >= 0 || node["locked"].bool == true)
        }?["title"].string.map(cleanTitle)
        let thumbnail = entry["thumbnails"].array.first { node in
            node["original"].bool == false && ((node["votes"].int ?? 0) >= 0 || node["locked"].bool == true)
                && node["timestamp"].double != nil
        }?["timestamp"].double
        return Branding(title: title?.isEmpty == false ? title : nil, thumbnailTime: thumbnail, fetchedAt: Date())
    }

    /// DeArrow marks titles that must not be auto-formatted with a leading ">".
    static func cleanTitle(_ title: String) -> String {
        var text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix(">") { text.removeFirst() }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Disk cache

    private func loadDiskIfNeeded() {
        guard !loadedDisk else { return }
        loadedDisk = true
        guard let data = try? Data(contentsOf: Self.diskURL),
              let stored = try? JSONDecoder().decode([String: Branding].self, from: data) else { return }
        let cutoff = Date().addingTimeInterval(-Self.ttl)
        for (id, entry) in stored where entry.fetchedAt > cutoff && cache[id] == nil { cache[id] = entry }
    }

    private func scheduleSave() {
        guard !saveScheduled else { return }
        saveScheduled = true
        Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            self.saveNow()
        }
    }

    private func saveNow() {
        saveScheduled = false
        let cutoff = Date().addingTimeInterval(-Self.ttl)
        let fresh = cache.filter { $0.value.fetchedAt > cutoff }
        let small = fresh.count > 1500 ? Dictionary(uniqueKeysWithValues: fresh.sorted { $0.value.fetchedAt > $1.value.fetchedAt }.prefix(1500).map { ($0.key, $0.value) }) : fresh
        guard let data = try? JSONEncoder().encode(small) else { return }
        try? data.write(to: Self.diskURL, options: .atomic)
    }
}

// MARK: - Views

/// A video title, replaced by DeArrow's when there is one (long press shows the original).
struct DeArrowTitle: View {
    let video: VideoItem
    /// Shown while nothing better is known (e.g. the watch page's own title).
    var fallback: String?

    @Environment(AppSettings.self) private var settings
    @State private var replacement: String?

    var body: some View {
        let original = fallback ?? video.title
        let useReplacement = settings.deArrowEnabled && settings.deArrowTitles
        Group {
            if useReplacement, let replacement, !replacement.isEmpty, replacement != original {
                // Long press: "Tiêu đề gốc".
                Text(replacement)
                    .contextMenu {
                        Section("Tiêu đề gốc") {
                            Text(original)
                        }
                        Button {
                            UIPasteboard.general.string = original
                        } label: {
                            Label("Sao chép tiêu đề gốc", systemImage: "doc.on.doc")
                        }
                    }
            } else {
                Text(original)
            }
        }
        .task(id: video.id) {
            replacement = nil
            guard useReplacement, !video.id.isEmpty else { return }
            let title = await DeArrow.shared.title(for: video.id)
            guard !Task.isCancelled else { return }
            replacement = title
        }
    }
}

/// `RemoteImage` of a video thumbnail, swapped for DeArrow's once it has loaded.
struct DeArrowThumbnail: View {
    let video: VideoItem
    var url: URL?
    var contentMode: ContentMode = .fill

    @Environment(AppSettings.self) private var settings
    @State private var replacement: URL?

    var body: some View {
        let enabled = settings.deArrowEnabled && settings.deArrowThumbnails && !video.isShort
        RemoteImage(url: enabled ? (replacement ?? url ?? video.displayThumbnail) : (url ?? video.displayThumbnail),
                    contentMode: contentMode)
            .task(id: video.id) {
                replacement = nil
                guard enabled, !video.id.isEmpty, !video.isLive else { return }
                let found = await DeArrow.shared.thumbnail(for: video.id)
                guard !Task.isCancelled else { return }
                replacement = found
            }
    }
}
