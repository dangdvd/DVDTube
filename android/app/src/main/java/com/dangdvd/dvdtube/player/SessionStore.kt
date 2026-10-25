package com.dangdvd.dvdtube.player

import android.content.Context
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.storage.AppScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.Executors

/**
 * Remembers what was playing (video, position, queue, index, playlist) so the next launch can put
 * it back, paused, in the mini player. Saved shortly after every change and when the app leaves.
 */
object SessionStore {
    @Serializable
    data class Saved(
        val video: VideoItem,
        val position: Double,
        val duration: Double,
        val queue: List<VideoItem> = emptyList(),
        val index: Int = 0,
        val playlistId: String? = null,
        val music: Boolean = false,
        val savedAt: Long = 0L,
    )

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    /** Writes and deletes run in order on one thread. */
    private val writer = Executors.newSingleThreadExecutor()
    private var file: File? = null
    private var job: Job? = null

    fun init(context: Context) {
        file = File(context.filesDir, "session.json")
    }

    /** Saves a moment later (changes come in bursts). */
    fun schedule() {
        job?.cancel()
        job = AppScope.launch {
            delay(1500)
            saveNow()
        }
    }

    fun saveNow() {
        job?.cancel()
        job = null
        val target = file ?: return
        val snapshot = PlayerController.sessionSnapshot() ?: return
        val text = runCatching { json.encodeToString(Saved.serializer(), snapshot) }.getOrNull() ?: return
        writer.execute {
            runCatching {
                val temp = File(target.parentFile, "session.json.tmp")
                temp.writeText(text)
                if (!temp.renameTo(target)) {
                    target.writeText(text)
                    temp.delete()
                }
            }
        }
    }

    fun clear() {
        job?.cancel()
        job = null
        val target = file ?: return
        writer.execute { runCatching { target.delete() } }
    }

    /** The last session (at most two weeks old). */
    fun load(): Saved? {
        val target = file ?: return null
        val saved = runCatching { json.decodeFromString(Saved.serializer(), target.readText()) }.getOrNull() ?: return null
        if (System.currentTimeMillis() - saved.savedAt > 14 * 86_400_000L) return null
        return saved
    }
}
