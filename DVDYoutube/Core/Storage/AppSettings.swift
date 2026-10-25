import CoreGraphics
import Foundation
import Observation

enum VideoQuality: Int, CaseIterable, Identifiable, Codable {
    case auto = 0
    case p1080 = 1080
    case p720 = 720
    case p480 = 480
    case p360 = 360
    case p240 = 240
    case p144 = 144

    var id: Int { rawValue }

    var title: String { self == .auto ? "Tự động" : "\(rawValue)p" }

    /// Upper bound passed to AVPlayer; `nil` lets it adapt freely.
    var maxHeight: Int? { self == .auto ? nil : rawValue }

    var peakBitRate: Double {
        switch self {
        case .auto: return 0
        case .p1080: return 6_000_000
        case .p720: return 3_000_000
        case .p480: return 1_500_000
        case .p360: return 800_000
        case .p240: return 450_000
        case .p144: return 250_000
        }
    }
}

/// Caption text size, like the official app's caption options.
enum CaptionSize: Int, CaseIterable, Identifiable {
    case small, normal, large, extraLarge
    var id: Int { rawValue }
    var title: String {
        switch self {
        case .small: return "Nhỏ"
        case .normal: return "Bình thường"
        case .large: return "Lớn"
        case .extraLarge: return "Rất lớn"
        }
    }
    var scale: CGFloat { [0.8, 1.0, 1.3, 1.6][rawValue] }
}

enum AppTheme: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: return "Theo hệ thống"
        case .light: return "Sáng"
        case .dark: return "Tối"
        }
    }
}

/// User preferences, persisted in `UserDefaults`.
@MainActor
@Observable
final class AppSettings {
    static let shared = AppSettings()

    private let defaults = UserDefaults.standard

    var language: String { didSet { defaults.set(language, forKey: SettingsKey.language) } }
    var region: String { didSet { defaults.set(region, forKey: SettingsKey.region) } }
    var wifiQuality: VideoQuality { didSet { defaults.set(wifiQuality.rawValue, forKey: "settings.wifiQuality") } }
    var cellularQuality: VideoQuality { didSet { defaults.set(cellularQuality.rawValue, forKey: "settings.cellularQuality") } }
    var downloadQuality: VideoQuality { didSet { defaults.set(downloadQuality.rawValue, forKey: "settings.downloadQuality") } }
    var playbackSpeed: Double { didSet { defaults.set(playbackSpeed, forKey: "settings.speed") } }
    var autoplay: Bool { didSet { defaults.set(autoplay, forKey: "settings.autoplay") } }
    var backgroundPlayback: Bool { didSet { defaults.set(backgroundPlayback, forKey: "settings.background") } }
    var autoPictureInPicture: Bool { didSet { defaults.set(autoPictureInPicture, forKey: "settings.autoPiP") } }
    var sponsorBlockEnabled: Bool { didSet { defaults.set(sponsorBlockEnabled, forKey: "settings.sponsorBlock") } }
    var sponsorBlockCategories: [String] { didSet { defaults.set(sponsorBlockCategories, forKey: "settings.sponsorBlockCategories") } }
    var captionLanguage: String { didSet { defaults.set(captionLanguage, forKey: "settings.captionLanguage") } }
    var captionsEnabled: Bool { didSet { defaults.set(captionsEnabled, forKey: "settings.captions") } }
    var saveHistory: Bool { didSet { defaults.set(saveHistory, forKey: "settings.saveHistory") } }
    var resumePlayback: Bool { didSet { defaults.set(resumePlayback, forKey: "settings.resume") } }
    var theme: AppTheme { didSet { defaults.set(theme.rawValue, forKey: "settings.theme") } }
    var remoteConfigURL: String { didSet { defaults.set(remoteConfigURL, forKey: SettingsKey.remoteConfigURL) } }
    var webPlayerFallback: Bool { didSet { defaults.set(webPlayerFallback, forKey: "settings.webFallback") } }

    // Data saving
    /// Play only the audio stream (no picture), remembered between launches.
    var audioOnlyMode: Bool { didSet { defaults.set(audioOnlyMode, forKey: "settings.audioOnly") } }
    /// Switch to audio only automatically on mobile data.
    var audioOnlyOnCellular: Bool { didSet { defaults.set(audioOnlyOnCellular, forKey: "settings.audioOnlyCellular") } }
    /// On mobile data: video up to 360p, the smallest audio stream, small thumbnails, no prefetching.
    var dataSaver: Bool { didSet { defaults.set(dataSaver, forKey: "settings.dataSaver") } }
    var downloadOnWifiOnly: Bool { didSet { defaults.set(downloadOnWifiOnly, forKey: "settings.downloadWifiOnly") } }

    // Player
    var doubleTapSeconds: Int { didSet { defaults.set(doubleTapSeconds, forKey: "settings.doubleTapSeconds") } }
    var captionSize: CaptionSize { didSet { defaults.set(captionSize.rawValue, forKey: "settings.captionSize") } }
    /// Opacity of the box behind captions (0 = none).
    var captionBackground: Double { didSet { defaults.set(captionBackground, forKey: "settings.captionBackground") } }

    // Digital wellbeing
    /// Minutes of watching before "Take a break" (0 = off).
    var breakReminderMinutes: Int { didSet { defaults.set(breakReminderMinutes, forKey: "settings.breakReminder") } }
    var bedtimeReminder: Bool { didSet { defaults.set(bedtimeReminder, forKey: "settings.bedtimeReminder") } }
    /// Minutes after midnight.
    var bedtimeStart: Int { didSet { defaults.set(bedtimeStart, forKey: "settings.bedtimeStart") } }
    var bedtimeEnd: Int { didSet { defaults.set(bedtimeEnd, forKey: "settings.bedtimeEnd") } }

    // Sound
    /// Evens out loudness between videos (YouTube's "Stable volume").
    var stableVolume: Bool { didSet { defaults.set(stableVolume, forKey: "settings.stableVolume") } }
    var eqEnabled: Bool { didSet { defaults.set(eqEnabled, forKey: "settings.eqEnabled"); syncEqualizer() } }
    /// `EQPreset.id`, or `EQPreset.customID` for the user's own bands.
    var eqPresetID: String { didSet { defaults.set(eqPresetID, forKey: "settings.eqPreset"); syncEqualizer() } }
    var eqCustomGains: [Double] { didSet { defaults.set(eqCustomGains, forKey: "settings.eqCustomGains"); syncEqualizer() } }
    var eqPreampAuto: Bool { didSet { defaults.set(eqPreampAuto, forKey: "settings.eqPreampAuto"); syncEqualizer() } }
    var eqPreamp: Double { didSet { defaults.set(eqPreamp, forKey: "settings.eqPreamp"); syncEqualizer() } }

    // Watch page & player extras
    /// Dislike counts from Return YouTube Dislike.
    var showDislikes: Bool { didSet { defaults.set(showDislikes, forKey: "settings.showDislikes") } }
    /// Soft glow of the video's colours around the player (dark appearance only).
    var ambientMode: Bool { didSet { defaults.set(ambientMode, forKey: "settings.ambientMode") } }
    /// In fullscreen: swipe up/down on the left for brightness, on the right for volume.
    var swipeControls: Bool { didSet { defaults.set(swipeControls, forKey: "settings.swipeControls") } }

    /// Searches are not added to the search history.
    var pauseSearchHistory: Bool { didSet { defaults.set(pauseSearchHistory, forKey: "settings.pauseSearchHistory") } }

    // Music mode
    /// "Nghe nhạc" plays only the sound unless the picture is turned on.
    var musicAudioOnly: Bool { didSet { defaults.set(musicAudioOnly, forKey: "settings.musicAudioOnly") } }

    // DeArrow (crowd-sourced titles and thumbnails without clickbait)
    var deArrowEnabled: Bool { didSet { defaults.set(deArrowEnabled, forKey: "settings.dearrow") } }
    var deArrowTitles: Bool { didSet { defaults.set(deArrowTitles, forKey: "settings.dearrowTitles") } }
    var deArrowThumbnails: Bool { didSet { defaults.set(deArrowThumbnails, forKey: "settings.dearrowThumbnails") } }

    /// Look for a new release on GitHub (at most once a day).
    var autoCheckUpdates: Bool { didSet { defaults.set(autoCheckUpdates, forKey: "settings.autoCheckUpdates") } }

    /// Incognito: nothing is added to the watch or search history (until the app restarts).
    var isIncognito = false

    /// Mobile data with data saver on.
    var savesData: Bool { dataSaver && NetworkMonitor.shared.isExpensive }

    private init() {
        let d = UserDefaults.standard
        d.register(defaults: [
            SettingsKey.language: "vi",
            SettingsKey.region: "VN",
            "settings.wifiQuality": VideoQuality.auto.rawValue,
            "settings.cellularQuality": VideoQuality.p720.rawValue,
            "settings.downloadQuality": VideoQuality.p720.rawValue,
            "settings.speed": 1.0,
            "settings.autoplay": true,
            "settings.background": true,
            "settings.autoPiP": true,
            "settings.sponsorBlock": true,
            "settings.sponsorBlockCategories": ["sponsor", "selfpromo", "interaction"],
            "settings.captionLanguage": "vi",
            "settings.captions": false,
            "settings.saveHistory": true,
            "settings.resume": true,
            "settings.theme": AppTheme.system.rawValue,
            "settings.webFallback": true,
            "settings.audioOnly": false,
            "settings.audioOnlyCellular": false,
            "settings.dataSaver": false,
            "settings.downloadWifiOnly": false,
            "settings.doubleTapSeconds": 10,
            "settings.captionSize": CaptionSize.normal.rawValue,
            "settings.captionBackground": 0.75,
            "settings.breakReminder": 0,
            "settings.bedtimeReminder": false,
            "settings.bedtimeStart": 23 * 60,
            "settings.bedtimeEnd": 7 * 60,
            "settings.stableVolume": true,
            "settings.eqEnabled": false,
            "settings.eqPreset": EQPreset.flat.id,
            "settings.eqCustomGains": [Double](repeating: 0, count: EQBand.count),
            "settings.eqPreampAuto": true,
            "settings.eqPreamp": 0.0,
            "settings.showDislikes": true,
            "settings.ambientMode": true,
            "settings.swipeControls": true,
            "settings.pauseSearchHistory": false,
            "settings.musicAudioOnly": true,
            "settings.dearrow": true,
            "settings.dearrowTitles": true,
            "settings.dearrowThumbnails": true,
            "settings.autoCheckUpdates": true,
        ])
        language = d.string(forKey: SettingsKey.language) ?? "vi"
        region = d.string(forKey: SettingsKey.region) ?? "VN"
        wifiQuality = VideoQuality(rawValue: d.integer(forKey: "settings.wifiQuality")) ?? .auto
        cellularQuality = VideoQuality(rawValue: d.integer(forKey: "settings.cellularQuality")) ?? .p720
        downloadQuality = VideoQuality(rawValue: d.integer(forKey: "settings.downloadQuality")) ?? .p720
        playbackSpeed = d.double(forKey: "settings.speed")
        autoplay = d.bool(forKey: "settings.autoplay")
        backgroundPlayback = d.bool(forKey: "settings.background")
        autoPictureInPicture = d.bool(forKey: "settings.autoPiP")
        sponsorBlockEnabled = d.bool(forKey: "settings.sponsorBlock")
        sponsorBlockCategories = d.stringArray(forKey: "settings.sponsorBlockCategories") ?? ["sponsor"]
        captionLanguage = d.string(forKey: "settings.captionLanguage") ?? "vi"
        captionsEnabled = d.bool(forKey: "settings.captions")
        saveHistory = d.bool(forKey: "settings.saveHistory")
        resumePlayback = d.bool(forKey: "settings.resume")
        theme = AppTheme(rawValue: d.string(forKey: "settings.theme") ?? "") ?? .system
        remoteConfigURL = d.string(forKey: SettingsKey.remoteConfigURL) ?? ""
        webPlayerFallback = d.bool(forKey: "settings.webFallback")
        audioOnlyMode = d.bool(forKey: "settings.audioOnly")
        audioOnlyOnCellular = d.bool(forKey: "settings.audioOnlyCellular")
        dataSaver = d.bool(forKey: "settings.dataSaver")
        downloadOnWifiOnly = d.bool(forKey: "settings.downloadWifiOnly")
        doubleTapSeconds = max(d.integer(forKey: "settings.doubleTapSeconds"), 5)
        captionSize = CaptionSize(rawValue: d.integer(forKey: "settings.captionSize")) ?? .normal
        captionBackground = d.double(forKey: "settings.captionBackground")
        breakReminderMinutes = d.integer(forKey: "settings.breakReminder")
        bedtimeReminder = d.bool(forKey: "settings.bedtimeReminder")
        bedtimeStart = d.integer(forKey: "settings.bedtimeStart")
        bedtimeEnd = d.integer(forKey: "settings.bedtimeEnd")
        stableVolume = d.bool(forKey: "settings.stableVolume")
        eqEnabled = d.bool(forKey: "settings.eqEnabled")
        eqPresetID = d.string(forKey: "settings.eqPreset") ?? EQPreset.flat.id
        let gains = (d.array(forKey: "settings.eqCustomGains") as? [Double]) ?? []
        eqCustomGains = gains.count == EQBand.count ? gains : [Double](repeating: 0, count: EQBand.count)
        eqPreampAuto = d.bool(forKey: "settings.eqPreampAuto")
        eqPreamp = d.double(forKey: "settings.eqPreamp")
        showDislikes = d.bool(forKey: "settings.showDislikes")
        ambientMode = d.bool(forKey: "settings.ambientMode")
        swipeControls = d.bool(forKey: "settings.swipeControls")
        pauseSearchHistory = d.bool(forKey: "settings.pauseSearchHistory")
        musicAudioOnly = d.bool(forKey: "settings.musicAudioOnly")
        deArrowEnabled = d.bool(forKey: "settings.dearrow")
        deArrowTitles = d.bool(forKey: "settings.dearrowTitles")
        deArrowThumbnails = d.bool(forKey: "settings.dearrowThumbnails")
        autoCheckUpdates = d.bool(forKey: "settings.autoCheckUpdates")
        syncEqualizer()
    }

    // MARK: Equalizer

    /// Band gains (dB) of the selected preset or the custom bands.
    var eqGains: [Double] {
        if eqPresetID == EQPreset.customID { return eqCustomGains }
        return (EQPreset.preset(eqPresetID) ?? .flat).gains
    }

    /// Preamp (dB): automatic headroom for boosted bands, or the user's value.
    var eqPreampDb: Double {
        eqPreampAuto ? -0.5 * max(0, eqGains.max() ?? 0) : eqPreamp
    }

    /// The equalizer changes the sound (enabled and not flat).
    var eqIsActive: Bool {
        eqEnabled && (eqGains.contains { abs($0) > 0.01 } || abs(eqPreampDb) > 0.01)
    }

    var eqPresetName: String {
        guard eqEnabled else { return "Tắt" }
        if eqPresetID == EQPreset.customID { return "Tùy chỉnh" }
        return (EQPreset.preset(eqPresetID) ?? .flat).name
    }

    /// Hands the current bands to the audio processing (any thread may read them).
    private func syncEqualizer() {
        EqualizerEngine.shared.update(enabled: eqIsActive, gains: eqGains, preampDb: eqPreampDb)
    }

    /// Whether `date` falls in the bedtime window (which may cross midnight).
    func isBedtime(_ date: Date = Date()) -> Bool {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        let minute = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        if bedtimeStart == bedtimeEnd { return false }
        return bedtimeStart < bedtimeEnd
            ? minute >= bedtimeStart && minute < bedtimeEnd
            : minute >= bedtimeStart || minute < bedtimeEnd
    }

    static let regions: [(code: String, name: String)] = [
        ("VN", "Việt Nam"), ("US", "Hoa Kỳ"), ("JP", "Nhật Bản"), ("KR", "Hàn Quốc"),
        ("GB", "Vương quốc Anh"), ("FR", "Pháp"), ("DE", "Đức"), ("TH", "Thái Lan"),
        ("SG", "Singapore"), ("AU", "Úc"), ("CA", "Canada"), ("IN", "Ấn Độ"),
    ]

    static let languages: [(code: String, name: String)] = [
        ("vi", "Tiếng Việt"), ("en", "English"), ("ja", "日本語"), ("ko", "한국어"),
        ("fr", "Français"), ("de", "Deutsch"), ("th", "ไทย"), ("zh-Hans", "中文"),
    ]

    static let speeds: [Double] = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 3.0, 4.0]
    static let doubleTapOptions = [5, 10, 15, 20, 30, 60]
    static let breakReminderOptions = [0, 15, 30, 45, 60, 90, 120, 180]
    static let sleepTimerOptions = [5, 10, 15, 20, 30, 45, 60, 90, 120]
}
