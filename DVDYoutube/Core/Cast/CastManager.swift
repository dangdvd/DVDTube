import Foundation
import Network
import Observation

/// Chromecast / Google TV support without Google's SDK: finds devices with Bonjour,
/// talks Cast v2 over TLS, starts the Default Media Receiver on the TV and hands it
/// the same ad-free stream the app plays itself.
@MainActor
@Observable
final class CastManager {
    static let shared = CastManager()

    struct Device: Identifiable, Hashable {
        let id: String
        let name: String
        let model: String?
        let endpoint: NWEndpoint
    }

    enum State: Equatable {
        case idle
        case connecting
        case connected
        case failed(String)
    }

    private(set) var devices: [Device] = []
    private(set) var isDiscovering = false
    private(set) var discoveryError: String?
    private(set) var state: State = .idle
    private(set) var device: Device?
    /// What the TV is doing ("Đang tải…", errors), nil while it simply plays.
    private(set) var statusText: String?
    private(set) var volume: Double = 1

    var isConnected: Bool { state == .connected }
    var isActive: Bool { state == .connected || state == .connecting }

    // MARK: Private state

    private static let appId = "CC1AD845" // Default Media Receiver
    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var connection: NWConnection?
    @ObservationIgnored private var heartbeatTask: Task<Void, Never>?
    @ObservationIgnored private var clockTask: Task<Void, Never>?
    @ObservationIgnored private var connectTimeout: Task<Void, Never>?
    @ObservationIgnored private var requestId = 0
    @ObservationIgnored private var transportId: String?
    @ObservationIgnored private var sessionId: String?
    @ObservationIgnored private var mediaSessionId: Int?
    /// FINISHED is repeated by later status updates; report it once per media session.
    @ObservationIgnored private var finishedSessionId: Int?
    @ObservationIgnored private var launchRequested = false

    @ObservationIgnored private var playerState = "IDLE"
    @ObservationIgnored private var reportedTime: Double = 0
    @ObservationIgnored private var reportedAt = Date()
    @ObservationIgnored private var mediaDuration: Double?

    private struct Candidate {
        var url: URL
        var contentType: String
        /// HLS segment format hints for the receiver ("fmp4" / "ts", "fmp4" / "mpeg2_ts").
        var segmentFormat: String?
        var videoSegmentFormat: String?
        var live: Bool
        var kind: String
    }

    private struct PendingLoad {
        var video: VideoItem
        var startAt: Double
    }

    @ObservationIgnored private var pendingLoad: PendingLoad?
    @ObservationIgnored private var loadingVideo: VideoItem?
    @ObservationIgnored private var candidates: [Candidate] = []
    @ObservationIgnored private var candidateIndex = 0
    @ObservationIgnored private var loadStartAt: Double = 0
    @ObservationIgnored private var loadRequestId: Int?
    @ObservationIgnored private var loadTimeout: Task<Void, Never>?
    @ObservationIgnored private var prepareTask: Task<Void, Never>?
    /// The stream kind that last worked, tried first next time.
    @ObservationIgnored private var workingKind: String?
    @ObservationIgnored private var reconnectDevice: Device?

    private init() {}

    // MARK: Discovery

    func startDiscovery() {
        guard browser == nil else { return }
        discoveryError = nil
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: "_googlecast._tcp", domain: nil), using: .tcp)
        browser.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                guard let self else { return }
                switch state {
                case .failed(let error), .waiting(let error):
                    Log.debug("cast discovery: \(error)")
                    self.discoveryError = "Không tìm được thiết bị. Hãy cho phép “Mạng cục bộ” cho DVDTube trong Cài đặt iPhone và dùng chung Wi-Fi với TV."
                case .ready:
                    self.discoveryError = nil
                default:
                    break
                }
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            MainActor.assumeIsolated {
                self?.updateDevices(results)
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

    private func updateDevices(_ results: Set<NWBrowser.Result>) {
        devices = results.compactMap { result -> Device? in
            guard case let .service(name, _, _, _) = result.endpoint else { return nil }
            var txt: [String: String] = [:]
            if case let .bonjour(record) = result.metadata { txt = record.dictionary }
            return Device(
                id: txt["id"] ?? name,
                name: txt["fn"] ?? name,
                model: txt["md"],
                endpoint: result.endpoint
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    // MARK: Connection

    /// Connects and, when given a video, plays it on the TV.
    func connect(to device: Device, video: VideoItem?, startAt: Double) {
        disconnect(stopApp: false, notify: false)
        self.device = device
        state = .connecting
        statusText = "Đang kết nối…"
        if let video { pendingLoad = PendingLoad(video: video, startAt: startAt) }

        let tls = NWProtocolTLS.Options()
        // Cast devices use self-signed certificates.
        sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, _, complete in
            complete(true)
        }, .main)
        let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        let connection = NWConnection(to: device.endpoint, using: parameters)
        connection.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                guard let self, connection === self.connection else { return }
                switch state {
                case .ready:
                    self.didOpenConnection()
                case .failed(let error):
                    self.connectionLost("Mất kết nối với \(device.name): \(error.localizedDescription)")
                case .cancelled:
                    break
                default:
                    break
                }
            }
        }
        self.connection = connection
        connection.start(queue: .main)
        receiveFrame(on: connection)

        connectTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            guard let self, !Task.isCancelled, self.state == .connecting else { return }
            self.connectionLost("Không kết nối được với \(device.name).")
        }
    }

    /// Stops casting. `stopApp` also closes the receiver on the TV.
    func disconnect(stopApp: Bool = true, notify: Bool = true) {
        let wasConnected = state == .connected
        if stopApp, let sessionId {
            send(CastMessage.Namespace.receiver, ["type": "STOP", "sessionId": sessionId])
        }
        if let transportId {
            send(CastMessage.Namespace.connection, ["type": "CLOSE"], to: transportId)
        }
        let closing = connection
        connection = nil
        // Let the last messages go out before closing the socket.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { closing?.cancel() }
        heartbeatTask?.cancel()
        clockTask?.cancel()
        connectTimeout?.cancel()
        loadTimeout?.cancel()
        prepareTask?.cancel()
        transportId = nil
        sessionId = nil
        mediaSessionId = nil
        launchRequested = false
        pendingLoad = nil
        loadingVideo = nil
        loadRequestId = nil
        playerState = "IDLE"
        statusText = nil
        CastKeepAlive.stop()
        CastProxy.shared.stop()
        if notify {
            state = .idle
            device = nil
            reconnectDevice = nil
            if wasConnected { PlayerManager.shared.castDidEnd() }
        }
    }

    private func connectionLost(_ message: String) {
        guard connection != nil || state == .connecting else { return }
        let lostDevice = device
        let wasConnected = state == .connected
        disconnect(stopApp: false, notify: false)
        Log.debug("cast: \(message)")
        state = .failed(message)
        device = nil
        if wasConnected {
            // The TV keeps playing; rejoin it when the app comes back.
            reconnectDevice = lostDevice
            PlayerManager.shared.castDidEnd()
        }
    }

    /// iOS drops the socket while the app is suspended; join the running session again.
    func appWillEnterForeground() {
        guard let device = reconnectDevice, connection == nil else { return }
        reconnectDevice = nil
        connect(to: device, video: nil, startAt: 0)
    }

    private func didOpenConnection() {
        connectTimeout?.cancel()
        send(CastMessage.Namespace.connection, ["type": "CONNECT"])
        send(CastMessage.Namespace.receiver, ["type": "GET_STATUS"])
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard let self, !Task.isCancelled else { return }
                self.send(CastMessage.Namespace.heartbeat, ["type": "PING"])
                if self.transportId != nil { self.send(CastMessage.Namespace.media, ["type": "GET_STATUS"], to: self.transportId) }
            }
        }
    }

    // MARK: Messages

    private func send(_ namespace: String, _ payload: [String: Any], to destination: String? = "receiver-0") {
        guard let connection, let destination else { return }
        var payload = payload
        if namespace != CastMessage.Namespace.connection, namespace != CastMessage.Namespace.heartbeat {
            requestId += 1
            payload["requestId"] = requestId
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        let message = CastMessage(source: "sender-0", destination: destination, namespace: namespace, payload: text)
        connection.send(content: message.framed, completion: .contentProcessed { _ in })
    }

    private func receiveFrame(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] header, _, _, error in
            MainActor.assumeIsolated {
                guard let self, connection === self.connection else { return }
                guard let header, header.count == 4, error == nil else {
                    self.connectionLost("Thiết bị đã ngắt kết nối.")
                    return
                }
                let bytes = [UInt8](header)
                let length = Int(bytes[0]) << 24 | Int(bytes[1]) << 16 | Int(bytes[2]) << 8 | Int(bytes[3])
                guard length > 0, length < 1 << 20 else {
                    self.connectionLost("Dữ liệu từ thiết bị không hợp lệ.")
                    return
                }
                connection.receive(minimumIncompleteLength: length, maximumLength: length) { [weak self] body, _, _, error in
                    MainActor.assumeIsolated {
                        guard let self, connection === self.connection else { return }
                        guard let body, body.count == length, error == nil else {
                            self.connectionLost("Thiết bị đã ngắt kết nối.")
                            return
                        }
                        if let message = CastMessage.decode(body) { self.handle(message) }
                        self.receiveFrame(on: connection)
                    }
                }
            }
        }
    }

    private func handle(_ message: CastMessage) {
        guard let json = try? JNode(data: Data(message.payload.utf8)) else { return }
        let type = json["type"].string ?? ""
        switch (message.namespace, type) {
        case (CastMessage.Namespace.heartbeat, "PING"):
            send(CastMessage.Namespace.heartbeat, ["type": "PONG"], to: message.source)
        case (CastMessage.Namespace.connection, "CLOSE"):
            if message.source == transportId {
                // The receiver app was closed on the TV.
                disconnect(stopApp: false)
            }
        case (CastMessage.Namespace.receiver, "RECEIVER_STATUS"):
            handleReceiverStatus(json["status"])
        case (CastMessage.Namespace.receiver, "LAUNCH_ERROR"):
            connectionLost("TV không mở được trình phát (\(json["reason"].string ?? "lỗi")).")
        case (CastMessage.Namespace.media, "MEDIA_STATUS"):
            handleMediaStatus(json)
        case (CastMessage.Namespace.media, "LOAD_FAILED"), (CastMessage.Namespace.media, "LOAD_CANCELLED"),
             (CastMessage.Namespace.media, "INVALID_REQUEST"):
            Log.debug("cast: \(type) detailedErrorCode=\(json["detailedErrorCode"].int ?? -1) reason=\(json["reason"].string ?? "-")")
            if json["requestId"].int == loadRequestId { tryNextCandidate(reason: type) }
        case (CastMessage.Namespace.media, "ERROR"):
            // CAF receivers report playback errors with a detailed code (e.g. 104 source not
            // supported, 311/312 HLS playlist network error, 301 segment network error).
            Log.debug("cast: ERROR detailedErrorCode=\(json["detailedErrorCode"].int ?? -1) reason=\(json["reason"].string ?? "-")")
        default:
            break
        }
    }

    private func handleReceiverStatus(_ status: JNode) {
        if let level = status.at("volume", "level").double { volume = level }
        let app = status["applications"].array.first { $0["appId"].string == Self.appId }
        guard let app, let transport = app["transportId"].string else {
            // Our receiver is not running: start it (only when there is something to play).
            if transportId != nil {
                disconnect(stopApp: false)
            } else if !launchRequested, pendingLoad != nil {
                launchRequested = true
                statusText = "Đang mở trình phát trên TV…"
                send(CastMessage.Namespace.receiver, ["type": "LAUNCH", "appId": Self.appId])
            } else if pendingLoad == nil, state == .connecting {
                // Rejoining, but the TV has stopped playing in the meantime.
                disconnect(stopApp: false)
            }
            return
        }
        sessionId = app["sessionId"].string
        guard transport != transportId else { return }
        transportId = transport
        send(CastMessage.Namespace.connection, ["type": "CONNECT"], to: transport)
        let isNewSession = state != .connected
        state = .connected
        statusText = nil
        startClock()
        if isNewSession {
            CastKeepAlive.start()
            PlayerManager.shared.castDidConnect()
        }
        if let pending = pendingLoad {
            pendingLoad = nil
            load(pending.video, info: PlayerManager.shared.playerInfo, startAt: pending.startAt)
        } else {
            // Joined a session that was already playing.
            send(CastMessage.Namespace.media, ["type": "GET_STATUS"], to: transport)
        }
    }

    private func handleMediaStatus(_ json: JNode) {
        let status = json["status"][0]
        guard status.exists else { return }
        if let id = status["mediaSessionId"].int { mediaSessionId = id }
        if let time = status["currentTime"].double {
            reportedTime = time
            reportedAt = Date()
        }
        if let duration = status.at("media", "duration").double, duration > 0 { mediaDuration = duration }
        playerState = status["playerState"].string ?? playerState

        switch playerState {
        case "PLAYING", "BUFFERING", "PAUSED":
            if loadingVideo != nil, loadRequestId != nil {
                // The current candidate works.
                workingKind = candidates.indices.contains(candidateIndex) ? candidates[candidateIndex].kind : workingKind
                loadTimeout?.cancel()
                loadRequestId = nil
                loadingVideo = nil
                statusText = nil
            }
        case "IDLE":
            switch status["idleReason"].string {
            case "ERROR":
                if loadRequestId != nil || loadingVideo != nil { tryNextCandidate(reason: "ERROR") }
            case "FINISHED":
                guard loadingVideo == nil, finishedSessionId != mediaSessionId else { return }
                finishedSessionId = mediaSessionId
                pushStatus()
                PlayerManager.shared.castDidFinish()
                return
            default:
                break
            }
        default:
            break
        }
        pushStatus()
    }

    // MARK: Loading media

    /// Plays a video on the connected TV (fetching its streams if needed).
    func load(_ video: VideoItem, info: PlayerInfo?, startAt: Double) {
        guard state == .connected || state == .connecting else { return }
        guard transportId != nil else {
            pendingLoad = PendingLoad(video: video, startAt: startAt)
            if state == .connected, !launchRequested {
                launchRequested = true
                send(CastMessage.Namespace.receiver, ["type": "LAUNCH", "appId": Self.appId])
            }
            return
        }
        prepareTask?.cancel()
        loadTimeout?.cancel()
        loadingVideo = video
        loadStartAt = startAt
        statusText = "Đang tải video lên TV…"
        reportedTime = startAt
        reportedAt = Date()
        playerState = "BUFFERING"
        pushStatus()
        prepareTask = Task { [weak self] in
            do {
                let streams: PlayerInfo
                if let info, info.videoId == video.id {
                    streams = info
                } else {
                    streams = try await YouTubeService.shared.player(video.id)
                }
                guard let self, !Task.isCancelled, self.loadingVideo?.id == video.id else { return }
                // Streams only start working once YouTube's server-side ad wait is over.
                let wait = streams.availableAt.timeIntervalSinceNow
                if wait > 0 {
                    self.statusText = "Đang chờ \(Int(wait.rounded(.up))) giây…"
                    try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                }
                guard !Task.isCancelled, self.loadingVideo?.id == video.id else { return }
                var relayed: Candidate?
                if let hls = streams.hlsURL, let host = self.localHost() {
                    do {
                        let relay = try await CastProxy.shared.prepare(hls: hls, host: host)
                        relayed = Candidate(
                            url: relay.url, contentType: "application/x-mpegurl",
                            segmentFormat: relay.isFMP4 ? "fmp4" : "ts",
                            videoSegmentFormat: relay.isFMP4 ? "fmp4" : "mpeg2_ts",
                            live: streams.isLive, kind: "relay-hls"
                        )
                    } catch {
                        Log.debug("cast relay unavailable: \(error.localizedDescription)")
                    }
                }
                guard !Task.isCancelled, self.loadingVideo?.id == video.id else { return }
                self.candidates = self.makeCandidates(streams, relayed: relayed)
                self.candidateIndex = 0
                if self.candidates.isEmpty {
                    self.statusText = "Video này không phát được trên TV."
                    self.loadingVideo = nil
                    return
                }
                self.sendLoad()
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.statusText = "Không tải được video: \(error.localizedDescription)"
                self.loadingVideo = nil
            }
        }
    }

    /// The stream relayed through the phone first; then the TV fetching YouTube directly
    /// (works when the TV shares the phone's public address and CORS allows it).
    private func makeCandidates(_ info: PlayerInfo, relayed: Candidate?) -> [Candidate] {
        var list: [Candidate] = relayed.map { [$0] } ?? []
        if let hls = info.hlsURL {
            list.append(Candidate(url: hls, contentType: "application/x-mpegurl", segmentFormat: "fmp4",
                                  videoSegmentFormat: "fmp4", live: info.isLive, kind: "hls-fmp4"))
            list.append(Candidate(url: hls, contentType: "application/x-mpegurl", segmentFormat: nil,
                                  videoSegmentFormat: nil, live: info.isLive, kind: "hls"))
        }
        if !info.isLive, let muxed = info.muxedFormats.filter({ $0.mimeType.contains("mp4") })
            .max(by: { ($0.height ?? 0) < ($1.height ?? 0) }) {
            list.append(Candidate(url: muxed.url, contentType: "video/mp4", segmentFormat: nil,
                                  videoSegmentFormat: nil, live: false, kind: "mp4"))
        }
        if let workingKind, let index = list.firstIndex(where: { $0.kind == workingKind }) {
            list.insert(list.remove(at: index), at: 0)
        }
        return list
    }

    private func sendLoad() {
        guard let video = loadingVideo, let transportId, candidates.indices.contains(candidateIndex) else { return }
        let candidate = candidates[candidateIndex]
        var media: [String: Any] = [
            "contentId": candidate.url.absoluteString,
            "contentUrl": candidate.url.absoluteString,
            "contentType": candidate.contentType,
            "streamType": candidate.live ? "LIVE" : "BUFFERED",
            "metadata": [
                "metadataType": 0,
                "title": video.title,
                "subtitle": video.channelName ?? "",
                "images": video.displayThumbnail.map { [["url": $0.absoluteString]] } ?? [],
            ] as [String: Any],
        ]
        if let format = candidate.segmentFormat { media["hlsSegmentFormat"] = format }
        if let format = candidate.videoSegmentFormat { media["hlsVideoSegmentFormat"] = format }
        var payload: [String: Any] = ["type": "LOAD", "media": media, "autoplay": true]
        if !candidate.live { payload["currentTime"] = loadStartAt }
        if let sessionId { payload["sessionId"] = sessionId }
        send(CastMessage.Namespace.media, payload, to: transportId)
        loadRequestId = requestId
        Log.debug("cast: LOAD \(video.id) as \(candidate.kind)")

        loadTimeout?.cancel()
        let attempt = candidateIndex
        loadTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard let self, !Task.isCancelled, self.loadingVideo != nil, self.candidateIndex == attempt else { return }
            self.tryNextCandidate(reason: "timeout")
        }
    }

    private func tryNextCandidate(reason: String) {
        guard loadingVideo != nil else { return }
        Log.debug("cast: stream \(candidates.indices.contains(candidateIndex) ? candidates[candidateIndex].kind : "?") failed (\(reason))")
        loadTimeout?.cancel()
        candidateIndex += 1
        if candidates.indices.contains(candidateIndex) {
            sendLoad()
        } else {
            loadRequestId = nil
            loadingVideo = nil
            playerState = "IDLE"
            statusText = "TV không phát được video này. Hãy thử AirPlay."
            pushStatus()
        }
    }

    /// This phone's address on the network it shares with the TV.
    private func localHost() -> String? {
        if case let .hostPort(host, _)? = connection?.currentPath?.localEndpoint, case let .ipv4(address) = host {
            return address.rawValue.map(String.init).joined(separator: ".")
        }
        return CastProxy.localIPv4()
    }

    // MARK: Playback control

    func play() {
        if playerState == "IDLE", let video = PlayerManager.shared.currentVideo, loadingVideo == nil {
            load(video, info: nil, startAt: estimatedTime < (mediaDuration ?? .infinity) - 1 ? estimatedTime : 0)
            return
        }
        mediaCommand(["type": "PLAY"])
    }

    func pause() {
        mediaCommand(["type": "PAUSE"])
    }

    func seek(to seconds: Double) {
        reportedTime = seconds
        reportedAt = Date()
        mediaCommand(["type": "SEEK", "currentTime": seconds])
    }

    func stopMedia() {
        mediaCommand(["type": "STOP"])
        loadingVideo = nil
    }

    func setVolume(_ level: Double) {
        volume = min(max(level, 0), 1)
        send(CastMessage.Namespace.receiver, ["type": "SET_VOLUME", "volume": ["level": volume]])
    }

    private func mediaCommand(_ payload: [String: Any]) {
        guard let transportId, let mediaSessionId else { return }
        var payload = payload
        payload["mediaSessionId"] = mediaSessionId
        send(CastMessage.Namespace.media, payload, to: transportId)
    }

    // MARK: Position

    private var estimatedTime: Double {
        guard playerState == "PLAYING" else { return reportedTime }
        let time = reportedTime + Date().timeIntervalSince(reportedAt)
        return min(time, mediaDuration ?? time)
    }

    private func startClock() {
        clockTask?.cancel()
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self, !Task.isCancelled else { return }
                if self.playerState == "PLAYING" { self.pushStatus() }
            }
        }
    }

    private func pushStatus() {
        guard state == .connected else { return }
        PlayerManager.shared.applyCastStatus(
            time: estimatedTime,
            duration: mediaDuration,
            playing: playerState == "PLAYING" || playerState == "BUFFERING",
            buffering: playerState == "BUFFERING"
        )
    }
}
