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
    private let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    func append(_ line: String) {
        lock.lock()
        lines.append("\(formatter.string(from: Date())) \(line)")
        if lines.count > 500 { lines.removeFirst(lines.count - 500) }
        lock.unlock()
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
        lock.unlock()
    }
}

/// Launch arguments that drive the app into a given screen, for automated screenshots:
/// `-DVDTubeDemoVideo <id>`, `-DVDTubeDemoSearch <query>`, `-DVDTubeDemoChannel <id or @handle>`,
/// `-DVDTubeDemoTab shorts|subscriptions|library`.
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
        if let video = value("-DVDTubeDemoVideo") {
            PlayerManager.shared.play(VideoItem(id: video, title: ""))
        }
        if arguments.contains("-DVDTubeDemoLiveChat") {
            Task { await probeLiveChat() }
        }
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
            Log.debug("live chat probe: \(model.messages.count) messages \(kinds), badges=\(badges), withPhoto=\(model.messages.filter { $0.authorPhoto != nil }.count), error=\(model.error ?? "none"), ended=\(model.hasEnded)")
            model.stop()
        } catch {
            Log.debug("live chat probe failed: \(error.localizedDescription)")
        }
        await probeChatReplay()
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
