import Foundation
import Observation

/// "Cập nhật": looks for a newer GitHub release. A sideloaded iPhone app cannot install
/// itself, so this only tells the user and opens the release page.
@MainActor
@Observable
final class UpdateChecker {
    static let shared = UpdateChecker()

    struct Release: Identifiable, Equatable {
        var version: String
        var notes: String
        var page: URL
        var id: String { version }
    }

    /// Shown as an alert at the root.
    var available: Release?
    private(set) var isChecking = false

    static let releasesURL = URL(string: "https://api.github.com/repos/dangdvd/DVDTube/releases/latest")!
    static let fallbackPage = URL(string: "https://github.com/dangdvd/DVDTube/releases/latest")!
    private static let lastCheckKey = "update.lastCheck"
    private static let lastShownKey = "update.lastShown"

    private init() {}

    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    /// At launch: at most once a day, when "Tự kiểm tra cập nhật" is on.
    func checkIfDue() async {
        guard AppSettings.shared.autoCheckUpdates else { return }
        let defaults = UserDefaults.standard
        let last = defaults.double(forKey: Self.lastCheckKey)
        guard Date().timeIntervalSince1970 - last > 24 * 3600 else { return }
        defaults.set(Date().timeIntervalSince1970, forKey: Self.lastCheckKey)
        guard let release = try? await fetchLatest(), Self.isNewer(release.version, than: Self.currentVersion) else { return }
        // Never nag more than once a day (dev builds "1.0" are older than every release).
        let shown = defaults.double(forKey: Self.lastShownKey)
        guard Date().timeIntervalSince1970 - shown > 24 * 3600 else { return }
        defaults.set(Date().timeIntervalSince1970, forKey: Self.lastShownKey)
        available = release
    }

    /// "Kiểm tra cập nhật" in Settings: returns a message when there is nothing new.
    func checkNow() async -> String? {
        isChecking = true
        defer { isChecking = false }
        do {
            let release = try await fetchLatest()
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.lastCheckKey)
            if Self.isNewer(release.version, than: Self.currentVersion) {
                available = release
                return nil
            }
            return "Bạn đang dùng bản mới nhất (v\(Self.currentVersion))."
        } catch {
            return "Không kiểm tra được cập nhật: \(error.localizedDescription)"
        }
    }

    private func fetchLatest() async throws -> Release {
        var request = URLRequest(url: Self.releasesURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.httpShouldHandleCookies = false
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        Log.debug("update check -> HTTP \(status)")
        guard status == 200, let json = try? JNode(data: data), let tag = json["tag_name"].string else {
            throw InnerTubeError.http(status)
        }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        let page = json["html_url"].string.flatMap(URL.init(string:)) ?? Self.fallbackPage
        var notes = (json["body"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if notes.count > 600 { notes = String(notes.prefix(600)) + "…" }
        return Release(version: version, notes: notes, page: page)
    }

    /// Numeric comparison of "1.0.N" versions (missing parts count as 0).
    static func isNewer(_ candidate: String, than current: String) -> Bool {
        func parts(_ text: String) -> [Int] {
            text.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        }
        let a = parts(candidate)
        let b = parts(current)
        for index in 0..<max(a.count, b.count) {
            let x = index < a.count ? a[index] : 0
            let y = index < b.count ? b[index] : 0
            if x != y { return x > y }
        }
        return false
    }
}
