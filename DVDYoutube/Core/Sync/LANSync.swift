import CryptoKit
import Foundation
import Network
import Observation
import Security

/// Encryption of the LAN sync, the same as the TV sign-in: AES-256-GCM with a 12-byte
/// nonce, the raw token as additional data, ciphertext‖tag, base64url without padding.
enum SyncCrypto {
    static func seal(_ plaintext: Data, key: Data, token: Data) throws -> (nonce: String, ciphertext: String) {
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce, authenticating: token)
        return (Base64URL.encode(Data(nonce)), Base64URL.encode(sealed.ciphertext + sealed.tag))
    }

    static func open(nonce: String, ciphertext: String, key: Data, token: Data) throws -> Data {
        guard let nonceData = Base64URL.decode(nonce), nonceData.count == 12,
              let combined = Base64URL.decode(ciphertext), combined.count >= 16 else {
            throw CryptoKitError.incorrectParameterSize
        }
        let box = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: nonceData),
            ciphertext: combined.prefix(combined.count - 16),
            tag: combined.suffix(16)
        )
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: token)
    }

    static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        if SecRandomCopyBytes(kSecRandomDefault, count, &bytes) != errSecSuccess {
            for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
        }
        return Data(bytes)
    }
}

/// A scanned `dvdtube://sync?h=<ip:port>&t=<token>&k=<key>&n=<name>` code.
struct SyncRequest: Identifiable {
    let host: String
    let token: Data
    let key: Data
    let name: String

    var id: String { host + token.base64EncodedString() }

    init?(url: URL) {
        guard url.scheme == "dvdtube", url.host == "sync",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let host = value("h"), TVLoginRequest.isPrivateLANAddress(host),
              let token = value("t").flatMap(Base64URL.decode), token.count >= 16,
              let key = value("k").flatMap(Base64URL.decode), key.count == 32 else { return nil }
        self.host = host
        self.token = token
        self.key = key
        name = value("n").flatMap { $0.isEmpty ? nil : $0 } ?? "thiết bị kia"
    }
}

/// The phone sends its library to the device showing the QR code and merges the reply.
enum SyncSender {
    enum Failure: LocalizedError {
        case unreachable
        case refused(String)

        var errorDescription: String? {
            switch self {
            case .unreachable:
                return "Không kết nối được tới thiết bị kia. Hai thiết bị phải cùng mạng Wi-Fi. Nếu iPhone hỏi quyền truy cập mạng cục bộ, hãy cho phép rồi quét lại mã."
            case .refused(let message):
                return message
            }
        }
    }

    @MainActor
    static func send(_ request: SyncRequest) async throws -> LibrarySync.Summary {
        let plaintext = LibrarySync.export(LibraryStore.shared.snapshot, device: CrossJSON.deviceName)
        let sealed = try SyncCrypto.seal(plaintext, key: request.key, token: request.token)
        let body: [String: String] = ["t": Base64URL.encode(request.token), "n": sealed.nonce, "c": sealed.ciphertext]
        guard let url = URL(string: "http://\(request.host)/sync") else { throw Failure.unreachable }
        var http = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        http.httpMethod = "POST"
        http.httpShouldHandleCookies = false
        http.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        http.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: http)
        } catch {
            Log.debug("library sync: \(error.localizedDescription)")
            throw Failure.unreachable
        }
        let json = (try? JNode(data: data)) ?? .empty
        guard (response as? HTTPURLResponse)?.statusCode == 200, json["ok"].bool == true,
              let nonce = json["n"].string, let ciphertext = json["c"].string else {
            throw Failure.refused(json["error"].string ?? "Thiết bị kia không nhận dữ liệu. Hãy tạo mã mới rồi quét lại.")
        }
        let merged = try SyncCrypto.open(nonce: nonce, ciphertext: ciphertext, key: request.key, token: request.token)
        let library = try LibrarySync.parse(merged).library
        return LibrarySync.apply(library)
    }
}

/// The phone as the RECEIVING side: shows a QR code and waits (10 minutes, one use) for
/// another device to send its library over the local network.
@MainActor
@Observable
final class SyncReceiver {
    static let shared = SyncReceiver()

    enum Phase: Equatable {
        case idle
        case starting
        case waiting(url: String)
        case done(String)
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var expiresAt: Date?

    static let preferredPort: UInt16 = 8768
    static let maxBody = 16 << 20

    @ObservationIgnored private var listener: NWListener?
    @ObservationIgnored private var token = Data()
    @ObservationIgnored private var key = Data()
    @ObservationIgnored private var used = false
    @ObservationIgnored private var expiryTask: Task<Void, Never>?
    @ObservationIgnored private let queue = DispatchQueue(label: "com.dangdvd.dvdtube.sync")

    private init() {}

    func start() {
        stop()
        guard let ip = CastProxy.localIPv4(), TVLoginRequest.isPrivateLANAddress(ip + ":1") else {
            phase = .failed("Không tìm thấy địa chỉ Wi-Fi của iPhone. Hãy kết nối Wi-Fi rồi thử lại.")
            return
        }
        token = SyncCrypto.randomBytes(16)
        key = SyncCrypto.randomBytes(32)
        used = false
        phase = .starting
        listen(on: Self.preferredPort, ip: ip)
    }

    private func listen(on preferred: UInt16?, ip: String) {
        let listener: NWListener
        do {
            if let preferred, let port = NWEndpoint.Port(rawValue: preferred) {
                listener = try NWListener(using: .tcp, on: port)
            } else {
                listener = try NWListener(using: .tcp)
            }
        } catch {
            if preferred != nil { return listen(on: nil, ip: ip) }
            phase = .failed("Không mở được cổng mạng để đồng bộ.")
            return
        }
        listener.newConnectionHandler = { [weak self] connection in
            Task { @MainActor in self?.accept(connection) }
        }
        listener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, self.listener === listener else { return }
                switch state {
                case .ready:
                    guard let port = listener.port?.rawValue else { return }
                    self.ready(ip: ip, port: port)
                case .failed(let error):
                    Log.debug("library sync: listener failed: \(error)")
                    listener.cancel()
                    self.listener = nil
                    if preferred != nil {
                        // Port 8768 is busy: any free port (the QR code carries it).
                        self.listen(on: nil, ip: ip)
                    } else {
                        self.phase = .failed("Không mở được cổng mạng để đồng bộ.")
                    }
                default:
                    break
                }
            }
        }
        self.listener = listener
        listener.start(queue: queue)
    }

    private func ready(ip: String, port: UInt16) {
        let name = CrossJSON.deviceName
        let url = "dvdtube://sync?h=\(ip):\(port)&t=\(Base64URL.encode(token))&k=\(Base64URL.encode(key))&n=\(Self.encode(name))"
        let expiry = Date().addingTimeInterval(600)
        expiresAt = expiry
        phase = .waiting(url: url)
        Log.debug("library sync: waiting on port \(port)")
        expiryTask?.cancel()
        expiryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 600_000_000_000)
            guard let self, !Task.isCancelled, case .waiting = self.phase else { return }
            self.stop()
            self.phase = .failed("Mã đã hết hạn. Tạo mã mới để đồng bộ.")
        }
    }

    func stop() {
        expiryTask?.cancel()
        listener?.cancel()
        listener = nil
        expiresAt = nil
        if case .waiting = phase { phase = .idle }
        if phase == .starting { phase = .idle }
    }

    func reset() {
        stop()
        phase = .idle
    }

    private static func encode(_ text: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? "DVDTube"
    }

    // MARK: Requests

    private func accept(_ connection: NWConnection) {
        guard case let .hostPort(host, _) = connection.endpoint, LANAddress.isPrivate(host) else {
            connection.start(queue: queue)
            LANHTTPRequest.respond(connection, status: 403, json: ["ok": false, "error": "Chỉ nhận kết nối trong mạng nội bộ."])
            return
        }
        connection.start(queue: queue)
        LANHTTPRequest.read(from: connection, maxBody: Self.maxBody) { [weak self] result in
            Task { @MainActor in self?.handle(result, on: connection) }
        }
    }

    private func handle(_ result: Result<LANHTTPRequest, LANHTTPRequest.ReadError>, on connection: NWConnection) {
        let request: LANHTTPRequest
        switch result {
        case .success(let value):
            request = value
        case .failure(.lengthRequired):
            return LANHTTPRequest.respond(connection, status: 411, json: ["ok": false, "error": "Thiếu Content-Length."])
        case .failure(.tooLarge):
            return LANHTTPRequest.respond(connection, status: 413, json: ["ok": false, "error": "Dữ liệu quá lớn."])
        case .failure:
            return LANHTTPRequest.respond(connection, status: 400, json: ["ok": false, "error": "Yêu cầu không hợp lệ."])
        }
        let path = request.path.split(separator: "?").first.map(String.init) ?? request.path
        guard path == "/sync" else {
            return LANHTTPRequest.respond(connection, status: 404, json: ["ok": false, "error": "Không tìm thấy."])
        }
        guard request.method == "POST" else {
            return LANHTTPRequest.respond(connection, status: 405, json: ["ok": false, "error": "Chỉ hỗ trợ POST."])
        }
        guard !used, case .waiting = phase else {
            return LANHTTPRequest.respond(connection, status: 410, json: ["ok": false, "error": "Mã đồng bộ đã được dùng hoặc đã hết hạn. Hãy tạo mã mới."])
        }
        guard let body = try? JNode(data: request.body),
              let sentToken = body["t"].string.flatMap(Base64URL.decode), sentToken == token,
              let nonce = body["n"].string, let ciphertext = body["c"].string else {
            return LANHTTPRequest.respond(connection, status: 403, json: ["ok": false, "error": "Mã đồng bộ không đúng."])
        }
        do {
            let plaintext = try SyncCrypto.open(nonce: nonce, ciphertext: ciphertext, key: key, token: token)
            let parsed = try LibrarySync.parse(plaintext)
            used = true
            let summary = LibrarySync.apply(parsed.library)
            let merged = LibrarySync.export(LibraryStore.shared.snapshot, device: CrossJSON.deviceName)
            let sealed = try SyncCrypto.seal(merged, key: key, token: token)
            LANHTTPRequest.respond(connection, status: 200, json: ["ok": true, "n": sealed.nonce, "c": sealed.ciphertext])
            let from = parsed.device.map { " với \($0)" } ?? ""
            phase = .done("Đã đồng bộ\(from). \(summary.text)")
            PlayerManager.shared.showToast(summary.text)
            // Single use: close the port once the reply has gone out.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                self?.listener?.cancel()
                self?.listener = nil
                self?.expiryTask?.cancel()
            }
        } catch {
            Log.debug("library sync: refused a request: \(error.localizedDescription)")
            LANHTTPRequest.respond(connection, status: 400, json: ["ok": false, "error": "Không giải mã được dữ liệu đồng bộ."])
        }
    }
}
