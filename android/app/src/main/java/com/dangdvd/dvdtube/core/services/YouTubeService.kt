package com.dangdvd.dvdtube.core.services

import android.net.Uri
import com.dangdvd.dvdtube.core.AccountIdentity
import com.dangdvd.dvdtube.core.AccountNotification
import com.dangdvd.dvdtube.core.AccountPlaylistOption
import com.dangdvd.dvdtube.core.AccountProfile
import com.dangdvd.dvdtube.core.ChannelAbout
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.ChannelPage
import com.dangdvd.dvdtube.core.ChannelTab
import com.dangdvd.dvdtube.core.CommentSortOption
import com.dangdvd.dvdtube.core.CommentsPage
import com.dangdvd.dvdtube.core.ContinuationKind
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.FeedPage
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.PlayerInfo
import com.dangdvd.dvdtube.core.PlaylistPage
import com.dangdvd.dvdtube.core.PostsPage
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.innertube.AboutParser
import com.dangdvd.dvdtube.core.innertube.AccountParser
import com.dangdvd.dvdtube.core.innertube.ChannelParser
import com.dangdvd.dvdtube.core.innertube.CommentsParser
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.innertube.ItemParser
import com.dangdvd.dvdtube.core.innertube.PlaylistParser
import com.dangdvd.dvdtube.core.innertube.PostsParser
import com.dangdvd.dvdtube.core.innertube.WatchParser

enum class SearchFilter(val title: String, val params: String?) {
    ALL("Tất cả", null),
    VIDEOS("Video", "EgIQAQ%3D%3D"),
    SHORTS("Shorts", "EgIQCQ%3D%3D"),
    CHANNELS("Kênh", "EgIQAg%3D%3D"),
    PLAYLISTS("Danh sách phát", "EgIQAw%3D%3D"),
    LIVE("Trực tiếp", "EgJAAQ%3D%3D"),
    RECENT("Mới tải lên", "CAI%3D"),
}

/** Feed categories shown as chips on the home screen. */
enum class HomeCategory(val title: String) {
    ALL("Tất cả"), MUSIC("Âm nhạc"), GAMING("Trò chơi"), LIVE("Trực tiếp"), PODCASTS("Podcast"),
    NEWS("Tin tức"), SPORTS("Thể thao"), LEARNING("Học tập"), MOVIES("Phim"),
}

/** High level API used by the UI. */
object YouTubeService {
    private val api = InnerTube
    private val vi get() = APIConfig.hl == "vi"

    // MARK: Search

    suspend fun search(query: String, filter: SearchFilter = SearchFilter.ALL): FeedPage =
        ItemParser.page(api.search(query, filter.params)).copy(kind = ContinuationKind.SEARCH)

    /** Search with the filter sheet's choices (upload date, type, duration, features, sort). */
    suspend fun search(query: String, filters: SearchFilters): FeedPage =
        ItemParser.page(api.search(query, filters.params())).copy(kind = ContinuationKind.SEARCH)

    suspend fun searchMore(token: String): FeedPage =
        ItemParser.page(api.searchContinuation(token)).copy(kind = ContinuationKind.SEARCH)

    /** Next page of any feed, using the endpoint the token came from. */
    suspend fun more(token: String, kind: ContinuationKind): FeedPage = when (kind) {
        ContinuationKind.BROWSE -> browseMore(token)
        ContinuationKind.SEARCH -> searchMore(token)
        ContinuationKind.NEXT -> relatedMore(token)
    }

    suspend fun suggestions(query: String): List<String> = api.suggestions(query)

    // MARK: Browse

    suspend fun browseMore(token: String): FeedPage = ItemParser.page(api.browseContinuation(token))

    private suspend fun charts(type: String): List<VideoItem> = ItemParser.chartVideos(api.charts(type))

    suspend fun category(category: HomeCategory): FeedPage = when (category) {
        HomeCategory.ALL -> search(if (vi) "thịnh hành" else "trending", SearchFilter.VIDEOS)
        HomeCategory.MUSIC -> {
            val music = runCatching { charts("TRENDING_VIDEOS") }.getOrDefault(emptyList())
            if (music.isNotEmpty()) FeedPage(music.map { FeedItem.Video(it) })
            else search(if (vi) "nhạc mới" else "new music", SearchFilter.VIDEOS)
        }
        // The "Gaming" destination channel has a trending tab.
        HomeCategory.GAMING -> ItemParser.page(api.browse("UCOpNcN46UbXVtpKMrmU4Abg", "Egh0cmVuZGluZw%3D%3D"))
        // The "Live" destination channel.
        HomeCategory.LIVE -> ItemParser.page(api.browse("UC4R8DWoMoI7CAwX8_LjQHig", "EgdsaXZldGFikgEDCKEK"))
        HomeCategory.PODCASTS -> ItemParser.page(api.browse("FEpodcasts_destination", "qgcCCAM%3D"))
        HomeCategory.NEWS -> searchRecent(if (vi) "tin tức" else "news")
        HomeCategory.SPORTS -> searchRecent(if (vi) "thể thao" else "sports highlights")
        HomeCategory.LEARNING -> search(if (vi) "kiến thức thú vị" else "learn something new", SearchFilter.VIDEOS)
        HomeCategory.MOVIES -> {
            val trailers = runCatching { charts("TRENDING_MOVIES") }.getOrDefault(emptyList())
            if (trailers.isNotEmpty()) FeedPage(trailers.map { FeedItem.Video(it) })
            else searchRecent(if (vi) "trailer phim" else "movie trailer")
        }
    }

    /** Search restricted to the current week. */
    private suspend fun searchRecent(query: String): FeedPage =
        ItemParser.page(api.search(query, "EgQIAxAB")).copy(kind = ContinuationKind.SEARCH)

    // MARK: Watch

    suspend fun player(videoId: String): PlayerInfo = api.player(videoId)

    suspend fun watchInfo(videoId: String): WatchInfo = WatchParser.parse(api.next(videoId), videoId)

    suspend fun relatedMore(token: String): FeedPage =
        ItemParser.page(api.nextContinuation(token)).copy(kind = ContinuationKind.NEXT)

    suspend fun comments(token: String): Pair<CommentsPage, List<CommentSortOption>> =
        CommentsParser.parse(api.nextContinuation(token))

    // MARK: Channels & playlists

    suspend fun channel(id: String, tab: ChannelTab = ChannelTab.VIDEOS): ChannelPage {
        val browseId = resolveChannelId(id)
        return ChannelParser.parse(api.browse(browseId, tab.defaultParams), browseId, tab)
    }

    suspend fun channelTab(id: String, tab: ChannelTab, params: String?): FeedPage =
        ChannelParser.parse(api.browse(id, params ?: tab.defaultParams), id, tab).initialPage

    /** The "Posts" (community) tab. */
    suspend fun channelPosts(id: String, params: String?): PostsPage =
        PostsParser.page(api.browse(id, params ?: ChannelTab.POSTS.defaultParams))

    suspend fun channelPostsMore(token: String): PostsPage = PostsParser.page(api.browseContinuation(token))

    /** The "About" panel: from the header's continuation, else from the about tab. */
    suspend fun channelAbout(id: String, aboutToken: String?, params: String?): ChannelAbout? {
        if (aboutToken != null) {
            runCatching { AboutParser.parse(api.browseContinuation(aboutToken)) }.getOrNull()?.let { return it }
        }
        val json = api.browse(id, params ?: ChannelTab.ABOUT.defaultParams)
        AboutParser.parse(json)?.let { return it }
        val token = ChannelParser.aboutToken(json["header"]) ?: return null
        return AboutParser.parse(api.browseContinuation(token))
    }

    /** Videos of one channel matching [query]. */
    suspend fun channelSearch(id: String, query: String): FeedPage =
        ItemParser.page(api.browseSearch(id, ChannelTab.SEARCH_PARAMS, query))

    /** Every video of a playlist (all pages, at most [limit]). */
    suspend fun playlistVideos(id: String, limit: Int = 200): List<VideoItem> {
        var page = playlist(id).page
        val videos = page.videos.toMutableList()
        var pages = 0
        while (videos.size < limit && pages < 20) {
            val token = page.continuation ?: break
            page = browseMore(token)
            if (page.videos.isEmpty()) break
            videos += page.videos.filter { video -> videos.none { it.id == video.id } }
            pages++
        }
        return videos.take(limit)
    }

    suspend fun playlist(id: String): PlaylistPage {
        val plainId = id.removePrefix("VL")
        if (isMix(plainId)) return mix(plainId)
        val page = PlaylistParser.parse(api.browse("VL$plainId"), id)
        // Some generated lists have no playlist page either: read them like a mix.
        if (page.page.videos.isEmpty() && plainId.startsWith("RD")) {
            runCatching { mix(plainId) }.getOrNull()?.takeIf { it.page.videos.isNotEmpty() }?.let { return it }
        }
        return page
    }

    /** Mixes ("Danh sách kết hợp": `RD…` ids, except album lists `RDCLAK…`) only exist on the watch page. */
    fun isMix(id: String): Boolean = id.startsWith("RD") && !id.startsWith("RDCLAK")

    private suspend fun mix(id: String): PlaylistPage {
        // `RD<video id>` and `RDAMVM<video id>` mixes start from that video.
        val seed = when {
            id.length == 13 -> id.drop(2)
            id.startsWith("RDAMVM") && id.length == 17 -> id.drop(6)
            else -> null
        }
        return PlaylistParser.mix(api.next(seed, id), id)
    }

    /** Accepts a `UC…` id, an `@handle` or a channel URL. */
    suspend fun resolveChannelId(value: String): String {
        if (value.startsWith("UC") && value.length == 24) return value
        val url = if (value.startsWith("http")) value else "https://www.youtube.com/" + if (value.startsWith("@")) value else "@$value"
        return api.resolveUrl(url).at("endpoint", "browseEndpoint", "browseId").string ?: value
    }

    /** Latest uploads of a channel for the subscriptions feed. */
    suspend fun latestVideos(channel: ChannelItem): List<VideoItem> {
        val rss = runCatching { RSSFeed.videos(channel.id) }.getOrDefault(emptyList())
        if (rss.isNotEmpty()) return rss.map { it.copy(channelAvatar = it.channelAvatar ?: channel.avatar) }
        val page = runCatching { channelTab(channel.id, ChannelTab.VIDEOS, null) }.getOrNull() ?: return emptyList()
        val now = System.currentTimeMillis()
        return page.videos.map { video ->
            video.copy(
                channelName = video.channelName ?: channel.name,
                channelId = video.channelId ?: channel.id,
                channelAvatar = video.channelAvatar ?: channel.avatar,
                publishedDate = RelativeDateParser.date(video.publishedText, now),
            )
        }
    }

    // MARK: Account (signed in)

    suspend fun accountProfile(): AccountProfile? = AccountParser.profile(api.accountMenu())

    /** Signed-in Google accounts and their brand channels. */
    suspend fun accountIdentities(): List<AccountIdentity> {
        var firstError: Exception? = null
        try {
            val identities = AccountParser.identities(api.accountSwitcher())
            Log.debug("account switcher: ${identities.size} identities")
            if (identities.isNotEmpty()) return identities
        } catch (error: Exception) {
            firstError = error
        }
        try {
            val identities = AccountParser.identities(api.accountsList())
            Log.debug("accounts list: ${identities.size} identities")
            return identities
        } catch (error: Exception) {
            throw firstError ?: error
        }
    }

    /**
     * Any account page by browse id: FEwhat_to_watch (home), FEsubscriptions, FEchannels,
     * FEhistory, FEplaylist_aggregation, VLWL (watch later), VLLL (liked videos).
     */
    suspend fun accountFeed(browseId: String): FeedPage {
        val page = ItemParser.page(api.browse(browseId))
        Log.debug("account $browseId: ${page.items.size} items, more=${page.continuation != null}${page.message?.let { ", notice: $it" } ?: ""}")
        return page
    }

    suspend fun accountPlaylistOptions(videoId: String): List<AccountPlaylistOption> =
        AccountParser.playlistOptions(api.addToPlaylistOptions(videoId))

    suspend fun accountNotifications(): List<AccountNotification> {
        val items = AccountParser.notifications(api.notificationMenu())
        Log.debug("notifications: ${items.size}")
        return items
    }

    /** Every channel the account is subscribed to. */
    suspend fun accountSubscriptions(): List<ChannelItem> {
        var page = accountFeed("FEchannels")
        val channels = page.items.mapNotNull { (it as? FeedItem.Channel)?.channel }.toMutableList()
        var pages = 0
        while (pages < 10) {
            val token = page.continuation ?: break
            page = browseMore(token)
            channels += page.items.mapNotNull { (it as? FeedItem.Channel)?.channel }
            pages++
        }
        return channels
    }

    // MARK: Links

    /** Extracts a video id from any YouTube URL (watch, youtu.be, shorts, live, embed). */
    fun videoId(text: String): String? {
        val uri = runCatching { Uri.parse(text.trim()) }.getOrNull() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (!host.contains("youtu")) return null
        uri.getQueryParameter("v")?.let { return it }
        val parts = uri.pathSegments
        if (host.contains("youtu.be")) return parts.firstOrNull()
        if (parts.size >= 2 && parts[0] in listOf("shorts", "live", "embed", "v")) return parts[1]
        return null
    }
}

/** Turns "2 ngày trước" / "3 weeks ago" into an approximate date (epoch ms) for sorting. */
object RelativeDateParser {
    private val units = listOf(
        listOf("giây", "second") to 1L,
        listOf("phút", "minute") to 60L,
        listOf("giờ", "hour") to 3600L,
        listOf("ngày", "day") to 86_400L,
        listOf("tuần", "week") to 604_800L,
        listOf("tháng", "month") to 2_592_000L,
        listOf("năm", "year") to 31_536_000L,
    )

    fun date(text: String?, now: Long = System.currentTimeMillis()): Long? {
        val lower = text?.lowercase() ?: return null
        val amount = Regex("\\d+").find(lower)?.value?.toLongOrNull() ?: 1L
        for ((keys, seconds) in units) {
            if (keys.any { lower.contains(it) }) return now - amount * seconds * 1000
        }
        return null
    }
}
