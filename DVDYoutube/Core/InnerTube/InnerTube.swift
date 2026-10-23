import Foundation

enum InnerTubeError: LocalizedError {
    case http(Int)
    case unplayable(String)
    /// YouTube's "Sign in to confirm you're not a bot" (or age gate) on the player endpoint.
    case loginRequired(String)
    case noStreams
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .http(let code):
            return code == 429
                ? "YouTube tạm thời giới hạn yêu cầu (429). Vui lòng thử lại sau."
                : "Lỗi kết nối tới YouTube (HTTP \(code))."
        case .unplayable(let reason): return reason
        case .loginRequired(let reason): return reason
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
        visitorData: String? = nil,
        authenticated: Bool = false
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
        let authHeaders = authenticated ? AuthSession.shared.headers(for: url) : nil
        if let authHeaders {
            // Send exactly the account cookies (not the anonymous cookie jar).
            request.httpShouldHandleCookies = false
            for (key, value) in authHeaders { request.setValue(value, forHTTPHeaderField: key) }
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        Log.debug("\(profile.name) \(endpoint) -> HTTP \(status), \(data.count) bytes\(authHeaders != nil ? " (signed in)" : "")")
        if authHeaders != nil, let http = response as? HTTPURLResponse {
            AuthSession.shared.absorb(response: http, url: url)
        }
        guard (200..<300).contains(status) else {
            // Google's error JSON says what was wrong with the request (no account data).
            if let message = (try? JNode(data: data))?.at("error", "message").string {
                Log.debug("\(endpoint) error: \(message)")
            }
            throw InnerTubeError.http(status)
        }
        return try JNode(data: data)
    }

    /// WEB client request used for search, browse and the watch page. Runs as the
    /// signed-in account when there is one (personalised results, account pages).
    func web(_ endpoint: String, body: [String: Any]) async throws -> JNode {
        let profile = APIConfig.webProfile
        let visitor = await visitorStore.value(for: profile.name)
        let json = try await post(endpoint, profile: profile, body: body, visitorData: visitor, authenticated: true)
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
                    // Never retry a bot check: hammering the endpoint only makes it stick.
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

    // MARK: - Live chat

    func liveChat(continuation: String) async throws -> JNode {
        try await web("live_chat/get_live_chat", body: ["continuation": continuation])
    }

    /// The first page of a chat is YouTube's own chat frame (`/live_chat?continuation=`):
    /// its `ytInitialData` holds the first messages and the token to keep polling with.
    func liveChatPage(continuation: String, replay: Bool) async throws -> JNode {
        var components = URLComponents(string: "https://www.youtube.com/\(replay ? "live_chat_replay" : "live_chat")")!
        components.queryItems = [
            URLQueryItem(name: "continuation", value: continuation),
            URLQueryItem(name: "hl", value: APIConfig.hl),
            URLQueryItem(name: "gl", value: APIConfig.gl),
        ]
        guard let url = components.url else { throw InnerTubeError.invalidResponse }
        var request = URLRequest(url: url)
        request.setValue("\(APIConfig.hl),en;q=0.9", forHTTPHeaderField: "Accept-Language")
        if let userAgent = APIConfig.webProfile.resolvedUserAgent(gl: APIConfig.gl) {
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }
        if let headers = AuthSession.shared.headers(for: url) {
            request.httpShouldHandleCookies = false
            for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        Log.debug("\(replay ? "live_chat_replay" : "live_chat") page -> HTTP \(status), \(data.count) bytes")
        guard (200..<300).contains(status) else { throw InnerTubeError.http(status) }
        guard let json = Self.initialData(in: data) else { throw InnerTubeError.invalidResponse }
        return json
    }

    /// Cuts the `ytInitialData = {...}` object out of a YouTube HTML page.
    static func initialData(in html: Data) -> JNode? {
        let bytes = [UInt8](html)
        let marker = Array("ytInitialData".utf8)
        guard bytes.count > marker.count else { return nil }
        var searchFrom = 0
        while let found = Self.index(of: marker, in: bytes, from: searchFrom) {
            searchFrom = found + marker.count
            // The object starts at the first "{" after the marker (` = {`, `"] = {`).
            guard let start = bytes[searchFrom...].prefix(16).firstIndex(of: UInt8(ascii: "{")) else { continue }
            var depth = 0
            var inString = false
            var escaped = false
            var index = start
            while index < bytes.count {
                let byte = bytes[index]
                if inString {
                    if escaped { escaped = false }
                    else if byte == UInt8(ascii: "\\") { escaped = true }
                    else if byte == UInt8(ascii: "\"") { inString = false }
                } else if byte == UInt8(ascii: "\"") {
                    inString = true
                } else if byte == UInt8(ascii: "{") {
                    depth += 1
                } else if byte == UInt8(ascii: "}") {
                    depth -= 1
                    if depth == 0 {
                        return try? JNode(data: Data(bytes[start...index]))
                    }
                }
                index += 1
            }
            return nil
        }
        return nil
    }

    private static func index(of needle: [UInt8], in haystack: [UInt8], from start: Int) -> Int? {
        guard start <= haystack.count - needle.count else { return nil }
        var index = start
        while index <= haystack.count - needle.count {
            if haystack[index] == needle[0], haystack[index..<index + needle.count].elementsEqual(needle) { return index }
            index += 1
        }
        return nil
    }

    func liveChatReplay(continuation: String, offsetMs: Int) async throws -> JNode {
        try await web("live_chat/get_live_chat_replay", body: [
            "continuation": continuation,
            "currentPlayerState": ["playerOffsetMs": String(max(offsetMs, 0))],
        ])
    }

    func sendLiveChatMessage(_ text: String, params: String) async throws -> JNode {
        try await web("live_chat/send_message", body: [
            "params": params,
            "clientMessageId": UUID().uuidString,
            "richMessage": ["textSegments": [["text": text]]],
        ])
    }

    // MARK: - Account (signed in only)

    func accountMenu() async throws -> JNode {
        try await web("account/account_menu", body: [:])
    }

    /// The website's "Switch account" list (all signed-in Google accounts and channels).
    func accountSwitcher() async throws -> JNode {
        let url = URL(string: "https://www.youtube.com/getAccountSwitcherEndpoint")!
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        if let userAgent = APIConfig.webProfile.resolvedUserAgent(gl: APIConfig.gl) {
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }
        for (key, value) in AuthSession.shared.headers(for: url) ?? [:] { request.setValue(value, forHTTPHeaderField: key) }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        Log.debug("account switcher -> HTTP \(status), \(data.count) bytes")
        guard (200..<300).contains(status) else { throw InnerTubeError.http(status) }
        // The body starts with an anti-JSON-hijacking prefix: )]}'
        var text = String(decoding: data, as: UTF8.self)
        if let start = text.firstIndex(of: "{") { text = String(text[start...]) }
        return try JNode(data: Data(text.utf8))
    }

    func accountsList() async throws -> JNode {
        try await web("account/accounts_list", body: [:])
    }

    func like(videoId: String, action: String) async throws {
        _ = try await web("like/\(action)", body: ["target": ["videoId": videoId]])
    }

    func subscription(channelId: String, subscribe: Bool) async throws {
        _ = try await web(
            subscribe ? "subscription/subscribe" : "subscription/unsubscribe",
            body: ["channelIds": [channelId], "params": subscribe ? "EgIIAhgA" : "CgIIAhgA"]
        )
    }

    func addToPlaylistOptions(videoId: String) async throws -> JNode {
        try await web("playlist/get_add_to_playlist", body: ["videoIds": [videoId]])
    }

    func createPlaylist(title: String, videoId: String?) async throws -> JNode {
        var body: [String: Any] = ["title": title, "privacyStatus": "PRIVATE"]
        if let videoId { body["videoIds"] = [videoId] }
        return try await web("playlist/create", body: body)
    }

    func notificationMenu() async throws -> JNode {
        try await web("notification/get_notification_menu", body: ["notificationsMenuRequestType": "NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX"])
    }

    func unseenNotificationCount() async throws -> Int {
        let json = try await web("notification/get_unseen_count", body: [:])
        return json["unseenCount"].int ?? json.findFirst("unseenCount").int ?? 0
    }

    func createComment(_ text: String, params: String) async throws -> JNode {
        try await web("comment/create_comment", body: ["commentText": text, "createCommentParams": params])
    }

    func createReply(_ text: String, params: String) async throws -> JNode {
        try await web("comment/create_comment_reply", body: ["commentText": text, "createReplyParams": params])
    }

    func editPlaylist(_ playlistId: String, add videoId: String? = nil, remove removedId: String? = nil) async throws {
        var actions: [[String: Any]] = []
        if let videoId { actions.append(["action": "ACTION_ADD_VIDEO", "addedVideoId": videoId]) }
        if let removedId { actions.append(["action": "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", "removedVideoId": removedId]) }
        _ = try await web("browse/edit_playlist", body: ["playlistId": playlistId, "actions": actions])
    }

    /// Adds a video to the account's YouTube watch history: fetch the signed-in web player
    /// response just for its tracking URLs and ping them, the way the website does.
    func markWatched(videoId: String, duration: Double) async {
        guard AuthSession.shared.isAuthenticated,
              let json = try? await web("player", body: ["videoId": videoId, "contentCheckOk": true, "racyCheckOk": true])
        else { return }
        let cpn = Self.randomToken(16)
        let length = String(max((json.at("videoDetails", "lengthSeconds").double ?? duration) - 1, 1))
        for (index, key) in ["videostatsPlaybackUrl", "videostatsWatchtimeUrl"].enumerated() {
            guard let base = json.at("playbackTracking", key, "baseUrl").string,
                  var components = URLComponents(string: base) else { continue }
            var items = (components.queryItems ?? []).filter { !["ver", "cpn", "cmt", "el", "st", "et"].contains($0.name) }
            items += [
                URLQueryItem(name: "ver", value: "2"),
                URLQueryItem(name: "cpn", value: cpn),
                URLQueryItem(name: "cmt", value: length),
                URLQueryItem(name: "el", value: "detailpage"),
            ]
            if index == 1 {
                items += [URLQueryItem(name: "st", value: "0"), URLQueryItem(name: "et", value: length)]
            }
            components.queryItems = items
            guard let url = components.url else { continue }
            var request = URLRequest(url: url)
            request.httpShouldHandleCookies = false
            for (header, value) in AuthSession.shared.headers(for: url) ?? [:] { request.setValue(value, forHTTPHeaderField: header) }
            let status = ((try? await session.data(for: request))?.1 as? HTTPURLResponse)?.statusCode ?? 0
            Log.debug("mark watched \(videoId) \(key) -> HTTP \(status)")
        }
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
