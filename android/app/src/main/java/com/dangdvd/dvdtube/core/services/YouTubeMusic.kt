package com.dangdvd.dvdtube.core.services

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.ParentalControls
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.parseDuration
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject

/** Tabs of the music search ("Bài hát / Video / Album / Nghệ sĩ / Danh sách phát"). */
enum class MusicFilter(val title: String, val params: String) {
    SONGS("Bài hát", "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
    VIDEOS("Video", "EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D"),
    ALBUMS("Album", "EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D"),
    ARTISTS("Nghệ sĩ", "EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D"),
    PLAYLISTS("Danh sách phát", "EgeKAQQoAEABagoQAxAEEAoQCRAF"),
}

/** One row / card of YouTube Music. */
data class MusicItem(
    val kind: Kind,
    val title: String,
    val subtitle: String,
    val thumbnail: String?,
    val videoId: String? = null,
    val browseId: String? = null,
    val playlistId: String? = null,
    val artists: String? = null,
    val artistId: String? = null,
    val album: String? = null,
    val durationText: String? = null,
) {
    enum class Kind { SONG, VIDEO, ALBUM, ARTIST, PLAYLIST }

    val key: String get() = kind.name + ":" + (videoId ?: browseId ?: playlistId ?: title)

    val isPlayable: Boolean get() = videoId != null && (kind == Kind.SONG || kind == Kind.VIDEO)

    fun asVideo(): VideoItem? {
        val id = videoId ?: return null
        return VideoItem(
            id = id,
            title = title,
            channelName = artists ?: subtitle.substringBefore(" • ").ifEmpty { null },
            channelId = artistId,
            thumbnail = thumbnail,
            durationText = durationText,
            durationSeconds = parseDuration(durationText),
        )
    }
}

data class MusicSection(val title: String?, val items: List<MusicItem>)

/** A music search result, album or artist page. */
data class MusicPage(val title: String?, val subtitle: String?, val thumbnail: String?, val sections: List<MusicSection>) {
    val songs: List<VideoItem> get() = sections.flatMap { it.items }.filter { it.isPlayable }.mapNotNull { it.asVideo() }.distinctBy { it.id }
}

data class LyricLine(val startMs: Long, val endMs: Long?, val text: String)

/** Plain lyrics, their source line and (when YouTube has them) timed lines for karaoke highlighting. */
data class Lyrics(val text: String, val source: String?, val lines: List<LyricLine>) {
    val isTimed: Boolean get() = lines.isNotEmpty()
}

/**
 * YouTube Music through its web client (WEB_REMIX): lyrics, music search, album and artist pages.
 * Radio ("Radio từ bài này") uses the regular mix of the web client (`RDAMVM<videoId>`).
 */
object YouTubeMusic {
    private val lyricsCache = object : LinkedHashMap<String, Lyrics?>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Lyrics?>?): Boolean = size > 60
    }
    private val durationPattern = Regex("^\\d+(:\\d{2})+$")

    // MARK: Lyrics

    /** Lyrics of [videoId] (null when YouTube Music has none). Cached per video. */
    suspend fun lyrics(videoId: String): Lyrics? {
        synchronized(lyricsCache) { if (lyricsCache.containsKey(videoId)) return lyricsCache[videoId] }
        val next = InnerTube.music("next", JSONObject().put("videoId", videoId).put("isAudioOnly", true))
        val browseId = next.findAll("tabRenderer").firstNotNullOfOrNull { tab ->
            tab.at("endpoint", "browseEndpoint", "browseId").string?.takeIf { it.startsWith("MPLYt") }
        }
        val result = if (browseId == null) null else parseLyrics(InnerTube.music("browse", JSONObject().put("browseId", browseId)))
        Log.debug("lyrics $videoId: ${if (result == null) "none" else if (result.isTimed) "timed (${result.lines.size} lines)" else "plain"}")
        synchronized(lyricsCache) { lyricsCache[videoId] = result }
        return result
    }

    private fun parseLyrics(page: JNode): Lyrics? {
        val shelves = page.at("contents", "sectionListRenderer", "contents").array
            .map { it["musicDescriptionShelfRenderer"] }.filter { it.exists }
            .ifEmpty { page.findAll("musicDescriptionShelfRenderer") }
        val shelf = shelves.firstOrNull()
        val text = shelf?.get("description")?.get("runs")?.array?.mapNotNull { it["text"].string }?.joinToString("")?.trim().orEmpty()
        val source = shelf?.get("footer")?.get("runs")?.array?.mapNotNull { it["text"].string }?.joinToString("")?.trim()?.ifEmpty { null }
        val lines = timedLines(page.raw)
        if (text.isEmpty() && lines.isEmpty()) return null
        return Lyrics(text.ifEmpty { lines.joinToString("\n") { it.text } }, source, lines)
    }

    /** Any array of `{lyricLine, cueRange:{startTimeMilliseconds}}` objects (timed lyrics). */
    private fun timedLines(value: Any?): List<LyricLine> {
        when (value) {
            is JSONArray -> {
                val nodes = JNode(value).array
                val looksTimed = nodes.isNotEmpty() && nodes.any { it["lyricLine"].exists && it.at("cueRange", "startTimeMilliseconds").exists }
                if (looksTimed) {
                    return nodes.mapNotNull { node ->
                        val start = node.at("cueRange", "startTimeMilliseconds").long ?: return@mapNotNull null
                        LyricLine(start, node.at("cueRange", "endTimeMilliseconds").long, node["lyricLine"].text ?: "")
                    }.sortedBy { it.startMs }
                }
                for (index in 0 until value.length()) {
                    val found = timedLines(value.opt(index))
                    if (found.isNotEmpty()) return found
                }
            }
            is JSONObject -> {
                val keys = value.keys()
                while (keys.hasNext()) {
                    val found = timedLines(value.opt(keys.next()))
                    if (found.isNotEmpty()) return found
                }
            }
        }
        return emptyList()
    }

    // MARK: Search & pages

    suspend fun search(query: String, filter: MusicFilter): MusicPage {
        val json = InnerTube.music("search", JSONObject().put("query", query).put("params", filter.params))
        val fallback = when (filter) {
            MusicFilter.SONGS -> MusicItem.Kind.SONG
            MusicFilter.VIDEOS -> MusicItem.Kind.VIDEO
            MusicFilter.ALBUMS -> MusicItem.Kind.ALBUM
            MusicFilter.ARTISTS -> MusicItem.Kind.ARTIST
            MusicFilter.PLAYLISTS -> MusicItem.Kind.PLAYLIST
        }
        val page = page(json, fallback)
        Log.debug("music search (${filter.name}): ${page.sections.sumOf { it.items.size }} items")
        return page
    }

    /** An album (`MPRE…`), artist (`UC…`) or playlist (`VL…`) page. */
    suspend fun browse(browseId: String): MusicPage {
        val json = InnerTube.music("browse", JSONObject().put("browseId", browseId))
        val page = page(json, if (browseId.startsWith("MPRE")) MusicItem.Kind.SONG else null)
        // Album tracks have neither artwork nor (often) the artist: take them from the header.
        return page.copy(sections = page.sections.map { section ->
            section.copy(items = section.items.map { item ->
                if (item.kind == MusicItem.Kind.SONG || item.kind == MusicItem.Kind.VIDEO) {
                    item.copy(
                        thumbnail = item.thumbnail ?: page.thumbnail,
                        artists = item.artists ?: page.subtitle?.substringBefore(" • ")?.ifEmpty { null },
                    )
                } else {
                    item
                }
            })
        })
    }

    private fun page(json: JNode, fallback: MusicItem.Kind?): MusicPage {
        val sections = ArrayList<MusicSection>()
        collectShelves(json.raw, sections, fallback)
        val header = listOf("musicResponsiveHeaderRenderer", "musicDetailHeaderRenderer", "musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer")
            .map { json.findFirst(it) }.firstOrNull { it.exists }
        val title = header?.get("title")?.text
        val subtitle = listOfNotNull(header?.get("straplineTextOne")?.text, header?.get("subtitle")?.text)
            .joinToString(" • ").ifEmpty { null }
        val thumbnail = header?.let { h ->
            h.at("thumbnail", "musicThumbnailRenderer", "thumbnail").bestImageUrl
                ?: h.at("thumbnail", "croppedSquareThumbnailRenderer", "thumbnail").bestImageUrl
                ?: h["thumbnail"].findFirst("thumbnails").let { JNode(JSONObject().put("thumbnails", it.raw)) }.bestImageUrl
        }
        val filtered = sections.map { section ->
            section.copy(items = section.items.filter { item ->
                val video = item.asVideo()
                if (video != null) ParentalControls.allows(video) else true
            }.distinctBy { it.key })
        }.filter { it.items.isNotEmpty() }
        return MusicPage(title, subtitle, thumbnail, filtered)
    }

    private fun collectShelves(value: Any?, out: MutableList<MusicSection>, fallback: MusicItem.Kind?) {
        when (value) {
            is JSONArray -> for (index in 0 until value.length()) collectShelves(value.opt(index), out, fallback)
            is JSONObject -> {
                val keys = value.keys().asSequence().toList()
                for (key in keys) {
                    val child = JNode(value.opt(key))
                    when (key) {
                        "musicShelfRenderer", "musicPlaylistShelfRenderer" -> {
                            val items = child["contents"].array.mapNotNull { entry ->
                                entry["musicResponsiveListItemRenderer"].takeIf { it.exists }?.let { responsive(it, fallback) }
                            }
                            if (items.isNotEmpty()) out += MusicSection(child["title"].text, items)
                        }
                        "musicCarouselShelfRenderer" -> {
                            val title = child.at("header", "musicCarouselShelfBasicHeaderRenderer", "title").text
                            val items = child["contents"].array.mapNotNull { entry ->
                                entry["musicTwoRowItemRenderer"].takeIf { it.exists }?.let(::twoRow)
                                    ?: entry["musicResponsiveListItemRenderer"].takeIf { it.exists }?.let { responsive(it, null) }
                            }
                            if (items.isNotEmpty()) out += MusicSection(title, items)
                        }
                        "responseContext", "frameworkUpdates", "header", "menu" -> Unit
                        else -> collectShelves(child.raw, out, fallback)
                    }
                }
            }
        }
    }

    private fun kindFor(browseId: String?, pageType: String?): MusicItem.Kind? = when {
        pageType?.contains("ALBUM") == true || browseId?.startsWith("MPRE") == true -> MusicItem.Kind.ALBUM
        pageType?.contains("ARTIST") == true || pageType?.contains("USER_CHANNEL") == true || browseId?.startsWith("UC") == true -> MusicItem.Kind.ARTIST
        pageType?.contains("PLAYLIST") == true || browseId?.startsWith("VL") == true -> MusicItem.Kind.PLAYLIST
        else -> null
    }

    private fun responsive(r: JNode, fallback: MusicItem.Kind?): MusicItem? {
        val columns = r["flexColumns"].array.map { it.at("musicResponsiveListItemFlexColumnRenderer", "text") }
        val titleRun = columns.firstOrNull()?.get("runs")?.get(0) ?: JNode.EMPTY
        val title = columns.firstOrNull()?.text?.trim()?.ifEmpty { null } ?: return null
        val detailRuns = columns.drop(1).flatMap { it["runs"].array }
        val parts = detailRuns.mapNotNull { it["text"].string }.joinToString("").split("•").map { it.trim() }.filter { it.isNotEmpty() }
        val artistRun = detailRuns.firstOrNull { run ->
            val id = run.at("navigationEndpoint", "browseEndpoint", "browseId").string
            id != null && id.startsWith("UC")
        }
        val albumRun = detailRuns.firstOrNull { run -> run.at("navigationEndpoint", "browseEndpoint", "browseId").string?.startsWith("MPRE") == true }
        val fixed = r["fixedColumns"].array.firstOrNull()?.at("musicResponsiveListItemFixedColumnRenderer", "text")?.text
        val duration = fixed?.takeIf { durationPattern.matches(it.trim()) }?.trim() ?: parts.lastOrNull { durationPattern.matches(it) }

        val watch = titleRun.at("navigationEndpoint", "watchEndpoint")
        val videoId = r.at("playlistItemData", "videoId").string
            ?: watch["videoId"].string
            ?: r.at("overlay", "musicItemThumbnailOverlayRenderer", "content", "musicPlayButtonRenderer", "playNavigationEndpoint", "watchEndpoint", "videoId").string
        val browse = r.at("navigationEndpoint", "browseEndpoint")
        val browseId = browse["browseId"].string
        val pageType = browse.at("browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType").string
        val musicVideoType = watch.at("watchEndpointMusicSupportedConfigs", "watchEndpointMusicConfig", "musicVideoType").string
        val kind = kindFor(browseId, pageType) ?: when {
            videoId == null -> return null
            musicVideoType == "MUSIC_VIDEO_TYPE_ATV" -> MusicItem.Kind.SONG
            musicVideoType != null -> MusicItem.Kind.VIDEO
            else -> if (fallback == MusicItem.Kind.VIDEO) MusicItem.Kind.VIDEO else MusicItem.Kind.SONG
        }
        // Search rows start with the type ("Bài hát", "Video"…): leave it out of the subtitle.
        val subtitleParts = if (parts.size > 1 && artistRun != null && parts.first() != artistRun["text"].string) parts.drop(1) else parts
        return MusicItem(
            kind = kind,
            title = title,
            subtitle = subtitleParts.joinToString(" • "),
            thumbnail = r.at("thumbnail", "musicThumbnailRenderer", "thumbnail").bestImageUrl,
            videoId = if (kind == MusicItem.Kind.SONG || kind == MusicItem.Kind.VIDEO) videoId else null,
            browseId = browseId,
            playlistId = if (kind == MusicItem.Kind.PLAYLIST) browseId?.removePrefix("VL") else null,
            artists = artistRun?.get("text")?.string ?: if (kind == MusicItem.Kind.SONG) subtitleParts.firstOrNull() else null,
            artistId = artistRun?.at("navigationEndpoint", "browseEndpoint", "browseId")?.string,
            album = albumRun?.get("text")?.string,
            durationText = duration,
        )
    }

    private fun twoRow(r: JNode): MusicItem? {
        val title = r["title"].text?.trim()?.ifEmpty { null } ?: return null
        val subtitle = r["subtitle"].text ?: ""
        val navigation = r["navigationEndpoint"]
        val browseId = navigation.at("browseEndpoint", "browseId").string
        val pageType = navigation.at("browseEndpoint", "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType").string
        val videoId = navigation.at("watchEndpoint", "videoId").string
        val kind = kindFor(browseId, pageType) ?: if (videoId != null) MusicItem.Kind.VIDEO else return null
        val artistRun = r["subtitle"]["runs"].array.firstOrNull { it.at("navigationEndpoint", "browseEndpoint", "browseId").string?.startsWith("UC") == true }
        return MusicItem(
            kind = kind,
            title = title,
            subtitle = subtitle,
            thumbnail = r.at("thumbnailRenderer", "musicThumbnailRenderer", "thumbnail").bestImageUrl,
            videoId = videoId,
            browseId = browseId,
            playlistId = if (kind == MusicItem.Kind.PLAYLIST) browseId?.removePrefix("VL") else null,
            artists = artistRun?.get("text")?.string,
            artistId = artistRun?.at("navigationEndpoint", "browseEndpoint", "browseId")?.string,
        )
    }

    // MARK: Radio

    /** "Radio từ bài này": the endless mix of [videoId] (the seed first). */
    suspend fun radio(video: VideoItem): List<VideoItem> {
        val mix = runCatching { YouTubeService.playlistVideos("RDAMVM${video.id}", limit = 50) }.getOrDefault(emptyList())
        val rest = mix.filter { it.id != video.id && !it.isShort && !it.isLive }
        return ParentalControls.filterVideos(listOf(video) + rest).distinctBy { it.id }
    }
}

/** Songs recently played in music mode ("Nghe gần đây"). */
object MusicRecents {
    private const val KEY = "music.recents"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val serializer = ListSerializer(VideoItem.serializer())
    private var loaded = false

    var items by mutableStateOf(listOf<VideoItem>())
        private set

    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        items = AppSettings.store.getString(KEY, null)?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()
    }

    val list: List<VideoItem> get() = ensureLoaded().let { items }

    fun add(video: VideoItem) {
        ensureLoaded()
        if (AppSettings.isIncognito) return
        items = (listOf(video) + items.filter { it.id != video.id }).take(40)
        AppSettings.store.edit().putString(KEY, json.encodeToString(serializer, items)).apply()
    }

    fun clear() {
        items = emptyList()
        loaded = true
        AppSettings.store.edit().remove(KEY).apply()
    }
}
