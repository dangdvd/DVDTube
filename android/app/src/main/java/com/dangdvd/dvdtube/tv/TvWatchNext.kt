package com.dangdvd.dvdtube.tv

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.HistoryEntry
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.services.DeArrow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * The Android TV launcher's "Xem tiếp" (Watch Next) row: unfinished videos of the history as
 * CONTINUE programs with their progress and poster, opening `dvdtube://watch?v=<id>&t=<s>`.
 * Finished videos and videos removed from the history are taken off the row.
 */
object TvWatchNext {
    private const val KEY = "tv.watchNext.ids"
    private const val MAX_PROGRAMS = 10
    // TvContractCompat constants (PreviewProgramColumns / WatchNextPrograms).
    private const val TYPE_CLIP = 4
    private const val ASPECT_RATIO_16_9 = 0
    private const val WATCH_NEXT_TYPE_CONTINUE = 0

    private fun stored(): MutableMap<String, Long> = runCatching {
        val json = JSONObject(AppSettings.store.getString(KEY, null) ?: "{}")
        json.keys().asSequence().associateWith { json.getLong(it) }.toMutableMap()
    }.getOrDefault(mutableMapOf())

    private fun store(map: Map<String, Long>) {
        val json = JSONObject()
        map.forEach { (id, program) -> json.put(id, program) }
        AppSettings.store.edit().putString(KEY, json.toString()).apply()
    }

    /** Brings the row in line with [history] (call off the main thread is not needed: it switches itself). */
    suspend fun sync(context: Context, history: List<HistoryEntry>) = withContext(Dispatchers.IO) {
        val resolver = context.applicationContext.contentResolver
        val wanted = history.asSequence()
            .filter { !it.video.isShort && !it.video.isLive && it.duration > 0 && it.progress in 0.03..0.95 }
            .distinctBy { it.video.id }
            .take(MAX_PROGRAMS)
            .toList()
        val programs = stored()
        // Remove what is finished or no longer in the history.
        val wantedIds = wanted.map { it.video.id }.toSet()
        for ((id, program) in programs.toMap()) {
            if (id in wantedIds) continue
            runCatching { resolver.delete(TvContractCompat.buildWatchNextProgramUri(program), null, null) }
            programs.remove(id)
        }
        for (entry in wanted) {
            val video = entry.video
            val title = DeArrow.title(video.id, video.title) ?: video.title.ifEmpty { "Video" }
            val program = WatchNextProgram.Builder()
                .setType(TYPE_CLIP)
                .setWatchNextType(WATCH_NEXT_TYPE_CONTINUE)
                .setLastEngagementTimeUtcMillis(entry.watchedAt)
                .setTitle(title)
                .setDescription(video.channelName ?: "")
                .setPosterArtUri(Uri.parse(video.displayThumbnail))
                .setPosterArtAspectRatio(ASPECT_RATIO_16_9)
                .setDurationMillis((entry.duration * 1000).toInt())
                .setLastPlaybackPositionMillis((entry.position * 1000).toInt())
                .setIntentUri(Uri.parse("dvdtube://watch?v=${video.id}&t=${entry.position.toInt()}"))
                .setInternalProviderId(video.id)
                .build()
            val values = program.toContentValues()
            val existing = programs[video.id]
            val updated = existing != null && runCatching {
                resolver.update(TvContractCompat.buildWatchNextProgramUri(existing), values, null, null) > 0
            }.getOrDefault(false)
            if (!updated) {
                val uri = runCatching { resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, values) }
                    .onFailure { Log.debug("watch next: insert failed (${it.message})") }
                    .getOrNull()
                if (uri != null) programs[video.id] = ContentUris.parseId(uri) else programs.remove(video.id)
            }
        }
        store(programs)
    }
}
