package com.dangdvd.dvdtube.core

import kotlinx.serialization.Serializable
import java.util.Locale
import java.util.UUID

@Serializable
data class VideoItem(
    val id: String,
    val title: String = "",
    val channelName: String? = null,
    val channelId: String? = null,
    val channelAvatar: String? = null,
    val thumbnail: String? = null,
    val durationText: String? = null,
    val durationSeconds: Int? = null,
    val viewCountText: String? = null,
    val publishedText: String? = null,
    /** Epoch milliseconds. */
    val publishedDate: Long? = null,
    val isLive: Boolean = false,
    val isShort: Boolean = false,
) {
    /** A good-looking 16:9 thumbnail even when the API only returned a 4:3 one. */
    val displayThumbnail: String get() = thumbnail ?: "https://i.ytimg.com/vi/$id/hqdefault.jpg"

    val shortsThumbnail: String
        get() = if (isShort && thumbnail != null) thumbnail else "https://i.ytimg.com/vi/$id/oardefault.jpg"

    val shareUrl: String get() = if (isShort) "https://youtube.com/shorts/$id" else "https://youtu.be/$id"

    /** "Channel • 1,2 Tr lượt xem • 2 ngày trước" */
    val metadataLine: String
        get() = listOf(channelName, viewCountText, publishedText)
            .mapNotNull { it?.trim()?.ifEmpty { null } }
            .joinToString(" • ")
}

@Serializable
data class ChannelItem(
    val id: String,
    val name: String = "",
    val avatar: String? = null,
    val handle: String? = null,
    val subscriberText: String? = null,
    val videoCountText: String? = null,
)

@Serializable
data class PlaylistItem(
    val id: String,
    val title: String = "",
    val thumbnail: String? = null,
    val channelName: String? = null,
    val videoCountText: String? = null,
)

sealed class FeedItem {
    abstract val key: String

    data class Video(val video: VideoItem) : FeedItem() {
        override val key get() = "v-" + video.id
    }

    data class Channel(val channel: ChannelItem) : FeedItem() {
        override val key get() = "c-" + channel.id
    }

    data class Playlist(val playlist: PlaylistItem) : FeedItem() {
        override val key get() = "p-" + playlist.id
    }

    data class Shorts(val items: List<VideoItem>) : FeedItem() {
        override val key get() = "s-" + (items.firstOrNull()?.id ?: "empty")
    }

    val videoOrNull: VideoItem? get() = (this as? Video)?.video
}

/** Which endpoint a continuation token belongs to. */
enum class ContinuationKind { BROWSE, SEARCH, NEXT }

data class FeedPage(
    val items: List<FeedItem>,
    val continuation: String? = null,
    val kind: ContinuationKind = ContinuationKind.BROWSE,
    /** YouTube's own explanation when a page has no items. */
    val message: String? = null,
) {
    val videos: List<VideoItem>
        get() = items.flatMap {
            when (it) {
                is FeedItem.Video -> listOf(it.video)
                is FeedItem.Shorts -> it.items
                else -> emptyList()
            }
        }

    companion object {
        val EMPTY = FeedPage(emptyList())
    }
}

data class Chapter(val title: String, val startSeconds: Int, val thumbnail: String?)

/** One slice of YouTube's "Most replayed" graph: how often that part is rewatched (0…1). */
data class HeatMarker(val start: Double, val duration: Double, val intensity: Double)

/** Where the watch page's chat starts ("Top chat" / "Live chat", or their replays). */
data class LiveChatInfo(val modes: List<Mode>, val isReplay: Boolean) {
    data class Mode(val title: String, val continuation: String)
}

/** Everything shown below the player on the watch page (from the `next` endpoint). */
data class WatchInfo(
    val videoId: String,
    val title: String,
    val viewCountText: String?,
    val shortViewCountText: String?,
    val dateText: String?,
    val relativeDateText: String?,
    val likeCountText: String?,
    val description: String?,
    val channel: ChannelItem?,
    val related: FeedPage,
    val commentsToken: String?,
    val commentCountText: String?,
    val chapters: List<Chapter>,
    /** Signed-in state from YouTube: "LIKE", "DISLIKE" or "INDIFFERENT". */
    val likeStatus: String?,
    val isSubscribed: Boolean?,
    val liveChat: LiveChatInfo?,
    val heatmap: List<HeatMarker> = emptyList(),
)

data class AccountPlaylistOption(val id: String, val title: String, val containsVideo: Boolean)

data class AccountNotification(
    val id: String,
    val message: String,
    val timeText: String?,
    val avatar: String?,
    val thumbnail: String?,
    val videoId: String?,
    val isRead: Boolean,
)

@Serializable
data class AccountProfile(
    val name: String,
    val handle: String? = null,
    val email: String? = null,
    val avatar: String? = null,
    /** The account's own channel (UC…), when it has one. */
    val channelId: String? = null,
)

/** One entry of the account switcher: a Google account or one of its brand channels. */
data class AccountIdentity(
    val authUser: Int,
    val pageId: String?,
    val name: String,
    val byline: String?,
    val email: String?,
    val avatar: String?,
    val isSelected: Boolean,
    val hasChannel: Boolean,
) {
    val id: String get() = "$authUser|${pageId ?: ""}"
    val isBrandAccount: Boolean get() = pageId != null
}

data class Comment(
    val id: String,
    val authorName: String,
    val authorAvatar: String?,
    val authorChannelId: String?,
    val text: String,
    val publishedText: String?,
    val likeCountText: String?,
    val replyCountText: String?,
    val repliesToken: String?,
    val isPinned: Boolean,
    val isCreator: Boolean,
    val isHearted: Boolean,
    /** Present when signed in: lets the account reply to this comment. */
    val replyParams: String?,
    /** Present when signed in: `comment/perform_comment_action` tokens. */
    val likeToken: String? = null,
    val unlikeToken: String? = null,
    val dislikeToken: String? = null,
    val undislikeToken: String? = null,
    /** "LIKED", "DISLIKED" or "INDIFFERENT" for the signed-in account. */
    val likeState: String = "INDIFFERENT",
    /** Like count as YouTube shows it once the account has liked the comment. */
    val likeCountLikedText: String? = null,
)

data class CommentsPage(
    val comments: List<Comment>,
    val continuation: String?,
    val countText: String?,
    /** Present when signed in: lets the account post a new comment. */
    val createParams: String?,
)

data class CommentSortOption(val title: String, val token: String)

enum class ChannelTab(val title: String, val defaultParams: String) {
    VIDEOS("Video", "EgZ2aWRlb3PyBgQKAjoA"),
    SHORTS("Shorts", "EgZzaG9ydHPyBgUKA5oBAA%3D%3D"),
    STREAMS("Trực tiếp", "EgdzdHJlYW1z8gYECgJ6AA%3D%3D"),
    PLAYLISTS("Danh sách phát", "EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA"),
    POSTS("Bài đăng", "Egljb21tdW5pdHnyBgQKAkoA"),
    ABOUT("Giới thiệu", "EgVhYm91dPIGBAoCEgA%3D");

    val urlSuffix: String get() = name.lowercase(Locale.ROOT)

    /** The tab's URL endings on youtube.com (`/posts` used to be `/community`). */
    val urlSuffixes: List<String>
        get() = when (this) {
            POSTS -> listOf("posts", "community")
            else -> listOf(urlSuffix)
        }

    companion object {
        /** Browse params of a channel's own search. */
        const val SEARCH_PARAMS = "EgZzZWFyY2jyBgQKAloA"
    }
}

data class ChannelPage(
    val channel: ChannelItem,
    val banner: String?,
    val description: String?,
    val tabParams: Map<ChannelTab, String>,
    val initialTab: ChannelTab,
    val initialPage: FeedPage,
    /** Continuation that loads the channel's "About" panel (from the header's description). */
    val aboutToken: String? = null,
)

/** What a community post shows below its text. */
sealed class PostAttachment {
    data class Images(val urls: List<String>) : PostAttachment()
    data class Video(val video: VideoItem) : PostAttachment()
    data class Poll(val choices: List<String>, val totalVotes: String?) : PostAttachment()
}

/** A post on a channel's "Posts" (community) tab. */
data class CommunityPost(
    val id: String,
    val authorName: String,
    val authorAvatar: String?,
    val text: String,
    val publishedText: String?,
    val likeCountText: String?,
    val commentCountText: String?,
    val attachment: PostAttachment?,
)

data class PostsPage(val posts: List<CommunityPost>, val continuation: String?)

data class ChannelLink(val title: String, val displayUrl: String?, val url: String)

/** The channel's "About" panel. */
data class ChannelAbout(
    val description: String?,
    val country: String?,
    val subscriberCountText: String?,
    val viewCountText: String?,
    val videoCountText: String?,
    val joinedDateText: String?,
    val channelUrl: String?,
    val links: List<ChannelLink>,
)

data class PlaylistPage(val playlist: PlaylistItem, val page: FeedPage)

data class CaptionTrack(
    val name: String,
    val languageCode: String,
    val baseUrl: String,
    val isAutoGenerated: Boolean,
    val isTranslatable: Boolean,
) {
    val id: String get() = languageCode + if (isAutoGenerated) "-asr" else ""
}

data class StreamFormat(
    val itag: Int,
    val url: String,
    val mimeType: String,
    val bitrate: Int,
    val width: Int?,
    val height: Int?,
    val fps: Int?,
    val contentLength: Long?,
    val qualityLabel: String?,
    val audioTrackName: String?,
    val isDefaultAudio: Boolean,
    /** Language of a dubbed / alternative audio track ("en", "vi"…), from `audioTrack.id`. */
    val audioLanguage: String? = null,
) {
    val isVideo: Boolean get() = mimeType.startsWith("video/")
    val isAudio: Boolean get() = mimeType.startsWith("audio/")
    val isH264: Boolean get() = mimeType.contains("avc1")
    val isAAC: Boolean get() = mimeType.contains("mp4a")
}

/** Result of the player endpoint: what can actually be played. */
data class PlayerInfo(
    val videoId: String,
    val title: String,
    val author: String?,
    val channelId: String?,
    val lengthSeconds: Int?,
    val viewCount: Long?,
    val shortDescription: String?,
    val isLive: Boolean,
    val thumbnail: String?,
    val hlsUrl: String?,
    val adaptiveFormats: List<StreamFormat>,
    val muxedFormats: List<StreamFormat>,
    val captions: List<CaptionTrack>,
    /** Streams only work after this moment (server-side pre-roll ad wait), epoch ms. */
    val availableAt: Long,
    val storyboard: Storyboard?,
    /** How much louder than YouTube's reference level the audio is (dB), for "Stable volume". */
    val loudnessDb: Double? = null,
) {
    val bestAudio: StreamFormat?
        get() = adaptiveFormats.filter { it.isAudio && it.isAAC && it.isDefaultAudio }.maxByOrNull { it.bitrate }
            ?: adaptiveFormats.filter { it.isAudio && it.isAAC }.maxByOrNull { it.bitrate }

    fun bestVideo(maxHeight: Int): StreamFormat? {
        val h264 = adaptiveFormats.filter { it.isVideo && it.isH264 }
        return h264.filter { (it.height ?: 0) <= maxHeight }
            .maxWithOrNull(compareBy<StreamFormat>({ it.height ?: 0 }, { it.bitrate }))
            ?: h264.minByOrNull { it.height ?: 0 }
    }

    fun asVideoItem(): VideoItem = VideoItem(
        id = videoId, title = title, channelName = author, channelId = channelId,
        thumbnail = thumbnail, durationText = lengthSeconds?.let(::formatDuration),
        durationSeconds = lengthSeconds, isLive = isLive,
    )
}

/**
 * Sprite sheets of small frames used for the preview while scrubbing.
 * Spec format: `baseURL|w#h#count#cols#rows#intervalMs#name#sigh|…` (one entry per level).
 */
data class Storyboard(
    val baseUrl: String,
    val level: Int,
    val width: Int,
    val height: Int,
    val count: Int,
    val columns: Int,
    val rows: Int,
    val intervalMs: Int,
    val name: String,
    val signature: String,
) {
    data class Frame(val url: String, val x: Int, val y: Int, val width: Int, val height: Int)

    fun frame(seconds: Double, duration: Double): Frame {
        val interval = if (intervalMs > 0) intervalMs.toDouble() else maxOf(duration * 1000 / count, 1.0)
        val index = (seconds * 1000 / interval).toInt().coerceIn(0, count - 1)
        val perSheet = columns * rows
        val sheet = index / perSheet
        val position = index % perSheet
        val sheetName = name.replace("\$M", sheet.toString())
        val url = baseUrl.replace("\$L", level.toString()).replace("\$N", sheetName) + "&sigh=" + signature
        return Frame(url, (position % columns) * width, (position / columns) * height, width, height)
    }

    companion object {
        fun parse(spec: String): Storyboard? {
            val parts = spec.split("|")
            if (parts.size <= 1) return null
            // The last level has the largest frames.
            val fields = parts.last().split("#")
            if (fields.size < 8) return null
            val width = fields[0].toIntOrNull() ?: return null
            val height = fields[1].toIntOrNull() ?: return null
            val count = fields[2].toIntOrNull() ?: return null
            val columns = fields[3].toIntOrNull() ?: return null
            val rows = fields[4].toIntOrNull() ?: return null
            val interval = fields[5].toIntOrNull() ?: return null
            if (width <= 0 || height <= 0 || count <= 0 || columns <= 0 || rows <= 0) return null
            return Storyboard(parts[0], parts.size - 2, width, height, count, columns, rows, interval, fields[6], fields[7])
        }
    }
}

data class SponsorSegment(val start: Double, val end: Double, val category: String)

@Serializable
data class HistoryEntry(
    val video: VideoItem,
    val watchedAt: Long,
    val position: Double,
    val duration: Double,
) {
    val progress: Double get() = if (duration > 0) (position / duration).coerceIn(0.0, 1.0) else 0.0
}

@Serializable
data class LocalPlaylist(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val videos: List<VideoItem> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
)

fun formatDuration(seconds: Int): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
}

fun formatTime(seconds: Double): String =
    if (!seconds.isFinite() || seconds < 0) "0:00" else formatDuration(seconds.toInt())

/** Parses "1:02:03" / "12:16" into seconds. */
fun parseDuration(text: String?): Int? {
    if (text == null) return null
    val parts = text.split(":").map { it.trim().toIntOrNull() ?: return null }
    if (parts.isEmpty() || parts.size > 3) return null
    return parts.fold(0) { acc, value -> acc * 60 + value }
}
