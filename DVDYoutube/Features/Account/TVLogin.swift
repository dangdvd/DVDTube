import CryptoKit
import Foundation

/// "Đăng nhập bằng điện thoại" on DVDTube for Android TV: the TV shows a QR code with
/// `dvdtube://tv-login?h=<ip:port>&t=<token>&k=<key>&n=<TV name>`; scanning it with the Camera
/// opens this app, which (after the user confirms) sends the YouTube session to that TV over
/// the local network, encrypted with the key from the QR code (AES-256-GCM, token as AAD).
struct TVLoginRequest: Identifiable {
    let host: String
    let token: Data
    let key: Data
    let tvName: String

    var id: String { host + token.base64EncodedString() }

    init?(url: URL) {
        guard url.scheme == "dvdtube", url.host == "tv-login",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let host = value("h"), Self.isPrivateLANAddress(host),
              let token = value("t").flatMap(Base64URL.decode), token.count >= 16,
              let key = value("k").flatMap(Base64URL.decode), key.count == 32 else { return nil }
        self.host = host
        self.token = token
        self.key = key
        tvName = value("n").flatMap { $0.isEmpty ? nil : $0 } ?? "TV"
    }

    /// Only a private IPv4 address with a port (10/8, 172.16/12, 192.168/16, 169.254/16): a planted
    /// QR code must not be able to send the session to a server on the internet.
    static func isPrivateLANAddress(_ host: String) -> Bool {
        let parts = host.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, let port = Int(parts[1]), (1...65535).contains(port) else { return false }
        let octets = parts[0].split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        switch (octets[0], octets[1]) {
        case (10, _), (192, 168), (169, 254): return true
        case (172, 16...31): return true
        default: return false
        }
    }
}

enum TVLoginSender {
    enum Failure: LocalizedError {
        case unreachable
        case refused(String)

        var errorDescription: String? {
            switch self {
            case .unreachable:
                return "Không kết nối được tới TV. Điện thoại và TV phải cùng mạng Wi-Fi. Nếu iPhone hỏi quyền truy cập mạng cục bộ, hãy cho phép rồi quét lại mã."
            case .refused(let message):
                return message
            }
        }
    }

    /// Sends the session; returns the account name the TV reports.
    static func send(_ request: TVLoginRequest, cookies: [String: String]) async throws -> String {
        let plaintext = try JSONSerialization.data(withJSONObject: ["cookies": cookies])
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(plaintext, using: SymmetricKey(data: request.key), nonce: nonce,
                                      authenticating: request.token)
        let body: [String: String] = [
            "t": Base64URL.encode(request.token),
            "n": Base64URL.encode(Data(nonce)),
            "c": Base64URL.encode(sealed.ciphertext + sealed.tag),
        ]
        guard let url = URL(string: "http://\(request.host)/pair") else { throw Failure.unreachable }
        var http = URLRequest(url: url, timeoutInterval: 10)
        http.httpMethod = "POST"
        http.setValue("application/json", forHTTPHeaderField: "Content-Type")
        http.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: http)
        } catch {
            Log.debug("tv login: \(error.localizedDescription)")
            throw Failure.unreachable
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (response as? HTTPURLResponse)?.statusCode == 200, json?["ok"] as? Bool == true else {
            throw Failure.refused(json?["error"] as? String ?? "TV không nhận phiên đăng nhập. Hãy tạo mã mới trên TV rồi quét lại.")
        }
        return json?["name"] as? String ?? ""
    }
}

/// Base64 with the URL-safe alphabet and no padding (accepts padded input too).
enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 = base64.replacingOccurrences(of: "=", with: "")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}
