package com.dangdvd.dvdtube.core.innertube

import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.FeedPage
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.formatDuration
import com.dangdvd.dvdtube.core.parseDuration
import org.json.JSONArray
import org.json.JSONObject

/**
 * Turns arbitrary InnerTube trees (search, browse, related, continuations) into feed items.
 * Rather than hard-coding the nesting of every page type, the parser walks the whole tree and
 * recognises the renderers that represent videos, channels, playlists and Shorts.
 */
object ItemParser {
    private val skippedKeys = setOf(
        "responseContext", "header", "topbar", "microformat", "frameworkUpdates", "playerOverlays",
        "menu", "thumbnailOverlays", "trackingParams", "loggingDirectives", "accessibility",
        "engagementPanels", "commandMetadata", "metadata",
        "richThumbnail", "channelThumbnailSupportedRenderers", "endScreen", "cards",
        "searchPyvRenderer", "adSlotRenderer", "promotedSparklesWebRenderer", "statementBannerRenderer",
    )

    private val videoKeys = setOf(
        "videoRenderer", "compactVideoRenderer", "gridVideoRenderer", "playlistVideoRenderer",
        "playlistPanelVideoRenderer", "videoWithContextRenderer", "endScreenVideoRenderer",
    )

    private val shelfKeys = setOf(
        "reelShelfRenderer", "gridShelfViewModel", "richShelfRenderer", "shelfRenderer",
        "horizontalCardListRenderer", "expandedShelfContentsRenderer",
    )

    fun page(node: JNode): FeedPage {
        val items = items(node)
        return FeedPage(items, continuation(node), message = if (items.isEmpty()) emptyMessage(node) else null)
    }

    /** Text of the notice YouTube shows instead of a feed. */
    fun emptyMessage(node: JNode): String? {
        for (key in listOf("feedNudgeRenderer", "backgroundPromoRenderer", "messageRenderer", "emptyStateViewModel")) {
            val renderer = node.findFirst(key)
            if (!renderer.exists) continue
            val parts = listOf(renderer["title"], renderer["subtitle"], renderer["text"], renderer["bodyText"])
                .mapNotNull { it.text?.trim()?.ifEmpty { null } }
            if (parts.isNotEmpty()) return parts.joinToString("\n")
        }
        return null
    }

    fun items(node: JNode): List<FeedItem> {
        val result = ArrayList<FeedItem>()
        walk(node.raw, result)
        val seen = HashSet<String>()
        // The same video sometimes appears twice (e.g. in a shelf and in the list).
        return result.filter { seen.add(it.key) }
    }

    fun continuation(node: JNode): String? {
        for (renderer in node.findAll("continuationItemRenderer").asReversed()) {
            renderer.findFirst("continuationCommand")["token"].string?.let { return it }
        }
        return null
    }

    private fun walk(value: Any?, result: MutableList<FeedItem>) {
        if (value is JSONArray) {
            for (i in 0 until value.length()) walk(value.opt(i), result)
            return
        }
        val dict = value as? JSONObject ?: return
        for (key in dict.keys().asSequence().sorted()) {
            if (key in skippedKeys) continue
            val child = JNode(dict.opt(key))
            if (key in videoKeys) {
                video(child)?.let { result.add(FeedItem.Video(it)) }
                continue
            }
            when (key) {
                "lockupViewModel" -> { lockup(child)?.let(result::add); continue }
                "shortsLockupViewModel" -> { shortFromLockup(child)?.let { result.add(FeedItem.Video(it)) }; continue }
                "reelItemRenderer" -> { shortFromReel(child)?.let { result.add(FeedItem.Video(it)) }; continue }
                "channelRenderer", "gridChannelRenderer" -> { channel(child)?.let { result.add(FeedItem.Channel(it)) }; continue }
                "playlistRenderer", "gridPlaylistRenderer", "compactPlaylistRenderer", "radioRenderer", "compactRadioRenderer" -> {
                    playlist(child)?.let { result.add(FeedItem.Playlist(it)) }
                    continue
                }
            }
            if (key in shelfKeys) {
                val inner = ArrayList<FeedItem>()
                walk(child.raw, inner)
                val shorts = inner.mapNotNull { it.videoOrNull }.filter { it.isShort }
                if (shorts.isNotEmpty() && shorts.size == inner.size) result.add(FeedItem.Shorts(shorts)) else result.addAll(inner)
                continue
            }
            walk(child.raw, result)
        }
    }

    // MARK: Renderers

    fun video(r: JNode): VideoItem? {
        val id = r["videoId"].string ?: return null
        val owner = listOf(r["ownerText"], r["longBylineText"], r["shortBylineText"]).firstOrNull { it.text != null }
        val channelId = owner?.get("runs")?.array?.firstNotNullOfOrNull { it.at("navigationEndpoint", "browseEndpoint", "browseId").string }

        var durationText = r["lengthText"].text
        var isLive = false
        var isShort = r.at("navigationEndpoint", "reelWatchEndpoint").exists
        for (overlay in r["thumbnailOverlays"].array) {
            val status = overlay["thumbnailOverlayTimeStatusRenderer"]
            if (!status.exists) continue
            when (status["style"].string) {
                "LIVE" -> isLive = true
                "SHORTS" -> isShort = true
                else -> if (durationText == null) durationText = status["text"].text
            }
        }
        for (badge in r["badges"].array) {
            if (badge.at("metadataBadgeRenderer", "style").string == "BADGE_STYLE_TYPE_LIVE_NOW") isLive = true
        }

        val avatar = r.at("channelThumbnailSupportedRenderers", "channelThumbnailWithLinkRenderer", "thumbnail").bestImageUrl
            ?: r["channelThumbnail"].bestImageUrl

        var views = r["shortViewCountText"].text ?: r["viewCountText"].text
        var published = r["publishedTimeText"].text
        if (views == null) {
            // playlistVideoRenderer: "1,2 Tr lượt xem • 2 năm trước" split into runs.
            val parts = r["videoInfo"]["runs"].array.mapNotNull { it["text"].string }.filter { it.trim().length > 1 }
            views = parts.firstOrNull()
            if (published == null && parts.size > 1) published = parts[1]
        }

        return VideoItem(
            id = id,
            title = r["title"].text ?: r["headline"].text ?: "",
            channelName = owner?.text,
            channelId = channelId,
            channelAvatar = avatar,
            thumbnail = r["thumbnail"].bestImageUrl,
            durationText = if (isLive) null else durationText,
            durationSeconds = r["lengthSeconds"].int ?: parseDuration(durationText),
            viewCountText = views,
            publishedText = published,
            isLive = isLive,
            isShort = isShort,
        )
    }

    private val durationPattern = Regex("^\\d+(:\\d{2})+$")

    fun lockup(r: JNode): FeedItem? {
        val id = r["contentId"].string ?: return null
        val type = r["contentType"].string ?: ""
        val meta = r.at("metadata", "lockupMetadataViewModel")
        val title = meta["title"].text ?: ""
        val rows = meta.at("metadata", "contentMetadataViewModel", "metadataRows").array.map { row ->
            row["metadataParts"].array.mapNotNull { it["text"].text?.trim()?.ifEmpty { null } }
        }.filter { it.isNotEmpty() }

        val avatarNode = meta.at("image", "decoratedAvatarViewModel")
        val avatar = avatarNode.at("avatar", "avatarViewModel", "image").bestImageUrl
        val channelId = avatarNode.findFirst("browseEndpoint")["browseId"].string

        val image = r["contentImage"]
        val thumbnail = image.findFirst("thumbnailViewModel")["image"].bestImageUrl
            ?: image.findFirst("primaryThumbnail").findFirst("image").bestImageUrl
        val badges = image.findAll("thumbnailBadgeViewModel")
        val badgeTexts = badges.mapNotNull { it["text"].string }

        if (type.contains("PLAYLIST") || type.contains("ALBUM") || type.contains("PODCAST")) {
            return FeedItem.Playlist(
                PlaylistItem(
                    id = id,
                    title = title,
                    thumbnail = thumbnail,
                    channelName = rows.firstOrNull()?.firstOrNull(),
                    videoCountText = badgeTexts.firstOrNull { text -> text.any { it.isDigit() } },
                ),
            )
        }
        if (type.isNotEmpty() && !type.contains("VIDEO")) return null

        val channelName: String?
        val parts: List<String>
        if (rows.size >= 2) {
            channelName = rows[0].joinToString(" • ")
            parts = rows[1]
        } else {
            channelName = null
            parts = rows.firstOrNull() ?: emptyList()
        }
        val duration = badgeTexts.firstOrNull { durationPattern.matches(it) }
        val isLive = badges.any { (it["badgeStyle"].string ?: "").contains("LIVE") }

        return FeedItem.Video(
            VideoItem(
                id = id,
                title = title,
                channelName = channelName,
                channelId = channelId,
                channelAvatar = avatar,
                thumbnail = thumbnail,
                durationText = duration,
                durationSeconds = parseDuration(duration),
                viewCountText = parts.firstOrNull(),
                publishedText = parts.getOrNull(1),
                isLive = isLive,
            ),
        )
    }

    fun shortFromLockup(r: JNode): VideoItem? {
        val endpoint = r.findFirst("reelWatchEndpoint")
        var id = endpoint["videoId"].string
        if (id == null) {
            val entity = r["entityId"].string
            if (entity != null && entity.contains("shorts-shelf-item-")) id = entity.substringAfter("shorts-shelf-item-")
        }
        id ?: return null
        val image = if (r.at("thumbnailViewModel", "thumbnailViewModel", "image").exists) {
            r.at("thumbnailViewModel", "thumbnailViewModel", "image")
        } else {
            r.at("thumbnailViewModel", "image")
        }
        var title = r.at("overlayMetadata", "primaryText").text
        if (title == null) {
            r["accessibilityText"].string?.let { title = it.split(", ").dropLast(1).joinToString(", ") }
        }
        return VideoItem(
            id = id,
            title = title ?: "",
            thumbnail = image.bestImageUrl ?: endpoint["thumbnail"].bestImageUrl,
            viewCountText = r.at("overlayMetadata", "secondaryText").text,
            isShort = true,
        )
    }

    fun shortFromReel(r: JNode): VideoItem? {
        val id = r["videoId"].string ?: return null
        return VideoItem(id = id, title = r["headline"].text ?: "", thumbnail = r["thumbnail"].bestImageUrl,
            viewCountText = r["viewCountText"].text, isShort = true)
    }

    fun channel(r: JNode): ChannelItem? {
        val id = r["channelId"].string ?: return null
        val subscriberCount = r["subscriberCountText"].text
        val videoCount = r["videoCountText"].text
        // Newer layouts put the @handle in `subscriberCountText` and the count in `videoCountText`.
        val isHandle = subscriberCount?.startsWith("@") == true
        return ChannelItem(
            id = id,
            name = r["title"].text ?: "",
            avatar = r["thumbnail"].bestImageUrl,
            handle = if (isHandle) subscriberCount else null,
            subscriberText = if (isHandle) videoCount else subscriberCount,
            videoCountText = if (isHandle) null else videoCount,
        )
    }

    fun playlist(r: JNode): PlaylistItem? {
        val id = r["playlistId"].string ?: return null
        val thumbnail = r["thumbnails"][0].bestImageUrl
            ?: r["thumbnail"].bestImageUrl
            ?: r["thumbnailRenderer"].findFirst("thumbnail").bestImageUrl
        var count = r["videoCountText"].text ?: r["videoCountShortText"].text
        if (count == null) r["videoCount"].string?.let { count = "$it video" }
        return PlaylistItem(
            id = id,
            title = r["title"].text ?: "",
            thumbnail = thumbnail,
            channelName = r["shortBylineText"].text ?: r["longBylineText"].text,
            videoCountText = count,
        )
    }

    /** Items of the YouTube Charts endpoint (`videoViews`). */
    fun chartVideos(node: JNode): List<VideoItem> {
        val list = node.findAll("videoViews").firstOrNull { it.array.isNotEmpty() } ?: return emptyList()
        return list.array.mapNotNull { v ->
            val id = v["id"].string ?: return@mapNotNull null
            if (v["isAvailable"].bool == false) return@mapNotNull null
            val artists = v["artists"].array.mapNotNull { it["name"].string }.joinToString(", ")
            val seconds = v["videoDuration"].int
            VideoItem(
                id = id,
                title = v["title"].string ?: "",
                channelName = artists.ifEmpty { v["channelName"].string },
                channelId = v["externalChannelId"].string,
                thumbnail = v["thumbnail"].bestImageUrl,
                durationText = seconds?.let(::formatDuration),
                durationSeconds = seconds,
                viewCountText = v.at("chartEntryMetadata", "currentPosition").int?.let { "#$it thịnh hành" },
            )
        }
    }
}
