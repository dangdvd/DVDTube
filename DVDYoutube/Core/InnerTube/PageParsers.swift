import Foundation

enum WatchParser {
    static func parse(_ json: JNode, videoId: String) -> WatchInfo {
        let watch = json.at("contents", "twoColumnWatchNextResults")
        let results = watch.at("results", "results", "contents").array
        let primary = results.first { $0["videoPrimaryInfoRenderer"].exists }?["videoPrimaryInfoRenderer"] ?? .empty
        let secondary = results.first { $0["videoSecondaryInfoRenderer"].exists }?["videoSecondaryInfoRenderer"] ?? .empty

        let likeButton = primary["videoActions"].findFirst("likeButtonViewModel")
        let likeCount = likeButton.at(
            "toggleButtonViewModel", "toggleButtonViewModel", "defaultButtonViewModel", "buttonViewModel", "title"
        ).string ?? likeButton.findFirst("buttonViewModel")["title"].string

        let owner = secondary.at("owner", "videoOwnerRenderer")
        var channel: ChannelItem?
        let channelId = owner.at("navigationEndpoint", "browseEndpoint", "browseId").string
            ?? owner["title"]["runs"][0].at("navigationEndpoint", "browseEndpoint", "browseId").string
        if let channelId {
            channel = ChannelItem(
                id: channelId,
                name: owner["title"].text ?? "",
                avatar: owner["thumbnail"].bestImageURL,
                subscriberText: owner["subscriberCountText"].text
            )
        }

        let commentsSection = results.first {
            $0.at("itemSectionRenderer", "sectionIdentifier").string == "comment-item-section"
        }
        let commentsToken = commentsSection?.findFirst("continuationCommand")["token"].string

        var commentCount: String?
        var chapters: [Chapter] = []
        for panel in json["engagementPanels"].array {
            let section = panel["engagementPanelSectionListRenderer"]
            let identifier = section["panelIdentifier"].string ?? section["targetId"].string ?? ""
            if identifier.contains("comments") {
                commentCount = section.at("header", "engagementPanelTitleHeaderRenderer", "contextualInfo").text
            } else if identifier.contains("macro-markers"), chapters.isEmpty {
                var seen = Set<Int>()
                chapters = section.findAll("macroMarkersListItemRenderer").compactMap { marker in
                    guard let title = marker["title"].text,
                          let start = parseDuration(marker["timeDescription"].text),
                          seen.insert(start).inserted
                    else { return nil }
                    return Chapter(title: title, startSeconds: start, thumbnail: marker["thumbnail"].bestImageURL)
                }.sorted { $0.startSeconds < $1.startSeconds }
            }
        }

        let related = ItemParser.page(watch["secondaryResults"])
        return WatchInfo(
            videoId: videoId,
            title: primary["title"].text ?? "",
            viewCountText: primary.at("viewCount", "videoViewCountRenderer", "viewCount").text,
            shortViewCountText: primary.at("viewCount", "videoViewCountRenderer", "shortViewCount").text,
            dateText: primary["dateText"].text,
            relativeDateText: primary["relativeDateText"].text,
            likeCountText: likeCount,
            description: secondary.at("attributedDescription", "content").string ?? secondary["description"].text,
            channel: channel,
            related: FeedPage(items: related.items.filter { $0.video?.id != videoId }, continuation: related.continuation, kind: .next),
            commentsToken: commentsToken,
            commentCountText: commentCount,
            chapters: chapters,
            likeStatus: primary["videoActions"].findFirst("likeStatusEntity")["likeStatus"].string,
            isSubscribed: secondary.findFirst("subscribeButtonRenderer")["subscribed"].bool,
            liveChat: LiveChatParser.info(watch),
            heatMarkers: heatMarkers(json)
        )
    }

    /// `frameworkUpdates` → `macroMarkersListEntity` of type MARKER_TYPE_HEATMAP.
    static func heatMarkers(_ json: JNode) -> [HeatMarker] {
        for mutation in json.at("frameworkUpdates", "entityBatchUpdate", "mutations").array {
            let list = mutation.at("payload", "macroMarkersListEntity", "markersList")
            guard list["markerType"].string == "MARKER_TYPE_HEATMAP" else { continue }
            let markers = list["markers"].array.compactMap { marker -> HeatMarker? in
                guard let start = marker["startMillis"].double, let length = marker["durationMillis"].double,
                      let intensity = marker["intensityScoreNormalized"].double else { return nil }
                return HeatMarker(start: start / 1000, duration: length / 1000, intensity: min(max(intensity, 0), 1))
            }
            if !markers.isEmpty { return markers.sorted { $0.start < $1.start } }
        }
        return []
    }
}

enum AccountParser {
    /// `account/account_menu` → the active account's name, handle and avatar.
    static func profile(_ json: JNode) -> AccountProfile? {
        let header = json.findFirst("activeAccountHeaderRenderer")
        guard let name = header["accountName"].text else { return nil }
        // "Your channel" in the menu links to the account's channel.
        let channelId = json.findAll("browseEndpoint").lazy
            .compactMap { $0["browseId"].string }
            .first { $0.hasPrefix("UC") }
        return AccountProfile(
            name: name,
            handle: header["channelHandle"].text,
            email: header["email"].text,
            avatar: header["accountPhoto"].bestImageURL,
            channelId: channelId
        )
    }

    /// Account switcher: every signed-in Google account and its brand channels.
    /// `authuser`/`pageid` come from each item's sign-in URL or page id token.
    static func identities(_ json: JNode) -> [AccountIdentity] {
        var result: [AccountIdentity] = []
        var seen = Set<String>()
        for (index, section) in json.findAll("accountSectionListRenderer").enumerated() {
            let header = section.findFirst("googleAccountHeaderRenderer")
            let email = header["email"].text
            let items = section.findAll("accountItem") + section.findAll("accountItemRenderer")
            for item in items {
                guard let name = item["accountName"].text else { continue }
                var authUser: Int?
                var pageId: String?
                for token in item.findAll("supportedTokens").flatMap(\.array) {
                    if let id = token.at("pageIdToken", "pageId").string, !id.isEmpty { pageId = id }
                    if let url = token.at("accountSigninToken", "signinUrl").string,
                       let components = URLComponents(string: url) {
                        for query in components.queryItems ?? [] {
                            if query.name == "authuser", let value = query.value.flatMap(Int.init) { authUser = value }
                            if query.name == "pageid", let value = query.value, !value.isEmpty, pageId == nil { pageId = value }
                        }
                    }
                }
                let identity = AccountIdentity(
                    authUser: authUser ?? index,
                    pageId: pageId,
                    name: name,
                    byline: item["channelHandle"].text ?? item["accountByline"].text,
                    email: email ?? (pageId == nil ? item["accountByline"].text : nil),
                    avatar: item["accountPhoto"].bestImageURL,
                    isSelected: item["isSelected"].bool ?? false,
                    hasChannel: item["hasChannel"].bool ?? true
                )
                if seen.insert(identity.id).inserted { result.append(identity) }
            }
        }
        return result
    }
}

extension AccountParser {
    static func playlistOptions(_ json: JNode) -> [AccountPlaylistOption] {
        json.findAll("playlistAddToOptionRenderer").compactMap { option in
            guard let id = option["playlistId"].string else { return nil }
            return AccountPlaylistOption(
                id: id,
                title: option["title"].text ?? id,
                containsVideo: option["containsSelectedVideos"].string == "ALL"
            )
        }
    }

    static func notifications(_ json: JNode) -> [AccountNotification] {
        json.findAll("notificationRenderer").compactMap { item in
            guard let message = item["shortMessage"].text else { return nil }
            return AccountNotification(
                id: item["notificationId"].string ?? UUID().uuidString,
                message: message,
                timeText: item["sentTimeText"].text,
                avatar: item["thumbnail"].bestImageURL,
                thumbnail: item["videoThumbnail"].bestImageURL,
                videoId: item.findFirst("watchEndpoint")["videoId"].string,
                isRead: item["read"].bool ?? true
            )
        }
    }
}

enum CommentsParser {
    struct SortOption: Hashable {
        var title: String
        var token: String
    }

    static func parse(_ json: JNode) -> (page: CommentsPage, sortOptions: [SortOption]) {
        var payloads: [String: JNode] = [:]
        var toolbarStates: [String: JNode] = [:]
        var toolbarSurfaces: [String: JNode] = [:]
        for mutation in json.at("frameworkUpdates", "entityBatchUpdate", "mutations").array {
            guard let key = mutation["entityKey"].string else { continue }
            let payload = mutation["payload"]
            if payload["commentEntityPayload"].exists {
                payloads[key] = payload["commentEntityPayload"]
            } else if payload["engagementToolbarStateEntityPayload"].exists {
                toolbarStates[key] = payload["engagementToolbarStateEntityPayload"]
            } else if payload["engagementToolbarSurfaceEntityPayload"].exists {
                toolbarSurfaces[key] = payload["engagementToolbarSurfaceEntityPayload"]
            }
        }

        var items: [JNode] = []
        for endpoint in json["onResponseReceivedEndpoints"].array {
            for key in endpoint.keys.sorted() {
                items.append(contentsOf: endpoint[key]["continuationItems"].array)
            }
        }

        var comments: [Comment] = []
        var continuation: String?
        var countText: String?
        var sortOptions: [SortOption] = []

        func build(_ viewModel: JNode, repliesToken: String?) -> Comment? {
            guard let key = viewModel["commentKey"].string, let payload = payloads[key] else { return nil }
            let properties = payload["properties"]
            let author = payload["author"]
            let toolbar = payload["toolbar"]
            let state = viewModel["toolbarStateKey"].string.flatMap { toolbarStates[$0] }
            let heartState = state?["heartState"].string
            let surface = viewModel["toolbarSurfaceKey"].string.flatMap { toolbarSurfaces[$0] }
            func action(_ command: String) -> String? {
                surface?[command].findFirst("performCommentActionEndpoint")["action"].string
            }
            let likeState: String? = {
                switch state?["likeState"].string {
                case "TOOLBAR_LIKE_STATE_LIKED": return "LIKED"
                case "TOOLBAR_LIKE_STATE_DISLIKED": return "DISLIKED"
                default: return nil
                }
            }()
            func nonEmpty(_ value: String?) -> String? {
                guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty, value != "0" else { return nil }
                return value
            }
            return Comment(
                id: properties["commentId"].string ?? viewModel["commentId"].string ?? key,
                authorName: author["displayName"].string ?? "",
                authorAvatar: author["avatarThumbnailUrl"].string.flatMap(URL.youtubeImage),
                authorChannelId: author["channelId"].string,
                text: properties.at("content", "content").string ?? "",
                publishedText: properties["publishedTime"].string,
                likeCountText: nonEmpty(toolbar["likeCountNotliked"].string),
                replyCountText: nonEmpty(toolbar["replyCount"].string),
                repliesToken: repliesToken,
                isPinned: viewModel["pinnedText"].exists,
                isCreator: author["isCreator"].bool ?? false,
                isHearted: heartState == "TOOLBAR_HEART_STATE_HEARTED",
                replyParams: surface?.findFirst("createReplyParams").string,
                likeCountLikedText: nonEmpty(toolbar["likeCountLiked"].string),
                likeState: likeState,
                likeToken: action("likeCommand"),
                unlikeToken: action("unlikeCommand"),
                dislikeToken: action("dislikeCommand"),
                undislikeToken: action("undislikeCommand")
            )
        }

        for item in items {
            if item["commentsHeaderRenderer"].exists {
                let header = item["commentsHeaderRenderer"]
                countText = header["countText"].text ?? header["commentsCount"].text
                for option in header.findAll("subMenuItems").first?.array ?? [] {
                    if let title = option["title"].string,
                       let token = option.findFirst("continuationCommand")["token"].string {
                        sortOptions.append(SortOption(title: title, token: token))
                    }
                }
            } else if item["commentThreadRenderer"].exists {
                let thread = item["commentThreadRenderer"]
                let repliesToken = thread.at("replies", "commentRepliesRenderer").findFirst("continuationCommand")["token"].string
                if let comment = build(thread.at("commentViewModel", "commentViewModel"), repliesToken: repliesToken) {
                    comments.append(comment)
                }
            } else if item["commentViewModel"].exists {
                if let comment = build(item["commentViewModel"], repliesToken: nil) {
                    comments.append(comment)
                }
            } else if item["continuationItemRenderer"].exists {
                continuation = item["continuationItemRenderer"].findFirst("continuationCommand")["token"].string
            }
        }
        return (
            CommentsPage(
                comments: comments,
                continuation: continuation,
                countText: countText,
                createParams: json.findFirst("createCommentParams").string
            ),
            sortOptions
        )
    }
}

enum ChannelParser {
    static func parse(_ json: JNode, channelId: String, tab: ChannelTab) -> ChannelPage {
        let header = json["header"]
        let pageHeader = header.at("pageHeaderRenderer", "content", "pageHeaderViewModel")
        let legacy = header["c4TabbedHeaderRenderer"]
        let metadata = json.at("metadata", "channelMetadataRenderer")

        let name = pageHeader.at("title", "dynamicTextViewModel", "text", "content").string
            ?? header.at("pageHeaderRenderer", "pageTitle").string
            ?? legacy["title"].text
            ?? metadata["title"].string
            ?? ""
        let avatar = pageHeader.at("image", "decoratedAvatarViewModel", "avatar", "avatarViewModel", "image").bestImageURL
            ?? legacy["avatar"].bestImageURL
            ?? metadata["avatar"].bestImageURL
        let banner = pageHeader.at("banner", "imageBannerViewModel", "image").bestImageURL
            ?? legacy["banner"].bestImageURL

        let parts = pageHeader.at("metadata", "contentMetadataViewModel", "metadataRows").array.flatMap { row in
            row["metadataParts"].array.compactMap { $0["text"].text }
        }
        let handle = parts.first { $0.hasPrefix("@") } ?? legacy["channelHandleText"].text
        let counts = parts.filter { !$0.hasPrefix("@") }
        let subscribers = counts.first ?? legacy["subscriberCountText"].text
        let videos = counts.count > 1 ? counts[1] : legacy["videosCountText"].text

        var tabParams: [ChannelTab: String] = [:]
        var selectedContent = JNode.empty
        for entry in json.at("contents", "twoColumnBrowseResultsRenderer", "tabs").array {
            let renderer = entry["tabRenderer"]
            guard renderer.exists else { continue }
            let url = renderer.findFirst("webCommandMetadata")["url"].string ?? ""
            let params = renderer.at("endpoint", "browseEndpoint", "params").string
            for candidate in ChannelTab.allCases where candidate.urlSuffixes.contains(where: { url.hasSuffix($0) }) {
                if let params { tabParams[candidate] = params }
            }
            if renderer["selected"].bool == true { selectedContent = renderer["content"] }
        }

        let channel = ChannelItem(
            id: metadata["externalId"].string ?? channelId,
            name: name,
            avatar: avatar,
            handle: handle,
            subscriberText: subscribers,
            videoCountText: videos
        )
        return ChannelPage(
            channel: channel,
            banner: banner,
            description: pageHeader.at("description", "descriptionPreviewViewModel", "description", "content").string
                ?? metadata["description"].string,
            tabParams: tabParams,
            initialTab: tab,
            initialPage: ItemParser.page(selectedContent),
            aboutToken: pageHeader["description"].findFirst("continuationCommand")["token"].string
                ?? header["c4TabbedHeaderRenderer"].findFirst("continuationCommand")["token"].string
        )
    }

    /// Posts of the channel's "Posts" (community) tab or of a continuation page.
    static func posts(_ json: JNode) -> ChannelPostsPage {
        var seen = Set<String>()
        let posts = json.findAll("backstagePostRenderer").compactMap(post).filter { seen.insert($0.id).inserted }
        return ChannelPostsPage(posts: posts, continuation: ItemParser.continuation(in: json))
    }

    static func post(_ r: JNode) -> ChannelPost? {
        guard let id = r["postId"].string else { return nil }
        let attachment = r["backstageAttachment"]
        var images: [URL] = []
        if let single = attachment.at("backstageImageRenderer", "image").bestImageURL { images.append(single) }
        images += attachment.at("postMultiImageRenderer", "images").array.compactMap {
            $0.at("backstageImageRenderer", "image").bestImageURL
        }
        let poll = attachment["pollRenderer"]
        return ChannelPost(
            id: id,
            authorName: r["authorText"].text ?? "",
            authorAvatar: r["authorThumbnail"].bestImageURL,
            text: r["contentText"].text ?? "",
            publishedText: r["publishedTimeText"].text,
            likeCountText: r["voteCount"].text,
            commentCountText: r.at("actionButtons", "commentActionButtonsRenderer", "replyButton", "buttonRenderer", "text").text,
            images: images,
            video: attachment["videoRenderer"].exists ? ItemParser.video(fromRenderer: attachment["videoRenderer"]) : nil,
            pollChoices: poll["choices"].array.compactMap { $0["text"].text },
            pollVotesText: poll["totalVotes"].text
        )
    }

    /// The `aboutChannelViewModel` anywhere in a response.
    static func about(_ json: JNode) -> ChannelAbout? {
        let model = json.findFirst("aboutChannelViewModel")
        guard model.exists else { return nil }
        let links: [ChannelAbout.Link] = model["links"].array.compactMap { entry in
            let link = entry["channelExternalLinkViewModel"]
            guard let raw = link["link"].findFirst("urlEndpoint")["url"].string ?? link["link"].text else { return nil }
            guard let url = externalURL(raw) else { return nil }
            let display = link["link"].text ?? url.host ?? raw
            return ChannelAbout.Link(title: link["title"].text ?? display, displayText: display, url: url)
        }
        func text(_ key: String) -> String? {
            guard let value = model[key].text?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
            return value
        }
        return ChannelAbout(
            description: text("description"),
            links: links,
            country: text("country"),
            subscriberCountText: text("subscriberCountText"),
            viewCountText: text("viewCountText"),
            videoCountText: text("videoCountText"),
            joinedDateText: text("joinedDateText"),
            canonicalURL: text("canonicalChannelUrl")
        )
    }

    /// YouTube wraps outside links as `youtube.com/redirect?q=<target>`.
    private static func externalURL(_ raw: String) -> URL? {
        let string = raw.hasPrefix("http") ? raw : "https://" + raw
        guard let components = URLComponents(string: string) else { return URL(string: string) }
        if components.host?.contains("youtube.com") == true, components.path.hasPrefix("/redirect"),
           let target = components.queryItems?.first(where: { $0.name == "q" })?.value, let url = URL(string: target) {
            return url
        }
        return components.url
    }
}

enum PlaylistParser {
    static func parse(_ json: JNode, playlistId: String) -> PlaylistPage {
        let header = json["header"]
        let title = header.at("pageHeaderRenderer", "pageTitle").string
            ?? header.at("playlistHeaderRenderer", "title").text
            ?? json.at("metadata", "playlistMetadataRenderer", "title").string
            ?? "Danh sách phát"
        let owner = header.at("playlistHeaderRenderer", "ownerText").text
            ?? header.at("pageHeaderRenderer", "content", "pageHeaderViewModel", "metadata")
                .findAll("text").compactMap { $0.text }.first { !$0.isEmpty }
        let content = json.at("contents", "twoColumnBrowseResultsRenderer", "tabs")[0].at("tabRenderer", "content")
        let page = ItemParser.page(content.exists ? content : json["contents"])
        let thumbnail = json.at("microformat", "microformatDataRenderer", "thumbnail").bestImageURL
            ?? page.videos.first?.thumbnail
        let countText = header.at("playlistHeaderRenderer", "numVideosText").text
        return PlaylistPage(
            playlist: PlaylistItem(id: playlistId, title: title, thumbnail: thumbnail, channelName: owner, videoCountText: countText),
            page: page
        )
    }
}

extension PlaylistParser {
    /// A mix from the watch page's playlist panel (`/next` with the playlist id).
    static func mix(_ json: JNode, playlistId: String) -> PlaylistPage {
        let panel = json.at("contents", "twoColumnWatchNextResults", "playlist", "playlist")
        var page = ItemParser.page(panel.exists ? panel["contents"] : json.findFirst("playlistPanelRenderer")["contents"])
        // Mixes never end; the panel's continuation is not a playlist page continuation.
        page.continuation = nil
        let title = panel["title"].string ?? panel["title"].text ?? "Danh sách kết hợp"
        let owner = panel["ownerName"].text ?? panel["longBylineText"].text
        return PlaylistPage(
            playlist: PlaylistItem(id: playlistId, title: title, thumbnail: page.videos.first?.thumbnail, channelName: owner,
                                   videoCountText: page.videos.isEmpty ? nil : "\(page.videos.count) video"),
            page: page
        )
    }
}

enum PlayerParser {
    static func parse(_ json: JNode, videoId: String) throws -> PlayerInfo {
        let playability = json["playabilityStatus"]
        let status = playability["status"].string ?? ""
        guard status == "OK" else {
            let error = playability.at("errorScreen", "playerErrorMessageRenderer")
            let reason = playability["reason"].string
                ?? error["reason"].text
                ?? error["subreason"].text
                ?? "Video không khả dụng (\(status.isEmpty ? "không rõ" : status))."
            if status == "LOGIN_REQUIRED" { throw InnerTubeError.loginRequired(reason) }
            throw InnerTubeError.unplayable(reason)
        }

        let details = json["videoDetails"]
        if let returned = details["videoId"].string, returned != videoId {
            throw InnerTubeError.unplayable("YouTube trả về một video khác. Vui lòng thử lại.")
        }

        let streaming = json["streamingData"]
        let adaptive = streaming["adaptiveFormats"].array.compactMap(format)
        let muxed = streaming["formats"].array.compactMap(format)
        let hls = streaming["hlsManifestUrl"].string.flatMap(URL.init(string:))
        guard hls != nil || !adaptive.isEmpty || !muxed.isEmpty else { throw InnerTubeError.noStreams }

        let tracklist = json.at("captions", "playerCaptionsTracklistRenderer")
        let captions: [CaptionTrack] = tracklist["captionTracks"].array.compactMap { track in
            guard let base = track["baseUrl"].string, let url = URL(string: base),
                  let code = track["languageCode"].string else { return nil }
            return CaptionTrack(
                name: track["name"].text ?? code,
                languageCode: code,
                baseURL: url,
                isAutoGenerated: track["kind"].string == "asr",
                isTranslatable: track["isTranslatable"].bool ?? false
            )
        }

        let expires = streaming["expiresInSeconds"].double.map { Date().addingTimeInterval($0) }
        return PlayerInfo(
            videoId: videoId,
            title: details["title"].string ?? "",
            author: details["author"].string,
            channelId: details["channelId"].string,
            lengthSeconds: details["lengthSeconds"].int,
            viewCount: details["viewCount"].int,
            shortDescription: details["shortDescription"].string,
            isLive: details["isLive"].bool ?? false,
            thumbnail: details["thumbnail"].bestImageURL,
            hlsURL: hls,
            adaptiveFormats: adaptive,
            muxedFormats: muxed,
            captions: captions,
            availableAt: Date().addingTimeInterval(prerollAdSeconds(json)),
            expiresAt: expires,
            storyboard: json.at("storyboards", "playerStoryboardSpecRenderer", "spec").string.flatMap(Storyboard.init(spec:)),
            loudnessDb: json.at("playerConfig", "audioConfig", "loudnessDb").double
        )
    }

    private static func format(_ f: JNode) -> StreamFormat? {
        // Formats with `signatureCipher` need the web player's JS to decode; skip them.
        guard let itag = f["itag"].int, let string = f["url"].string, let url = URL(string: string),
              let mime = f["mimeType"].string else { return nil }
        return StreamFormat(
            itag: itag,
            url: url,
            mimeType: mime,
            bitrate: f["bitrate"].int ?? 0,
            width: f["width"].int,
            height: f["height"].int,
            fps: f["fps"].int,
            contentLength: f["contentLength"].string.flatMap { Int64($0) },
            qualityLabel: f["qualityLabel"].string,
            audioTrackName: f.at("audioTrack", "displayName").string,
            audioTrackId: f.at("audioTrack", "id").string,
            isDefaultAudio: f.at("audioTrack", "audioIsDefault").bool ?? true
        )
    }

    /// YouTube refuses to serve the streams until a (skipped) pre-roll would have finished.
    /// Mirrors what yt-dlp does: sum the length (or skip offset) of every pre-roll ad.
    private static func prerollAdSeconds(_ json: JNode) -> TimeInterval {
        var renderers: [JNode] = []
        for placement in json["adPlacements"].array
        where placement.at("adPlacementRenderer", "config", "adPlacementConfig", "kind").string == "AD_PLACEMENT_KIND_START" {
            renderers.append(contentsOf: placement.at("adPlacementRenderer", "renderer").findAll("instreamVideoAdRenderer"))
        }
        for slot in json["adSlots"].array
        where slot.at("adSlotRenderer", "adSlotMetadata", "triggerEvent").string == "SLOT_TRIGGER_EVENT_BEFORE_CONTENT" {
            renderers.append(contentsOf: slot.findAll("instreamVideoAdRenderer"))
        }
        var total: TimeInterval = 0
        for renderer in renderers {
            if let skip = renderer["skipOffsetMilliseconds"].double {
                total += skip / 1000
            } else if let vars = renderer["playerVars"].string,
                      let length = URLComponents(string: "?" + vars)?.queryItems?
                        .first(where: { $0.name == "length_seconds" })?.value.flatMap(Double.init) {
                total += length
            }
        }
        return min(total, 120)
    }
}
