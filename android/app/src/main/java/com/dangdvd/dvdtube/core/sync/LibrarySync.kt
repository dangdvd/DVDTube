package com.dangdvd.dvdtube.core.sync

import com.dangdvd.dvdtube.DVDTubeApp
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.HistoryEntry
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.LocalPlaylist
import com.dangdvd.dvdtube.core.ModelJson
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.tv.TvActivity
import com.dangdvd.dvdtube.tv.TvPairingServer
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * "Đồng bộ thư viện": the cross-platform library file (`dvdtube-library` v1) and its merge rules
 * (a union — deletions are not propagated), shared by file export / import and the LAN sync.
 */
object LibrarySync {
    const val FORMAT = "dvdtube-library"
    const val VERSION = 1
    private const val HISTORY_LIMIT = 1000
    private const val SEARCH_LIMIT = 50

    data class Library(
        val subscriptions: List<ChannelItem>,
        val history: List<HistoryEntry>,
        val watchLater: List<VideoItem>,
        val liked: List<VideoItem>,
        val playlists: List<LocalPlaylist>,
        val searchHistory: List<String>,
        val device: String? = null,
        val platform: String? = null,
        val exportedAt: Long = System.currentTimeMillis(),
    )

    /** What a merge added to this device. */
    data class Summary(val channels: Int, val videos: Int, val playlists: Int, val searches: Int) {
        val isEmpty: Boolean get() = channels == 0 && videos == 0 && playlists == 0 && searches == 0

        val text: String
            get() {
                if (isEmpty) return "Thư viện đã khớp, không có gì mới."
                val parts = listOfNotNull(
                    channels.takeIf { it > 0 }?.let { "$it kênh" },
                    videos.takeIf { it > 0 }?.let { "$it video" },
                    playlists.takeIf { it > 0 }?.let { "$it danh sách phát" },
                    searches.takeIf { it > 0 }?.let { "$it tìm kiếm" },
                )
                return "Đã thêm " + parts.joinToString(", ") + "."
            }
    }

    val platform: String
        get() = runCatching { if (TvActivity.isTelevision(DVDTubeApp.instance)) "tv" else "android" }.getOrDefault("android")

    val deviceName: String get() = runCatching { TvPairingServer.deviceName(DVDTubeApp.instance) }.getOrDefault("Android")

    fun local(): Library = Library(
        subscriptions = LibraryStore.subscriptions,
        history = LibraryStore.history,
        watchLater = LibraryStore.watchLater,
        liked = LibraryStore.liked,
        playlists = LibraryStore.playlists,
        searchHistory = LibraryStore.searchHistory,
        device = deviceName,
        platform = platform,
    )

    fun exportFileName(time: Long = System.currentTimeMillis()): String =
        "DVDTube-thu-vien-" + SimpleDateFormat("yyyyMMdd", Locale.ROOT).format(Date(time)) + ".json"

    // MARK: JSON

    fun toJson(library: Library): String {
        val json = JSONObject()
            .put("format", FORMAT)
            .put("version", VERSION)
            .put("exportedAt", library.exportedAt)
            .put("device", library.device ?: deviceName)
            .put("platform", library.platform ?: platform)
            .put("subscriptions", JSONArray().also { array -> library.subscriptions.forEach { array.put(ModelJson.channel(it)) } })
            .put("history", JSONArray().also { array ->
                library.history.forEach { entry ->
                    array.put(
                        JSONObject()
                            .put("video", ModelJson.video(entry.video))
                            .put("watchedAt", entry.watchedAt)
                            .put("position", entry.position)
                            .put("duration", entry.duration),
                    )
                }
            })
            .put("watchLater", ModelJson.videos(library.watchLater))
            .put("liked", ModelJson.videos(library.liked))
            .put("playlists", JSONArray().also { array ->
                library.playlists.forEach { playlist ->
                    array.put(
                        JSONObject()
                            .put("id", playlist.id)
                            .put("name", playlist.name)
                            .put("videos", ModelJson.videos(playlist.videos))
                            .put("createdAt", playlist.createdAt),
                    )
                }
            })
            .put("searchHistory", JSONArray().also { array -> library.searchHistory.forEach { array.put(it) } })
        return json.toString()
    }

    /** Null when the text is not a DVDTube library. Unknown keys are ignored, missing arrays are empty. */
    fun parse(text: String): Library? {
        val json = runCatching { JNode.parse(text.trim().removePrefix("﻿")) }.getOrNull() ?: return null
        if (json.raw !is JSONObject) return null
        val format = json["format"].string
        if (format != null && format != FORMAT) return null
        if (format == null && !json["history"].exists && !json["subscriptions"].exists) return null
        val history = json["history"].array.mapNotNull { node ->
            val video = ModelJson.parseVideo(node["video"]) ?: return@mapNotNull null
            HistoryEntry(
                video = video,
                watchedAt = node["watchedAt"].double?.toLong() ?: 0L,
                position = node["position"].double ?: 0.0,
                duration = node["duration"].double ?: 0.0,
            )
        }
        val playlists = json["playlists"].array.mapNotNull { node ->
            val name = node["name"].string?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            LocalPlaylist(
                id = node["id"].string?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
                name = name,
                videos = ModelJson.parseVideos(node["videos"]).distinctBy { it.id },
                createdAt = node["createdAt"].double?.toLong() ?: System.currentTimeMillis(),
            )
        }
        return Library(
            subscriptions = json["subscriptions"].array.mapNotNull(ModelJson::parseChannel).distinctBy { it.id },
            history = history,
            watchLater = ModelJson.parseVideos(json["watchLater"]).distinctBy { it.id },
            liked = ModelJson.parseVideos(json["liked"]).distinctBy { it.id },
            playlists = playlists,
            searchHistory = json["searchHistory"].array.mapNotNull { it.string?.trim()?.takeIf { s -> s.isNotEmpty() } },
            device = json["device"].string,
            platform = json["platform"].string,
            exportedAt = json["exportedAt"].double?.toLong() ?: 0L,
        )
    }

    // MARK: Merge

    private fun filled(channel: ChannelItem): Int =
        listOf(channel.avatar, channel.handle, channel.subscriberText, channel.videoCountText).count { it != null } +
            if (channel.name.isNotEmpty()) 1 else 0

    private fun unionVideos(local: List<VideoItem>, remote: List<VideoItem>): List<VideoItem> {
        val ids = local.map { it.id }.toHashSet()
        return local + remote.filter { ids.add(it.id) }
    }

    /** [local] ∪ [remote] by the protocol's rules, and what that adds to [local]. */
    fun merge(local: Library, remote: Library): Pair<Library, Summary> {
        // Subscriptions: by channel id, keeping the more complete entry.
        val remoteById = remote.subscriptions.associateBy { it.id }
        val localIds = local.subscriptions.map { it.id }.toHashSet()
        val subscriptions = local.subscriptions.map { mine ->
            val theirs = remoteById[mine.id]
            if (theirs != null && filled(theirs) > filled(mine)) theirs else mine
        } + remote.subscriptions.filter { it.id !in localIds }.distinctBy { it.id }
        val addedChannels = subscriptions.size - local.subscriptions.size

        // History: the newest entry per video (with its position), newest first.
        val latest = LinkedHashMap<String, HistoryEntry>()
        for (entry in local.history + remote.history) {
            val current = latest[entry.video.id]
            if (current == null || entry.watchedAt > current.watchedAt) latest[entry.video.id] = entry
        }
        val history = latest.values.sortedByDescending { it.watchedAt }.take(HISTORY_LIMIT)
        val localHistoryIds = local.history.map { it.video.id }.toHashSet()
        val addedHistory = history.count { it.video.id !in localHistoryIds }

        val watchLater = unionVideos(local.watchLater, remote.watchLater)
        val liked = unionVideos(local.liked, remote.liked)

        // Playlists: by id, else by name; videos united; remote-only playlists added.
        val playlists = local.playlists.toMutableList()
        var addedPlaylists = 0
        var addedPlaylistVideos = 0
        for (theirs in remote.playlists) {
            var index = playlists.indexOfFirst { it.id == theirs.id }
            if (index < 0) index = playlists.indexOfFirst { it.name.trim().equals(theirs.name.trim(), ignoreCase = true) }
            if (index >= 0) {
                val mine = playlists[index]
                val united = unionVideos(mine.videos, theirs.videos)
                addedPlaylistVideos += united.size - mine.videos.size
                playlists[index] = mine.copy(videos = united)
            } else {
                playlists += theirs
                addedPlaylists++
            }
        }

        val searches = local.searchHistory.toMutableList()
        for (query in remote.searchHistory) {
            if (searches.none { it.equals(query, ignoreCase = true) }) searches += query
        }
        val searchHistory = searches.take(SEARCH_LIMIT)
        val addedSearches = searchHistory.size - minOf(local.searchHistory.size, SEARCH_LIMIT)

        val merged = Library(subscriptions, history, watchLater, liked, playlists, searchHistory, local.device, local.platform)
        val summary = Summary(
            channels = addedChannels,
            videos = addedHistory + (watchLater.size - local.watchLater.size) + (liked.size - local.liked.size) + addedPlaylistVideos,
            playlists = addedPlaylists,
            searches = addedSearches.coerceAtLeast(0),
        )
        return merged to summary
    }

    /** Merges [remote] into this device's library and saves it. Call on the main thread. */
    fun mergeIntoLocal(remote: Library): Summary {
        val (merged, summary) = merge(local(), remote)
        if (!summary.isEmpty || merged.history != LibraryStore.history) {
            LibraryStore.replaceAll(merged.subscriptions, merged.history, merged.watchLater, merged.liked, merged.playlists, merged.searchHistory)
        }
        return summary
    }
}
