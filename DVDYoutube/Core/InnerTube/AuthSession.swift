import CryptoKit
import Foundation
import Security

/// The signed-in YouTube session: the account's youtube.com cookies, kept in the Keychain.
///
/// Requests to YouTube's own web API authenticate exactly like the website does: the
/// cookies plus a `SAPISIDHASH` header derived from them. The cookies are only ever sent
/// to `*.youtube.com`; the Google password is typed into Google's own page and never
/// passes through the app.
final class AuthSession: @unchecked Sendable {
    static let shared = AuthSession()

    static let origin = "https://www.youtube.com"

    /// Which of the signed-in Google accounts (`authUser`, 0-based like `/u/1/`) and,
    /// for a brand account, which channel (`pageId`) requests run as.
    struct Identity: Codable, Equatable {
        var authUser = 0
        var pageId: String?
    }

    private let lock = NSLock()
    private var cookies: [String: String] = [:]
    private var identity = Identity()
    private static let identityKey = "auth.identity"

    private init() {
        cookies = Keychain.load() ?? [:]
        if let data = UserDefaults.standard.data(forKey: Self.identityKey),
           let saved = try? JSONDecoder().decode(Identity.self, from: data) {
            identity = saved
        }
    }

    var currentIdentity: Identity {
        lock.lock()
        defer { lock.unlock() }
        return identity
    }

    func setIdentity(_ newIdentity: Identity) {
        lock.lock()
        identity = newIdentity
        lock.unlock()
        if let data = try? JSONEncoder().encode(newIdentity) {
            UserDefaults.standard.set(data, forKey: Self.identityKey)
        }
    }

    /// The session cookies, for "Đăng nhập trên TV" (sent only to the user's own TV, encrypted).
    var cookieSnapshot: [String: String] {
        lock.lock()
        defer { lock.unlock() }
        return cookies
    }

    var isAuthenticated: Bool {
        lock.lock()
        defer { lock.unlock() }
        return Self.hasAuthCookies(cookies)
    }

    static func hasAuthCookies(_ cookies: [String: String]) -> Bool {
        cookies["LOGIN_INFO"] != nil
            && (cookies["SAPISID"] ?? cookies["__Secure-3PAPISID"] ?? cookies["__Secure-1PAPISID"]) != nil
    }

    func replace(with newCookies: [String: String]) {
        lock.lock()
        cookies = newCookies
        lock.unlock()
        Keychain.save(newCookies)
    }

    func clear() {
        lock.lock()
        cookies = [:]
        identity = Identity()
        lock.unlock()
        Keychain.delete()
        UserDefaults.standard.removeObject(forKey: Self.identityKey)
    }

    var cookieList: [String: String] {
        lock.lock()
        defer { lock.unlock() }
        return cookies
    }

    /// YouTube rotates some cookies (e.g. `__Secure-3PSIDTS`); keep the newest values.
    func absorb(response: HTTPURLResponse, url: URL) {
        guard let fields = response.allHeaderFields as? [String: String],
              fields.keys.contains(where: { $0.caseInsensitiveCompare("Set-Cookie") == .orderedSame }) else { return }
        let updated = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
            .filter { $0.domain.hasSuffix("youtube.com") }
        guard !updated.isEmpty else { return }
        lock.lock()
        var changed = false
        for cookie in updated where cookies[cookie.name] != nil && cookies[cookie.name] != cookie.value {
            cookies[cookie.name] = cookie.value
            changed = true
        }
        let snapshot = cookies
        lock.unlock()
        if changed { Keychain.save(snapshot) }
    }

    /// Headers that make an InnerTube request run as the signed-in account (nil if signed out).
    /// `origin` must match the site the request claims to come from (e.g. YouTube Studio).
    func headers(for url: URL, origin: String = AuthSession.origin) -> [String: String]? {
        guard let host = url.host?.lowercased(), host == "youtube.com" || host.hasSuffix(".youtube.com") else { return nil }
        lock.lock()
        let cookies = self.cookies
        let identity = self.identity
        lock.unlock()
        guard Self.hasAuthCookies(cookies) else { return nil }

        var headers: [String: String] = [
            "Cookie": cookies.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: "; "),
            "X-Origin": origin,
            "X-Goog-AuthUser": String(identity.authUser),
            "X-Youtube-Bootstrap-Logged-In": "true",
        ]
        if let pageId = identity.pageId { headers["X-Goog-PageId"] = pageId }
        let timestamp = String(Int(Date().timeIntervalSince1970))
        let schemes: [(String, String?)] = [
            ("SAPISIDHASH", cookies["SAPISID"] ?? cookies["__Secure-3PAPISID"]),
            ("SAPISID1PHASH", cookies["__Secure-1PAPISID"]),
            ("SAPISID3PHASH", cookies["__Secure-3PAPISID"]),
        ]
        let authorization = schemes.compactMap { scheme, sid -> String? in
            guard let sid else { return nil }
            let digest = Insecure.SHA1.hash(data: Data("\(timestamp) \(sid) \(origin)".utf8))
            let hex = digest.map { String(format: "%02x", $0) }.joined()
            return "\(scheme) \(timestamp)_\(hex)"
        }.joined(separator: " ")
        if !authorization.isEmpty { headers["Authorization"] = authorization }
        return headers
    }

    // MARK: - Importing cookies

    /// Keeps the youtube.com cookies from a browser session.
    static func youtubeCookies(from cookies: [HTTPCookie]) -> [String: String] {
        var result: [String: String] = [:]
        for cookie in cookies where cookie.domain.lowercased().hasSuffix("youtube.com") {
            result[cookie.name] = cookie.value
        }
        return result
    }

    /// Accepts a Netscape `cookies.txt` export or a raw `Cookie:` header ("a=b; c=d").
    static func parseCookieText(_ text: String) -> [String: String] {
        var result: [String: String] = [:]
        let lines = text.components(separatedBy: .newlines)
        let looksLikeNetscape = lines.contains { $0.components(separatedBy: "\t").count >= 7 }
        if looksLikeNetscape {
            for raw in lines {
                var line = raw.trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("#HttpOnly_") { line.removeFirst("#HttpOnly_".count) }
                guard !line.isEmpty, !line.hasPrefix("#") else { continue }
                let columns = line.components(separatedBy: "\t")
                guard columns.count >= 7, columns[0].lowercased().hasSuffix("youtube.com") else { continue }
                result[columns[5]] = columns[6...].joined(separator: "\t")
            }
        } else {
            var header = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if header.lowercased().hasPrefix("cookie:") { header = String(header.dropFirst(7)) }
            for pair in header.components(separatedBy: ";") {
                let parts = pair.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                if parts.count == 2, !parts[0].isEmpty { result[parts[0]] = parts[1] }
            }
        }
        return result
    }
}

/// Minimal Keychain wrapper for the cookie dictionary (this device only, never synced).
private enum Keychain {
    private static let service = "com.dangdvd.dvdtube.youtube-session"
    private static let account = "cookies"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> [String: String]? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode([String: String].self, from: data)
    }

    static func save(_ cookies: [String: String]) {
        guard let data = try? JSONEncoder().encode(cookies) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var item = query
            item.merge(attributes) { _, new in new }
            SecItemAdd(item as CFDictionary, nil)
        }
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
