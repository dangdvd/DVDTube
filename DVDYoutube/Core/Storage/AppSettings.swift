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

    static let speeds: [Double] = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
}
