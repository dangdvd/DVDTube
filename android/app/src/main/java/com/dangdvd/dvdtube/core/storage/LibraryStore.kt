package com.dangdvd.dvdtube.core.storage

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.HistoryEntry
import com.dangdvd.dvdtube.core.LocalPlaylist
import com.dangdvd.dvdtube.core.VideoItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** App-wide coroutine scope on the main thread. */
object AppScope : CoroutineScope by MainScope()

@Serializable
private data class LibraryData(
    val subscriptions: List<ChannelItem> = emptyList(),
    val history: List<HistoryEntry> = emptyList(),
    val watchLater: List<VideoItem> = emptyList(),
    val liked: List<VideoItem> = emptyList(),
    val playlists: List<LocalPlaylist> = emptyList(),
    val searchHistory: List<String> = emptyList(),
)

/**
 * Everything that would normally live in a Google account: subscriptions, history, likes and
 * playlists. Stored locally as JSON — nothing leaves the device.
 */
object LibraryStore {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private lateinit var file: File
    private var saveJob: Job? = null

    var subscriptions by mutableStateOf(listOf<ChannelItem>())
        private set
    var history by mutableStateOf(listOf<HistoryEntry>())
        private set
    var watchLater by mutableStateOf(listOf<VideoItem>())
        private set
    var liked by mutableStateOf(listOf<VideoItem>())
        private set
    var playlists by mutableStateOf(listOf<LocalPlaylist>())
        private set
    var searchHistory by mutableStateOf(listOf<String>())
        private set
    /** Dislikes are kept for this session only (like the official app, they are private). */
    var disliked by mutableStateOf(setOf<String>())
        private set

    fun init(context: Context) {
        file = File(context.filesDir, "library.json")
        val stored = runCatching { json.decodeFromString(LibraryData.serializer(), file.readText()) }.getOrNull() ?: return
        subscriptions = stored.subscriptions
        history = stored.history
        watchLater = stored.watchLater
        liked = stored.liked
        playlists = stored.playlists
        searchHistory = stored.searchHistory
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        val snapshot = LibraryData(subscriptions, history, watchLater, liked, playlists, searchHistory)
        saveJob = AppScope.launch {
            delay(500)
            withContext(Dispatchers.IO) {
                runCatching {
                    val temp = File(file.parentFile, "library.json.tmp")
                    temp.writeText(json.encodeToString(LibraryData.serializer(), snapshot))
                    temp.renameTo(file)
                }
            }
        }
    }

    // MARK: Subscriptions

    fun isSubscribed(channelId: String?): Boolean = channelId != null && subscriptions.any { it.id == channelId }

    fun toggleSubscription(channel: ChannelItem) {
        subscriptions = if (isSubscribed(channel.id)) subscriptions.filter { it.id != channel.id } else listOf(channel) + subscriptions
        scheduleSave()
    }

    fun updateSubscription(channel: ChannelItem) {
        val index = subscriptions.indexOfFirst { it.id == channel.id }
        if (index < 0) return
        val existing = subscriptions[index]
        val updated = existing.copy(
            name = channel.name.ifEmpty { existing.name },
            avatar = channel.avatar ?: existing.avatar,
            subscriberText = channel.subscriberText ?: existing.subscriberText,
            handle = channel.handle ?: existing.handle,
        )
        if (updated == existing) return
        subscriptions = subscriptions.toMutableList().also { it[index] = updated }
        scheduleSave()
    }

    /** Imports a Google Takeout `subscriptions.csv` (Channel Id, Channel Url, Channel Title). */
    fun importSubscriptions(csv: String): Int {
        val added = ArrayList<ChannelItem>()
        for (line in csv.lines().drop(1)) {
            val columns = line.split(",", limit = 3).map { it.trim().trim('"') }
            if (columns.size < 3 || !columns[0].startsWith("UC")) continue
            if (isSubscribed(columns[0]) || added.any { it.id == columns[0] }) continue
            added.add(ChannelItem(columns[0], columns[2]))
        }
        if (added.isNotEmpty()) {
            subscriptions = subscriptions + added
            scheduleSave()
        }
        return added.size
    }

    fun exportSubscriptionsCsv(): String =
        (listOf("Channel Id,Channel Url,Channel Title") + subscriptions.map {
            "${it.id},http://www.youtube.com/channel/${it.id},${it.name.replace(",", " ")}"
        }).joinToString("\n")

    // MARK: History

    fun recordWatch(video: VideoItem, position: Double, duration: Double) {
        if (!AppSettings.saveHistory) return
        val existing = history.firstOrNull { it.video.id == video.id }
        val entry = HistoryEntry(video, System.currentTimeMillis(), position,
            if (duration <= 0) existing?.duration ?: 0.0 else duration)
        history = (listOf(entry) + history.filter { it.video.id != video.id }).take(1000)
        scheduleSave()
    }

    fun updatePosition(videoId: String, position: Double, duration: Double) {
        val index = history.indexOfFirst { it.video.id == videoId }
        if (index < 0) return
        val entry = history[index]
        history = history.toMutableList().also {
            it[index] = entry.copy(position = position, duration = if (duration > 0) duration else entry.duration)
        }
        scheduleSave()
    }

    fun resumePosition(videoId: String): Double? {
        val entry = history.firstOrNull { it.video.id == videoId } ?: return null
        if (entry.position <= 10) return null
        if (entry.duration > 0 && entry.position >= entry.duration - 10) return null
        return entry.position
    }

    fun removeFromHistory(videoId: String) {
        history = history.filter { it.video.id != videoId }
        scheduleSave()
    }

    fun clearHistory() {
        history = emptyList()
        scheduleSave()
    }

    // MARK: Watch later & likes

    fun isInWatchLater(videoId: String) = watchLater.any { it.id == videoId }

    fun toggleWatchLater(video: VideoItem) {
        watchLater = if (isInWatchLater(video.id)) watchLater.filter { it.id != video.id } else listOf(video) + watchLater
        scheduleSave()
    }

    fun isLiked(videoId: String) = liked.any { it.id == videoId }

    fun toggleLike(video: VideoItem) {
        liked = if (isLiked(video.id)) liked.filter { it.id != video.id } else listOf(video) + liked
        if (video.id in disliked) disliked = disliked - video.id
        scheduleSave()
    }

    fun toggleDislike(video: VideoItem) {
        if (video.id in disliked) {
            disliked = disliked - video.id
        } else {
            disliked = disliked + video.id
            if (isLiked(video.id)) {
                liked = liked.filter { it.id != video.id }
                scheduleSave()
            }
        }
    }

    // MARK: Playlists

    fun createPlaylist(name: String, video: VideoItem? = null): LocalPlaylist {
        val playlist = LocalPlaylist(name = name, videos = listOfNotNull(video))
        playlists = listOf(playlist) + playlists
        scheduleSave()
        return playlist
    }

    private fun updatePlaylist(id: String, transform: (LocalPlaylist) -> LocalPlaylist) {
        playlists = playlists.map { if (it.id == id) transform(it) else it }
        scheduleSave()
    }

    fun add(video: VideoItem, playlistId: String) = updatePlaylist(playlistId) { playlist ->
        if (playlist.videos.any { it.id == video.id }) playlist else playlist.copy(videos = playlist.videos + video)
    }

    fun remove(videoId: String, playlistId: String) = updatePlaylist(playlistId) { playlist ->
        playlist.copy(videos = playlist.videos.filter { it.id != videoId })
    }

    fun moveVideo(playlistId: String, from: Int, to: Int) = updatePlaylist(playlistId) { playlist ->
        val videos = playlist.videos.toMutableList()
        if (from !in videos.indices || to !in videos.indices) return@updatePlaylist playlist
        videos.add(to, videos.removeAt(from))
        playlist.copy(videos = videos)
    }

    fun renamePlaylist(playlistId: String, name: String) = updatePlaylist(playlistId) { it.copy(name = name) }

    fun deletePlaylist(playlistId: String) {
        playlists = playlists.filter { it.id != playlistId }
        scheduleSave()
    }

    fun playlist(id: String): LocalPlaylist? = playlists.firstOrNull { it.id == id }

    // MARK: Search history

    fun addSearch(query: String) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return
        searchHistory = (listOf(trimmed) + searchHistory.filter { !it.equals(trimmed, ignoreCase = true) }).take(50)
        scheduleSave()
    }

    fun removeSearch(query: String) {
        searchHistory = searchHistory.filter { it != query }
        scheduleSave()
    }

    fun clearSearchHistory() {
        searchHistory = emptyList()
        scheduleSave()
    }
}
