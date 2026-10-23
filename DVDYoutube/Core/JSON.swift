import Foundation

/// A thin, read-only wrapper around the `Any` tree produced by `JSONSerialization`.
/// InnerTube responses are huge and their shape changes often, so instead of strict
/// `Codable` models we navigate them defensively: every lookup returns a node and a
/// missing key simply yields an empty node.
struct JNode {
    let raw: Any?

    init(_ raw: Any?) {
        self.raw = raw
    }

    init(data: Data) throws {
        raw = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    static let empty = JNode(nil)

    subscript(key: String) -> JNode {
        JNode((raw as? [String: Any])?[key])
    }

    subscript(index: Int) -> JNode {
        guard let array = raw as? [Any], array.indices.contains(index) else { return .empty }
        return JNode(array[index])
    }

    /// Follows a path of keys, e.g. `node.at("a", "b", "c")`.
    func at(_ keys: String...) -> JNode {
        var node = self
        for key in keys {
            node = node[key]
            if !node.exists { return .empty }
        }
        return node
    }

    var exists: Bool { raw != nil && !(raw is NSNull) }

    var dict: [String: Any]? { raw as? [String: Any] }

    var keys: [String] { dict.map { Array($0.keys) } ?? [] }

    var array: [JNode] { (raw as? [Any])?.map(JNode.init) ?? [] }

    var first: JNode { self[0] }

    var last: JNode {
        guard let array = raw as? [Any], let item = array.last else { return .empty }
        return JNode(item)
    }

    var string: String? {
        switch raw {
        case let value as String: return value
        case let value as NSNumber: return value.stringValue
        default: return nil
        }
    }

    var int: Int? {
        switch raw {
        case let value as NSNumber: return value.intValue
        case let value as String: return Int(value)
        default: return nil
        }
    }

    var double: Double? {
        switch raw {
        case let value as NSNumber: return value.doubleValue
        case let value as String: return Double(value)
        default: return nil
        }
    }

    var bool: Bool? {
        switch raw {
        case let value as NSNumber: return value.boolValue
        case let value as String: return value == "true"
        default: return nil
        }
    }

    /// Extracts human readable text from the many text shapes InnerTube uses:
    /// plain strings, `{simpleText}`, `{runs: [{text}]}` and `{content}`.
    var text: String? {
        if let value = raw as? String { return value }
        if let simple = self["simpleText"].string { return simple }
        if let runs = raw.flatMap({ ($0 as? [String: Any])?["runs"] as? [Any] }) {
            let joined = runs.compactMap { ($0 as? [String: Any])?["text"] as? String }.joined()
            return joined.isEmpty ? nil : joined
        }
        if let content = self["content"].string { return content }
        if let content = self["text"].string { return content }
        if self["text"].exists { return self["text"].text }
        return nil
    }

    /// Depth-first search for every value stored under `key`.
    func findAll(_ key: String, limit: Int = .max) -> [JNode] {
        var results: [JNode] = []
        JNode.collect(raw, key: key, into: &results, limit: limit)
        return results
    }

    func findFirst(_ key: String) -> JNode {
        findAll(key, limit: 1).first ?? .empty
    }

    private static func collect(_ value: Any?, key: String, into results: inout [JNode], limit: Int) {
        if results.count >= limit { return }
        if let dict = value as? [String: Any] {
            for (k, v) in dict {
                if k == key {
                    results.append(JNode(v))
                    if results.count >= limit { return }
                } else {
                    collect(v, key: key, into: &results, limit: limit)
                }
            }
        } else if let array = value as? [Any] {
            for item in array {
                collect(item, key: key, into: &results, limit: limit)
                if results.count >= limit { return }
            }
        }
    }
}

extension JNode {
    /// Picks the URL of the widest image from `{thumbnails: [...]}` or `{sources: [...]}` lists.
    var bestImageURL: URL? {
        var candidates = self["thumbnails"].array
        if candidates.isEmpty { candidates = self["sources"].array }
        if candidates.isEmpty { candidates = self.array }
        let best = candidates.max { ($0["width"].int ?? 0) < ($1["width"].int ?? 0) }
        return best?["url"].string.flatMap(URL.youtubeImage)
    }
}

extension URL {
    /// Image URLs from InnerTube are sometimes protocol-relative (`//yt3.ggpht.com/...`).
    static func youtubeImage(_ string: String) -> URL? {
        if string.hasPrefix("//") { return URL(string: "https:" + string) }
        return URL(string: string)
    }
}
