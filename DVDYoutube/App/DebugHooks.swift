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

    /// Runs the chat of the demo video for a while and logs what was parsed (no message text).
    private static func probeLiveChat() async {
        for _ in 0..<40 {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard let info = PlayerManager.shared.watchInfo else { continue }
            guard let chat = info.liveChat else {
                Log.debug("live chat probe: no chat on this video")
                return
            }
            Log.debug("live chat probe: modes=\(chat.modes.map(\.title)) replay=\(chat.isReplay)")
            let model = LiveChatModel(info: chat)
            model.start()
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            let kinds = Dictionary(grouping: model.messages) { message -> String in
                switch message.kind {
                case .text: return "text"
                case .paid: return "paid"
                case .membership: return "membership"
                case .system: return "system"
                }
            }.mapValues(\.count)
            Log.debug("live chat probe: \(model.messages.count) messages \(kinds), error=\(model.error ?? "none"), ended=\(model.hasEnded)")
            model.stop()
            return
        }
        Log.debug("live chat probe: watch info did not load")
    }
}
