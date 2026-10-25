import Foundation
import os
import UIKit

/// Diagnostics. Every line goes to an in-memory log the user can copy from Settings
/// (endpoints, HTTP status codes and errors only — never cookies or account data).
/// With the `-DVDTubeVerbose` launch argument (CI smoke test) lines also go to stderr.
enum Log {
    static let verbose = ProcessInfo.processInfo.arguments.contains("-DVDTubeVerbose")
    private static let logger = Logger(subsystem: "com.dangdvd.dvdtube", category: "app")

    static func debug(_ message: @autoclosure () -> String) {
        let text = message()
        DiagnosticsLog.shared.append(text)
        guard verbose else { return }
        logger.debug("\(text, privacy: .public)")
        // stderr is unbuffered, so lines survive the app being terminated by `simctl`.
        FileHandle.standardError.write(Data("[DVDTube] \(text)\n".utf8))
    }
}

/// Ring buffer of the most recent log lines.
final class DiagnosticsLog: @unchecked Sendable {
    static let shared = DiagnosticsLog()

    private let lock = NSLock()
    private var lines: [String] = []
    /// Player errors, HTTP failures… kept apart so they survive a long, chatty session.
    private var errors: [String] = []
    private let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
    private let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    static let maxLines = 2000

    func append(_ line: String) {
        lock.lock()
        lines.append("\(formatter.string(from: Date())) \(line)")
        if lines.count > Self.maxLines { lines.removeFirst(lines.count - Self.maxLines) }
        if Self.isError(line) {
            errors.append("\(dayFormatter.string(from: Date())) \(line)")
            if errors.count > 300 { errors.removeFirst(errors.count - 300) }
        }
        lock.unlock()
    }

    private static func isError(_ line: String) -> Bool {
        let lower = line.lowercased()
        if lower.contains("failed") || lower.contains("error") || lower.contains("lỗi") || lower.contains("refused") { return true }
        // "… -> HTTP 403, 12 bytes"
        if let range = line.range(of: #"HTTP [45]\d\d"#, options: .regularExpression), !range.isEmpty { return true }
        return false
    }

    /// The last lines and the recent errors (for "Gửi nhật ký lỗi").
    var snapshot: (lines: [String], errors: [String]) {
        lock.lock()
        defer { lock.unlock() }
        return (lines, errors)
    }

    @MainActor
    var text: String {
        lock.lock()
        defer { lock.unlock() }
        let device = "\(UIDevice.current.model) iOS \(UIDevice.current.systemVersion)"
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        return (["DVDTube \(version) • \(device)"] + lines).joined(separator: "\n")
    }

    func clear() {
        lock.lock()
        lines.removeAll()
        errors.removeAll()
        lock.unlock()
    }
}

/// Launch arguments that drive the app into a given screen, for automated screenshots:
/// `-DVDTubeDemoVideo <id>`, `-DVDTubeDemoSearch <query>`, `-DVDTubeDemoChannel <id or @handle>`,
/// `-DVDTubeDemoTab shorts|subscriptions|library`, `-DVDTubeDemoMusic` (music screen),
/// `-DVDTubeDemoMusicProbe` (music search / lyrics / DeArrow, logged as counts).
@MainActor
enum DebugHooks {
    static func apply() {
        let arguments = ProcessInfo.processInfo.arguments
        func value(_ key: String) -> String? {
            guard let index = arguments.firstIndex(of: key), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        let router = Router.shared
        switch value("-DVDTubeDemoTab") {
        case "shorts": router.selectedTab = .shorts
        case "subscriptions": router.selectedTab = .subscriptions
        case "library": router.selectedTab = .library
        default: break
        }
        if let query = value("-DVDTubeDemoSearch") {
            router.open(.searchResults(query))
        }
        if let channel = value("-DVDTubeDemoChannel") {
            router.openChannel(id: channel)
        }
        if arguments.contains("-DVDTubeDemoAudioOnly") {
            PlayerManager.shared.setAudioOnly(true)
        }
        if arguments.contains("-DVDTubeDemoSleepTimer") {
            PlayerManager.shared.setSleepTimer(minutes: 1)
        }
        if let video = value("-DVDTubeDemoVideo") {
            PlayerManager.shared.play(VideoItem(id: video, title: ""))
        }
        if arguments.contains("-DVDTubeDemoLiveChat") {
            Task { await probeLiveChat() }
        }
        if arguments.contains("-DVDTubeDemoCastRelay") {
            Task { await probeCastRelay() }
        }
        if arguments.contains("-DVDTubeDemoMusic") {
            router.open(.music)
        }
        if arguments.contains("-DVDTubeDemoMusicProbe") {
            Task { await probeMusic() }
        }
    }

    /// YouTube Music search, lyrics, an album page and DeArrow, logged as counts only.
    private static func probeMusic() async {
        do {
            let songs = try await MusicService.search("Sơn Tùng M-TP", kind: .songs)
            Log.debug("music probe: \(songs.count) songs, first has video id=\(songs.first.map { !$0.id.isEmpty } ?? false)")
            let albums = try await MusicService.search("Sơn Tùng M-TP", kind: .albums)
            Log.debug("music probe: \(albums.count) albums")
            if let album = albums.first {
                let page = try await MusicService.page(browseId: album.id)
                Log.debug("music probe: album page tracks=\(page.tracks.count) shelves=\(page.shelves.count)")
            }
            for song in songs.prefix(3) {
                let lyrics = try await MusicService.lyrics(videoId: song.id)
                Log.debug("music probe: lyrics found=\(lyrics != nil) timed=\(lyrics?.isTimed ?? false) lines=\(lyrics?.lines.count ?? 0)")
                if lyrics != nil { break }
            }
        } catch {
            Log.debug("music probe failed: \(error.localizedDescription)")
        }
        let title = await DeArrow.shared.title(for: "dQw4w9WgXcQ")
        Log.debug("dearrow probe: title replaced=\(title != nil)")
    }

    /// Finds a stream that is live right now, runs its chat for a while and logs what
    /// was parsed (counts only, no message text).
    private static func probeLiveChat() async {
        do {
            let results = try await YouTubeService.shared.search("lofi", filter: .live)
            guard let live = results.videos.first(where: \.isLive) ?? results.videos.first else {
                Log.debug("live chat probe: no live stream found")
                return
            }
            let info = try await YouTubeService.shared.watchInfo(live.id)
            guard let chat = info.liveChat else {
                Log.debug("live chat probe: \(live.id) has no chat")
                return
            }
            Log.debug("live chat probe: \(live.id) modes=\(chat.modes.map(\.title)) replay=\(chat.isReplay)")
            let model = LiveChatModel(info: chat)
            model.start()
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            let kinds = Dictionary(grouping: model.messages) { message -> String in
                switch message.kind {
                case .text: return "text"
                case .paid: return "paid"
                case .membership: return "membership"
                case .system: return "system"
                }
            }.mapValues(\.count)
            let badges = model.messages.filter { $0.isOwner || $0.isModerator || $0.isMember || $0.isVerified }.count
            Log.debug("live chat probe: \(model.messages.count) messages \(kinds), badges=\(badges), withPhoto=\(model.messages.filter { $0.authorPhoto != nil }.count), error=\(model.error ?? "none"), ended=\(model.hasEnded), views=\(model.modes.map(\.title))")
            if let other = model.modes.first(where: { $0 != model.selectedMode }) {
                model.select(other)
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                Log.debug("live chat probe: switched to \(other.title): \(model.messages.count) messages, error=\(model.error ?? "none")")
            }
            model.stop()
        } catch {
            Log.debug("live chat probe failed: \(error.localizedDescription)")
        }
        await probeChatReplay()
    }

    /// Plays the TV's part against the Chromecast relay with Apple's public HLS sample:
    /// master playlist, a media playlist, the init segment and a byte range of a segment.
    private static func probeCastRelay() async {
        let sample = URL(string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8")!
        func get(_ url: URL, range: String? = nil, method: String = "GET") async -> (Int, Data, [AnyHashable: Any]) {
            var request = URLRequest(url: url)
            request.httpMethod = method
            if let range { request.setValue(range, forHTTPHeaderField: "Range") }
            guard let result = try? await URLSession.shared.data(for: request),
                  let http = result.1 as? HTTPURLResponse else { return (0, Data(), [:]) }
            return (http.statusCode, result.0, http.allHeaderFields)
        }
        func uris(_ text: String) -> [URL] {
            text.components(separatedBy: .newlines).compactMap { line -> URL? in
                if line.hasPrefix("#") {
                    guard let start = line.range(of: "URI=\""), let end = line[start.upperBound...].firstIndex(of: "\"") else { return nil }
                    return URL(string: String(line[start.upperBound..<end]))
                }
                return line.isEmpty ? nil : URL(string: line)
            }
        }
        do {
            let prepared = try await CastProxy.shared.prepare(hls: sample, host: "127.0.0.1")
            let master = await get(prepared.url)
            let masterText = String(decoding: master.1, as: UTF8.self)
            let masterURIs = uris(masterText)
            let allLocal = masterURIs.allSatisfy { $0.host == "127.0.0.1" }
            Log.debug("relay probe: master -> \(master.0), \(masterURIs.count) uris, all relayed=\(allLocal), fmp4=\(prepared.isFMP4), cors=\(master.2["Access-Control-Allow-Origin"] ?? "none"), variants=\(masterText.components(separatedBy: "#EXT-X-STREAM-INF").count - 1)")
            guard let variant = masterURIs.first(where: { $0.path.hasSuffix(".m3u8") }) else { return }
            let media = await get(variant)
            let mediaURIs = uris(String(decoding: media.1, as: UTF8.self))
            Log.debug("relay probe: media playlist -> \(media.0), \(mediaURIs.count) uris, all relayed=\(mediaURIs.allSatisfy { $0.host == "127.0.0.1" })")
            if let first = mediaURIs.first {
                let head = await get(first, method: "HEAD")
                Log.debug("relay probe: HEAD first resource -> \(head.0), length=\(head.2["Content-Length"] ?? "none")")
                let start = await get(first, range: "bytes=0-65535")
                Log.debug("relay probe: first resource range -> \(start.0), \(start.1.count) bytes")
            }
            if mediaURIs.count > 1 {
                let partial = await get(mediaURIs[1], range: "bytes=0-1023")
                Log.debug("relay probe: segment range -> \(partial.0), \(partial.1.count) bytes, content-range=\(partial.2["Content-Range"] ?? "none")")
            }
            let preflight = await get(prepared.url, method: "OPTIONS")
            Log.debug("relay probe: preflight -> \(preflight.0)")
            CastProxy.shared.stop()
        } catch {
            Log.debug("relay probe failed: \(error.localizedDescription)")
        }
    }

    /// A finished stream's chat replay: the frame page, then one fetch 10 minutes in.
    private static func probeChatReplay() async {
        do {
            var candidates: [VideoItem] = []
            for channel in ["@LofiGirl", "@NASA"] {
                let streams = try await YouTubeService.shared.channel(channel, tab: .streams)
                Log.debug("chat replay probe: \(channel) streams tab has \(streams.initialPage.videos.count) videos")
                candidates += streams.initialPage.videos.filter { !$0.isLive }.prefix(3)
            }
            for video in candidates {
                let chat = try await YouTubeService.shared.watchInfo(video.id).liveChat
                Log.debug("chat replay probe: \(video.id) chat=\(chat.map { $0.isReplay ? "replay" : "live" } ?? "none")")
                guard let chat, chat.isReplay else { continue }
                let page = LiveChatParser.parse(try await InnerTube.shared.liveChatPage(continuation: chat.modes[0].continuation, replay: true))
                Log.debug("chat replay probe: \(video.id) page messages=\(page.messages.count) next=\(page.continuation != nil) seek=\(page.seekContinuation != nil)")
                if let token = page.seekContinuation ?? page.continuation {
                    let chunk = LiveChatParser.parse(try await InnerTube.shared.liveChatReplay(continuation: token, offsetMs: 600_000))
                    let offsets = chunk.messages.compactMap(\.offsetMs)
                    Log.debug("chat replay probe: at 10:00 messages=\(chunk.messages.count) offsets=\(offsets.min() ?? -1)...\(offsets.max() ?? -1) next=\(chunk.continuation != nil)")
                }
                return
            }
            Log.debug("chat replay probe: no past stream with chat replay found")
        } catch {
            Log.debug("chat replay probe failed: \(error.localizedDescription)")
        }
    }
}
