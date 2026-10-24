package com.dangdvd.dvdtube.core.storage

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.StreamFormat
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.core.formatDuration
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.innertube.InnerTubeException
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.player.Toasts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import kotlin.coroutines.coroutineContext

@Serializable
data class DownloadedVideo(
    val video: VideoItem,
    val fileName: String,
    val fileSize: Long,
    val qualityLabel: String? = null,
    val downloadedAt: Long,
    /** Only the sound, as an `.m4a` file. */
    val isAudioOnly: Boolean = false,
)

sealed class DownloadState {
    /** Waiting in the queue (e.g. a whole playlist being downloaded one by one). */
    data object Queued : DownloadState()
    data object Preparing : DownloadState()
    data class Downloading(val progress: Double) : DownloadState()
    data object Merging : DownloadState()
    data class Failed(val message: String) : DownloadState()
}

/**
 * Offline downloads: fetches the H.264 video + AAC audio streams in chunks and merges them
 * into a regular `.mp4`, or only the AAC audio into an `.m4a`.
 */
object DownloadManager {
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var folder: File
    private lateinit var indexFile: File
    private lateinit var appContext: Context
    private val jobs = HashMap<String, Job>()

    private data class QueuedDownload(val video: VideoItem, val audioOnly: Boolean)
    /** Downloads waiting their turn (one at a time), e.g. a whole playlist. */
    private val queue = ArrayDeque<QueuedDownload>()
    private var queueJob: Job? = null

    var downloads by mutableStateOf(listOf<DownloadedVideo>())
        private set
    var states by mutableStateOf(mapOf<String, DownloadState>())
        private set
    /** Titles of downloads in progress or queued, for the downloads screen. */
    var activeTitles by mutableStateOf(mapOf<String, String>())
        private set

    fun init(context: Context) {
        appContext = context.applicationContext
        folder = File(context.getExternalFilesDir(null) ?: context.filesDir, "Downloads").apply { mkdirs() }
        indexFile = File(context.filesDir, "downloads.json")
        downloads = runCatching {
            json.decodeFromString(ListSerializer(DownloadedVideo.serializer()), indexFile.readText())
        }.getOrDefault(emptyList()).filter { File(folder, it.fileName).exists() }
    }

    val activeCount: Int get() = states.values.count { it !is DownloadState.Failed }
    val totalSize: Long get() = downloads.sumOf { it.fileSize }

    fun entry(videoId: String): DownloadedVideo? = downloads.firstOrNull { it.video.id == videoId }

    fun localFile(videoId: String): File? {
        val entry = downloads.firstOrNull { it.video.id == videoId } ?: return null
        return File(folder, entry.fileName).takeIf { it.exists() }
    }

    fun isDownloaded(videoId: String) = localFile(videoId) != null

    private fun setState(id: String, state: DownloadState?) {
        states = if (state == null) states - id else states + (id to state)
    }

    private fun isBusy(videoId: String): Boolean = jobs.containsKey(videoId) || queue.any { it.video.id == videoId }

    private fun blockedByNetwork(): Boolean {
        if (AppSettings.downloadOnWifiOnly && AppSettings.isMeteredNetwork) {
            Toasts.show("Chỉ tải xuống khi có Wi-Fi (đổi trong Cài đặt › Tải xuống)")
            return true
        }
        return false
    }

    /** [quality] overrides the download quality setting; [audioOnly] saves just the sound (.m4a). */
    fun download(video: VideoItem, audioOnly: Boolean = false, quality: VideoQuality? = null) {
        if (isBusy(video.id) || isDownloaded(video.id)) return
        if (blockedByNetwork()) return
        setState(video.id, DownloadState.Preparing)
        activeTitles = activeTitles + (video.id to video.title.ifEmpty { video.id })
        jobs[video.id] = AppScope.launch { run(video, audioOnly, quality) }
        Toasts.show(if (audioOnly) "Đang tải âm thanh…" else "Đang tải xuống…")
    }

    /** Queues every video (e.g. of a playlist); they download one after another. */
    fun downloadAll(videos: List<VideoItem>, audioOnly: Boolean) {
        if (blockedByNetwork()) return
        val fresh = videos.distinctBy { it.id }.filter { !it.isLive && !isBusy(it.id) && !isDownloaded(it.id) }
        if (fresh.isEmpty()) {
            Toasts.show("Các video này đã được tải xuống")
            return
        }
        for (video in fresh) {
            queue.addLast(QueuedDownload(video, audioOnly))
            setState(video.id, DownloadState.Queued)
        }
        activeTitles = activeTitles + fresh.associate { it.id to it.title.ifEmpty { it.id } }
        Toasts.show("Đã thêm ${fresh.size} video vào hàng đợi tải xuống")
        if (queueJob?.isActive != true) queueJob = AppScope.launch { drainQueue() }
    }

    private suspend fun drainQueue() {
        while (true) {
            val next = queue.removeFirstOrNull() ?: break
            if (states[next.video.id] != DownloadState.Queued) continue
            setState(next.video.id, DownloadState.Preparing)
            val job = AppScope.launch { run(next.video, next.audioOnly, null) }
            jobs[next.video.id] = job
            job.join()
        }
    }

    fun cancel(videoId: String) {
        queue.removeAll { it.video.id == videoId }
        jobs.remove(videoId)?.cancel()
        setState(videoId, null)
        activeTitles = activeTitles - videoId
    }

    fun delete(videoId: String) {
        cancel(videoId)
        downloads.firstOrNull { it.video.id == videoId }?.let { File(folder, it.fileName).delete() }
        downloads = downloads.filter { it.video.id != videoId }
        save()
    }

    fun deleteAll() = downloads.map { it.video.id }.forEach(::delete)

    private fun save() {
        val snapshot = downloads
        AppScope.launch(Dispatchers.IO) {
            runCatching { indexFile.writeText(json.encodeToString(ListSerializer(DownloadedVideo.serializer()), snapshot)) }
        }
    }

    /** Copies a download into the phone's Movies (or Music, for audio) folder. */
    fun exportToGallery(videoId: String) {
        val entry = downloads.firstOrNull { it.video.id == videoId } ?: return
        val source = File(folder, entry.fileName)
        val audio = entry.isAudioOnly
        AppScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    val resolver = appContext.contentResolver
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, entry.fileName)
                        put(MediaStore.MediaColumns.MIME_TYPE, if (audio) "audio/mp4" else "video/mp4")
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            put(MediaStore.MediaColumns.RELATIVE_PATH,
                                (if (audio) Environment.DIRECTORY_MUSIC else Environment.DIRECTORY_MOVIES) + "/DVDTube")
                        }
                    }
                    val collection = when {
                        audio && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
                            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        audio -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        else -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    }
                    val uri = resolver.insert(collection, values) ?: error("insert failed")
                    resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } }
                    true
                }.getOrDefault(false)
            }
            Toasts.show(when {
                !ok -> "Không lưu được vào thư viện"
                audio -> "Đã lưu vào thư mục Music/DVDTube"
                else -> "Đã lưu vào thư mục Movies/DVDTube"
            })
        }
    }

    private suspend fun run(video: VideoItem, audioOnly: Boolean, quality: VideoQuality?) {
        val temp = File(appContext.cacheDir, "dl-${video.id}").apply { mkdirs() }
        try {
            val info = YouTubeService.player(video.id)
            if (info.isLive) throw InnerTubeException.Unplayable("Không thể tải xuống video trực tiếp.")
            val wait = info.availableAt - System.currentTimeMillis()
            if (wait > 0) delay(wait)

            var item = video
            if (item.title.isEmpty()) item = item.copy(title = info.title)
            item = item.copy(channelName = item.channelName ?: info.author, channelId = item.channelId ?: info.channelId)
            if (item.durationSeconds == null && info.lengthSeconds != null) {
                item = item.copy(durationSeconds = info.lengthSeconds, durationText = formatDuration(info.lengthSeconds))
            }

            val fileName = fileName(item, if (audioOnly) "m4a" else "mp4")
            val output = File(folder, fileName)
            output.delete()
            val maxHeight = (quality ?: AppSettings.downloadQuality).maxHeight ?: 1080
            val qualityLabel: String?
            val videoFormat = info.bestVideo(maxHeight)
            val audioFormat = info.bestAudio
            if (audioOnly) {
                // itag 140 (AAC 128 kbps) in the original language plays everywhere.
                val audio = info.adaptiveFormats.firstOrNull { it.itag == 140 && it.isDefaultAudio } ?: audioFormat
                    ?: throw InnerTubeException.NoStreams()
                val raw = File(temp, "audio.m4a")
                val total = maxOf(audio.contentLength ?: 1L, 1L).toDouble()
                fetch(audio, raw) { done -> report(video.id, done / total) }
                setState(video.id, DownloadState.Merging)
                withContext(Dispatchers.IO) { remuxOrCopyAudio(raw, output) }
                qualityLabel = "Âm thanh ${audio.bitrate / 1000} kbps"
            } else if (videoFormat != null && audioFormat != null) {
                val videoFile = File(temp, "video.mp4")
                val audioFile = File(temp, "audio.m4a")
                val videoLength = videoFormat.contentLength ?: 0L
                val total = maxOf(videoLength + (audioFormat.contentLength ?: 0L), 1L).toDouble()
                fetch(videoFormat, videoFile) { done -> report(video.id, done / total) }
                fetch(audioFormat, audioFile) { done -> report(video.id, (videoLength + done) / total) }
                setState(video.id, DownloadState.Merging)
                withContext(Dispatchers.IO) { mux(videoFile, audioFile, output) }
                qualityLabel = videoFormat.qualityLabel
            } else {
                val muxed = info.muxedFormats.maxByOrNull { it.height ?: 0 } ?: throw InnerTubeException.NoStreams()
                val total = maxOf(muxed.contentLength ?: 1L, 1L).toDouble()
                fetch(muxed, output) { done -> report(video.id, done / total) }
                qualityLabel = muxed.qualityLabel
            }
            downloads = listOf(DownloadedVideo(item, fileName, output.length(), qualityLabel, System.currentTimeMillis(), audioOnly)) +
                downloads.filter { it.video.id != video.id }
            save()
            setState(video.id, null)
            Toasts.show("Đã tải xong: ${item.title}")
        } catch (error: CancellationException) {
            setState(video.id, null)
        } catch (error: Exception) {
            Log.debug("download ${video.id} failed: ${error.message}")
            setState(video.id, DownloadState.Failed(error.message ?: "Lỗi tải xuống"))
        } finally {
            temp.deleteRecursively()
            jobs.remove(video.id)
            activeTitles = activeTitles - video.id
        }
    }

    private fun report(id: String, progress: Double) {
        if (!jobs.containsKey(id)) return
        setState(id, DownloadState.Downloading(progress.coerceIn(0.0, 1.0)))
    }

    private fun fileName(video: VideoItem, extension: String): String {
        val title = video.title.replace(Regex("[/\\\\?%*|\"<>:]"), " ").trim().take(80)
        return (if (title.isEmpty()) video.id else "$title [${video.id}]") + ".$extension"
    }

    /** Downloads in 10 MB `range=` chunks; googlevideo throttles single large requests. */
    private suspend fun fetch(format: StreamFormat, destination: File, progress: (Long) -> Unit) = withContext(Dispatchers.IO) {
        val length = format.contentLength ?: 0L
        FileOutputStream(destination).use { out ->
            if (length <= 0) {
                InnerTube.client.newCall(Request.Builder().url(format.url).build()).execute().use { response ->
                    if (response.code !in 200..299) throw InnerTubeException.Http(response.code)
                    response.body?.byteStream()?.copyTo(out)
                }
                return@withContext
            }
            val chunk = 10L shl 20
            var offset = 0L
            var failures = 0
            while (offset < length) {
                coroutineContext.ensureActive()
                val end = minOf(offset + chunk, length) - 1
                val url = format.url.toHttpUrl().newBuilder().removeAllQueryParameters("range")
                    .addQueryParameter("range", "$offset-$end").build()
                try {
                    InnerTube.client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                        if (response.code !in 200..299) throw InnerTubeException.Http(response.code)
                        val bytes = response.body?.bytes() ?: ByteArray(0)
                        if (bytes.isEmpty()) throw InnerTubeException.InvalidResponse()
                        out.write(bytes)
                        offset += bytes.size
                    }
                    failures = 0
                    withContext(Dispatchers.Main) { progress(offset) }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    failures++
                    if (failures > 3) throw error
                    delay(failures * 1000L)
                }
            }
        }
    }

    /** DASH audio is fragmented; a plain MP4 container works in every player (else keep it as is). */
    private fun remuxOrCopyAudio(raw: File, output: File) {
        if (runCatching { remuxAudio(raw, output) }.isSuccess) return
        output.delete()
        raw.copyTo(output, overwrite = true)
    }

    /** Rewrites a fragmented (DASH) audio file as a regular MP4 audio file, without re-encoding. */
    private fun remuxAudio(input: File, output: File) {
        val extractor = MediaExtractor().apply { setDataSource(input.path) }
        val muxer = MediaMuxer(output.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        try {
            val track = (0 until extractor.trackCount).first {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            }
            extractor.selectTrack(track)
            val out = muxer.addTrack(extractor.getTrackFormat(track))
            muxer.start()
            val buffer = ByteBuffer.allocate(1 shl 20)
            val info = MediaCodec.BufferInfo()
            while (true) {
                buffer.clear()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                info.set(0, size, extractor.sampleTime, MediaCodec.BUFFER_FLAG_KEY_FRAME)
                muxer.writeSampleData(out, buffer, info)
                extractor.advance()
            }
            muxer.stop()
        } finally {
            runCatching { muxer.release() }
            extractor.release()
        }
    }

    /** Merges the video and audio tracks into one MP4 without re-encoding. */
    private fun mux(video: File, audio: File, output: File) {
        val videoExtractor = MediaExtractor().apply { setDataSource(video.path) }
        val audioExtractor = MediaExtractor().apply { setDataSource(audio.path) }
        val muxer = MediaMuxer(output.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        try {
            val videoTrack = (0 until videoExtractor.trackCount).first {
                videoExtractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
            }
            val audioTrack = (0 until audioExtractor.trackCount).first {
                audioExtractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            }
            videoExtractor.selectTrack(videoTrack)
            audioExtractor.selectTrack(audioTrack)
            val videoOut = muxer.addTrack(videoExtractor.getTrackFormat(videoTrack))
            val audioOut = muxer.addTrack(audioExtractor.getTrackFormat(audioTrack))
            muxer.start()
            val buffer = ByteBuffer.allocate(8 shl 20)
            val info = MediaCodec.BufferInfo()
            for ((extractor, track) in listOf(videoExtractor to videoOut, audioExtractor to audioOut)) {
                while (true) {
                    buffer.clear()
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) break
                    info.set(
                        0, size, extractor.sampleTime,
                        if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0,
                    )
                    muxer.writeSampleData(track, buffer, info)
                    extractor.advance()
                }
            }
            muxer.stop()
        } finally {
            runCatching { muxer.release() }
            videoExtractor.release()
            audioExtractor.release()
        }
    }
}
