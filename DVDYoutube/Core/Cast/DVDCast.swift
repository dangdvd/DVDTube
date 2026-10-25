import Foundation
import Network
import Observation

/// "Truyền tới DVDTube": sends videos to DVDTube running on an Android TV or a computer.
/// Receivers advertise `_dvdtube._tcp` with Bonjour and serve a small JSON API on the LAN
/// (port 8766 by default). The receiver fetches the stream itself in full quality; the
/// phone only sends video ids and remote-control commands — never cookies or account data.
@MainActor
@Observable
final class DVDCast {
    static let shared = DVDCast()

    struct Receiver: Identifiable, Hashable {
        /// The receiver's stable id (TXT `id`), or "manual:<host:port>" until it is known.
        var id: String
        var name: String
        /// "tv" or "desktop".
        var kind: String
        /// Bonjour service, resolved to an address when connecting.
        var endpoint: NWEndpoint?
        /// "a.b.c.d:port" for receivers added by address.
        var address: String?
        var isManual: Bool

        var icon: String { kind == "desktop" ? "desktopcomputer" : "tv" }
        var kindTitle: String { kind == "desktop" ? "DVDTube trên máy tính" : "DVDTube trên TV" }
    }

    struct Status: Equatable {
        var state = "idle"
        var video: VideoItem?
        var position: Double = 0
        var duration: Double = 0
        var volume: Double = 1
        var muted = false
        var queue: [VideoItem] = []
        var index = 0
        var error: String?

        var isPlaying: Bool { state == "playing" || state == "buffering" || state == "loading" }
    }

    enum State: Equatable {
        case idle
        case connecting
        case connected
        case failed(String)
    }

    enum Failure: LocalizedError {
        case unreachable(String)
        case refused(String)
        case invalidAddress

        var errorDescription: String? {
            switch self {
            case .unreachable(let name):
                return "Không kết nối được tới \(name). Hai thiết bị phải cùng mạng Wi-Fi và DVDTube phải đang mở trên TV/máy tính. Nếu iPhone hỏi quyền truy cập mạng cục bộ, hãy cho phép."
            case .refused(let message):
                return message
            case .invalidAddress:
                return "Địa chỉ không hợp lệ. Nhập dạng 192.168.1.20:8766 (chỉ địa chỉ trong mạng nội bộ)."
            }
        }
    }

    private(set) var discovered: [Receiver] = []
    private(set) var manual: [Receiver] = []
    private(set) var state: State = .idle
    private(set) var receiver: Receiver?
    private(set) var status = Status()
    private(set) var isDiscovering = false
    /// The receiver serves `/api/queue/edit` (its `/api/info` features list "queue-edit").
    private(set) var supportsQueueEdit = false

    var isConnected: Bool { state == .connected }
    var isActive: Bool { state == .connected || state == .connecting }

    /// The receiver has a video loaded: picking another one asks whether to play it now or queue it.
    var receiverBusy: Bool {
        status.video != nil && ["playing", "paused", "buffering", "loading"].contains(status.state)
    }

    /// A moment after a queue edit from here, when statuses may still show the old queue.
    var queueEditPending: Bool { Date().timeIntervalSince(lastQueueEditAt) < 1.5 }

    /// Discovered receivers first, then the ones added by address (without duplicates).
    var receivers: [Receiver] {
        let found = Set(discovered.map(\.id))
        return discovered + manual.filter { !found.contains($0.id) }
    }

    /// The remote-control sheet is on screen: poll every second.
    @ObservationIgnored var remoteVisible = false {
        didSet { if remoteVisible, isConnected { pollSoon() } }
    }

    static let defaultPort = 8766
    private static let manualKey = "dvdcast.manualReceivers"

    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var host: String?
    @ObservationIgnored private var connectTask: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var failures = 0
    @ObservationIgnored private var isForeground = true
    /// Position reported locally right after a seek, until the receiver confirms it.
    @ObservationIgnored private var lastCommandAt = Date.distantPast
    /// A video just sent with /api/play: older statuses (still the previous video) are ignored.
    @ObservationIgnored private var expectedVideo: (id: String, since: Date)?
    @ObservationIgnored private var lastQueueEditAt = Date.distantPast
    @ObservationIgnored private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 8
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    private init() {
        loadManual()
    }

    // MARK: Discovery

    func startDiscovery() {
        guard browser == nil else { return }
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: "_dvdtube._tcp", domain: nil), using: .tcp)
        browser.stateUpdateHandler = { state in
            if case .failed(let error) = state { Log.debug("dvdtube cast discovery: \(error)") }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            MainActor.assumeIsolated {
                self?.updateDiscovered(results)
            }
        }
        browser.start(queue: .main)
        self.browser = browser
        isDiscovering = true
    }

    func stopDiscovery() {
        browser?.cancel()
        browser = nil
        isDiscovering = false
    }

    private func updateDiscovered(_ results: Set<NWBrowser.Result>) {
        discovered = results.compactMap { result -> Receiver? in
            guard case let .service(name, _, _, _) = result.endpoint else { return nil }
            var txt: [String: String] = [:]
            if case let .bonjour(record) = result.metadata { txt = record.dictionary }
            let display = (txt["name"]?.isEmpty == false ? txt["name"] : nil) ?? name
            return Receiver(id: txt["id"] ?? name, name: display, kind: txt["kind"] ?? "tv",
                            endpoint: result.endpoint, address: nil, isManual: false)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        Log.debug("dvdtube cast discovery: \(discovered.count) receiver(s)")
    }

    // MARK: Receivers added by address

    /// "192.168.1.20:8766" or "192.168.1.20" (default port). Checks the receiver answers.
    func addManual(_ text: String) async throws -> Receiver {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("http://") { value.removeFirst("http://".count) }
        if value.hasSuffix("/") { value.removeLast() }
        if !value.contains(":") { value += ":\(Self.defaultPort)" }
        guard TVLoginRequest.isPrivateLANAddress(value) else { throw Failure.invalidAddress }
        let info = try await call("GET", "/api/info", host: value, timeout: 5)
        guard info["app"].string == "DVDTube" else {
            throw Failure.refused("Thiết bị ở \(value) không phải DVDTube.")
        }
        let receiver = Receiver(
            id: info["id"].string ?? "manual:\(value)",
            name: info["name"].string ?? value,
            kind: info["kind"].string ?? "tv",
            endpoint: nil, address: value, isManual: true
        )
        manual.removeAll { $0.id == receiver.id || $0.address == value }
        manual.insert(receiver, at: 0)
        saveManual()
        return receiver
    }

    func removeManual(_ receiver: Receiver) {
        manual.removeAll { $0.id == receiver.id }
        saveManual()
    }

    private func loadManual() {
        guard let list = UserDefaults.standard.array(forKey: Self.manualKey) as? [[String: String]] else { return }
        manual = list.compactMap { entry in
            guard let address = entry["address"], let id = entry["id"] else { return nil }
            return Receiver(id: id, name: entry["name"] ?? address, kind: entry["kind"] ?? "tv",
                            endpoint: nil, address: address, isManual: true)
        }
    }

    private func saveManual() {
        let list: [[String: String]] = manual.compactMap { receiver in
            guard let address = receiver.address else { return nil }
            return ["id": receiver.id, "name": receiver.name, "kind": receiver.kind, "address": address]
        }
        UserDefaults.standard.set(list, forKey: Self.manualKey)
    }

    // MARK: Connection

    /// Connects; when given a video it starts playing on the receiver at `startAt`.
    func connect(to receiver: Receiver, video: VideoItem?, startAt: Double?, queue: [VideoItem]?, index: Int?,
                 playlistId: String? = nil) {
        disconnect(sendStop: false, notify: false)
        CastManager.shared.disconnect()
        self.receiver = receiver
        state = .connecting
        status = Status()
        supportsQueueEdit = false
        connectTask = Task { [weak self] in
            guard let self else { return }
            do {
                let address = try await self.resolve(receiver)
                guard !Task.isCancelled else { return }
                let info = try await self.call("GET", "/api/info", host: address, timeout: 6)
                guard info["app"].string == "DVDTube" else {
                    throw Failure.refused("Thiết bị này không phải DVDTube.")
                }
                guard !Task.isCancelled, self.receiver?.id == receiver.id else { return }
                self.host = address
                if let name = info["name"].string, !name.isEmpty { self.receiver?.name = name }
                self.supportsQueueEdit = info["features"].array.contains { $0.string == "queue-edit" }
                self.state = .connected
                self.failures = 0
                Log.debug("dvdtube cast: connected (\(info["kind"].string ?? "?"), protocol \(info["protocol"].int ?? 0))")
                PlayerManager.shared.castDidConnect()
                self.startPolling()
                if let video {
                    self.status.video = video
                    self.expectedVideo = (video.id, Date())
                    do {
                        try await self.sendPlay(video, startAt: startAt, queue: queue, index: index, playlistId: playlistId)
                    } catch {
                        // Connected, but this video was refused: say why and stay connected.
                        self.expectedVideo = nil
                        PlayerManager.shared.showToast(error.localizedDescription)
                    }
                }
            } catch {
                guard !Task.isCancelled, self.receiver?.id == receiver.id else { return }
                Log.debug("dvdtube cast: connect failed: \(error.localizedDescription)")
                self.state = .failed(error.localizedDescription)
                self.receiver = nil
                self.host = nil
            }
        }
    }

    /// Stops casting. `sendStop` also stops playback on the receiver.
    func disconnect(sendStop: Bool = true, notify: Bool = true) {
        let wasConnected = state == .connected
        connectTask?.cancel()
        pollTask?.cancel()
        pollTask = nil
        if sendStop, wasConnected, let host {
            let request = makeRequest("POST", "/api/control", host: host,
                                      body: ["action": "stop", "value": NSNull()], timeout: 3)
            if let request { session.dataTask(with: request).resume() }
        }
        host = nil
        supportsQueueEdit = false
        if notify {
            state = .idle
            receiver = nil
            if wasConnected { PlayerManager.shared.castDidEnd() }
        }
    }

    /// "Tiếp tục trên thiết bị này": stop the receiver and continue here from its position.
    func continueHere() {
        let position = status.position
        let video = status.video
        disconnect()
        PlayerManager.shared.resumeLocally(video: video, at: position)
    }

    func appDidEnterBackground() {
        isForeground = false
    }

    func appWillEnterForeground() {
        isForeground = true
        if isConnected { pollSoon() }
    }

    /// The service's address (IPv4) through a short TCP connection to it.
    private func resolve(_ receiver: Receiver) async throws -> String {
        if let address = receiver.address { return address }
        guard let endpoint = receiver.endpoint else { throw Failure.unreachable(receiver.name) }
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
            ip.version = .v4
        }
        let connection = NWConnection(to: endpoint, using: parameters)
        let name = receiver.name
        return try await withCheckedThrowingContinuation { continuation in
            let once = ContinuationOnce(continuation)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if case let .hostPort(host, port)? = connection.currentPath?.remoteEndpoint,
                       let text = LANAddress.string(host) {
                        once.resume(.success("\(text):\(port.rawValue)"))
                    } else {
                        once.resume(.failure(Failure.unreachable(name)))
                    }
                    connection.cancel()
                case .failed:
                    once.resume(.failure(Failure.unreachable(name)))
                    connection.cancel()
                default:
                    break
                }
            }
            connection.start(queue: .main)
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                once.resume(.failure(Failure.unreachable(name)))
                connection.cancel()
            }
        }
    }

    // MARK: Commands

    /// Plays a video on the receiver (with the rest of the queue when there is one).
    func play(_ video: VideoItem, startAt: Double?, queue: [VideoItem]?, index: Int?, playlistId: String? = nil) {
        guard isConnected else { return }
        status.video = video
        status.position = startAt ?? 0
        status.state = "loading"
        expectedVideo = (video.id, Date())
        Task {
            do {
                try await sendPlay(video, startAt: startAt, queue: queue, index: index, playlistId: playlistId)
            } catch {
                PlayerManager.shared.showToast(error.localizedDescription)
            }
        }
    }

    private func sendPlay(_ video: VideoItem, startAt: Double?, queue: [VideoItem]?, index: Int?, playlistId: String?) async throws {
        guard let host else { return }
        let list = queue.map { Array($0.prefix(200)) }
        var body: [String: Any] = [
            "video": CrossJSON.video(video),
            "startSeconds": CrossJSON.orNull(startAt.map { max(0, $0) }),
            "queue": CrossJSON.orNull(list.map { items in items.map { CrossJSON.video($0) } }),
            "index": CrossJSON.orNull(index),
            "playlistId": CrossJSON.orNull(playlistId),
        ]
        body["sender"] = CrossJSON.deviceName
        _ = try await call("POST", "/api/play", host: host, body: body)
        lastCommandAt = Date()
        pollSoon()
    }

    /// Adds a video to the receiver's queue (`next`: play it right after the current one).
    func enqueue(_ video: VideoItem, next: Bool) {
        guard isConnected, let host else { return }
        Task {
            do {
                _ = try await call("POST", "/api/queue", host: host, body: ["video": CrossJSON.video(video), "next": next])
                PlayerManager.shared.showToast(next ? "Sẽ phát tiếp theo trên \(receiver?.name ?? "TV")"
                                                    : "Đã thêm vào hàng đợi trên \(receiver?.name ?? "TV")")
                pollSoon()
            } catch {
                PlayerManager.shared.showToast(error.localizedDescription)
            }
        }
    }

    /// "Phát ngay" keeping the receiver's queue: the video goes next in line, then the receiver skips to it.
    func playNow(_ video: VideoItem) {
        guard isConnected, let host else { return }
        lastQueueEditAt = Date()
        Task {
            do {
                _ = try await call("POST", "/api/queue", host: host, body: ["video": CrossJSON.video(video), "next": true])
                _ = try await call("POST", "/api/control", host: host, body: ["action": "next", "value": NSNull()])
                pollSoon()
            } catch {
                PlayerManager.shared.showToast(error.localizedDescription)
            }
        }
    }

    /// Edits the receiver's queue (remove | move | play | clear); false (with a message) when its
    /// DVDTube is too old for that.
    @discardableResult
    func editQueue(_ op: String, index: Int, videoId: String?, to: Int? = nil) -> Bool {
        guard isConnected, let host else { return false }
        guard supportsQueueEdit else {
            PlayerManager.shared.showToast("Hãy cập nhật DVDTube trên \(receiver?.name ?? "TV") để sửa hàng đợi từ iPhone")
            return false
        }
        lastQueueEditAt = Date()
        let body: [String: Any] = [
            "op": op,
            "index": index,
            "videoId": CrossJSON.orNull(videoId),
            "to": CrossJSON.orNull(to),
        ]
        Task {
            do {
                _ = try await call("POST", "/api/queue/edit", host: host, body: body)
                pollSoon()
            } catch {
                PlayerManager.shared.showToast(error.localizedDescription)
            }
        }
        return true
    }

    /// play | pause | toggle | seek | skip | next | previous | stop | volume | mute
    func control(_ action: String, value: Double? = nil) {
        guard isConnected, let host else { return }
        // Show the result at once; the next status confirms it.
        switch action {
        case "play": status.state = "playing"
        case "pause": status.state = "paused"
        case "toggle": status.state = status.isPlaying ? "paused" : "playing"
        case "seek": if let value { status.position = max(0, value) }
        case "skip": if let value { status.position = max(0, status.position + value) }
        case "volume": if let value { status.volume = min(max(value, 0), 1) }
        case "mute": if let value { status.muted = value != 0 }
        default: break
        }
        lastCommandAt = Date()
        applyToPlayer()
        Task {
            do {
                _ = try await call("POST", "/api/control", host: host,
                                   body: ["action": action, "value": CrossJSON.orNull(value)])
                pollSoon()
            } catch {
                PlayerManager.shared.showToast(error.localizedDescription)
            }
        }
    }

    // MARK: Status

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if self.isForeground || self.remoteVisible { await self.pollOnce() }
                let interval: UInt64 = self.remoteVisible || PlayerManager.shared.isExpanded ? 1_000_000_000 : 2_000_000_000
                try? await Task.sleep(nanoseconds: interval)
            }
        }
    }

    private func pollSoon() {
        Task { await pollOnce() }
    }

    private func pollOnce() async {
        guard isConnected, let host else { return }
        do {
            let json = try await call("GET", "/api/status", host: host, timeout: 4)
            guard isConnected, self.host == host else { return }
            failures = 0
            var next = Status()
            next.state = json["state"].string ?? "idle"
            next.video = CrossJSON.video(from: json["video"])
            next.position = json["position"].double ?? 0
            next.duration = json["duration"].double ?? 0
            next.volume = json["volume"].double ?? 1
            next.muted = json["muted"].bool ?? false
            next.queue = json["queue"].array.compactMap { CrossJSON.video(from: $0) }
            next.index = json["index"].int ?? 0
            next.error = json["error"].string
            // A command sent a moment ago may not be reflected yet.
            if Date().timeIntervalSince(lastCommandAt) < 0.8 { return }
            if let expected = expectedVideo {
                if next.video?.id == expected.id {
                    expectedVideo = nil
                } else if Date().timeIntervalSince(expected.since) < 10 {
                    return
                } else {
                    expectedVideo = nil
                }
            }
            let changedVideo = next.video?.id != status.video?.id
            status = next
            applyToPlayer()
            if changedVideo, let video = next.video {
                PlayerManager.shared.castDidChangeVideo(video, queue: next.queue, index: next.index)
            } else if !queueEditPending {
                // Another phone may have added, removed or moved videos.
                PlayerManager.shared.castDidUpdateQueue(next.queue, index: next.index)
            }
        } catch {
            failures += 1
            if failures >= 5 {
                let name = receiver?.name ?? "TV"
                Log.debug("dvdtube cast: lost the receiver")
                disconnect(sendStop: false)
                state = .failed("Mất kết nối với \(name).")
            }
        }
    }

    private func applyToPlayer() {
        PlayerManager.shared.applyCastStatus(
            time: status.position,
            duration: status.duration > 0 ? status.duration : nil,
            playing: status.isPlaying,
            buffering: status.state == "buffering" || status.state == "loading"
        )
    }

    // MARK: HTTP

    private func makeRequest(_ method: String, _ path: String, host: String, body: [String: Any]?, timeout: TimeInterval) -> URLRequest? {
        guard let url = URL(string: "http://\(host)\(path)") else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body, let data = try? JSONSerialization.data(withJSONObject: body) {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = data
        }
        return request
    }

    private func call(_ method: String, _ path: String, host: String, body: [String: Any]? = nil,
                      timeout: TimeInterval = 6) async throws -> JNode {
        guard let request = makeRequest(method, path, host: host, body: body, timeout: timeout) else {
            throw Failure.invalidAddress
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Failure.unreachable(receiver?.name ?? host)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JNode(data: data)) ?? .empty
        guard status == 200, json["ok"].bool == true else {
            if path != "/api/status" { Log.debug("dvdtube cast: \(path) -> HTTP \(status)") }
            throw Failure.refused(json["error"].string ?? "Thiết bị trả lời lỗi (HTTP \(status)).")
        }
        return json
    }
}
