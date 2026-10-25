import Foundation
import Network
import UIKit

/// JSON shapes shared with DVDTube for Android, Android TV and the desktop app (cast API,
/// library sync). Field names follow the Android `VideoItem` / `ChannelItem`; dates are
/// epoch milliseconds. Readers ignore unknown keys and only require `id`.
enum CrossJSON {
    static let platform = "ios"

    // MARK: Writing

    static func video(_ video: VideoItem) -> [String: Any] {
        var dict: [String: Any] = [
            "id": video.id,
            "title": video.title,
            "isLive": video.isLive,
            "isShort": video.isShort,
        ]
        if let value = video.channelName { dict["channelName"] = value }
        if let value = video.channelId { dict["channelId"] = value }
        if let value = video.channelAvatar { dict["channelAvatar"] = value.absoluteString }
        if let value = video.thumbnail { dict["thumbnail"] = value.absoluteString }
        if let value = video.durationText { dict["durationText"] = value }
        if let value = video.durationSeconds { dict["durationSeconds"] = value }
        if let value = video.viewCountText { dict["viewCountText"] = value }
        if let value = video.publishedText { dict["publishedText"] = value }
        if let value = video.publishedDate { dict["publishedDate"] = milliseconds(value) }
        return dict
    }

    static func channel(_ channel: ChannelItem) -> [String: Any] {
        var dict: [String: Any] = ["id": channel.id, "name": channel.name]
        if let value = channel.avatar { dict["avatar"] = value.absoluteString }
        if let value = channel.handle { dict["handle"] = value }
        if let value = channel.subscriberText { dict["subscriberText"] = value }
        if let value = channel.videoCountText { dict["videoCountText"] = value }
        return dict
    }

    static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    static func date(milliseconds node: JNode) -> Date? {
        guard let value = node.double, value > 0 else { return nil }
        return Date(timeIntervalSince1970: value / 1000)
    }

    /// `nil` → JSON `null` (JSONSerialization needs `NSNull`).
    static func orNull(_ value: Any?) -> Any {
        value ?? NSNull()
    }

    // MARK: Reading

    static func video(from node: JNode) -> VideoItem? {
        guard let id = node["id"].string?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else { return nil }
        return VideoItem(
            id: id,
            title: node["title"].string ?? "",
            channelName: nonEmpty(node["channelName"].string),
            channelId: nonEmpty(node["channelId"].string),
            channelAvatar: url(node["channelAvatar"]),
            thumbnail: url(node["thumbnail"]),
            durationText: nonEmpty(node["durationText"].string),
            durationSeconds: node["durationSeconds"].int,
            viewCountText: nonEmpty(node["viewCountText"].string),
            publishedText: nonEmpty(node["publishedText"].string),
            publishedDate: date(milliseconds: node["publishedDate"]),
            isLive: node["isLive"].bool ?? false,
            isShort: node["isShort"].bool ?? false
        )
    }

    static func channel(from node: JNode) -> ChannelItem? {
        guard let id = node["id"].string?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty else { return nil }
        return ChannelItem(
            id: id,
            name: node["name"].string ?? "",
            avatar: url(node["avatar"]),
            handle: nonEmpty(node["handle"].string),
            subscriberText: nonEmpty(node["subscriberText"].string),
            videoCountText: nonEmpty(node["videoCountText"].string)
        )
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private static func url(_ node: JNode) -> URL? {
        guard let string = node.string, !string.isEmpty else { return nil }
        return URL.youtubeImage(string)
    }

    // MARK: Device

    /// The name other DVDTube devices show for this iPhone.
    @MainActor
    static var deviceName: String {
        let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "iPhone" : name
    }
}

/// Private / loopback addresses only: the LAN APIs never talk to the internet.
enum LANAddress {
    /// 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, ::1, fc00::/7, fe80::/10.
    static func isPrivate(_ host: NWEndpoint.Host) -> Bool {
        switch host {
        case .ipv4(let address):
            return isPrivateIPv4([UInt8](address.rawValue))
        case .ipv6(let address):
            let bytes = [UInt8](address.rawValue)
            guard bytes.count == 16 else { return false }
            // IPv4-mapped (::ffff:a.b.c.d).
            if bytes[0..<10].allSatisfy({ $0 == 0 }), bytes[10] == 0xFF, bytes[11] == 0xFF {
                return isPrivateIPv4(Array(bytes[12..<16]))
            }
            if bytes[0..<15].allSatisfy({ $0 == 0 }), bytes[15] == 1 { return true }
            if bytes[0] & 0xFE == 0xFC { return true }
            if bytes[0] == 0xFE, bytes[1] & 0xC0 == 0x80 { return true }
            return false
        case .name(let name, _):
            return name == "localhost"
        @unknown default:
            return false
        }
    }

    static func isPrivateIPv4(_ octets: [UInt8]) -> Bool {
        guard octets.count == 4 else { return false }
        switch (octets[0], octets[1]) {
        case (10, _), (127, _), (192, 168), (169, 254): return true
        case (172, 16...31): return true
        default: return false
        }
    }

    /// "a.b.c.d" of an IPv4 host, the name of a named one.
    static func string(_ host: NWEndpoint.Host) -> String? {
        switch host {
        case .ipv4(let address):
            return [UInt8](address.rawValue).map(String.init).joined(separator: ".")
        case .name(let name, _):
            return name
        default:
            return nil
        }
    }
}

/// Resumes a continuation once even if the callback fires repeatedly.
final class ContinuationOnce<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?

    init(_ continuation: CheckedContinuation<T, Error>) {
        self.continuation = continuation
    }

    func resume(_ result: Result<T, Error>) {
        lock.lock()
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }
}

/// A tiny HTTP/1.1 request reader for the LAN servers (cast receiver API is on TVs/PCs; the
/// iPhone serves the library sync). Reads the head, then exactly `Content-Length` bytes.
struct LANHTTPRequest {
    var method: String
    var path: String
    var headers: [String: String]
    var body: Data

    enum ReadError: Error {
        case malformed, lengthRequired, tooLarge, closed
    }

    static func read(from connection: NWConnection, maxBody: Int,
                     completion: @escaping (Result<LANHTTPRequest, ReadError>) -> Void) {
        readHead(connection, buffer: Data(), maxBody: maxBody, completion: completion)
    }

    private static func readHead(_ connection: NWConnection, buffer: Data, maxBody: Int,
                                 completion: @escaping (Result<LANHTTPRequest, ReadError>) -> Void) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, isComplete, error in
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
                let lines = head.components(separatedBy: "\r\n")
                let parts = (lines.first ?? "").split(separator: " ")
                guard parts.count >= 2 else { return completion(.failure(.malformed)) }
                var headers: [String: String] = [:]
                for line in lines.dropFirst() {
                    guard let colon = line.firstIndex(of: ":") else { continue }
                    headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                }
                let method = String(parts[0]).uppercased()
                let path = String(parts[1])
                var body = Data(buffer[end.upperBound...])
                guard method != "GET", method != "HEAD", method != "OPTIONS" else {
                    return completion(.success(LANHTTPRequest(method: method, path: path, headers: headers, body: Data())))
                }
                guard let lengthText = headers["content-length"], let length = Int(lengthText), length >= 0 else {
                    return completion(.failure(.lengthRequired))
                }
                guard length <= maxBody else { return completion(.failure(.tooLarge)) }
                if body.count >= length {
                    body = body.prefix(length)
                    return completion(.success(LANHTTPRequest(method: method, path: path, headers: headers, body: body)))
                }
                if headers["expect"]?.lowercased().contains("100-continue") == true {
                    connection.send(content: Data("HTTP/1.1 100 Continue\r\n\r\n".utf8), completion: .contentProcessed { _ in })
                }
                readBody(connection, body: body, length: length) { result in
                    switch result {
                    case .success(let full):
                        completion(.success(LANHTTPRequest(method: method, path: path, headers: headers, body: full)))
                    case .failure(let failure):
                        completion(.failure(failure))
                    }
                }
            } else if isComplete || error != nil {
                completion(.failure(.closed))
            } else if buffer.count > 32_768 {
                completion(.failure(.malformed))
            } else {
                readHead(connection, buffer: buffer, maxBody: maxBody, completion: completion)
            }
        }
    }

    private static func readBody(_ connection: NWConnection, body: Data, length: Int,
                                 completion: @escaping (Result<Data, ReadError>) -> Void) {
        let missing = length - body.count
        connection.receive(minimumIncompleteLength: 1, maximumLength: min(missing, 1 << 20)) { data, _, isComplete, error in
            var body = body
            if let data { body.append(data) }
            if body.count >= length {
                completion(.success(body.prefix(length)))
            } else if isComplete || error != nil {
                completion(.failure(.closed))
            } else {
                readBody(connection, body: body, length: length, completion: completion)
            }
        }
    }

    /// Sends a JSON response and closes the connection.
    static func respond(_ connection: NWConnection, status: Int, json: [String: Any]) {
        let body = (try? JSONSerialization.data(withJSONObject: json)) ?? Data("{}".utf8)
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        case 405: reason = "Method Not Allowed"
        case 410: reason = "Gone"
        case 411: reason = "Length Required"
        case 413: reason = "Payload Too Large"
        default: reason = "Error"
        }
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: application/json; charset=utf-8\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        var data = Data(head.utf8)
        data.append(body)
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
