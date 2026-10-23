import Foundation

/// Turns arbitrary InnerTube trees (search, browse, related, continuations) into feed items.
///
/// Rather than hard-coding the nesting of every page type, the parser walks the whole tree
/// and recognises the renderers that represent videos, channels, playlists and Shorts.
/// This keeps working when YouTube moves things around, which it does constantly.
enum ItemParser {
    private static let skippedKeys: Set<String> = [
        "responseContext", "header", "topbar", "microformat", "frameworkUpdates", "playerOverlays",
        "menu", "thumbnailOverlays", "trackingParams", "loggingDirectives", "accessibility",
        "engagementPanels", "commandMetadata", "metadata",
        "richThumbnail", "channelThumbnailSupportedRenderers", "endScreen", "cards",
        "searchPyvRenderer", "adSlotRenderer", "promotedSparklesWebRenderer", "statementBannerRenderer",
    ]

    private static let videoKeys: Set<String> = [
        "videoRenderer", "compactVideoRenderer", "gridVideoRenderer", "playlistVideoRenderer",
        "playlistPanelVideoRenderer", "videoWithContextRenderer", "endScreenVideoRenderer",
    ]

    private static let shelfKeys: Set<String> = [
        "reelShelfRenderer", "gridShelfViewModel", "richShelfRenderer", "shelfRenderer",
        "horizontalCardListRenderer", "expandedShelfContentsRenderer",
    ]

    static func page(_ node: JNode) -> FeedPage {
        var page = FeedPage(items: items(in: node), continuation: continuation(in: node))
        if page.items.isEmpty { page.message = emptyMessage(in: node) }
        return page
    }

    /// Text of the notice YouTube shows instead of a feed.
    static func emptyMessage(in node: JNode) -> String? {
        for key in ["feedNudgeRenderer", "backgroundPromoRenderer", "messageRenderer", "emptyStateViewModel"] {
            let renderer = node.findFirst(key)
            guard renderer.exists else { continue }
            let parts = [renderer["title"], renderer["subtitle"], renderer["text"], renderer["bodyText"]]
                .compactMap { $0.text?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if !parts.isEmpty { return parts.joined(separator: "\n") }
        }
        return nil
    }

    static func items(in node: JNode) -> [FeedItem] {
        var result: [FeedItem] = []
        var seen = Set<String>()
        walk(node.raw, into: &result)
        // The same video sometimes appears twice (e.g. in a shelf and in the list).
        return result.filter { seen.insert($0.id).inserted }
    }

    static func continuation(in node: JNode) -> String? {
        let renderers = node.findAll("continuationItemRenderer")
        for renderer in renderers.reversed() {
            if let token = renderer.findFirst("continuationCommand")["token"].string { return token }
        }
        return nil
    }

    private static func walk(_ value: Any?, into result: inout [FeedItem]) {
        if let array = value as? [Any] {
            for element in array { walk(element, into: &result) }
            return
        }
        guard let dict = value as? [String: Any] else { return }

        for key in dict.keys.sorted() {
            if skippedKeys.contains(key) { continue }
            let child = JNode(dict[key])

            if videoKeys.contains(key) {
                if let video = video(fromRenderer: child) { result.append(.video(video)) }
                continue
            }
            switch key {
            case "lockupViewModel":
                if let item = lockup(child) { result.append(item) }
                continue
            case "shortsLockupViewModel":
                if let short = short(fromShortsLockup: child) { result.append(.video(short)) }
                continue
            case "reelItemRenderer":
                if let short = short(fromReelItem: child) { result.append(.video(short)) }
                continue
            case "channelRenderer", "gridChannelRenderer":
                if let channel = channel(fromRenderer: child) { result.append(.channel(channel)) }
                continue
            case "playlistRenderer", "gridPlaylistRenderer", "compactPlaylistRenderer", "radioRenderer", "compactRadioRenderer":
                if let playlist = playlist(fromRenderer: child) { result.append(.playlist(playlist)) }
                continue
            default:
                break
            }

            if shelfKeys.contains(key) {
                var inner: [FeedItem] = []
                walk(child.raw, into: &inner)
                let shorts = inner.compactMap { $0.video }.filter(\.isShort)
                if !shorts.isEmpty, shorts.count == inner.count {
                    result.append(.shorts(shorts))
                } else {
                    result.append(contentsOf: inner)
                }
                continue
            }

            walk(child.raw, into: &result)
        }
    }

    // MARK: - Renderers

    static func video(fromRenderer r: JNode) -> VideoItem? {
        guard let id = r["videoId"].string else { return nil }
        let owner = [r["ownerText"], r["longBylineText"], r["shortBylineText"]].first { $0.text != nil }
        let channelId = owner?["runs"].array.lazy
            .compactMap { $0.at("navigationEndpoint", "browseEndpoint", "browseId").string }
            .first

        var durationText = r["lengthText"].text
        var isLive = false
        var isShort = r.at("navigationEndpoint", "reelWatchEndpoint").exists
        for overlay in r["thumbnailOverlays"].array {
            let status = overlay["thumbnailOverlayTimeStatusRenderer"]
            guard status.exists else { continue }
            switch status["style"].string {
            case "LIVE": isLive = true
            case "SHORTS": isShort = true
            default: if durationText == nil { durationText = status["text"].text }
            }
        }
        for badge in r["badges"].array {
            if badge.at("metadataBadgeRenderer", "style").string == "BADGE_STYLE_TYPE_LIVE_NOW" { isLive = true }
        }

        let avatar = r.at("channelThumbnailSupportedRenderers", "channelThumbnailWithLinkRenderer", "thumbnail").bestImageURL
            ?? r["channelThumbnail"].bestImageURL

        var views = r["shortViewCountText"].text ?? r["viewCountText"].text
        var published = r["publishedTimeText"].text
        if views == nil {
            // playlistVideoRenderer: "1,2 Tr lượt xem • 2 năm trước" split into runs.
            let parts = r["videoInfo"]["runs"].array.compactMap { $0["text"].string }
                .filter { $0.trimmingCharacters(in: .whitespaces).count > 1 }
            views = parts.first
            if published == nil, parts.count > 1 { published = parts[1] }
        }

        return VideoItem(
            id: id,
            title: r["title"].text ?? r["headline"].text ?? "",
            channelName: owner?.text,
            channelId: channelId,
            channelAvatar: avatar,
            thumbnail: r["thumbnail"].bestImageURL,
            durationText: isLive ? nil : durationText,
            durationSeconds: r["lengthSeconds"].int ?? parseDuration(durationText),
            viewCountText: views,
            publishedText: published,
            isLive: isLive,
            isShort: isShort
        )
    }

    static func lockup(_ r: JNode) -> FeedItem? {
        guard let id = r["contentId"].string else { return nil }
        let type = r["contentType"].string ?? ""
        let meta = r.at("metadata", "lockupMetadataViewModel")
        let title = meta["title"].text ?? ""
        let rows: [[String]] = meta.at("metadata", "contentMetadataViewModel", "metadataRows").array.map { row in
            row["metadataParts"].array.compactMap { $0["text"].text?.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        }.filter { !$0.isEmpty }

        let avatarNode = meta.at("image", "decoratedAvatarViewModel")
        let avatar = avatarNode.at("avatar", "avatarViewModel", "image").bestImageURL
        let channelId = avatarNode.findFirst("browseEndpoint")["browseId"].string

        let image = r["contentImage"]
        let thumbnail = image.findFirst("thumbnailViewModel")["image"].bestImageURL
            ?? image.findFirst("primaryThumbnail").findFirst("image").bestImageURL
        let badges = image.findAll("thumbnailBadgeViewModel")
        let badgeTexts = badges.compactMap { $0["text"].string }

        if type.contains("PLAYLIST") || type.contains("ALBUM") || type.contains("PODCAST") {
            return .playlist(PlaylistItem(
                id: id,
                title: title,
                thumbnail: thumbnail,
                channelName: rows.first?.first,
                videoCountText: badgeTexts.first { $0.rangeOfCharacter(from: .decimalDigits) != nil }
            ))
        }
        guard type.isEmpty || type.contains("VIDEO") else { return nil }

        var channelName: String?
        var parts: [String]
        if rows.count >= 2 {
            channelName = rows[0].joined(separator: " • ")
            parts = rows[1]
        } else {
            parts = rows.first ?? []
        }
        let duration = badgeTexts.first { $0.range(of: #"^\d+(:\d{2})+$"#, options: .regularExpression) != nil }
        let isLive = badges.contains { ($0["badgeStyle"].string ?? "").contains("LIVE") }

        return .video(VideoItem(
            id: id,
            title: title,
            channelName: channelName,
            channelId: channelId,
            channelAvatar: avatar,
            thumbnail: thumbnail,
            durationText: duration,
            durationSeconds: parseDuration(duration),
            viewCountText: parts.first,
            publishedText: parts.count > 1 ? parts[1] : nil,
            isLive: isLive
        ))
    }

    static func short(fromShortsLockup r: JNode) -> VideoItem? {
        let endpoint = r.findFirst("reelWatchEndpoint")
        var id = endpoint["videoId"].string
        if id == nil, let entity = r["entityId"].string, let range = entity.range(of: "shorts-shelf-item-") {
            id = String(entity[range.upperBound...])
        }
        guard let id else { return nil }
        let image = r.at("thumbnailViewModel", "thumbnailViewModel", "image").exists
            ? r.at("thumbnailViewModel", "thumbnailViewModel", "image")
            : r.at("thumbnailViewModel", "image")
        var title = r.at("overlayMetadata", "primaryText").text
        if title == nil, let accessibility = r["accessibilityText"].string {
            title = accessibility.components(separatedBy: ", ").dropLast().joined(separator: ", ")
        }
        return VideoItem(
            id: id,
            title: title ?? "",
            thumbnail: image.bestImageURL ?? endpoint["thumbnail"].bestImageURL,
            viewCountText: r.at("overlayMetadata", "secondaryText").text,
            isShort: true
        )
    }

    static func short(fromReelItem r: JNode) -> VideoItem? {
        guard let id = r["videoId"].string else { return nil }
        return VideoItem(
            id: id,
            title: r["headline"].text ?? "",
            thumbnail: r["thumbnail"].bestImageURL,
            viewCountText: r["viewCountText"].text,
            isShort: true
        )
    }

    static func channel(fromRenderer r: JNode) -> ChannelItem? {
        guard let id = r["channelId"].string else { return nil }
        let subscriberCount = r["subscriberCountText"].text
        let videoCount = r["videoCountText"].text
        // Newer layouts put the @handle in `subscriberCountText` and the count in `videoCountText`.
        let isHandle = subscriberCount?.hasPrefix("@") == true
        return ChannelItem(
            id: id,
            name: r["title"].text ?? "",
            avatar: r["thumbnail"].bestImageURL,
            handle: isHandle ? subscriberCount : nil,
            subscriberText: isHandle ? videoCount : subscriberCount,
            videoCountText: isHandle ? nil : videoCount
        )
    }

    static func playlist(fromRenderer r: JNode) -> PlaylistItem? {
        guard let id = r["playlistId"].string else { return nil }
        let thumbnail = r["thumbnails"][0].bestImageURL
            ?? r["thumbnail"].bestImageURL
            ?? r["thumbnailRenderer"].findFirst("thumbnail").bestImageURL
        var count = r["videoCountText"].text ?? r["videoCountShortText"].text
        if count == nil, let number = r["videoCount"].string { count = "\(number) video" }
        return PlaylistItem(
            id: id,
            title: r["title"].text ?? "",
            thumbnail: thumbnail,
            channelName: r["shortBylineText"].text ?? r["longBylineText"].text,
            videoCountText: count
        )
    }

    /// Items of the YouTube Charts endpoint (`videoViews`).
    static func chartVideos(_ node: JNode) -> [VideoItem] {
        guard let list = node.findAll("videoViews").first(where: { !$0.array.isEmpty }) else { return [] }
        return list.array.compactMap { v in
            guard let id = v["id"].string, v["isAvailable"].bool != false else { return nil }
            let artists = v["artists"].array.compactMap { $0["name"].string }.joined(separator: ", ")
            let seconds = v["videoDuration"].int
            return VideoItem(
                id: id,
                title: v["title"].string ?? "",
                channelName: artists.isEmpty ? v["channelName"].string : artists,
                channelId: v["externalChannelId"].string,
                thumbnail: v["thumbnail"].bestImageURL,
                durationText: seconds.map(formatDuration),
                durationSeconds: seconds,
                viewCountText: v.at("chartEntryMetadata", "currentPosition").int.map { "#\($0) thịnh hành" }
            )
        }
    }
}
