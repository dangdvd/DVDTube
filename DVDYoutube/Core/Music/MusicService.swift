import Foundation

/// One row of YouTube Music: a song, a music video, an album, an artist or a playlist.
struct MusicItem: Identifiable, Hashable {
    enum Kind: Hashable { case song, video, album, artist, playlist }

    var kind: Kind
    /// Video id (songs, videos) or browse id (albums `MPRE…`, artists `UC…`, playlists `VL…`).
    var id: String
    var title: String
    var subtitle: String
    var artist: String?
    var artistId: String?
    var album: String?
    var durationText: String?
    var thumbnail: URL?

    var isPlayable: Bool { kind == .song || kind == .video }

    var video: VideoItem {
        VideoItem(
            id: id, title: title, channelName: artist, channelId: artistId,
            thumbnail: thumbnail ?? URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg"),
            durationText: durationText, durationSeconds: parseDuration(durationText)
        )
    }
}

struct MusicShelf: Identifiable, Hashable {
    var title: String
    var items: [MusicItem]
    var id: String { title + (items.first?.id ?? "") }
}

/// An album or artist page of YouTube Music.
struct MusicPage {
    var title: String
    var subtitle: String?
    var thumbnail: URL?
    var shelves: [MusicShelf]

    var tracks: [MusicItem] { shelves.flatMap(\.items).filter(\.isPlayable) }
}

enum MusicSearchKind: String, CaseIterable, Identifiable {
    case songs, videos, albums, artists, playlists

    var id: String { rawValue }

    var title: String {
        switch self {
        case .songs: return "Bài hát"
        case .videos: return "Video"
        case .albums: return "Album"
        case .artists: return "Nghệ sĩ"
        case .playlists: return "Danh sách phát"
        }
    }

    var params: String {
        switch self {
        case .songs: return "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"
        case .videos: return "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D"
        case .albums: return "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D"
        case .artists: return "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D"
        case .playlists: return "EgeKAQQoAEABagoQAxAEEAoQCRAF"
        }
    }

    var itemKind: MusicItem.Kind {
        switch self {
        case .songs: return .song
        case .videos: return .video
        case .albums: return .album
        case .artists: return .artist
        case .playlists: return .playlist
        }
    }
}

/// Lyrics of a song: plain text, plus timed lines when YouTube Music has them.
struct Lyrics: Hashable {
    struct Line: Hashable {
        var start: Double
        var end: Double?
        var text: String
    }

    var text: String
    var source: String?
    var lines: [Line]

    var isTimed: Bool { !lines.isEmpty }
}

/// YouTube Music through its web client (`WEB_REMIX`): lyrics, music search, albums, artists.
enum MusicService {
    // MARK: Lyrics

    private static let lyricsCache = LyricsCache()

    /// Nil when YouTube Music has no lyrics for the video.
    static func lyrics(videoId: String) async throws -> Lyrics? {
        if let cached = await lyricsCache.value(for: videoId) { return cached.lyrics }
        let next = try await InnerTube.shared.music("next", body: ["videoId": videoId, "isAudioOnly": true])
        let browseId = next.findAll("tabRenderer")
            .compactMap { $0.at("endpoint", "browseEndpoint", "browseId").string }
            .first { $0.hasPrefix("MPLYt") }
        guard let browseId else {
            await lyricsCache.set(nil, for: videoId)
            return nil
        }
        let page = try await InnerTube.shared.music("browse", body: ["browseId": browseId])
        let lyrics = parseLyrics(page)
        await lyricsCache.set(lyrics, for: videoId)
        return lyrics
    }

    static func parseLyrics(_ page: JNode) -> Lyrics? {
        var text = ""
        var source: String?
        let sections = page.at("contents", "sectionListRenderer", "contents").array
        var shelves = sections.map { $0["musicDescriptionShelfRenderer"] }.filter(\.exists)
        if shelves.isEmpty { shelves = page.findAll("musicDescriptionShelfRenderer") }
        for shelf in shelves {
            let body = shelf.at("description", "runs").array.compactMap { $0["text"].string }.joined()
            if !body.isEmpty, text.isEmpty { text = body }
            let footer = shelf.at("footer", "runs").array.compactMap { $0["text"].string }.joined()
            if !footer.isEmpty, source == nil { source = footer }
        }
        let lines = timedLines(page)
        if text.isEmpty, !lines.isEmpty { text = lines.map(\.text).joined(separator: "\n") }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return Lyrics(text: text, source: source, lines: lines)
    }

    /// Any `lines[*]` (or `timedLyricsData[*]`) with `lyricLine` + `cueRange.startTimeMilliseconds`.
    private static func timedLines(_ page: JNode) -> [Lyrics.Line] {
        for key in ["lines", "timedLyricsData"] {
            for list in page.findAll(key) {
                let lines = list.array.compactMap { node -> Lyrics.Line? in
                    guard let text = node["lyricLine"].string ?? node["lyricLine"].text,
                          let start = node.at("cueRange", "startTimeMilliseconds").double else { return nil }
                    let end = node.at("cueRange", "endTimeMilliseconds").double
                    return Lyrics.Line(start: start / 1000, end: end.map { $0 / 1000 }, text: text)
                }
                if lines.count >= 2 { return lines.sorted { $0.start < $1.start } }
            }
        }
        return []
    }

    // MARK: Search

    static func search(_ query: String, kind: MusicSearchKind) async throws -> [MusicItem] {
        let json = try await InnerTube.shared.music("search", body: ["query": query, "params": kind.params])
        let items = json.findAll("musicResponsiveListItemRenderer").compactMap { item(from: $0, fallback: kind.itemKind) }
        return filtered(unique(items))
    }

    static func item(from r: JNode, fallback: MusicItem.Kind) -> MusicItem? {
        let columns = r["flexColumns"].array.map { $0.at("musicResponsiveListItemFlexColumnRenderer", "text", "runs").array }
        guard let titleRuns = columns.first else { return nil }
        let title = titleRuns.compactMap { $0["text"].string }.joined()
        guard !title.isEmpty else { return nil }

        var artists: [String] = []
        var artistId: String?
        var album: String?
        var duration: String?
        var other: [String] = []
        for column in columns.dropFirst() {
            for run in column {
                guard let text = run["text"].string?.trimmingCharacters(in: .whitespaces), !text.isEmpty, text != "•", text != "&", text != "," else { continue }
                let browseId = run.at("navigationEndpoint", "browseEndpoint", "browseId").string ?? ""
                if browseId.hasPrefix("UC") || browseId.hasPrefix("FEmusic_library_privately_owned_artist") {
                    artists.append(text)
                    artistId = artistId ?? (browseId.hasPrefix("UC") ? browseId : nil)
                } else if browseId.hasPrefix("MPRE") {
                    album = text
                } else if text.range(of: #"^\d+(:\d{2}){1,2}$"#, options: .regularExpression) != nil {
                    duration = text
                } else if !typeWords.contains(text) {
                    other.append(text)
                }
            }
        }
        if let fixed = r["fixedColumns"].array.first?.at("musicResponsiveListItemFixedColumnRenderer", "text").text,
           fixed.range(of: #"^\d+(:\d{2}){1,2}$"#, options: .regularExpression) != nil {
            duration = duration ?? fixed
        }

        let videoId = r.at("playlistItemData", "videoId").string
            ?? r.at("overlay", "musicItemThumbnailOverlayRenderer", "content", "musicPlayButtonRenderer",
                    "playNavigationEndpoint", "watchEndpoint", "videoId").string
            ?? r.at("navigationEndpoint", "watchEndpoint", "videoId").string
        let browseId = r.at("navigationEndpoint", "browseEndpoint", "browseId").string
        let thumbnail = r.at("thumbnail", "musicThumbnailRenderer", "thumbnail").bestImageURL

        var kind = fallback
        let id: String
        if fallback == .song || fallback == .video, let videoId {
            id = videoId
        } else if let browseId, !browseId.isEmpty {
            id = browseId
            if browseId.hasPrefix("MPRE") {
                kind = .album
            } else if browseId.hasPrefix("UC") {
                kind = .artist
            } else if browseId.hasPrefix("VL") {
                kind = .playlist
            } else {
                return nil
            }
        } else if let videoId {
            id = videoId
            kind = .song
        } else {
            return nil
        }
        // Artists: the first line is the name; the second often just "Nghệ sĩ • 1,2 Tr người đăng ký".
        if kind == .artist { artists = [] }
        var subtitleParts: [String] = []
        if !artists.isEmpty { subtitleParts.append(artists.joined(separator: ", ")) }
        if let album { subtitleParts.append(album) }
        subtitleParts.append(contentsOf: other)
        if let duration { subtitleParts.append(duration) }
        return MusicItem(
            kind: kind, id: id, title: title,
            subtitle: subtitleParts.joined(separator: " • "),
            artist: artists.isEmpty ? (kind == .artist ? title : other.first) : artists.joined(separator: ", "),
            artistId: kind == .artist ? id : artistId,
            album: album, durationText: duration, thumbnail: thumbnail
        )
    }

    /// Words YouTube Music puts in front of results ("Bài hát • Ca sĩ • 3:45").
    private static let typeWords: Set<String> = [
        "Bài hát", "Song", "Video", "Album", "Nghệ sĩ", "Artist", "Danh sách phát", "Playlist",
        "Đĩa đơn", "Single", "EP", "Tập", "Episode", "Podcast",
    ]

    // MARK: Albums and artists

    static func page(browseId: String) async throws -> MusicPage {
        let json = try await InnerTube.shared.music("browse", body: ["browseId": browseId])
        return parsePage(json, browseId: browseId)
    }

    static func parsePage(_ json: JNode, browseId: String) -> MusicPage {
        let header = [json.findFirst("musicResponsiveHeaderRenderer"), json.findFirst("musicImmersiveHeaderRenderer"),
                      json.findFirst("musicDetailHeaderRenderer"), json.findFirst("musicVisualHeaderRenderer")]
            .first { $0.exists } ?? .empty
        let title = header["title"].text ?? ""
        let subtitle = header["straplineTextOne"].text ?? header["subtitle"].text
        let thumbnail = header.findFirst("musicThumbnailRenderer")["thumbnail"].bestImageURL
            ?? header["thumbnail"].bestImageURL
        var shelves: [MusicShelf] = []

        // Track lists (album tracks, an artist's top songs).
        for key in ["musicShelfRenderer", "musicPlaylistShelfRenderer"] {
            for shelf in json.findAll(key) {
                let shelfTitle = shelf["title"].text ?? (browseId.hasPrefix("MPRE") ? "Bài hát" : "Bài hát nổi bật")
                var items = shelf["contents"].array.compactMap { entry -> MusicItem? in
                    let renderer = entry["musicResponsiveListItemRenderer"]
                    return renderer.exists ? item(from: renderer, fallback: .song) : nil
                }
                items = items.map { track in
                    var track = track
                    // Album tracks have no artwork of their own.
                    if track.thumbnail == nil, browseId.hasPrefix("MPRE") { track.thumbnail = thumbnail }
                    if track.artist == nil, browseId.hasPrefix("MPRE") { track.artist = subtitle }
                    return track
                }
                if !items.isEmpty { shelves.append(MusicShelf(title: shelfTitle, items: filtered(items))) }
            }
        }

        // Carousels (albums, singles, related artists, videos).
        for shelf in json.findAll("musicCarouselShelfRenderer") {
            let shelfTitle = shelf.at("header", "musicCarouselShelfBasicHeaderRenderer", "title").text ?? ""
            let items = shelf["contents"].array.compactMap { entry -> MusicItem? in
                if entry["musicTwoRowItemRenderer"].exists { return twoRowItem(entry["musicTwoRowItemRenderer"]) }
                if entry["musicResponsiveListItemRenderer"].exists {
                    return item(from: entry["musicResponsiveListItemRenderer"], fallback: .song)
                }
                return nil
            }
            if !items.isEmpty { shelves.append(MusicShelf(title: shelfTitle.isEmpty ? "Khác" : shelfTitle, items: filtered(items))) }
        }
        return MusicPage(title: title, subtitle: subtitle, thumbnail: thumbnail, shelves: shelves.filter { !$0.items.isEmpty })
    }

    private static func twoRowItem(_ r: JNode) -> MusicItem? {
        guard let title = r["title"].text, !title.isEmpty else { return nil }
        let subtitle = r["subtitle"].text ?? ""
        let thumbnail = r.at("thumbnailRenderer", "musicThumbnailRenderer", "thumbnail").bestImageURL
        if let browseId = r.at("navigationEndpoint", "browseEndpoint", "browseId").string {
            let kind: MusicItem.Kind = browseId.hasPrefix("MPRE") ? .album : browseId.hasPrefix("UC") ? .artist : .playlist
            return MusicItem(kind: kind, id: browseId, title: title, subtitle: subtitle,
                             artist: kind == .artist ? title : nil, artistId: kind == .artist ? browseId : nil,
                             album: kind == .album ? title : nil, durationText: nil, thumbnail: thumbnail)
        }
        if let videoId = r.at("navigationEndpoint", "watchEndpoint", "videoId").string {
            return MusicItem(kind: .video, id: videoId, title: title, subtitle: subtitle, artist: nil, artistId: nil,
                             album: nil, durationText: nil, thumbnail: thumbnail)
        }
        return nil
    }

    private static func unique(_ items: [MusicItem]) -> [MusicItem] {
        var seen = Set<String>()
        return items.filter { seen.insert($0.id).inserted }
    }

    /// Blocked keywords of the parental controls.
    private static func filtered(_ items: [MusicItem]) -> [MusicItem] {
        guard ContentFilter.shared.isActive else { return items }
        return items.filter { !ContentFilter.shared.isBlocked(title: $0.title, channel: $0.artist) }
    }
}

private actor LyricsCache {
    struct Entry {
        var lyrics: Lyrics?
    }

    private var entries: [String: Entry] = [:]

    func value(for videoId: String) -> Entry? { entries[videoId] }

    func set(_ lyrics: Lyrics?, for videoId: String) {
        if entries.count > 200 { entries.removeAll() }
        entries[videoId] = Entry(lyrics: lyrics)
    }
}
