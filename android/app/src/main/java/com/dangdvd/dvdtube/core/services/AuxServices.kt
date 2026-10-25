package com.dangdvd.dvdtube.core.services

import android.text.format.DateUtils
import android.util.Xml
import com.dangdvd.dvdtube.core.CaptionTrack
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.SponsorSegment
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.innertube.InnerTubeException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.xmlpull.v1.XmlPullParser
import java.security.MessageDigest
import java.text.NumberFormat
import java.time.OffsetDateTime
import java.util.Locale

/** Channel uploads via the public RSS feed: cheap, stable and has exact publish dates. */
object RSSFeed {
    suspend fun videos(channelId: String): List<VideoItem> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("https://www.youtube.com/feeds/videos.xml?channel_id=$channelId").build()
        InnerTube.client.newCall(request).execute().use { response ->
            if (response.code != 200) throw InnerTubeException.InvalidResponse()
            com.dangdvd.dvdtube.core.ParentalControls.filterVideos(parse(response.body?.string() ?: "", channelId))
        }
    }

    private fun parse(xml: String, channelId: String): List<VideoItem> {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(xml.reader())
        val videos = ArrayList<VideoItem>()
        var entry: MutableMap<String, String>? = null
        var channelName: String? = null
        var text = StringBuilder()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    text = StringBuilder()
                    when (parser.name) {
                        "entry" -> entry = mutableMapOf()
                        "media:thumbnail" -> parser.getAttributeValue(null, "url")?.let { entry?.put("thumbnail", it) }
                        "media:statistics" -> parser.getAttributeValue(null, "views")?.let { entry?.put("views", it) }
                        "link" -> parser.getAttributeValue(null, "href")?.let { entry?.put("link", it) }
                    }
                }
                XmlPullParser.TEXT -> text.append(parser.text)
                XmlPullParser.END_TAG -> {
                    val value = text.toString().trim()
                    val current = entry
                    if (current == null) {
                        if (parser.name == "title" && channelName == null) channelName = value
                    } else when (parser.name) {
                        "yt:videoId" -> current["id"] = value
                        "title" -> current["title"] = value
                        "published" -> current["published"] = value
                        "name" -> current["author"] = value
                        "entry" -> {
                            current["id"]?.let { id ->
                                val date = current["published"]?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }
                                videos.add(
                                    VideoItem(
                                        id = id,
                                        title = current["title"] ?: "",
                                        channelName = current["author"] ?: channelName,
                                        channelId = channelId,
                                        thumbnail = current["thumbnail"],
                                        viewCountText = current["views"]?.toLongOrNull()?.let(NumberText::views),
                                        publishedText = date?.let(NumberText::relative),
                                        publishedDate = date,
                                        isShort = current["link"]?.contains("/shorts/") == true,
                                    ),
                                )
                            }
                            entry = null
                        }
                    }
                }
            }
            event = parser.next()
        }
        return videos
    }
}

/** Crowd-sourced in-video sponsor segments (https://sponsor.ajay.app). */
object SponsorBlock {
    val allCategories = listOf(
        "sponsor" to "Nhà tài trợ",
        "selfpromo" to "Tự quảng cáo",
        "interaction" to "Nhắc đăng ký / tương tác",
        "intro" to "Đoạn mở đầu",
        "outro" to "Đoạn kết",
        "preview" to "Xem trước / tóm tắt",
        "music_offtopic" to "Đoạn không phải nhạc",
        "filler" to "Nội dung lan man",
    )

    fun title(category: String): String = allCategories.firstOrNull { it.first == category }?.second ?: category

    /** Uses the hash-prefix API so the exact video id is never sent. */
    suspend fun segments(videoId: String, categories: List<String>): List<SponsorSegment> = withContext(Dispatchers.IO) {
        if (categories.isEmpty()) return@withContext emptyList()
        runCatching {
            val digest = MessageDigest.getInstance("SHA-256").digest(videoId.toByteArray()).joinToString("") { "%02x".format(it) }
            val url = "https://sponsor.ajay.app/api/skipSegments/${digest.take(4)}".toHttpUrl().newBuilder()
                .addQueryParameter("categories", categories.joinToString(",", "[", "]") { "\"$it\"" })
                .build()
            InnerTube.client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                val json = JNode.parse(response.body?.string() ?: "[]")
                val entry = json.array.firstOrNull { it["videoID"].string == videoId } ?: return@use emptyList()
                entry["segments"].array.mapNotNull { segment ->
                    if ((segment["actionType"].string ?: "skip") != "skip") return@mapNotNull null
                    val start = segment["segment"][0].double ?: return@mapNotNull null
                    val end = segment["segment"][1].double ?: return@mapNotNull null
                    if (end <= start) return@mapNotNull null
                    SponsorSegment(start, end, segment["category"].string ?: "sponsor")
                }.sortedBy { it.start }
            }
        }.getOrDefault(emptyList())
    }
}

data class CaptionCue(val start: Double, val end: Double, val text: String)

object CaptionLoader {
    /** Downloads a caption track in YouTube's `json3` format, optionally machine translated. */
    suspend fun load(track: CaptionTrack, translateTo: String?): List<CaptionCue> = withContext(Dispatchers.IO) {
        val builder = track.baseUrl.toHttpUrl().newBuilder().removeAllQueryParameters("fmt").removeAllQueryParameters("tlang")
            .addQueryParameter("fmt", "json3")
        if (translateTo != null && translateTo != track.languageCode) builder.addQueryParameter("tlang", translateTo)
        InnerTube.client.newCall(Request.Builder().url(builder.build()).build()).execute().use { response ->
            val json = JNode.parse(response.body?.string() ?: "{}")
            json["events"].array.mapNotNull { event ->
                val start = event["tStartMs"].double ?: return@mapNotNull null
                val text = event["segs"].array.mapNotNull { it["utf8"].string }.joinToString("").trim()
                if (text.isEmpty()) return@mapNotNull null
                val duration = event["dDurationMs"].double ?: 2000.0
                CaptionCue(start / 1000, (start + duration) / 1000, text)
            }
        }
    }
}

/** Vietnamese-friendly number/date formatting for values we compute ourselves. */
object NumberText {
    fun compact(value: Long): String {
        val vi = APIConfig.hl == "vi"
        val formatter = NumberFormat.getNumberInstance(Locale.forLanguageTag(APIConfig.hl))
        fun format(v: Double, suffix: String): String {
            formatter.maximumFractionDigits = if (v < 10) 1 else 0
            return formatter.format(v) + suffix
        }
        val d = value.toDouble()
        return when {
            d >= 1_000_000_000 -> format(d / 1_000_000_000, if (vi) " T" else "B")
            d >= 1_000_000 -> format(d / 1_000_000, if (vi) " Tr" else "M")
            d >= 1_000 -> format(d / 1_000, if (vi) " N" else "K")
            else -> value.toString()
        }
    }

    fun views(value: Long): String = compact(value) + if (APIConfig.hl == "vi") " lượt xem" else " views"

    fun relative(epochMs: Long): String =
        DateUtils.getRelativeTimeSpanString(epochMs, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()
}

/** Dislike counts estimated by Return YouTube Dislike (only the video id is sent). */
object ReturnYouTubeDislike {
    private val cache = HashMap<String, Long>()

    suspend fun dislikes(videoId: String): Long? {
        synchronized(cache) { cache[videoId] }?.let { return it }
        val count = withContext(Dispatchers.IO) {
            runCatching {
                val url = "https://returnyoutubedislikeapi.com/votes".toHttpUrl().newBuilder()
                    .addQueryParameter("videoId", videoId).build()
                InnerTube.client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    JNode.parse(response.body?.string() ?: "{}")["dislikes"].long
                }
            }.getOrNull()
        } ?: return null
        synchronized(cache) {
            if (cache.size > 200) cache.clear()
            cache[videoId] = count
        }
        return count
    }
}
