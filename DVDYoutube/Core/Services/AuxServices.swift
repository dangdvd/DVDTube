import CryptoKit
import Foundation

/// Channel uploads via the public RSS feed: cheap, stable and has exact publish dates.
enum RSSFeed {
    static func videos(channelId: String) async throws -> [VideoItem] {
        guard let url = URL(string: "https://www.youtube.com/feeds/videos.xml?channel_id=\(channelId)") else { return [] }
        let (data, response) = try await InnerTube.shared.session.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw InnerTubeError.invalidResponse }
        let delegate = RSSDelegate(channelId: channelId)
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.videos
    }

    private final class RSSDelegate: NSObject, XMLParserDelegate {
        let channelId: String
        var videos: [VideoItem] = []
        private var current: [String: String]?
        private var text = ""
        private var channelName: String?
        private let dateFormatter = ISO8601DateFormatter()

        init(channelId: String) {
            self.channelId = channelId
        }

        func parser(_ parser: XMLParser, didStartElement element: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String] = [:]) {
            text = ""
            switch element {
            case "entry": current = [:]
            case "media:thumbnail": current?["thumbnail"] = attributes["url"]
            case "media:statistics": current?["views"] = attributes["views"]
            case "link": if let href = attributes["href"] { current?["link"] = href }
            default: break
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            text += string
        }

        func parser(_ parser: XMLParser, didEndElement element: String, namespaceURI: String?, qualifiedName: String?) {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if current == nil {
                if element == "title", channelName == nil { channelName = value }
                return
            }
            switch element {
            case "yt:videoId": current?["id"] = value
            case "title": current?["title"] = value
            case "published": current?["published"] = value
            case "name": current?["author"] = value
            case "entry":
                if let entry = current, let id = entry["id"] {
                    let date = entry["published"].flatMap(dateFormatter.date(from:))
                    videos.append(VideoItem(
                        id: id,
                        title: entry["title"] ?? "",
                        channelName: entry["author"] ?? channelName,
                        channelId: channelId,
                        thumbnail: entry["thumbnail"].flatMap(URL.init(string:)),
                        viewCountText: entry["views"].flatMap { Int($0) }.map(NumberText.views),
                        publishedText: date.map(NumberText.relative),
                        publishedDate: date,
                        isShort: entry["link"]?.contains("/shorts/") ?? false
                    ))
                }
                current = nil
            default: break
            }
        }
    }
}

/// Crowd-sourced in-video sponsor segments (https://sponsor.ajay.app).
enum SponsorBlock {
    static let allCategories: [(id: String, title: String)] = [
        ("sponsor", "Nhà tài trợ"),
        ("selfpromo", "Tự quảng cáo"),
        ("interaction", "Nhắc đăng ký / tương tác"),
        ("intro", "Đoạn mở đầu"),
        ("outro", "Đoạn kết"),
        ("preview", "Xem trước / tóm tắt"),
        ("music_offtopic", "Đoạn không phải nhạc"),
        ("filler", "Nội dung lan man"),
    ]

    static func title(for category: String) -> String {
        allCategories.first { $0.id == category }?.title ?? category
    }

    /// Uses the hash-prefix API so the exact video id is never sent.
    static func segments(videoId: String, categories: [String]) async -> [SponsorSegment] {
        guard !categories.isEmpty else { return [] }
        let digest = SHA256.hash(data: Data(videoId.utf8)).map { String(format: "%02x", $0) }.joined()
        let prefix = String(digest.prefix(4))
        var components = URLComponents(string: "https://sponsor.ajay.app/api/skipSegments/\(prefix)")!
        let categoriesJSON = "[" + categories.map { "\"\($0)\"" }.joined(separator: ",") + "]"
        components.queryItems = [URLQueryItem(name: "categories", value: categoriesJSON)]
        guard let url = components.url,
              let result = try? await URLSession.shared.data(from: url),
              let json = try? JNode(data: result.0)
        else { return [] }
        let entry = json.array.first { $0["videoID"].string == videoId }
        return (entry?["segments"].array ?? []).compactMap { segment in
            guard segment["actionType"].string ?? "skip" == "skip",
                  let start = segment["segment"][0].double, let end = segment["segment"][1].double,
                  end > start else { return nil }
            return SponsorSegment(start: start, end: end, category: segment["category"].string ?? "sponsor")
        }.sorted { $0.start < $1.start }
    }
}

struct CaptionCue: Hashable {
    var start: Double
    var end: Double
    var text: String
}

enum CaptionLoader {
    /// Downloads a caption track in YouTube's `json3` format, optionally machine translated.
    static func load(track: CaptionTrack, translateTo language: String?) async throws -> [CaptionCue] {
        guard var components = URLComponents(url: track.baseURL, resolvingAgainstBaseURL: false) else { return [] }
        var items = (components.queryItems ?? []).filter { $0.name != "fmt" && $0.name != "tlang" }
        items.append(URLQueryItem(name: "fmt", value: "json3"))
        if let language, language != track.languageCode { items.append(URLQueryItem(name: "tlang", value: language)) }
        components.queryItems = items
        guard let url = components.url else { return [] }
        let (data, _) = try await InnerTube.shared.session.data(from: url)
        let json = try JNode(data: data)
        var cues: [CaptionCue] = []
        for event in json["events"].array {
            guard let start = event["tStartMs"].double else { continue }
            let text = event["segs"].array.compactMap { $0["utf8"].string }.joined()
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            let duration = event["dDurationMs"].double ?? 2000
            cues.append(CaptionCue(start: start / 1000, end: (start + duration) / 1000, text: text))
        }
        return cues
    }
}

/// Vietnamese-friendly number/date formatting for values we compute ourselves.
enum NumberText {
    static func compact(_ value: Int) -> String {
        let double = Double(value)
        func format(_ v: Double, _ suffix: String) -> String {
            let formatter = NumberFormatter()
            formatter.locale = Locale(identifier: APIConfig.hl)
            formatter.maximumFractionDigits = v < 10 ? 1 : 0
            return (formatter.string(from: NSNumber(value: v)) ?? String(v)) + suffix
        }
        let vi = APIConfig.hl == "vi"
        switch double {
        case 1_000_000_000...: return format(double / 1_000_000_000, vi ? " T" : "B")
        case 1_000_000...: return format(double / 1_000_000, vi ? " Tr" : "M")
        case 1_000...: return format(double / 1_000, vi ? " N" : "K")
        default: return String(value)
        }
    }

    static func views(_ value: Int) -> String {
        compact(value) + (APIConfig.hl == "vi" ? " lượt xem" : " views")
    }

    static func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: APIConfig.hl)
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
