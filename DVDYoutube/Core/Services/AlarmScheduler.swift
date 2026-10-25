import Foundation
import Observation
import UserNotifications

/// "Hẹn giờ phát": plays something at a set time. iOS cannot start playback in a suspended
/// app, so each alarm is a time-sensitive local notification (tap → plays); when the app is
/// running at that moment (in front, or playing in the background) it starts by itself.
struct PlaybackAlarm: Codable, Identifiable, Hashable {
    enum Repeat: String, Codable, CaseIterable, Identifiable {
        case once, daily, weekdays, weekend
        var id: String { rawValue }
        var title: String {
            switch self {
            case .once: return "Một lần"
            case .daily: return "Hằng ngày"
            case .weekdays: return "Ngày thường"
            case .weekend: return "Cuối tuần"
            }
        }
        /// Calendar weekdays (1 = Sunday); empty = every day.
        var weekdays: [Int] {
            switch self {
            case .once, .daily: return []
            case .weekdays: return [2, 3, 4, 5, 6]
            case .weekend: return [1, 7]
            }
        }
    }

    enum Content: Codable, Hashable {
        case localPlaylist(UUID)
        case watchLater
        case liked
        case radioFromRecent
        case link(String)
    }

    var id = UUID()
    var hour: Int
    var minute: Int
    var repeatMode: Repeat = .daily
    var content: Content = .watchLater
    /// Volume rises over 30 seconds.
    var fadeIn = true
    var audioOnly = false
    var isEnabled = true
    /// For "Một lần": when it rings (the next occurrence of hour:minute when saved).
    var fireDate: Date?

    var timeText: String { String(format: "%02d:%02d", hour, minute) }
}

@MainActor
@Observable
final class AlarmScheduler {
    static let shared = AlarmScheduler()

    private(set) var alarms: [PlaybackAlarm] = []
    private static let storageKey = "alarms.list"
    private static let identifierPrefix = "alarm-"

    @ObservationIgnored private var monitor: Task<Void, Never>?
    @ObservationIgnored private var lastCheck = Date()
    /// alarm id → when it last started playback (a tapped notification must not restart it).
    @ObservationIgnored private var lastFired: [UUID: Date] = [:]

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.storageKey),
           let list = try? JSONDecoder().decode([PlaybackAlarm].self, from: data) {
            alarms = list
        }
    }

    // MARK: Editing

    func save(_ alarm: PlaybackAlarm) {
        var alarm = alarm
        if alarm.repeatMode == .once { alarm.fireDate = Self.nextDate(hour: alarm.hour, minute: alarm.minute, after: Date()) }
        if let index = alarms.firstIndex(where: { $0.id == alarm.id }) {
            alarms[index] = alarm
        } else {
            alarms.append(alarm)
        }
        alarms.sort { ($0.hour, $0.minute) < ($1.hour, $1.minute) }
        persist()
        Task {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            await reschedule()
        }
    }

    func setEnabled(_ alarm: PlaybackAlarm, _ enabled: Bool) {
        var copy = alarm
        copy.isEnabled = enabled
        save(copy)
    }

    func delete(_ alarm: PlaybackAlarm) {
        alarms.removeAll { $0.id == alarm.id }
        persist()
        Task { await reschedule() }
    }

    private func persist() {
        UserDefaults.standard.set(try? JSONEncoder().encode(alarms), forKey: Self.storageKey)
    }

    // MARK: Notifications

    /// Replaces every pending alarm notification with the current list.
    func reschedule() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let old = pending.map(\.identifier).filter { $0.hasPrefix(Self.identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: old)
        for alarm in alarms where alarm.isEnabled {
            let content = UNMutableNotificationContent()
            content.title = "Hẹn giờ phát"
            content.body = "Đến giờ phát \(contentTitle(alarm.content)). Nhấn để bắt đầu."
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            content.userInfo = ["alarmId": alarm.id.uuidString]
            content.threadIdentifier = "alarms"
            var triggers: [(String, UNCalendarNotificationTrigger)] = []
            if alarm.repeatMode == .once {
                guard let date = alarm.fireDate, date > Date() else { continue }
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                triggers.append(("0", UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
            } else if alarm.repeatMode.weekdays.isEmpty {
                let parts = DateComponents(hour: alarm.hour, minute: alarm.minute)
                triggers.append(("0", UNCalendarNotificationTrigger(dateMatching: parts, repeats: true)))
            } else {
                for weekday in alarm.repeatMode.weekdays {
                    let parts = DateComponents(hour: alarm.hour, minute: alarm.minute, weekday: weekday)
                    triggers.append((String(weekday), UNCalendarNotificationTrigger(dateMatching: parts, repeats: true)))
                }
            }
            for (suffix, trigger) in triggers {
                let request = UNNotificationRequest(identifier: "\(Self.identifierPrefix)\(alarm.id.uuidString)-\(suffix)",
                                                    content: content, trigger: trigger)
                try? await center.add(request)
            }
        }
        Log.debug("alarms: \(alarms.filter(\.isEnabled).count) scheduled")
    }

    // MARK: Ringing while the app runs

    /// Checks every 15 s whether an alarm time has come (also while playing in the background).
    func startMonitoring() {
        guard monitor == nil else { return }
        lastCheck = Date()
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                self?.check()
            }
        }
    }

    private func check() {
        let now = Date()
        defer { lastCheck = now }
        for alarm in alarms where alarm.isEnabled {
            guard let due = Self.occurrence(of: alarm, after: lastCheck), due <= now else { continue }
            // Only when it is really now (not a time missed while suspended).
            guard now.timeIntervalSince(due) < 120 else { continue }
            fire(alarm.id)
        }
    }

    /// The next time `alarm` rings after `date`.
    static func occurrence(of alarm: PlaybackAlarm, after date: Date) -> Date? {
        if alarm.repeatMode == .once {
            guard let fire = alarm.fireDate, fire > date else { return nil }
            return fire
        }
        let calendar = Calendar.current
        var candidate = nextDate(hour: alarm.hour, minute: alarm.minute, after: date)
        let weekdays = alarm.repeatMode.weekdays
        guard !weekdays.isEmpty else { return candidate }
        for _ in 0..<8 {
            if weekdays.contains(calendar.component(.weekday, from: candidate)) { return candidate }
            candidate = calendar.date(byAdding: .day, value: 1, to: candidate) ?? candidate.addingTimeInterval(86_400)
        }
        return nil
    }

    static func nextDate(hour: Int, minute: Int, after date: Date) -> Date {
        let calendar = Calendar.current
        let today = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date) ?? date
        if today > date { return today }
        return calendar.date(byAdding: .day, value: 1, to: today) ?? today.addingTimeInterval(86_400)
    }

    /// The alarm rang (in-app timer, notification shown in front, or tapped).
    func fire(_ id: UUID) {
        guard let alarm = alarms.first(where: { $0.id == id }) else { return }
        if let last = lastFired[id], Date().timeIntervalSince(last) < 600 {
            // Already playing for this alarm: just show it.
            if alarm.audioOnly { Router.shared.showMusicPlayer = true } else { PlayerManager.shared.isExpanded = true }
            return
        }
        lastFired[id] = Date()
        if alarm.repeatMode == .once, let index = alarms.firstIndex(where: { $0.id == id }) {
            alarms[index].isEnabled = false
            persist()
        }
        Log.debug("alarm: ringing")
        Task {
            let resolved = await resolve(alarm.content)
            let videos = resolved.videos
            guard let first = videos.first else {
                PlayerManager.shared.showToast("Hẹn giờ phát: không có nội dung để phát")
                return
            }
            let player = PlayerManager.shared
            if alarm.audioOnly || resolved.radioId != nil {
                player.playMusic(first, queue: videos, radio: resolved.radioId, audioOnly: alarm.audioOnly)
            } else {
                player.play(first, queue: videos)
            }
            if alarm.fadeIn { player.startFadeIn(seconds: 30) }
            player.showToast("Hẹn giờ phát lúc \(alarm.timeText)")
        }
    }

    // MARK: Content

    func contentTitle(_ content: PlaybackAlarm.Content) -> String {
        switch content {
        case .localPlaylist(let id): return "“\(LibraryStore.shared.playlist(id)?.name ?? "Danh sách phát")”"
        case .watchLater: return "Xem sau"
        case .liked: return "Video đã thích"
        case .radioFromRecent: return "radio từ bài nghe gần nhất"
        case .link: return "liên kết đã dán"
        }
    }

    private func resolve(_ content: PlaybackAlarm.Content) async -> (videos: [VideoItem], radioId: String?) {
        let library = LibraryStore.shared
        let account = AccountStore.shared
        switch content {
        case .localPlaylist(let id):
            return (library.playlist(id)?.videos ?? [], nil)
        case .watchLater:
            if account.isSignedIn, let page = try? await YouTubeService.shared.accountFeed("VLWL"), !page.videos.isEmpty {
                return (page.videos, nil)
            }
            return (library.watchLater, nil)
        case .liked:
            if account.isSignedIn, let page = try? await YouTubeService.shared.accountFeed("VLLL"), !page.videos.isEmpty {
                return (page.videos, nil)
            }
            return (library.liked, nil)
        case .radioFromRecent:
            guard let seed = MusicRecents.shared.items.first
                ?? library.history.first(where: { !$0.video.isShort && !$0.video.isLive })?.video else { return ([], nil) }
            let mixId = "RDAMVM" + seed.id
            var videos = (try? await YouTubeService.shared.playlist(mixId))?.page.videos.filter { !$0.isShort && !$0.isLive } ?? []
            if !videos.contains(where: { $0.id == seed.id }) { videos.insert(seed, at: 0) }
            return (videos, mixId)
        case .link(let text):
            if let id = YouTubeService.videoId(from: text) {
                return ([VideoItem(id: id, title: "")], nil)
            }
            if let list = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines))?
                .queryItems?.first(where: { $0.name == "list" })?.value,
               let videos = try? await YouTubeService.shared.allPlaylistVideos(list, limit: 100) {
                return (videos, nil)
            }
            return ([], nil)
        }
    }
}
