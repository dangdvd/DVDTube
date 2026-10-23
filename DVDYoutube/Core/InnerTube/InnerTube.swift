import Foundation

enum InnerTubeError: LocalizedError {
    case http(Int)
    case unplayable(String)
    case noStreams
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .http(let code):
            return code == 429
                ? "YouTube tạm thời giới hạn yêu cầu (429). Vui lòng thử lại sau."
                : "Lỗi kết nối tới YouTube (HTTP \(code))."
        case .unplayable(let reason): return reason
        case .noStreams: return "Không tìm thấy luồng phát cho video này."
        case .invalidResponse: return "Phản hồi từ YouTube không hợp lệ."
        }
    }
}

/// Low level access to YouTube's internal "InnerTube" API.
final class InnerTube {
    static let shared = InnerTube()

    let session: URLSession
    private let visitorStore = VisitorDataStore()

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.httpCookieAcceptPolicy = .always
        session = URLSession(configuration: config)
    }

    // MARK: - Request building

    private func context(for profile: ClientProfile, visitorData: String?) -> [String: Any] {
        var client: [String: Any] = [
            "clientName": profile.name,
            "clientVersion": profile.version,
            "hl": APIConfig.hl,
            "gl": APIConfig.gl,
            "utcOffsetMinutes": TimeZone.current.secondsFromGMT() / 60,
        ]
        if let value = profile.clientScreen { client["clientScreen"] = value }
        if let value = profile.platform { client["platform"] = value }
        if let value = profile.deviceMake { client["deviceMake"] = value }
        if let value = profile.deviceModel { client["deviceModel"] = value }
        if let value = profile.osName { client["osName"] = value }
        if let value = profile.osVersion { client["osVersion"] = value }
        if profile.name == "WEB" { client["originalUrl"] = "https://www.youtube.com" }
        if let visitorData { client["visitorData"] = visitorData }
        return [
            "client": client,
            "request": ["internalExperimentFlags": [Any](), "useSsl": true],
            "user": ["lockedSafetyMode": false],
        ]
    }

    func post(
        _ endpoint: String,
        profile: ClientProfile,
        body: [String: Any],
        query: [String: String] = [:],
        host: String? = nil,
        visitorData: String? = nil
    ) async throws -> JNode {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host ?? profile.host
        components.path = "/youtubei/v1/\(endpoint)"
        components.queryItems = [URLQueryItem(name: "prettyPrint", value: "false")]
            + query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else { throw InnerTubeError.invalidResponse }

        var payload = body
        payload["context"] = context(for: profile, visitorData: visitorData)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\(APIConfig.hl),en;q=0.9", forHTTPHeaderField: "Accept-Language")
        if let userAgent = profile.resolvedUserAgent(gl: APIConfig.gl) {
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }
        if profile.sendClientHeaders {
            request.setValue(String(profile.id), forHTTPHeaderField: "X-YouTube-Client-Name")
            request.setValue(profile.version, forHTTPHeaderField: "X-YouTube-Client-Version")
            if profile.extraHeaders?["Origin"] == nil {
                request.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
            }
        }
        if let visitorData {
            request.setValue(visitorData, forHTTPHeaderField: "X-Goog-Visitor-Id")
        }
        for (key, value) in profile.extraHeaders ?? [:] {
            request.setValue(value, forHTTPHeaderField: key)
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        Log.debug("\(profile.name) \(endpoint) -> HTTP \(status), \(data.count) bytes")
        guard (200..<300).contains(status) else { throw InnerTubeError.http(status) }
        return try JNode(data: data)
    }

    /// WEB client request used for search, browse and the watch page.
    func web(_ endpoint: String, body: [String: Any]) async throws -> JNode {
        let profile = APIConfig.webProfile
        let visitor = await visitorStore.value(for: profile.name)
        let json = try await post(endpoint, profile: profile, body: body, visitorData: visitor)
        if visitor == nil, let fresh = json.at("responseContext", "visitorData").string {
            await visitorStore.set(fresh, for: profile.name)
        }
        return json
    }

    // MARK: - Visitor data

    /// Player requests from the visionOS client must carry a visitor id that YouTube issued.
    func visitorData(for profile: ClientProfile, forceRefresh: Bool = false) async throws -> String {
        if !forceRefresh, let cached = await visitorStore.value(for: profile.name) {
            return cached
        }
        let json = try await post("visitor_id", profile: profile, body: [:], host: "www.youtube.com")
        guard let visitor = json.at("responseContext", "visitorData").string else {
            throw InnerTubeError.invalidResponse
        }
        await visitorStore.set(visitor, for: profile.name)
        return visitor
    }

    // MARK: - Endpoints

    func player(videoId: String) async throws -> PlayerInfo {
        var lastError: Error = InnerTubeError.noStreams
        for profile in APIConfig.playerProfiles {
            for attempt in 0..<2 {
                do {
                    let visitor = try await visitorData(for: profile, forceRefresh: attempt > 0)
                    let json = try await post(
                        "player",
                        profile: profile,
                        body: [
                            "videoId": videoId,
                            "cpn": Self.randomToken(16),
                            "contentCheckOk": true,
                            "racyCheckOk": true,
                        ],
                        query: ["t": Self.randomToken(12), "id": videoId],
                        visitorData: visitor
                    )
                    return try PlayerParser.parse(json, videoId: videoId)
                } catch let error as InnerTubeError {
                    Log.debug("player(\(videoId)) via \(profile.name) failed: \(error.localizedDescription)")
                    lastError = error
                    // A bad visitor id shows up as an unplayable response; retry once with a fresh one.
                    if case .unplayable = error, attempt == 0 { continue }
                    break
                } catch {
                    lastError = error
                    break
                }
            }
        }
        throw lastError
    }

    func search(query: String, params: String?) async throws -> JNode {
        var body: [String: Any] = ["query": query]
        if let params { body["params"] = params }
        return try await web("search", body: body)
    }

    func browse(browseId: String, params: String? = nil) async throws -> JNode {
        var body: [String: Any] = ["browseId": browseId]
        if let params { body["params"] = params }
        return try await web("browse", body: body)
    }

    func browseContinuation(_ token: String) async throws -> JNode {
        try await web("browse", body: ["continuation": token])
    }

    func searchContinuation(_ token: String) async throws -> JNode {
        try await web("search", body: ["continuation": token])
    }

    func next(videoId: String) async throws -> JNode {
        try await web("next", body: ["videoId": videoId, "contentCheckOk": true, "racyCheckOk": true])
    }

    func nextContinuation(_ token: String) async throws -> JNode {
        try await web("next", body: ["continuation": token])
    }

    func resolveURL(_ url: String) async throws -> JNode {
        try await web("navigation/resolve_url", body: ["url": url])
    }

    func charts(type: String) async throws -> JNode {
        try await post(
            "browse",
            profile: APIConfig.chartsProfile,
            body: [
                "browseId": "FEmusic_analytics_charts_home",
                "query": "perspective=CHART_DETAILS&chart_params_country_code=\(APIConfig.gl)&chart_params_chart_type=\(type)",
            ],
            query: ["alt": "json"]
        )
    }

    /// Search-as-you-type suggestions.
    func suggestions(for query: String) async -> [String] {
        var components = URLComponents(string: "https://suggestqueries-clients6.youtube.com/complete/search")!
        components.queryItems = [
            URLQueryItem(name: "client", value: "youtube"),
            URLQueryItem(name: "ds", value: "yt"),
            URLQueryItem(name: "hl", value: APIConfig.hl),
            URLQueryItem(name: "gl", value: APIConfig.gl.lowercased()),
            URLQueryItem(name: "oe", value: "utf-8"),
            URLQueryItem(name: "q", value: query),
        ]
        guard let url = components.url,
              let result = try? await session.data(from: url),
              var text = String(data: result.0, encoding: .utf8) ?? String(data: result.0, encoding: .isoLatin1)
        else { return [] }
        // The response is JSONP: window.google.ac.h([...])
        if let start = text.firstIndex(of: "("), let end = text.lastIndex(of: ")"), start < end {
            text = String(text[text.index(after: start)..<end])
        }
        guard let json = try? JNode(data: Data(text.utf8)) else { return [] }
        return json[1].array.compactMap { entry in entry.string ?? entry[0].string }
    }

    static func randomToken(_ length: Int) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        return String((0..<length).map { _ in alphabet.randomElement()! })
    }
}

private actor VisitorDataStore {
    private var values: [String: (value: String, date: Date)] = [:]

    func value(for client: String) -> String? {
        guard let entry = values[client], Date().timeIntervalSince(entry.date) < 3600 else { return nil }
        return entry.value
    }

    func set(_ value: String, for client: String) {
        values[client] = (value, Date())
    }
}
