import Foundation
import os

/// Diagnostics, enabled with the `-DVDTubeVerbose` launch argument (used by the CI smoke test).
enum Log {
    static let verbose = ProcessInfo.processInfo.arguments.contains("-DVDTubeVerbose")
    private static let logger = Logger(subsystem: "com.dangdvd.dvdtube", category: "app")

    static func debug(_ message: @autoclosure () -> String) {
        guard verbose else { return }
        let text = message()
        logger.debug("\(text, privacy: .public)")
        // stderr is unbuffered, so lines survive the app being terminated by `simctl`.
        FileHandle.standardError.write(Data("[DVDTube] \(text)\n".utf8))
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
    }
}
