package com.dangdvd.dvdtube.player

import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.LibraryStore
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/**
 * What Android Auto (or any media browser) can browse: history, watch later, likes, playlists,
 * new videos from subscriptions and downloads. Playable items use the video id as media id.
 */
object AutoLibrary {
    const val ROOT = "root"
    private const val HISTORY = "folder:history"
    private const val WATCH_LATER = "folder:watchLater"
    private const val LIKED = "folder:liked"
    private const val PLAYLISTS = "folder:playlists"
    private const val SUBSCRIPTIONS = "folder:subscriptions"
    private const val DOWNLOADS = "folder:downloads"
    private const val LOCAL_PLAYLIST = "local:"
    private const val ACCOUNT_PLAYLIST = "playlist:"

    /** Videos seen while browsing (for titles and artwork when one is played). */
    private val known = HashMap<String, VideoItem>()
    /** The last list shown for each folder: playing one item queues the rest of its list. */
    private val lists = HashMap<String, List<VideoItem>>()

    fun root(): MediaItem = folder(ROOT, "DVDTube")

    private fun folder(id: String, title: String, artwork: String? = null): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setIsBrowsable(true)
            .setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
        artwork?.let { metadata.setArtworkUri(Uri.parse(it)) }
        return MediaItem.Builder().setMediaId(id).setMediaMetadata(metadata.build()).build()
    }

    private fun item(video: VideoItem): MediaItem {
        known[video.id] = video
        return MediaItem.Builder()
            .setMediaId(video.id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(video.title.ifEmpty { video.id })
                    .setArtist(video.channelName)
                    .setArtworkUri(Uri.parse(video.displayThumbnail))
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_VIDEO)
                    .build(),
            )
            .build()
    }

    /** A media item for [mediaId] (a folder or a video), e.g. for playback resumption. */
    fun itemFor(mediaId: String): MediaItem = when {
        mediaId == ROOT -> root()
        mediaId.contains(':') -> folder(mediaId, "")
        else -> item(known[mediaId] ?: VideoItem(id = mediaId))
    }

    /** Adds titles and artwork to an item a controller asked to play. */
    fun resolve(mediaItem: MediaItem): MediaItem = video(mediaItem)?.let(::item) ?: mediaItem

    fun video(mediaItem: MediaItem): VideoItem? {
        val id = mediaItem.mediaId.takeIf { it.isNotEmpty() && !it.contains(':') && it != ROOT } ?: return null
        known[id]?.let { return it }
        val metadata = mediaItem.mediaMetadata
        return VideoItem(
            id = id,
            title = metadata.title?.toString() ?: "",
            channelName = metadata.artist?.toString(),
            thumbnail = metadata.artworkUri?.toString(),
        )
    }

    fun queueFor(videoId: String): List<VideoItem>? = lists.values.firstOrNull { list -> list.any { it.id == videoId } }

    suspend fun children(parentId: String): List<MediaItem> = when (parentId) {
        ROOT -> listOf(
            folder(HISTORY, "Tiếp tục xem"),
            folder(WATCH_LATER, "Xem sau"),
            folder(LIKED, "Video đã thích"),
            folder(PLAYLISTS, "Danh sách phát"),
            folder(SUBSCRIPTIONS, "Kênh đăng ký – video mới"),
            folder(DOWNLOADS, "Đã tải xuống"),
        )
        PLAYLISTS -> playlists()
        else -> videos(parentId).also { lists[parentId] = it }.map(::item)
    }

    private suspend fun videos(parentId: String): List<VideoItem> {
        val videos = when {
            parentId == HISTORY -> account("FEhistory") ?: LibraryStore.history.map { it.video }
            parentId == WATCH_LATER -> account("VLWL") ?: LibraryStore.watchLater
            parentId == LIKED -> account("VLLL") ?: LibraryStore.liked
            parentId == SUBSCRIPTIONS -> account("FEsubscriptions") ?: latestFromSubscriptions()
            parentId == DOWNLOADS -> DownloadManager.downloads.map { it.video }
            parentId.startsWith(LOCAL_PLAYLIST) -> LibraryStore.playlist(parentId.removePrefix(LOCAL_PLAYLIST))?.videos.orEmpty()
            parentId.startsWith(ACCOUNT_PLAYLIST) ->
                runCatching { YouTubeService.playlist(parentId.removePrefix(ACCOUNT_PLAYLIST)).page.videos }.getOrDefault(emptyList())
            else -> emptyList()
        }
        return videos.distinctBy { it.id }.take(100)
    }

    /** The signed-in account's page, or null to fall back to what is stored on the phone. */
    private suspend fun account(browseId: String): List<VideoItem>? {
        if (!AccountStore.isSignedIn) return null
        return runCatching { YouTubeService.accountFeed(browseId).videos }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    private suspend fun latestFromSubscriptions(): List<VideoItem> = coroutineScope {
        LibraryStore.subscriptions.take(15)
            .map { channel -> async { runCatching { YouTubeService.latestVideos(channel) }.getOrDefault(emptyList()) } }
            .awaitAll()
            .flatten()
            .filter { !it.isShort }
            .sortedByDescending { it.publishedDate ?: 0L }
            .take(60)
    }

    private suspend fun playlists(): List<MediaItem> {
        val local = LibraryStore.playlists.map { folder(LOCAL_PLAYLIST + it.id, it.name, it.videos.firstOrNull()?.displayThumbnail) }
        val remote = if (AccountStore.isSignedIn) {
            runCatching { YouTubeService.accountFeed("FEplaylist_aggregation").items }.getOrDefault(emptyList())
                .mapNotNull { (it as? FeedItem.Playlist)?.playlist }
                .map { folder(ACCOUNT_PLAYLIST + it.id, it.title, it.thumbnail) }
        } else {
            emptyList()
        }
        return local + remote
    }
}
