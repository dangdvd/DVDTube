import Foundation
import Observation

/// `dvdtube://` links (QR codes, widgets, notifications) and shared YouTube links:
/// `watch?v=<id>[&t=<s>]`, `search?q=`, `shorts`, `music`, `sync?…`, `tv-login?…`.
@MainActor
@Observable
final class DeepLinks {
    static let shared = DeepLinks()

    /// A scanned "sign in on the TV" code waiting for the user's confirmation.
    var tvLogin: TVLoginRequest?
    var tvLoginNeedsAccount = false
    /// A scanned library sync code waiting for the user's confirmation.
    var syncRequest: SyncRequest?
    /// Result of the last sync started from here (shown in an alert).
    var syncResult: String?
    private(set) var isSyncing = false

    private init() {}

    func open(_ url: URL) {
        let player = PlayerManager.shared
        let router = Router.shared
        if url.scheme == "dvdtube" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
            switch url.host {
            case "tv-login":
                guard let request = TVLoginRequest(url: url) else {
                    player.showToast("Mã QR đăng nhập TV không hợp lệ")
                    return
                }
                if AccountStore.shared.isSignedIn, AuthSession.shared.isAuthenticated {
                    tvLogin = request
                } else {
                    tvLoginNeedsAccount = true
                }
                return
            case "sync":
                guard let request = SyncRequest(url: url) else {
                    player.showToast("Mã QR đồng bộ không hợp lệ hoặc không thuộc mạng nội bộ")
                    return
                }
                syncRequest = request
                return
            case "watch":
                if let id = value("v"), !id.isEmpty {
                    let start = value("t").flatMap { Self.seconds($0) }
                    player.play(VideoItem(id: id, title: ""), startAt: start)
                }
                return
            case "search":
                if ParentalControls.shared.searchDisabled {
                    player.showToast("Tìm kiếm đã bị tắt trong Kiểm soát của phụ huynh")
                    return
                }
                let query = (value("q") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                router.open(query.isEmpty ? .search : .searchResults(query))
                return
            case "shorts":
                guard !ParentalControls.shared.shortsHidden else { return }
                player.isExpanded = false
                router.selectedTab = .shorts
                return
            case "music":
                router.open(.music)
                return
            default:
                break
            }
        }
        // Any YouTube link opened with the app (dvdtube://<path> works like youtube.com/<path>).
        var text = url.absoluteString
        if url.scheme == "dvdtube" {
            text = text.replacingOccurrences(of: "dvdtube://", with: "https://www.youtube.com/")
        }
        let query = URLComponents(string: text)?.queryItems ?? []
        if let id = YouTubeService.videoId(from: text) {
            let startText = query.first(where: { $0.name == "t" || $0.name == "start" })?.value
            let start = startText.flatMap { Self.seconds($0) }
            player.play(VideoItem(id: id, title: ""), startAt: start)
        } else if let list = query.first(where: { $0.name == "list" })?.value, !list.isEmpty {
            router.open(.playlist(PlaylistItem(id: list, title: "Danh sách phát")))
        }
    }

    /// "90", "90s", "1m30s", "1h2m3s".
    static func seconds(_ text: String) -> Double? {
        if let plain = Double(text) { return plain > 0 ? plain : nil }
        var total = 0.0
        var number = ""
        for character in text.lowercased() {
            if character.isNumber {
                number.append(character)
            } else if let value = Double(number) {
                switch character {
                case "h": total += value * 3600
                case "m": total += value * 60
                case "s": total += value
                default: break
                }
                number = ""
            }
        }
        if let value = Double(number) { total += value }
        return total > 0 ? total : nil
    }

    // MARK: Library sync (sending side)

    func confirmSync(_ request: SyncRequest) {
        guard !isSyncing else { return }
        isSyncing = true
        PlayerManager.shared.showToast("Đang đồng bộ với \(request.name)…")
        Task {
            defer { self.isSyncing = false }
            do {
                let summary = try await SyncSender.send(request)
                self.syncResult = "Đã đồng bộ với \(request.name). \(summary.text)"
            } catch {
                self.syncResult = error.localizedDescription
            }
        }
    }

    // MARK: TV sign-in

    func sendTVLogin(_ request: TVLoginRequest) {
        let cookies = AuthSession.shared.cookieSnapshot
        Task {
            do {
                let name = try await TVLoginSender.send(request, cookies: cookies)
                PlayerManager.shared.showToast(name.isEmpty ? "Đã đăng nhập DVDTube trên TV" : "Đã đăng nhập trên TV: \(name)")
            } catch {
                PlayerManager.shared.showToast(error.localizedDescription)
            }
        }
    }
}
