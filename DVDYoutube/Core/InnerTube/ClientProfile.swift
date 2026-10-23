import Foundation

/// Describes one InnerTube client identity (the app YouTube thinks is talking to it).
/// All values can be overridden by the remote config so the app keeps working when
/// YouTube changes something, without having to rebuild and re-sideload it.
struct ClientProfile: Codable, Hashable {
    var name: String
    var id: Int
    var version: String
    var host: String = "www.youtube.com"
    var userAgent: String?
    var deviceMake: String?
    var deviceModel: String?
    var osName: String?
    var osVersion: String?
    var platform: String?
    var clientScreen: String?
    /// Send `X-YouTube-Client-Name/Version` + `Origin` headers.
    var sendClientHeaders: Bool = true
    var extraHeaders: [String: String]?

    /// `{gl}` in the user agent is replaced by the content country.
    func resolvedUserAgent(gl: String) -> String? {
        userAgent?.replacingOccurrences(of: "{gl}", with: gl.uppercased())
    }

    static let web = ClientProfile(
        name: "WEB",
        id: 1,
        version: "2.20261019.01.00",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
        platform: "DESKTOP"
    )

    /// The visionOS app's client currently gets HLS + direct stream URLs without
    /// PO tokens or JavaScript signature deciphering, which is exactly what AVPlayer needs.
    static let visionOS = ClientProfile(
        name: "VISIONOS",
        id: 101,
        version: "1.04",
        host: "youtubei.googleapis.com",
        userAgent: "com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; {gl})",
        deviceMake: "Apple",
        deviceModel: "RealityDevice17,1",
        osName: "visionOS",
        osVersion: "26.6.0.23O770",
        platform: "MOBILE",
        clientScreen: "WATCH",
        sendClientHeaders: false,
        extraHeaders: ["X-Goog-Api-Format-Version": "2"]
    )

    static let charts = ClientProfile(
        name: "WEB_MUSIC_ANALYTICS",
        id: 31,
        version: "2.0",
        host: "charts.youtube.com",
        sendClientHeaders: true,
        extraHeaders: ["Origin": "https://charts.youtube.com", "Referer": "https://charts.youtube.com"]
    )
}

extension ClientProfile {
    // Written by hand so that a remote config may omit any field that has a default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        id = try c.decode(Int.self, forKey: .id)
        version = try c.decode(String.self, forKey: .version)
        host = try c.decodeIfPresent(String.self, forKey: .host) ?? "www.youtube.com"
        userAgent = try c.decodeIfPresent(String.self, forKey: .userAgent)
        deviceMake = try c.decodeIfPresent(String.self, forKey: .deviceMake)
        deviceModel = try c.decodeIfPresent(String.self, forKey: .deviceModel)
        osName = try c.decodeIfPresent(String.self, forKey: .osName)
        osVersion = try c.decodeIfPresent(String.self, forKey: .osVersion)
        platform = try c.decodeIfPresent(String.self, forKey: .platform)
        clientScreen = try c.decodeIfPresent(String.self, forKey: .clientScreen)
        sendClientHeaders = try c.decodeIfPresent(Bool.self, forKey: .sendClientHeaders) ?? true
        extraHeaders = try c.decodeIfPresent([String: String].self, forKey: .extraHeaders)
    }
}

/// Optional JSON hosted in the GitHub repo (see `Config/remote-config.json`).
struct RemoteConfig: Codable {
    var web: ClientProfile?
    var playerClients: [ClientProfile]?
    var charts: ClientProfile?
    var message: String?
}

/// Thread-safe accessors for region + config values used by the networking layer.
enum APIConfig {
    private static let defaults = UserDefaults.standard
    private static let configKey = "remoteConfig.cached"

    static var hl: String { defaults.string(forKey: SettingsKey.language) ?? "vi" }
    static var gl: String { defaults.string(forKey: SettingsKey.region) ?? "VN" }

    static var remote: RemoteConfig? {
        guard let data = defaults.data(forKey: configKey) else { return nil }
        return try? JSONDecoder().decode(RemoteConfig.self, from: data)
    }

    static var webProfile: ClientProfile { remote?.web ?? .web }
    static var chartsProfile: ClientProfile { remote?.charts ?? .charts }

    static var playerProfiles: [ClientProfile] {
        if let clients = remote?.playerClients, !clients.isEmpty { return clients }
        return [.visionOS]
    }

    static let defaultRemoteConfigURL = "https://raw.githubusercontent.com/dangdvd/DVDYoutube/main/Config/remote-config.json"

    static var remoteConfigURL: String {
        let stored = defaults.string(forKey: SettingsKey.remoteConfigURL) ?? ""
        return stored.isEmpty ? defaultRemoteConfigURL : stored
    }

    /// Downloads the remote config; failures keep the previous (or built-in) values.
    static func refreshRemoteConfig() async {
        guard let url = URL(string: remoteConfigURL) else { return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let result = try? await URLSession.shared.data(for: request),
              (result.1 as? HTTPURLResponse)?.statusCode == 200,
              (try? JSONDecoder().decode(RemoteConfig.self, from: result.0)) != nil
        else { return }
        defaults.set(result.0, forKey: configKey)
    }

    static func clearRemoteConfig() {
        defaults.removeObject(forKey: configKey)
    }
}

enum SettingsKey {
    static let language = "settings.hl"
    static let region = "settings.gl"
    static let remoteConfigURL = "settings.remoteConfigURL"
}
