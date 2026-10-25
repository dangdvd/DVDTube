package com.dangdvd.dvdtube.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * The cross-platform JSON shapes of [VideoItem] and [ChannelItem] (cast API, library sync):
 * the Android field names; only `id` is required, unknown keys are ignored and numbers are
 * read leniently (other platforms may write `1.0` for an integer).
 */
object ModelJson {
    fun video(video: VideoItem): JSONObject = JSONObject().apply {
        put("id", video.id)
        put("title", video.title)
        video.channelName?.let { put("channelName", it) }
        video.channelId?.let { put("channelId", it) }
        video.channelAvatar?.let { put("channelAvatar", it) }
        video.thumbnail?.let { put("thumbnail", it) }
        video.durationText?.let { put("durationText", it) }
        video.durationSeconds?.let { put("durationSeconds", it) }
        video.viewCountText?.let { put("viewCountText", it) }
        video.publishedText?.let { put("publishedText", it) }
        video.publishedDate?.let { put("publishedDate", it) }
        put("isLive", video.isLive)
        put("isShort", video.isShort)
    }

    fun videos(list: List<VideoItem>): JSONArray = JSONArray().also { array -> list.forEach { array.put(video(it)) } }

    fun parseVideo(node: JNode): VideoItem? {
        val id = node["id"].string?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return VideoItem(
            id = id,
            title = node["title"].string ?: "",
            channelName = node["channelName"].string,
            channelId = node["channelId"].string,
            channelAvatar = node["channelAvatar"].string,
            thumbnail = node["thumbnail"].string,
            durationText = node["durationText"].string,
            durationSeconds = node["durationSeconds"].double?.toInt(),
            viewCountText = node["viewCountText"].string,
            publishedText = node["publishedText"].string,
            publishedDate = node["publishedDate"].double?.toLong(),
            isLive = node["isLive"].bool ?: false,
            isShort = node["isShort"].bool ?: false,
        )
    }

    fun parseVideos(node: JNode): List<VideoItem> = node.array.mapNotNull(::parseVideo)

    fun channel(channel: ChannelItem): JSONObject = JSONObject().apply {
        put("id", channel.id)
        put("name", channel.name)
        channel.avatar?.let { put("avatar", it) }
        channel.handle?.let { put("handle", it) }
        channel.subscriberText?.let { put("subscriberText", it) }
        channel.videoCountText?.let { put("videoCountText", it) }
    }

    fun parseChannel(node: JNode): ChannelItem? {
        val id = node["id"].string?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return ChannelItem(
            id = id,
            name = node["name"].string ?: "",
            avatar = node["avatar"].string,
            handle = node["handle"].string,
            subscriberText = node["subscriberText"].string,
            videoCountText = node["videoCountText"].string,
        )
    }
}
