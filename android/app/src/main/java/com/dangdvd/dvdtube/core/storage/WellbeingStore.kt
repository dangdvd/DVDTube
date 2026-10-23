package com.dangdvd.dvdtube.core.storage

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.VideoItem
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.util.Calendar
import java.util.Locale

/** Seconds of video watched per day, for "Time watched" (kept for 30 days, on device only). */
object WatchTimeStore {
    private const val KEY = "wellbeing.watchTime"
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = MapSerializer(String.serializer(), Double.serializer())

    var secondsByDay by mutableStateOf(mapOf<String, Double>())
        private set
    private var loaded = false
    private var pending = 0.0
    private var lastSave = System.currentTimeMillis()

    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        secondsByDay = AppSettings.store.getString(KEY, null)
            ?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() } ?: emptyMap()
    }

    fun dayKey(timeMillis: Long): String {
        val calendar = Calendar.getInstance().apply { timeInMillis = timeMillis }
        return String.format(
            Locale.ROOT, "%04d-%02d-%02d",
            calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
        )
    }

    private fun daysAgoMillis(days: Int): Long =
        Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -days) }.timeInMillis

    fun add(seconds: Double, at: Long = System.currentTimeMillis()) {
        ensureLoaded()
        val key = dayKey(at)
        secondsByDay = secondsByDay + (key to (secondsByDay[key] ?: 0.0) + seconds)
        pending += seconds
        if (pending >= 30 || at - lastSave > 60_000) save()
    }

    fun save() {
        ensureLoaded()
        pending = 0.0
        lastSave = System.currentTimeMillis()
        val cutoff = dayKey(daysAgoMillis(30))
        secondsByDay = secondsByDay.filterKeys { it >= cutoff }
        AppSettings.store.edit().putString(KEY, json.encodeToString(serializer, secondsByDay)).apply()
    }

    fun seconds(daysAgo: Int): Double {
        ensureLoaded()
        return secondsByDay[dayKey(daysAgoMillis(daysAgo))] ?: 0.0
    }

    /** The last 7 days, oldest first: (epoch ms, seconds). */
    val lastWeek: List<Pair<Long, Double>>
        get() {
            ensureLoaded()
            return (6 downTo 0).map { daysAgo ->
                val time = daysAgoMillis(daysAgo)
                time to (secondsByDay[dayKey(time)] ?: 0.0)
            }
        }

    val dailyAverage: Double get() = lastWeek.sumOf { it.second } / 7

    fun reset() {
        secondsByDay = emptyMap()
        save()
    }
}

/**
 * Videos marked "Not interested" and channels marked "Don't recommend channel".
 * They are left out of the home feed, related videos and Shorts.
 */
object HiddenContentStore {
    private const val VIDEOS_KEY = "hidden.videos"
    private const val CHANNELS_KEY = "hidden.channels"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    var videos by mutableStateOf(listOf<VideoItem>())
        private set
    var channels by mutableStateOf(listOf<ChannelItem>())
        private set
    private var loaded = false
    private var videoIds = setOf<String>()
    private var channelIds = setOf<String>()

    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        videos = AppSettings.store.getString(VIDEOS_KEY, null)
            ?.let { runCatching { json.decodeFromString(ListSerializer(VideoItem.serializer()), it) }.getOrNull() } ?: emptyList()
        channels = AppSettings.store.getString(CHANNELS_KEY, null)
            ?.let { runCatching { json.decodeFromString(ListSerializer(ChannelItem.serializer()), it) }.getOrNull() } ?: emptyList()
        rebuild()
    }

    val isEmpty: Boolean get() = ensureLoaded().let { videos.isEmpty() && channels.isEmpty() }

    fun isHidden(video: VideoItem): Boolean {
        ensureLoaded()
        // Read the observable lists so screens update when something is hidden.
        if (videos.isEmpty() && channels.isEmpty()) return false
        return video.id in videoIds || (video.channelId != null && video.channelId in channelIds)
    }

    fun isHidden(item: FeedItem): Boolean = when (item) {
        is FeedItem.Video -> isHidden(item.video)
        is FeedItem.Channel -> ensureLoaded().let { item.channel.id in channelIds }
        else -> false
    }

    fun filter(items: List<FeedItem>): List<FeedItem> {
        if (isEmpty) return items
        return items.mapNotNull { item ->
            if (item is FeedItem.Shorts) {
                val kept = item.items.filter { !isHidden(it) }
                if (kept.isEmpty()) null else FeedItem.Shorts(kept)
            } else if (isHidden(item)) null else item
        }
    }

    fun hide(video: VideoItem) {
        ensureLoaded()
        if (video.id in videoIds) return
        videos = listOf(video) + videos
        save()
    }

    fun hideChannel(video: VideoItem) {
        ensureLoaded()
        val id = video.channelId ?: return
        if (id in channelIds) return
        channels = listOf(ChannelItem(id = id, name = video.channelName ?: id, avatar = video.channelAvatar)) + channels
        save()
    }

    fun unhideVideo(id: String) {
        ensureLoaded()
        videos = videos.filter { it.id != id }
        save()
    }

    fun unhideChannel(id: String) {
        ensureLoaded()
        channels = channels.filter { it.id != id }
        save()
    }

    fun clear() {
        videos = emptyList()
        channels = emptyList()
        save()
    }

    private fun rebuild() {
        videoIds = videos.map { it.id }.toSet()
        channelIds = channels.map { it.id }.toSet()
    }

    private fun save() {
        videos = videos.take(500)
        rebuild()
        AppSettings.store.edit()
            .putString(VIDEOS_KEY, json.encodeToString(ListSerializer(VideoItem.serializer()), videos))
            .putString(CHANNELS_KEY, json.encodeToString(ListSerializer(ChannelItem.serializer()), channels))
            .apply()
    }
}
