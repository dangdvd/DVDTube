package com.dangdvd.dvdtube.core.services

import android.content.Context
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.innertube.InnerTube
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * DeArrow (https://dearrow.ajay.app): crowd-sourced titles and thumbnails that replace clickbait.
 * Uses the hash-prefix API (only the first 4 hex digits of sha256(videoId) are sent). Results are
 * cached for an hour in memory and in a small file; at most 4 requests run at a time.
 */
object DeArrow {
    /** What DeArrow has for a video (null fields keep YouTube's own). */
    data class Branding(val title: String?, val thumbnailUrl: String?)

    private const val TTL = 3_600_000L
    private const val MAX_ENTRIES = 600
    private val memory = LinkedHashMap<String, Pair<Long, Branding>>()
    private val inFlight = HashMap<String, CompletableDeferred<Branding?>>()
    private val semaphore = Semaphore(4)
    @Volatile private var cacheFile: File? = null
    @Volatile private var diskLoaded = false
    @Volatile private var lastDiskSave = 0L
    /** Thumbnail URLs that failed to load (kept out for this run). */
    private val badThumbnails = HashSet<String>()

    val isEnabled: Boolean get() = AppSettings.deArrow && (AppSettings.deArrowTitles || AppSettings.deArrowThumbnails)

    fun init(context: Context) {
        cacheFile = File(context.cacheDir, "dearrow.json")
    }

    /** The cached branding (fresh), without any network request. */
    fun cached(videoId: String): Branding? {
        loadDisk()
        return synchronized(memory) {
            val entry = memory[videoId] ?: return null
            if (System.currentTimeMillis() - entry.first > TTL) null else entry.second
        }
    }

    /** Title to show instead of [original], when DeArrow has one (and titles are on). */
    fun title(videoId: String, original: String): String? {
        if (!AppSettings.deArrow || !AppSettings.deArrowTitles) return null
        val title = cached(videoId)?.title ?: return null
        return title.takeIf { it.isNotBlank() && it != original }
    }

    /** Fetches (or reuses) the branding of [videoId]; never throws. */
    suspend fun branding(videoId: String): Branding? {
        if (!isEnabled || videoId.isBlank()) return null
        cached(videoId)?.let { return it }
        val (deferred, owner) = synchronized(inFlight) {
            inFlight[videoId]?.let { it to false } ?: CompletableDeferred<Branding?>().also { inFlight[videoId] = it }.let { it to true }
        }
        if (!owner) return deferred.await()
        val result = runCatching { semaphore.withPermit { fetch(videoId) } }.getOrNull()
        synchronized(inFlight) { inFlight.remove(videoId) }
        deferred.complete(result)
        return result
    }

    fun markThumbnailBad(url: String) {
        synchronized(badThumbnails) { badThumbnails += url }
    }

    fun isThumbnailBad(url: String): Boolean = synchronized(badThumbnails) { url in badThumbnails }

    private fun sha256Prefix(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }.take(4)

    private suspend fun fetch(videoId: String): Branding? = withContext(Dispatchers.IO) {
        cached(videoId)?.let { return@withContext it }
        val url = "https://sponsor.ajay.app/api/branding/${sha256Prefix(videoId)}"
        val text = InnerTube.client.newCall(Request.Builder().url(url).header("Accept", "application/json").build()).execute().use { response ->
            if (response.code == 404) return@use "{}"
            if (!response.isSuccessful) {
                Log.debug("dearrow -> HTTP ${response.code}")
                return@use null
            }
            response.body?.string()
        } ?: return@withContext null
        val json = runCatching { JNode.parse(text) }.getOrNull() ?: return@withContext null
        val now = System.currentTimeMillis()
        var mine: Branding? = null
        // Every video of the same hash prefix comes back: cache them all.
        for (id in json.keys) {
            val branding = parse(id, json[id])
            if (id == videoId) mine = branding
            synchronized(memory) { memory[id] = now to branding }
        }
        val result = mine ?: Branding(null, null)
        synchronized(memory) {
            memory[videoId] = now to result
            while (memory.size > MAX_ENTRIES) memory.remove(memory.keys.first())
        }
        saveDisk()
        result
    }

    private fun parse(videoId: String, entry: JNode): Branding {
        val title = entry["titles"].array.firstOrNull { item ->
            item["original"].bool == false && ((item["votes"].double ?: -1.0) >= 0 || item["locked"].bool == true)
        }?.get("title")?.string?.trim()?.removePrefix(">")?.trim()?.takeIf { it.isNotEmpty() }
        val thumbnail = entry["thumbnails"].array.firstOrNull { item ->
            item["original"].bool == false && ((item["votes"].double ?: -1.0) >= 0 || item["locked"].bool == true) &&
                item["timestamp"].double != null
        }?.let { item ->
            val time = item["timestamp"].string ?: return@let null
            "https://dearrow-thumb.ajay.app/api/v1/getThumbnail".toHttpUrl().newBuilder()
                .addQueryParameter("videoID", videoId)
                .addQueryParameter("time", time)
                .build().toString()
        }
        return Branding(title, thumbnail)
    }

    // MARK: Disk cache

    private fun loadDisk() {
        if (diskLoaded) return
        diskLoaded = true
        val file = cacheFile ?: return
        runCatching {
            if (!file.exists()) return
            val json = JSONObject(file.readText())
            val now = System.currentTimeMillis()
            synchronized(memory) {
                for (id in json.keys()) {
                    val item = json.optJSONObject(id) ?: continue
                    val at = item.optLong("at")
                    if (now - at > TTL) continue
                    val title = item.optString("title").takeIf { item.has("title") && it.isNotEmpty() }
                    val thumb = item.optString("thumb").takeIf { item.has("thumb") && it.isNotEmpty() }
                    memory[id] = at to Branding(title, thumb)
                }
            }
        }
    }

    private fun saveDisk() {
        val file = cacheFile ?: return
        val now = System.currentTimeMillis()
        if (now - lastDiskSave < 10_000) return
        lastDiskSave = now
        runCatching {
            val json = JSONObject()
            synchronized(memory) {
                for ((id, entry) in memory) {
                    if (now - entry.first > TTL) continue
                    val item = JSONObject().put("at", entry.first)
                    entry.second.title?.let { item.put("title", it) }
                    entry.second.thumbnailUrl?.let { item.put("thumb", it) }
                    json.put(id, item)
                }
            }
            file.writeText(json.toString())
        }
    }
}
