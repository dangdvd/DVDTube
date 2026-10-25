import Foundation

struct VideoItem: Identifiable, Hashable, Codable {
    var id: String
    var title: String
    var channelName: String?
    var channelId: String?
    var channelAvatar: URL?
    var thumbnail: URL?
    var durationText: String?
    var durationSeconds: Int?
    var viewCountText: String?
    var publishedText: String?
    var publishedDate: Date?
    var isLive: Bool = false
    var isShort: Bool = false

    /// A good-looking 16:9 thumbnail even when the API only returned a 4:3 one.
    var displayThumbnail: URL? {
        thumbnail ?? URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg")
    }

    var shortsThumbnail: URL? {
        if isShort, let thumbnail { return thumbnail }
        return URL(string: "https://i.ytimg.com/vi/\(id)/oardefault.jpg") ?? thumbnail
    }

    var shareURL: URL {
        URL(string: isShort ? "https://youtube.com/shorts/\(id)" : "https://youtu.be/\(id)")!
    }

    /// "Channel • 1,2 Tr lượt xem • 2 ngày trước"
    var metadataLine: String {
        [channelName, viewCountText, publishedText]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }
}

struct ChannelItem: Identifiable, Hashable, Codable {
    var id: String
    var name: String
    var avatar: URL?
    var handle: String?
    var subscriberText: String?
    var videoCountText: String?
}

struct PlaylistItem: Identifiable, Hashable, Codable {
    var id: String
    var title: String
    var thumbnail: URL?
    var channelName: String?
    var videoCountText: String?
}

enum FeedItem: Identifiable, Hashable {
    case video(VideoItem)
    case channel(ChannelItem)
    case playlist(PlaylistItem)
    case shorts([VideoItem])

    var id: String {
        switch self {
        case .video(let video): return "v-" + video.id
        case .channel(let channel): return "c-" + channel.id
        case .playlist(let playlist): return "p-" + playlist.id
        case .shorts(let items): return "s-" + (items.first?.id ?? "empty")
        }
    }

    var video: VideoItem? {
        if case .video(let video) = self { return video }
        return nil
    }
}

/// Which endpoint a continuation token belongs to.
enum ContinuationKind {
    case browse, search, next
}

struct FeedPage {
    var items: [FeedItem]
    var continuation: String?
    var kind: ContinuationKind = .browse
    /// YouTube's own explanation when a page has no items (e.g. "Your watch history is off").
    var message: String?

    static let empty = FeedPage(items: [], continuation: nil)

    var videos: [VideoItem] {
        items.flatMap { item -> [VideoItem] in
            switch item {
            case .video(let video): return [video]
            case .shorts(let shorts): return shorts
            default: return []
            }
        }
    }
}

struct Chapter: Identifiable, Hashable {
    var id: Int { startSeconds }
    var title: String
    var startSeconds: Int
    var thumbnail: URL?
}

/// Everything shown below the player on the watch page (from the `next` endpoint).
struct WatchInfo {
    var videoId: String
    var title: String
    var viewCountText: String?
    var shortViewCountText: String?
    var dateText: String?
    var relativeDateText: String?
    var likeCountText: String?
    var description: String?
    var channel: ChannelItem?
    var related: FeedPage
    var commentsToken: String?
    var commentCountText: String?
    var chapters: [Chapter]
    /// Signed-in state from YouTube: "LIKE", "DISLIKE" or "INDIFFERENT".
    var likeStatus: String?
    var isSubscribed: Bool?
    /// Live streams and their replays.
    var liveChat: LiveChatInfo?
    /// "Most replayed": how much each part of the video gets rewatched.
    var heatMarkers: [HeatMarker] = []
}

/// One slice of YouTube's "Most replayed" graph.
struct HeatMarker: Hashable {
    var start: Double
    var duration: Double
    /// 0…1, relative to the most replayed part.
    var intensity: Double
}

/// An account playlist in the "Save to…" sheet.
struct AccountPlaylistOption: Identifiable, Hashable {
    var id: String
    var title: String
    var containsVideo: Bool
}

/// An entry of the account's YouTube notifications (bell).
struct AccountNotification: Identifiable, Hashable {
    var id: String
    var message: String
    var timeText: String?
    var avatar: URL?
    var thumbnail: URL?
    var videoId: String?
    var isRead: Bool
}

struct AccountProfile: Codable, Hashable {
    var name: String
    var handle: String?
    var email: String?
    var avatar: URL?
    /// The account's own channel (UC…), when it has one.
    var channelId: String?
}

/// One entry of the account switcher: a Google account or one of its brand channels.
struct AccountIdentity: Identifiable, Hashable {
    var authUser: Int
    var pageId: String?
    var name: String
    var byline: String?
    /// The Google account (email) this identity belongs to.
    var email: String?
    var avatar: URL?
    var isSelected: Bool
    var hasChannel: Bool

    var id: String { "\(authUser)|\(pageId ?? "")" }
    var isBrandAccount: Bool { pageId != nil }
}

struct Comment: Identifiable, Hashable {
    var id: String
    var authorName: String
    var authorAvatar: URL?
    var authorChannelId: String?
    var text: String
    var publishedText: String?
    var likeCountText: String?
    var replyCountText: String?
    var repliesToken: String?
    var isPinned: Bool
    var isCreator: Bool
    var isHearted: Bool
    /// Present when signed in: lets the account reply to this comment.
    var replyParams: String?
    /// Count shown once the account has liked the comment.
    var likeCountLikedText: String?
    /// "LIKED", "DISLIKED" or nil, as YouTube reports it for the signed-in account.
    var likeState: String?
    /// `perform_comment_action` tokens (signed in only).
    var likeToken: String?
    var unlikeToken: String?
    var dislikeToken: String?
    var undislikeToken: String?
}

struct CommentsPage {
    var comments: [Comment]
    var continuation: String?
    var countText: String?
    /// Present when signed in: lets the account post a new comment.
    var createParams: String?
}

enum ChannelTab: String, CaseIterable, Identifiable {
    case videos, shorts, streams, playlists, posts, about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .videos: return "Video"
        case .shorts: return "Shorts"
        case .streams: return "Trực tiếp"
        case .playlists: return "Danh sách phát"
        case .posts: return "Bài đăng"
        case .about: return "Giới thiệu"
        }
    }

    /// The end of the tab's URL on youtube.com (the posts tab used to be "community").
    var urlSuffixes: [String] {
        switch self {
        case .posts: return ["/posts", "/community"]
        default: return ["/" + rawValue]
        }
    }

    /// Fallback tab parameters, used when the channel response does not list the tab.
    var defaultParams: String {
        switch self {
        case .videos: return "EgZ2aWRlb3PyBgQKAjoA"
        case .shorts: return "EgZzaG9ydHPyBgUKA5oBAA%3D%3D"
        case .streams: return "EgdzdHJlYW1z8gYECgJ6AA%3D%3D"
        case .playlists: return "EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA"
        case .posts: return "Egljb21tdW5pdHnyBgQKAkoA"
        case .about: return "EgVhYm91dPIGBAoCEgA%3D"
        }
    }

    /// Browse parameters of a channel's search tab (sent with a `query`).
    static let searchParams = "EgZzZWFyY2jyBgQKAloA"
}

/// A post on a channel's "Posts" (community) tab.
struct ChannelPost: Identifiable, Hashable {
    var id: String
    var authorName: String
    var authorAvatar: URL?
    var text: String
    var publishedText: String?
    var likeCountText: String?
    var commentCountText: String?
    var images: [URL]
    var video: VideoItem?
    var pollChoices: [String]
    var pollVotesText: String?
}

struct ChannelPostsPage {
    var posts: [ChannelPost]
    var continuation: String?
}

/// The channel's "About" panel.
struct ChannelAbout: Hashable {
    struct Link: Hashable, Identifiable {
        var title: String
        var displayText: String
        var url: URL
        var id: String { url.absoluteString + title }
    }

    var description: String?
    var links: [Link]
    var country: String?
    var subscriberCountText: String?
    var viewCountText: String?
    var videoCountText: String?
    var joinedDateText: String?
    var canonicalURL: String?
}

struct ChannelPage {
    var channel: ChannelItem
    var banner: URL?
    var description: String?
    var tabParams: [ChannelTab: String]
    var initialTab: ChannelTab
    var initialPage: FeedPage
    /// Continuation that loads the "About" panel from the header's description.
    var aboutToken: String?
}

struct PlaylistPage {
    var playlist: PlaylistItem
    var page: FeedPage
}

struct CaptionTrack: Identifiable, Hashable {
    var id: String { languageCode + (isAutoGenerated ? "-asr" : "") }
    var name: String
    var languageCode: String
    var baseURL: URL
    var isAutoGenerated: Bool
    var isTranslatable: Bool
}

struct StreamFormat: Hashable {
    var itag: Int
    var url: URL
    var mimeType: String
    var bitrate: Int
    var width: Int?
    var height: Int?
    var fps: Int?
    var contentLength: Int64?
    var qualityLabel: String?
    var audioTrackName: String?
    /// e.g. "en.4" / "vi.3": language code, then a variant number.
    var audioTrackId: String?
    var isDefaultAudio: Bool
    /// Byte ranges of the MP4 header and segment index (for a DASH manifest).
    var initRange: ClosedRange<Int64>? = nil
    var indexRange: ClosedRange<Int64>? = nil
    var approxDurationMs: Int64? = nil
    var audioSampleRate: Int? = nil
    var audioChannels: Int? = nil

    var isVideo: Bool { mimeType.hasPrefix("video/") }
    var isAudio: Bool { mimeType.hasPrefix("audio/") }
    var isH264: Bool { mimeType.contains("avc1") }
    var isAAC: Bool { mimeType.contains("mp4a") }

    /// Language of a dubbed audio track ("en", "vi"…), from `audioTrackId`.
    var audioLanguage: String? {
        audioTrackId?.split(separator: ".").first.map(String.init)
    }
}

/// One audio language of a video with dubbed tracks.
struct AudioTrackOption: Identifiable, Hashable {
    /// The language tag ("en", "vi-VN"…), or the name when there is none.
    var id: String
    var name: String
    var isOriginal: Bool
}

/// Result of the player endpoint: what can actually be played.
struct PlayerInfo {
    var videoId: String
    var title: String
    var author: String?
    var channelId: String?
    var lengthSeconds: Int?
    var viewCount: Int?
    var shortDescription: String?
    var isLive: Bool
    var thumbnail: URL?
    var hlsURL: URL?
    var adaptiveFormats: [StreamFormat]
    var muxedFormats: [StreamFormat]
    var captions: [CaptionTrack]
    /// YouTube now enforces the length of a skipped pre-roll ad on the server:
    /// streams only work after this moment.
    var availableAt: Date
    var expiresAt: Date?
    var storyboard: Storyboard?
    /// How much louder than YouTube's reference level the audio is (dB), for stable volume.
    var loudnessDb: Double?
    /// False for age-restricted videos (when the response says so).
    var isFamilySafe: Bool = true

    var bestAudio: StreamFormat? { preferredAudio(language: nil) }

    /// The AAC stream in `language` (a dubbed track), else the original one.
    func preferredAudio(language: String?, smallest: Bool = false) -> StreamFormat? {
        let aac = adaptiveFormats.filter { $0.isAudio && $0.isAAC }
        var candidates = aac.filter(\.isDefaultAudio)
        if let language, !language.isEmpty {
            let matching = aac.filter { AudioLanguage.matches($0.audioLanguage, language) }
            if !matching.isEmpty { candidates = matching }
        }
        if candidates.isEmpty { candidates = aac }
        return smallest ? candidates.min { $0.bitrate < $1.bitrate } : candidates.max { $0.bitrate < $1.bitrate }
    }

    /// The audio languages of a video with dubbed tracks (empty when there is just one).
    var audioTracks: [AudioTrackOption] {
        var seen = Set<String>()
        var tracks: [AudioTrackOption] = []
        for format in adaptiveFormats where format.isAudio {
            guard let name = format.audioTrackName else { continue }
            let id = format.audioLanguage ?? name
            guard seen.insert(id).inserted else { continue }
            tracks.append(AudioTrackOption(id: id, name: name, isOriginal: format.isDefaultAudio))
        }
        return tracks.count > 1 ? tracks.sorted { $0.isOriginal && !$1.isOriginal } : []
    }

    func bestVideo(maxHeight: Int) -> StreamFormat? {
        let h264 = adaptiveFormats.filter { $0.isVideo && $0.isH264 }
        return h264.filter { ($0.height ?? 0) <= maxHeight }.max { ($0.height ?? 0, $0.bitrate) < ($1.height ?? 0, $1.bitrate) }
            ?? h264.min { ($0.height ?? 0) < ($1.height ?? 0) }
    }

    var asVideoItem: VideoItem {
        VideoItem(
            id: videoId, title: title, channelName: author, channelId: channelId,
            thumbnail: thumbnail, durationText: lengthSeconds.map(formatDuration),
            durationSeconds: lengthSeconds, isLive: isLive
        )
    }
}

/// Sprite sheets of small frames used for the preview while scrubbing.
/// Spec format: `baseURL|w#h#count#cols#rows#intervalMs#name#sigh|…` (one entry per level).
struct Storyboard: Hashable {
    var baseURL: String
    var level: Int
    var width: Int
    var height: Int
    var count: Int
    var columns: Int
    var rows: Int
    var intervalMs: Int
    var name: String
    var signature: String

    init?(spec: String) {
        let parts = spec.components(separatedBy: "|")
        guard parts.count > 1 else { return nil }
        // The last level has the largest frames.
        let level = parts.count - 2
        let fields = parts[parts.count - 1].components(separatedBy: "#")
        guard fields.count >= 8,
              let width = Int(fields[0]), let height = Int(fields[1]), let count = Int(fields[2]),
              let columns = Int(fields[3]), let rows = Int(fields[4]), let interval = Int(fields[5]),
              width > 0, height > 0, count > 0, columns > 0, rows > 0 else { return nil }
        baseURL = parts[0]
        self.level = level
        self.width = width
        self.height = height
        self.count = count
        self.columns = columns
        self.rows = rows
        intervalMs = interval
        name = fields[6]
        signature = fields[7]
    }

    /// Sprite sheet URL and the frame's rectangle (in sheet pixels) for a playback time.
    func frame(at seconds: Double, duration: Double) -> (url: URL, rect: CGRect)? {
        let interval = intervalMs > 0 ? Double(intervalMs) : max(duration * 1000 / Double(count), 1)
        let index = min(max(Int(seconds * 1000 / interval), 0), count - 1)
        let perSheet = columns * rows
        let sheet = index / perSheet
        let position = index % perSheet
        let sheetName = name.replacingOccurrences(of: "$M", with: String(sheet))
        let urlString = baseURL
            .replacingOccurrences(of: "$L", with: String(level))
            .replacingOccurrences(of: "$N", with: sheetName)
            + "&sigh=" + signature
        guard let url = URL(string: urlString) else { return nil }
        let rect = CGRect(x: (position % columns) * width, y: (position / columns) * height, width: width, height: height)
        return (url, rect)
    }
}

/// Compares language tags loosely: "en" matches "en-US", "vi-VN" matches "vi".
enum AudioLanguage {
    static func matches(_ a: String?, _ b: String?) -> Bool {
        guard let a = a?.lowercased(), let b = b?.lowercased(), !a.isEmpty, !b.isEmpty else { return false }
        if a == b { return true }
        let baseA = a.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? a
        let baseB = b.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? b
        return baseA == baseB
    }
}

struct SponsorSegment: Hashable {
    var start: Double
    var end: Double
    var category: String
}

func formatDuration(_ seconds: Int) -> String {
    let h = seconds / 3600
    let m = (seconds % 3600) / 60
    let s = seconds % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds >= 0 else { return "0:00" }
    return formatDuration(Int(seconds))
}

/// Parses "1:02:03" / "12:16" into seconds.
func parseDuration(_ text: String?) -> Int? {
    guard let text else { return nil }
    let parts = text.split(separator: ":").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    guard !parts.isEmpty, parts.count <= 3 else { return nil }
    return parts.reduce(0) { $0 * 60 + $1 }
}
