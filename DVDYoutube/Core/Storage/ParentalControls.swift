import CryptoKit
import Foundation
import Observation

/// "Kiểm soát của phụ huynh": restricted mode, a daily watch-time limit, allowed hours,
/// blocked keywords and a few switches, all behind a 4-digit PIN (salted SHA-256, on this
/// device only). There is no account to recover a forgotten PIN: "Quên mã PIN" resets
/// every parental setting after a confirmation.
@MainActor
@Observable
final class ParentalControls {
    static let shared = ParentalControls()

    enum LockReason: Equatable {
        case dailyLimit
        case outsideHours
    }

    private(set) var isEnabled: Bool
    var restrictedMode: Bool { didSet { save("restricted", restrictedMode) } }
    /// Minutes per day (0 = no limit).
    var dailyLimitMinutes: Int { didSet { save("dailyLimit", dailyLimitMinutes) } }
    var hoursEnabled: Bool { didSet { save("hoursEnabled", hoursEnabled) } }
    /// Minutes after midnight.
    var hoursStart: Int { didSet { save("hoursStart", hoursStart) } }
    var hoursEnd: Int { didSet { save("hoursEnd", hoursEnd) } }
    var blockedKeywords: String { didSet { save("keywords", blockedKeywords) } }
    var hideComments: Bool { didSet { save("hideComments", hideComments) } }
    var hideShorts: Bool { didSet { save("hideShorts", hideShorts) } }
    var disableSearch: Bool { didSet { save("disableSearch", disableSearch) } }

    /// Set while watching is not allowed; the whole app shows the lock screen.
    private(set) var lockReason: LockReason?
    /// Seconds watched today (all players), for the daily limit.
    private(set) var secondsToday: Double = 0

    static let limitOptions = [0, 15, 30, 45, 60, 90, 120, 180, 240]

    private let defaults = UserDefaults.standard
    @ObservationIgnored private var usage: [String: Double] = [:]
    @ObservationIgnored private var extraSeconds: [String: Double] = [:]
    @ObservationIgnored private var unlimitedDay: String?
    @ObservationIgnored private var hoursOverrideUntil = Date.distantPast
    @ObservationIgnored private var unsaved: Double = 0
    @ObservationIgnored private var loop: Task<Void, Never>?

    private static func key(_ name: String) -> String { "parental." + name }

    private init() {
        let d = UserDefaults.standard
        d.register(defaults: [
            Self.key("dailyLimit"): 0,
            Self.key("hoursStart"): 7 * 60,
            Self.key("hoursEnd"): 21 * 60,
            Self.key("restricted"): true,
        ])
        isEnabled = d.bool(forKey: Self.key("enabled"))
        restrictedMode = d.bool(forKey: Self.key("restricted"))
        dailyLimitMinutes = d.integer(forKey: Self.key("dailyLimit"))
        hoursEnabled = d.bool(forKey: Self.key("hoursEnabled"))
        hoursStart = d.integer(forKey: Self.key("hoursStart"))
        hoursEnd = d.integer(forKey: Self.key("hoursEnd"))
        blockedKeywords = d.string(forKey: Self.key("keywords")) ?? ""
        hideComments = d.bool(forKey: Self.key("hideComments"))
        hideShorts = d.bool(forKey: Self.key("hideShorts"))
        disableSearch = d.bool(forKey: Self.key("disableSearch"))
        usage = d.dictionary(forKey: Self.key("usage")) as? [String: Double] ?? [:]
        extraSeconds = d.dictionary(forKey: Self.key("extra")) as? [String: Double] ?? [:]
        unlimitedDay = d.string(forKey: Self.key("unlimitedDay"))
        secondsToday = usage[WatchTimeStore.dayKey(Date())] ?? 0
        ContentFilter.shared.update(enabled: isEnabled, keywords: blockedKeywords, hideShorts: hideShorts)
    }

    private func save(_ name: String, _ value: Any) {
        defaults.set(value, forKey: Self.key(name))
        ContentFilter.shared.update(enabled: isEnabled, keywords: blockedKeywords, hideShorts: hideShorts)
        if name == "dailyLimit" || name.hasPrefix("hours") { evaluate(playing: false) }
    }

    // MARK: Thread-safe flags for the networking layer

    /// `context.user.lockedSafetyMode` of every InnerTube request.
    nonisolated static var restrictedModeActive: Bool {
        UserDefaults.standard.bool(forKey: "parental.enabled") && UserDefaults.standard.bool(forKey: "parental.restricted")
    }

    // Shortcuts for the UI (false while parental controls are off).
    var commentsHidden: Bool { isEnabled && hideComments }
    var shortsHidden: Bool { isEnabled && hideShorts }
    var searchDisabled: Bool { isEnabled && disableSearch }

    // MARK: PIN

    var hasPIN: Bool { defaults.string(forKey: Self.key("pinHash")) != nil }

    static func isValidPIN(_ pin: String) -> Bool {
        pin.count == 4 && pin.allSatisfy { $0.isASCII && $0.isNumber }
    }

    func verify(_ pin: String) -> Bool {
        guard let salt = defaults.string(forKey: Self.key("pinSalt")),
              let stored = defaults.string(forKey: Self.key("pinHash")) else { return false }
        return Self.hash(pin, salt: salt) == stored
    }

    /// Turns parental controls on with a new PIN.
    func enable(pin: String) {
        guard Self.isValidPIN(pin) else { return }
        setPIN(pin)
        isEnabled = true
        defaults.set(true, forKey: Self.key("enabled"))
        ContentFilter.shared.update(enabled: true, keywords: blockedKeywords, hideShorts: hideShorts)
        startMonitoring()
        evaluate(playing: false)
    }

    func setPIN(_ pin: String) {
        var bytes = [UInt8](repeating: 0, count: 16)
        for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
        let salt = Data(bytes).base64EncodedString()
        defaults.set(salt, forKey: Self.key("pinSalt"))
        defaults.set(Self.hash(pin, salt: salt), forKey: Self.key("pinHash"))
    }

    /// Off (keeps the PIN-less defaults for next time).
    func disable() {
        isEnabled = false
        lockReason = nil
        defaults.set(false, forKey: Self.key("enabled"))
        defaults.removeObject(forKey: Self.key("pinHash"))
        defaults.removeObject(forKey: Self.key("pinSalt"))
        ContentFilter.shared.update(enabled: false, keywords: blockedKeywords, hideShorts: hideShorts)
    }

    /// "Quên mã PIN": everything back to the defaults, parental controls off.
    func resetAll() {
        disable()
        for name in ["restricted", "dailyLimit", "hoursEnabled", "hoursStart", "hoursEnd", "keywords", "hideComments",
                     "hideShorts", "disableSearch", "usage", "extra", "unlimitedDay"] {
            defaults.removeObject(forKey: Self.key(name))
        }
        restrictedMode = true
        dailyLimitMinutes = 0
        hoursEnabled = false
        hoursStart = 7 * 60
        hoursEnd = 21 * 60
        blockedKeywords = ""
        hideComments = false
        hideShorts = false
        disableSearch = false
        extraSeconds = [:]
        unlimitedDay = nil
        lockReason = nil
    }

    private static func hash(_ pin: String, salt: String) -> String {
        SHA256.hash(data: Data((salt + ":" + pin).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Watch time and allowed hours

    /// Counts playback time and locks the app when watching is not allowed. Started at launch.
    func startMonitoring() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard let self else { return }
                let playing = PlayerManager.shared.isPlaying || ShortsPlayer.shared.isPlaying
                self.evaluate(playing: playing)
            }
        }
    }

    private func evaluate(playing: Bool) {
        guard isEnabled else {
            if lockReason != nil { lockReason = nil }
            return
        }
        let now = Date()
        let today = WatchTimeStore.dayKey(now)
        if playing {
            usage[today, default: 0] += 1
            unsaved += 1
            if unsaved >= 30 { saveUsage() }
        }
        let watched = usage[today] ?? 0
        if watched != secondsToday { secondsToday = watched }
        let reason = currentLockReason(now: now)
        if reason != lockReason { lockReason = reason }
        if reason != nil, playing {
            PlayerManager.shared.pause()
            ShortsPlayer.shared.pause()
            saveUsage()
        }
    }

    private func currentLockReason(now: Date) -> LockReason? {
        let today = WatchTimeStore.dayKey(now)
        if unlimitedDay == today { return nil }
        if hoursEnabled, !isWithinHours(now), now >= hoursOverrideUntil { return .outsideHours }
        if dailyLimitMinutes > 0 {
            let allowed = Double(dailyLimitMinutes * 60) + (extraSeconds[today] ?? 0)
            if (usage[today] ?? 0) >= allowed { return .dailyLimit }
        }
        return nil
    }

    func isWithinHours(_ date: Date) -> Bool {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        let minute = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        if hoursStart == hoursEnd { return true }
        return hoursStart < hoursEnd
            ? minute >= hoursStart && minute < hoursEnd
            : minute >= hoursStart || minute < hoursEnd
    }

    /// Minutes left today (nil without a limit).
    var minutesLeftToday: Int? {
        guard isEnabled, dailyLimitMinutes > 0 else { return nil }
        let today = WatchTimeStore.dayKey(Date())
        if unlimitedDay == today { return nil }
        let allowed = Double(dailyLimitMinutes * 60) + (extraSeconds[today] ?? 0)
        return max(Int((allowed - secondsToday) / 60), 0)
    }

    /// After the PIN on the lock screen: more time, or no limit for the rest of today (`nil`).
    func grant(minutes: Int?) {
        let now = Date()
        let today = WatchTimeStore.dayKey(now)
        if let minutes {
            if lockReason == .outsideHours {
                hoursOverrideUntil = now.addingTimeInterval(Double(minutes) * 60)
            } else {
                // From what has been watched so far: "+15 phút" means 15 more minutes.
                let used = usage[today] ?? 0
                let allowed = Double(dailyLimitMinutes * 60) + (extraSeconds[today] ?? 0)
                extraSeconds[today] = (extraSeconds[today] ?? 0) + max(used - allowed, 0) + Double(minutes) * 60
            }
        } else {
            unlimitedDay = today
            defaults.set(today, forKey: Self.key("unlimitedDay"))
        }
        extraSeconds = extraSeconds.filter { $0.key >= Self.oldestKept }
        defaults.set(extraSeconds, forKey: Self.key("extra"))
        lockReason = currentLockReason(now: now)
    }

    func saveUsage() {
        unsaved = 0
        usage = usage.filter { $0.key >= Self.oldestKept }
        defaults.set(usage, forKey: Self.key("usage"))
    }

    private static var oldestKept: String {
        WatchTimeStore.dayKey(Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date())
    }
}

/// Blocked keywords and hidden Shorts, readable from any thread (the parsers run off the
/// main actor). Matching ignores case and Vietnamese diacritics.
final class ContentFilter: @unchecked Sendable {
    static let shared = ContentFilter()

    private let lock = NSLock()
    private var keywords: [String] = []
    private var shortsHidden = false

    private init() {
        // Also ready before the parental controls object exists (feeds may parse first).
        let defaults = UserDefaults.standard
        update(enabled: defaults.bool(forKey: "parental.enabled"),
               keywords: defaults.string(forKey: "parental.keywords") ?? "",
               hideShorts: defaults.bool(forKey: "parental.hideShorts"))
    }

    var isActive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !keywords.isEmpty || shortsHidden
    }

    func update(enabled: Bool, keywords text: String, hideShorts: Bool) {
        let list = enabled
            ? text.components(separatedBy: CharacterSet(charactersIn: ",;\n")).map(Self.normalize).filter { !$0.isEmpty }
            : []
        lock.lock()
        keywords = Array(Set(list))
        shortsHidden = enabled && hideShorts
        lock.unlock()
    }

    static func normalize(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "vi_VN"))
            .replacingOccurrences(of: "đ", with: "d")
            .replacingOccurrences(of: "Đ", with: "d")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func isBlocked(title: String, channel: String?) -> Bool {
        lock.lock()
        let words = keywords
        lock.unlock()
        guard !words.isEmpty else { return false }
        let haystack = Self.normalize(title + " " + (channel ?? ""))
        return words.contains { haystack.contains($0) }
    }

    func allows(_ video: VideoItem) -> Bool {
        lock.lock()
        let hideShorts = shortsHidden
        lock.unlock()
        if hideShorts, video.isShort { return false }
        return !isBlocked(title: video.title, channel: video.channelName)
    }

    func filter(_ videos: [VideoItem]) -> [VideoItem] {
        guard isActive else { return videos }
        return videos.filter(allows)
    }

    func filter(_ items: [FeedItem]) -> [FeedItem] {
        guard isActive else { return items }
        lock.lock()
        let hideShorts = shortsHidden
        lock.unlock()
        return items.compactMap { item in
            switch item {
            case .video(let video):
                return allows(video) ? item : nil
            case .shorts(let list):
                if hideShorts { return nil }
                let kept = list.filter(allows)
                return kept.isEmpty ? nil : .shorts(kept)
            case .channel(let channel):
                return isBlocked(title: channel.name, channel: nil) ? nil : item
            case .playlist(let playlist):
                return isBlocked(title: playlist.title, channel: playlist.channelName) ? nil : item
            }
        }
    }
}
