package com.dangdvd.dvdtube.core.innertube

import android.net.Uri
import com.dangdvd.dvdtube.core.AccountIdentity
import com.dangdvd.dvdtube.core.AccountNotification
import com.dangdvd.dvdtube.core.AccountPlaylistOption
import com.dangdvd.dvdtube.core.AccountProfile
import com.dangdvd.dvdtube.core.CaptionTrack
import com.dangdvd.dvdtube.core.ChannelAbout
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.ChannelLink
import com.dangdvd.dvdtube.core.ChannelPage
import com.dangdvd.dvdtube.core.ChannelTab
import com.dangdvd.dvdtube.core.Chapter
import com.dangdvd.dvdtube.core.Comment
import com.dangdvd.dvdtube.core.CommentSortOption
import com.dangdvd.dvdtube.core.CommentsPage
import com.dangdvd.dvdtube.core.CommunityPost
import com.dangdvd.dvdtube.core.ContinuationKind
import com.dangdvd.dvdtube.core.HeatMarker
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.PlayerInfo
import com.dangdvd.dvdtube.core.PostAttachment
import com.dangdvd.dvdtube.core.PostsPage
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.PlaylistPage
import com.dangdvd.dvdtube.core.Storyboard
import com.dangdvd.dvdtube.core.StreamFormat
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.parseDuration
import com.dangdvd.dvdtube.core.youtubeImage
import java.util.UUID

object WatchParser {
    fun parse(json: JNode, videoId: String): WatchInfo {
        val watch = json.at("contents", "twoColumnWatchNextResults")
        val results = watch.at("results", "results", "contents").array
        val primary = results.firstOrNull { it["videoPrimaryInfoRenderer"].exists }?.get("videoPrimaryInfoRenderer") ?: JNode.EMPTY
        val secondary = results.firstOrNull { it["videoSecondaryInfoRenderer"].exists }?.get("videoSecondaryInfoRenderer") ?: JNode.EMPTY

        val likeButton = primary["videoActions"].findFirst("likeButtonViewModel")
        val likeCount = likeButton.at(
            "toggleButtonViewModel", "toggleButtonViewModel", "defaultButtonViewModel", "buttonViewModel", "title",
        ).string ?: likeButton.findFirst("buttonViewModel")["title"].string

        val owner = secondary.at("owner", "videoOwnerRenderer")
        val channelId = owner.at("navigationEndpoint", "browseEndpoint", "browseId").string
            ?: owner["title"]["runs"][0].at("navigationEndpoint", "browseEndpoint", "browseId").string
        val channel = channelId?.let {
            ChannelItem(id = it, name = owner["title"].text ?: "", avatar = owner["thumbnail"].bestImageUrl,
                subscriberText = owner["subscriberCountText"].text)
        }

        val commentsSection = results.firstOrNull { it.at("itemSectionRenderer", "sectionIdentifier").string == "comment-item-section" }
        val commentsToken = commentsSection?.findFirst("continuationCommand")?.get("token")?.string

        var commentCount: String? = null
        var chapters = emptyList<Chapter>()
        for (panel in json["engagementPanels"].array) {
            val section = panel["engagementPanelSectionListRenderer"]
            val identifier = section["panelIdentifier"].string ?: section["targetId"].string ?: ""
            if (identifier.contains("comments")) {
                commentCount = section.at("header", "engagementPanelTitleHeaderRenderer", "contextualInfo").text
            } else if (identifier.contains("macro-markers") && chapters.isEmpty()) {
                val seen = HashSet<Int>()
                chapters = section.findAll("macroMarkersListItemRenderer").mapNotNull { marker ->
                    val title = marker["title"].text ?: return@mapNotNull null
                    val start = parseDuration(marker["timeDescription"].text) ?: return@mapNotNull null
                    if (!seen.add(start)) return@mapNotNull null
                    Chapter(title, start, marker["thumbnail"].bestImageUrl)
                }.sortedBy { it.startSeconds }
            }
        }

        // "Most replayed": an entity in the framework updates.
        val heatmap = json.at("frameworkUpdates", "entityBatchUpdate", "mutations").array
            .map { it.at("payload", "macroMarkersListEntity", "markersList") }
            .firstOrNull { it["markerType"].string == "MARKER_TYPE_HEATMAP" }
            ?.get("markers")?.array
            ?.mapNotNull { marker ->
                val start = marker["startMillis"].double ?: return@mapNotNull null
                val length = marker["durationMillis"].double ?: return@mapNotNull null
                HeatMarker(start / 1000, length / 1000, marker["intensityScoreNormalized"].double ?: 0.0)
            }
            ?.sortedBy { it.start }
            .orEmpty()

        val related = ItemParser.page(watch["secondaryResults"])
        return WatchInfo(
            videoId = videoId,
            title = primary["title"].text ?: "",
            viewCountText = primary.at("viewCount", "videoViewCountRenderer", "viewCount").text,
            shortViewCountText = primary.at("viewCount", "videoViewCountRenderer", "shortViewCount").text,
            dateText = primary["dateText"].text,
            relativeDateText = primary["relativeDateText"].text,
            likeCountText = likeCount,
            description = secondary.at("attributedDescription", "content").string ?: secondary["description"].text,
            channel = channel,
            related = related.copy(items = related.items.filter { it.videoOrNull?.id != videoId }, kind = ContinuationKind.NEXT),
            commentsToken = commentsToken,
            commentCountText = commentCount,
            chapters = chapters,
            likeStatus = primary["videoActions"].findFirst("likeStatusEntity")["likeStatus"].string,
            isSubscribed = secondary.findFirst("subscribeButtonRenderer")["subscribed"].bool,
            liveChat = LiveChatParser.info(watch),
            heatmap = heatmap,
        )
    }
}

object AccountParser {
    /** `account/account_menu` → the active account's name, handle and avatar. */
    fun profile(json: JNode): AccountProfile? {
        val header = json.findFirst("activeAccountHeaderRenderer")
        val name = header["accountName"].text ?: return null
        // "Your channel" in the menu links to the account's channel.
        val channelId = json.findAll("browseEndpoint").mapNotNull { it["browseId"].string }.firstOrNull { it.startsWith("UC") }
        return AccountProfile(
            name = name,
            handle = header["channelHandle"].text,
            email = header["email"].text,
            avatar = header["accountPhoto"].bestImageUrl,
            channelId = channelId,
        )
    }

    /**
     * Account switcher: every signed-in Google account and its brand channels.
     * `authuser`/`pageid` come from each item's sign-in URL or page id token.
     */
    fun identities(json: JNode): List<AccountIdentity> {
        val result = ArrayList<AccountIdentity>()
        val seen = HashSet<String>()
        json.findAll("accountSectionListRenderer").forEachIndexed { index, section ->
            val header = section.findFirst("googleAccountHeaderRenderer")
            val email = header["email"].text
            val items = section.findAll("accountItem") + section.findAll("accountItemRenderer")
            for (item in items) {
                val name = item["accountName"].text ?: continue
                var authUser: Int? = null
                var pageId: String? = null
                for (token in item.findAll("supportedTokens").flatMap { it.array }) {
                    token.at("pageIdToken", "pageId").string?.takeIf { it.isNotEmpty() }?.let { pageId = it }
                    token.at("accountSigninToken", "signinUrl").string?.let { signin ->
                        val uri = Uri.parse(if (signin.startsWith("/")) "https://www.youtube.com$signin" else signin)
                        uri.getQueryParameter("authuser")?.toIntOrNull()?.let { authUser = it }
                        uri.getQueryParameter("pageid")?.takeIf { it.isNotEmpty() && pageId == null }?.let { pageId = it }
                    }
                }
                val identity = AccountIdentity(
                    authUser = authUser ?: index,
                    pageId = pageId,
                    name = name,
                    byline = item["channelHandle"].text ?: item["accountByline"].text,
                    email = email ?: if (pageId == null) item["accountByline"].text else null,
                    avatar = item["accountPhoto"].bestImageUrl,
                    isSelected = item["isSelected"].bool ?: false,
                    hasChannel = item["hasChannel"].bool ?: true,
                )
                if (seen.add(identity.id)) result.add(identity)
            }
        }
        return result
    }

    fun playlistOptions(json: JNode): List<AccountPlaylistOption> =
        json.findAll("playlistAddToOptionRenderer").mapNotNull { option ->
            val id = option["playlistId"].string ?: return@mapNotNull null
            AccountPlaylistOption(id, option["title"].text ?: id, option["containsSelectedVideos"].string == "ALL")
        }

    fun notifications(json: JNode): List<AccountNotification> =
        json.findAll("notificationRenderer").mapNotNull { item ->
            val message = item["shortMessage"].text ?: return@mapNotNull null
            AccountNotification(
                id = item["notificationId"].string ?: UUID.randomUUID().toString(),
                message = message,
                timeText = item["sentTimeText"].text,
                avatar = item["thumbnail"].bestImageUrl,
                thumbnail = item["videoThumbnail"].bestImageUrl,
                videoId = item.findFirst("watchEndpoint")["videoId"].string,
                isRead = item["read"].bool ?: true,
            )
        }
}

object CommentsParser {
    fun parse(json: JNode): Pair<CommentsPage, List<CommentSortOption>> {
        val payloads = HashMap<String, JNode>()
        val toolbarStates = HashMap<String, JNode>()
        val toolbarSurfaces = HashMap<String, JNode>()
        for (mutation in json.at("frameworkUpdates", "entityBatchUpdate", "mutations").array) {
            val key = mutation["entityKey"].string ?: continue
            val payload = mutation["payload"]
            when {
                payload["commentEntityPayload"].exists -> payloads[key] = payload["commentEntityPayload"]
                payload["engagementToolbarStateEntityPayload"].exists -> toolbarStates[key] = payload["engagementToolbarStateEntityPayload"]
                payload["engagementToolbarSurfaceEntityPayload"].exists -> toolbarSurfaces[key] = payload["engagementToolbarSurfaceEntityPayload"]
            }
        }

        val items = ArrayList<JNode>()
        for (endpoint in json["onResponseReceivedEndpoints"].array) {
            for (key in endpoint.keys.sorted()) items.addAll(endpoint[key]["continuationItems"].array)
        }

        fun nonEmpty(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() && it != "0" }

        fun build(viewModel: JNode, repliesToken: String?): Comment? {
            val key = viewModel["commentKey"].string ?: return null
            val payload = payloads[key] ?: return null
            val properties = payload["properties"]
            val author = payload["author"]
            val toolbar = payload["toolbar"]
            val state = viewModel["toolbarStateKey"].string?.let { toolbarStates[it] }
            val heartState = state?.get("heartState")?.string
            val surface = viewModel["toolbarSurfaceKey"].string?.let { toolbarSurfaces[it] }
            fun action(command: String): String? =
                surface?.get(command)?.findFirst("performCommentActionEndpoint")?.get("action")?.string
            return Comment(
                id = properties["commentId"].string ?: viewModel["commentId"].string ?: key,
                authorName = author["displayName"].string ?: "",
                authorAvatar = author["avatarThumbnailUrl"].string?.let(::youtubeImage),
                authorChannelId = author["channelId"].string,
                text = properties.at("content", "content").string ?: "",
                publishedText = properties["publishedTime"].string,
                likeCountText = nonEmpty(toolbar["likeCountNotliked"].string),
                replyCountText = nonEmpty(toolbar["replyCount"].string),
                repliesToken = repliesToken,
                isPinned = viewModel["pinnedText"].exists,
                isCreator = author["isCreator"].bool ?: false,
                isHearted = heartState == "TOOLBAR_HEART_STATE_HEARTED",
                replyParams = surface?.findFirst("createReplyParams")?.string,
                likeToken = action("likeCommand"),
                unlikeToken = action("unlikeCommand"),
                dislikeToken = action("dislikeCommand"),
                undislikeToken = action("undislikeCommand"),
                likeState = when (state?.get("likeState")?.string) {
                    "TOOLBAR_LIKE_STATE_LIKED" -> "LIKED"
                    "TOOLBAR_LIKE_STATE_DISLIKED" -> "DISLIKED"
                    else -> "INDIFFERENT"
                },
                likeCountLikedText = nonEmpty(toolbar["likeCountLiked"].string),
            )
        }

        val comments = ArrayList<Comment>()
        var continuation: String? = null
        var countText: String? = null
        val sortOptions = ArrayList<CommentSortOption>()
        for (item in items) {
            when {
                item["commentsHeaderRenderer"].exists -> {
                    val header = item["commentsHeaderRenderer"]
                    countText = header["countText"].text ?: header["commentsCount"].text
                    for (option in header.findAll("subMenuItems").firstOrNull()?.array ?: emptyList()) {
                        val title = option["title"].string ?: continue
                        val token = option.findFirst("continuationCommand")["token"].string ?: continue
                        sortOptions.add(CommentSortOption(title, token))
                    }
                }
                item["commentThreadRenderer"].exists -> {
                    val thread = item["commentThreadRenderer"]
                    val repliesToken = thread.at("replies", "commentRepliesRenderer").findFirst("continuationCommand")["token"].string
                    build(thread.at("commentViewModel", "commentViewModel"), repliesToken)?.let(comments::add)
                }
                item["commentViewModel"].exists -> build(item["commentViewModel"], null)?.let(comments::add)
                item["continuationItemRenderer"].exists ->
                    continuation = item["continuationItemRenderer"].findFirst("continuationCommand")["token"].string
            }
        }
        return CommentsPage(comments, continuation, countText, json.findFirst("createCommentParams").string) to sortOptions
    }
}

object ChannelParser {
    fun parse(json: JNode, channelId: String, tab: ChannelTab): ChannelPage {
        val header = json["header"]
        val pageHeader = header.at("pageHeaderRenderer", "content", "pageHeaderViewModel")
        val legacy = header["c4TabbedHeaderRenderer"]
        val metadata = json.at("metadata", "channelMetadataRenderer")

        val name = pageHeader.at("title", "dynamicTextViewModel", "text", "content").string
            ?: header.at("pageHeaderRenderer", "pageTitle").string
            ?: legacy["title"].text
            ?: metadata["title"].string
            ?: ""
        val avatar = pageHeader.at("image", "decoratedAvatarViewModel", "avatar", "avatarViewModel", "image").bestImageUrl
            ?: legacy["avatar"].bestImageUrl
            ?: metadata["avatar"].bestImageUrl
        val banner = pageHeader.at("banner", "imageBannerViewModel", "image").bestImageUrl ?: legacy["banner"].bestImageUrl

        val parts = pageHeader.at("metadata", "contentMetadataViewModel", "metadataRows").array.flatMap { row ->
            row["metadataParts"].array.mapNotNull { it["text"].text }
        }
        val handle = parts.firstOrNull { it.startsWith("@") } ?: legacy["channelHandleText"].text
        val counts = parts.filter { !it.startsWith("@") }
        val subscribers = counts.firstOrNull() ?: legacy["subscriberCountText"].text
        val videos = counts.getOrNull(1) ?: legacy["videosCountText"].text

        val tabParams = HashMap<ChannelTab, String>()
        var selectedContent = JNode.EMPTY
        for (entry in json.at("contents", "twoColumnBrowseResultsRenderer", "tabs").array) {
            val renderer = entry["tabRenderer"]
            if (!renderer.exists) continue
            val url = renderer.findFirst("webCommandMetadata")["url"].string ?: ""
            val params = renderer.at("endpoint", "browseEndpoint", "params").string
            for (candidate in ChannelTab.entries) {
                if (params != null && candidate.urlSuffixes.any { url.endsWith("/$it") }) tabParams[candidate] = params
            }
            if (renderer["selected"].bool == true) selectedContent = renderer["content"]
        }

        return ChannelPage(
            channel = ChannelItem(metadata["externalId"].string ?: channelId, name, avatar, handle, subscribers, videos),
            banner = banner,
            description = pageHeader.at("description", "descriptionPreviewViewModel", "description", "content").string
                ?: metadata["description"].string,
            tabParams = tabParams,
            initialTab = tab,
            initialPage = ItemParser.page(selectedContent),
            aboutToken = aboutToken(header),
        )
    }

    /** The description in the header opens the "About" panel through a continuation. */
    fun aboutToken(header: JNode): String? =
        header.findAll("showEngagementPanelEndpoint").firstNotNullOfOrNull { it.findFirst("continuationCommand")["token"].string }
}

/** Posts on a channel's "Posts" (community) tab. */
object PostsParser {
    fun page(json: JNode): PostsPage {
        val seen = HashSet<String>()
        val posts = json.findAll("backstagePostRenderer").mapNotNull(::post).filter { seen.add(it.id) }
        return PostsPage(posts, ItemParser.continuation(json))
    }

    private fun post(r: JNode): CommunityPost? {
        val id = r["postId"].string ?: return null
        val attachment = r["backstageAttachment"]
        val parsed: PostAttachment? = when {
            attachment["backstageImageRenderer"].exists ->
                attachment.at("backstageImageRenderer", "image").bestImageUrl?.let { PostAttachment.Images(listOf(it)) }
            attachment["postMultiImageRenderer"].exists -> attachment.at("postMultiImageRenderer", "images").array
                .mapNotNull { it.at("backstageImageRenderer", "image").bestImageUrl }
                .takeIf { it.isNotEmpty() }?.let { PostAttachment.Images(it) }
            attachment["videoRenderer"].exists -> ItemParser.video(attachment["videoRenderer"])?.let { PostAttachment.Video(it) }
            attachment["pollRenderer"].exists -> {
                val poll = attachment["pollRenderer"]
                PostAttachment.Poll(poll["choices"].array.mapNotNull { it["text"].text }, poll["totalVotes"].text)
            }
            else -> null
        }
        return CommunityPost(
            id = id,
            authorName = r["authorText"].text ?: "",
            authorAvatar = r["authorThumbnail"].bestImageUrl,
            text = r["contentText"].text ?: "",
            publishedText = r["publishedTimeText"].text,
            likeCountText = r["voteCount"].text?.trim()?.takeIf { it.isNotEmpty() },
            commentCountText = r.at("actionButtons", "commentActionButtonsRenderer", "replyButton", "buttonRenderer", "text").text
                ?.trim()?.takeIf { it.isNotEmpty() },
            attachment = parsed,
        )
    }
}

/** The channel's "About" panel (`aboutChannelViewModel`). */
object AboutParser {
    fun parse(json: JNode): ChannelAbout? {
        val about = json.findFirst("aboutChannelViewModel")
        if (!about.exists) return null
        val links = about["links"].array.mapNotNull { entry ->
            val link = entry["channelExternalLinkViewModel"]
            val title = link["title"].text ?: return@mapNotNull null
            val display = link["link"].text
            val target = link.at("link", "commandRuns")[0].at("onTap", "innertubeCommand", "urlEndpoint", "url").string
                ?: display?.let { if (it.startsWith("http")) it else "https://$it" }
                ?: return@mapNotNull null
            ChannelLink(title, display, redirectTarget(target))
        }
        return ChannelAbout(
            description = about["description"].text,
            country = about["country"].text,
            subscriberCountText = about["subscriberCountText"].text,
            viewCountText = about["viewCountText"].text,
            videoCountText = about["videoCountText"].text,
            joinedDateText = about["joinedDateText"].text,
            channelUrl = about["canonicalChannelUrl"].text,
            links = links,
        )
    }

    /** `youtube.com/redirect?q=<target>` → the target itself. */
    private fun redirectTarget(url: String): String {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return url
        if (uri.host?.endsWith("youtube.com") == true && uri.path == "/redirect") {
            uri.getQueryParameter("q")?.let { return it }
        }
        return url
    }
}

object PlaylistParser {
    fun parse(json: JNode, playlistId: String): PlaylistPage {
        val header = json["header"]
        val title = header.at("pageHeaderRenderer", "pageTitle").string
            ?: header.at("playlistHeaderRenderer", "title").text
            ?: json.at("metadata", "playlistMetadataRenderer", "title").string
            ?: "Danh sách phát"
        val owner = header.at("playlistHeaderRenderer", "ownerText").text
            ?: header.at("pageHeaderRenderer", "content", "pageHeaderViewModel", "metadata")
                .findAll("text").mapNotNull { it.text }.firstOrNull { it.isNotEmpty() }
        val content = json.at("contents", "twoColumnBrowseResultsRenderer", "tabs")[0].at("tabRenderer", "content")
        val page = ItemParser.page(if (content.exists) content else json["contents"])
        val thumbnail = json.at("microformat", "microformatDataRenderer", "thumbnail").bestImageUrl ?: page.videos.firstOrNull()?.thumbnail
        val countText = header.at("playlistHeaderRenderer", "numVideosText").text
        return PlaylistPage(PlaylistItem(playlistId, title, thumbnail, owner, countText), page)
    }
}

object PlayerParser {
    fun parse(json: JNode, videoId: String): PlayerInfo {
        val playability = json["playabilityStatus"]
        val status = playability["status"].string ?: ""
        if (status != "OK") {
            val error = playability.at("errorScreen", "playerErrorMessageRenderer")
            val reason = playability["reason"].string
                ?: error["reason"].text
                ?: error["subreason"].text
                ?: "Video không khả dụng (${status.ifEmpty { "không rõ" }})."
            if (status == "LOGIN_REQUIRED") throw InnerTubeException.LoginRequired(reason)
            throw InnerTubeException.Unplayable(reason)
        }

        val details = json["videoDetails"]
        val returned = details["videoId"].string
        if (returned != null && returned != videoId) throw InnerTubeException.Unplayable("YouTube trả về một video khác. Vui lòng thử lại.")

        val streaming = json["streamingData"]
        val adaptive = streaming["adaptiveFormats"].array.mapNotNull(::format)
        val muxed = streaming["formats"].array.mapNotNull(::format)
        val hls = streaming["hlsManifestUrl"].string
        if (hls == null && adaptive.isEmpty() && muxed.isEmpty()) throw InnerTubeException.NoStreams()

        val captions = json.at("captions", "playerCaptionsTracklistRenderer")["captionTracks"].array.mapNotNull { track ->
            val base = track["baseUrl"].string ?: return@mapNotNull null
            val code = track["languageCode"].string ?: return@mapNotNull null
            CaptionTrack(track["name"].text ?: code, code, base, track["kind"].string == "asr", track["isTranslatable"].bool ?: false)
        }

        return PlayerInfo(
            videoId = videoId,
            title = details["title"].string ?: "",
            author = details["author"].string,
            channelId = details["channelId"].string,
            lengthSeconds = details["lengthSeconds"].int,
            viewCount = details["viewCount"].long,
            shortDescription = details["shortDescription"].string,
            isLive = details["isLive"].bool ?: false,
            thumbnail = details["thumbnail"].bestImageUrl,
            hlsUrl = hls,
            adaptiveFormats = adaptive,
            muxedFormats = muxed,
            captions = captions,
            availableAt = System.currentTimeMillis() + (prerollAdSeconds(json) * 1000).toLong(),
            storyboard = json.at("storyboards", "playerStoryboardSpecRenderer", "spec").string?.let(Storyboard::parse),
            loudnessDb = json.at("playerConfig", "audioConfig", "loudnessDb").double,
        )
    }

    private fun format(f: JNode): StreamFormat? {
        // Formats with `signatureCipher` need the web player's JS to decode; skip them.
        val itag = f["itag"].int ?: return null
        val url = f["url"].string ?: return null
        val mime = f["mimeType"].string ?: return null
        return StreamFormat(
            itag = itag,
            url = url,
            mimeType = mime,
            bitrate = f["bitrate"].int ?: 0,
            width = f["width"].int,
            height = f["height"].int,
            fps = f["fps"].int,
            contentLength = f["contentLength"].long,
            qualityLabel = f["qualityLabel"].string,
            audioTrackName = f.at("audioTrack", "displayName").string,
            isDefaultAudio = f.at("audioTrack", "audioIsDefault").bool ?: true,
            audioLanguage = f.at("audioTrack", "id").string?.substringBefore('.')?.takeIf { it.isNotEmpty() },
        )
    }

    /**
     * YouTube refuses to serve the streams until a (skipped) pre-roll would have finished.
     * Sum the length (or skip offset) of every pre-roll ad, like yt-dlp.
     */
    private fun prerollAdSeconds(json: JNode): Double {
        val renderers = ArrayList<JNode>()
        for (placement in json["adPlacements"].array) {
            if (placement.at("adPlacementRenderer", "config", "adPlacementConfig", "kind").string == "AD_PLACEMENT_KIND_START") {
                renderers.addAll(placement.at("adPlacementRenderer", "renderer").findAll("instreamVideoAdRenderer"))
            }
        }
        for (slot in json["adSlots"].array) {
            if (slot.at("adSlotRenderer", "adSlotMetadata", "triggerEvent").string == "SLOT_TRIGGER_EVENT_BEFORE_CONTENT") {
                renderers.addAll(slot.findAll("instreamVideoAdRenderer"))
            }
        }
        var total = 0.0
        for (renderer in renderers) {
            val skip = renderer["skipOffsetMilliseconds"].double
            if (skip != null) {
                total += skip / 1000
            } else {
                val vars = renderer["playerVars"].string ?: continue
                Uri.parse("https://x/?$vars").getQueryParameter("length_seconds")?.toDoubleOrNull()?.let { total += it }
            }
        }
        return minOf(total, 120.0)
    }
}
