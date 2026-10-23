package com.dangdvd.dvdtube.cast

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.PlayerInfo
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.player.PlayerController
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Chromecast / Google TV through Google's Cast framework (discovery, sessions, device
 * picker). The TV runs the Default Media Receiver and gets the same ad-free stream the app
 * plays, relayed through the phone first ([CastRelay]).
 */
object CastController {
    var isConnected by mutableStateOf(false)
        private set
    var deviceName by mutableStateOf<String?>(null)
        private set
    /** What the TV is doing ("Đang tải…", errors), null while it simply plays. */
    var statusText by mutableStateOf<String?>(null)
        private set
    var isAvailable by mutableStateOf(false)
        private set

    private lateinit var appContext: Context
    private var castContext: CastContext? = null
    private var session: CastSession? = null
    private var loadJob: Job? = null
    private var loadingVideo: VideoItem? = null
    private var candidates = listOf<Candidate>()
    private var startAtMs = 0L
    private var workingKind: String? = null
    /** The current TV item already reported its end (so autoplay runs once). */
    private var finishHandled = false

    private data class Candidate(
        val url: String,
        val contentType: String,
        val segmentFormat: String?,
        val videoSegmentFormat: String?,
        val live: Boolean,
        val kind: String,
    )

    fun init(context: Context) {
        appContext = context.applicationContext
        castContext = runCatching { CastContext.getSharedInstance(appContext) }
            .onFailure { Log.debug("cast unavailable: ${it.message}") }
            .getOrNull()
        isAvailable = castContext != null
        castContext?.sessionManager?.addSessionManagerListener(sessionListener, CastSession::class.java)
        castContext?.sessionManager?.currentCastSession?.takeIf { it.isConnected }?.let { attach(it, resumed = true) }
    }

    private val sessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarted(session: CastSession, sessionId: String) = attach(session, resumed = false)
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = attach(session, resumed = true)
        override fun onSessionEnded(session: CastSession, error: Int) = detach()
        override fun onSessionSuspended(session: CastSession, reason: Int) = Unit
        override fun onSessionStarting(session: CastSession) {
            statusText = "Đang kết nối…"
        }
        override fun onSessionStartFailed(session: CastSession, error: Int) {
            statusText = null
            Log.debug("cast: session start failed ($error)")
        }
        override fun onSessionEnding(session: CastSession) = Unit
        override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
        override fun onSessionResumeFailed(session: CastSession, error: Int) = Unit
    }

    private fun attach(newSession: CastSession, resumed: Boolean) {
        session = newSession
        deviceName = newSession.castDevice?.friendlyName
        isConnected = true
        statusText = null
        newSession.remoteMediaClient?.let { client ->
            client.registerCallback(mediaCallback)
            client.addProgressListener(progressListener, 500)
        }
        PlayerController.castDidConnect()
        Log.debug("cast: connected to ${deviceName ?: "TV"}")
        val video = PlayerController.currentVideo
        if (video != null && (!resumed || newSession.remoteMediaClient?.mediaInfo == null)) {
            load(video, PlayerController.streamsFor(video.id), PlayerController.currentTime)
        }
    }

    private fun detach() {
        session?.remoteMediaClient?.let { client ->
            client.unregisterCallback(mediaCallback)
            client.removeProgressListener(progressListener)
        }
        session = null
        loadJob?.cancel()
        loadingVideo = null
        val wasConnected = isConnected
        isConnected = false
        deviceName = null
        statusText = null
        AppScope.launch(Dispatchers.IO) { CastRelay.stop() }
        if (wasConnected) PlayerController.castDidEnd()
        Log.debug("cast: disconnected")
    }

    fun disconnect() {
        castContext?.sessionManager?.endCurrentSession(true)
    }

    private val client: RemoteMediaClient? get() = session?.remoteMediaClient

    // MARK: Loading

    /** Plays a video on the connected TV (fetching its streams if needed). */
    fun load(video: VideoItem, info: PlayerInfo?, startAt: Double) {
        if (!isConnected) return
        loadJob?.cancel()
        loadingVideo = video
        startAtMs = (startAt * 1000).toLong()
        statusText = "Đang tải video lên TV…"
        loadJob = AppScope.launch {
            try {
                val streams = info?.takeIf { it.videoId == video.id } ?: YouTubeService.player(video.id)
                if (loadingVideo?.id != video.id) return@launch
                // Streams only start working once YouTube's server-side ad wait is over.
                val wait = streams.availableAt - System.currentTimeMillis()
                if (wait > 0) {
                    statusText = "Đang chờ ${(wait + 999) / 1000} giây…"
                    delay(wait)
                }
                val relayed = streams.hlsUrl?.let { hls ->
                    withContext(Dispatchers.IO) {
                        runCatching { CastRelay.prepare(appContext, hls) }
                            .onFailure { Log.debug("cast relay unavailable: ${it.message}") }
                            .getOrNull()
                    }
                }?.let {
                    Candidate(it.url, "application/x-mpegurl", if (it.isFmp4) "fmp4" else "ts",
                        if (it.isFmp4) "fmp4" else "mpeg2_ts", streams.isLive, "relay-hls")
                }
                candidates = makeCandidates(streams, relayed)
                if (candidates.isEmpty()) {
                    statusText = "Video này không phát được trên TV."
                    loadingVideo = null
                    return@launch
                }
                tryCandidate(video, 0)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                statusText = "Không tải được video: ${error.message}"
                loadingVideo = null
            }
        }
    }

    /** The stream relayed through the phone first; then the TV fetching YouTube directly. */
    private fun makeCandidates(info: PlayerInfo, relayed: Candidate?): List<Candidate> {
        val list = ArrayList<Candidate>()
        relayed?.let(list::add)
        info.hlsUrl?.let { hls ->
            list.add(Candidate(hls, "application/x-mpegurl", "fmp4", "fmp4", info.isLive, "hls-fmp4"))
            list.add(Candidate(hls, "application/x-mpegurl", null, null, info.isLive, "hls"))
        }
        if (!info.isLive) {
            info.muxedFormats.filter { it.mimeType.contains("mp4") }.maxByOrNull { it.height ?: 0 }?.let {
                list.add(Candidate(it.url, "video/mp4", null, null, false, "mp4"))
            }
        }
        workingKind?.let { kind ->
            val index = list.indexOfFirst { it.kind == kind }
            if (index > 0) list.add(0, list.removeAt(index))
        }
        return list
    }

    private fun tryCandidate(video: VideoItem, index: Int) {
        val remote = client ?: return
        if (loadingVideo?.id != video.id) return
        val candidate = candidates.getOrNull(index) ?: run {
            loadingVideo = null
            statusText = "TV không phát được video này."
            return
        }
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, video.title)
            putString(MediaMetadata.KEY_SUBTITLE, video.channelName ?: "")
            addImage(WebImage(Uri.parse(video.displayThumbnail)))
        }
        val mediaInfo = MediaInfo.Builder(candidate.url)
            .setContentType(candidate.contentType)
            .setStreamType(if (candidate.live) MediaInfo.STREAM_TYPE_LIVE else MediaInfo.STREAM_TYPE_BUFFERED)
            .setMetadata(metadata)
            .apply {
                candidate.segmentFormat?.let { setHlsSegmentFormat(it) }
                candidate.videoSegmentFormat?.let { setHlsVideoSegmentFormat(it) }
            }
            .build()
        val request = MediaLoadRequestData.Builder()
            .setMediaInfo(mediaInfo)
            .setAutoplay(true)
            .setCurrentTime(if (candidate.live) 0 else startAtMs)
            .build()
        Log.debug("cast: LOAD ${video.id} as ${candidate.kind}")
        remote.load(request).setResultCallback { result ->
            if (loadingVideo?.id != video.id) return@setResultCallback
            if (result.status.isSuccess) {
                workingKind = candidate.kind
                finishHandled = false
                loadingVideo = null
                statusText = null
            } else {
                Log.debug("cast: stream ${candidate.kind} failed (${result.status.statusCode} ${result.status.statusMessage ?: ""})")
                tryCandidate(video, index + 1)
            }
        }
    }

    // MARK: Status

    private val progressListener = RemoteMediaClient.ProgressListener { progress, duration ->
        val remote = client ?: return@ProgressListener
        val state = remote.playerState
        PlayerController.applyCastStatus(
            time = progress / 1000.0,
            total = if (duration > 0) duration / 1000.0 else null,
            playing = state == MediaStatus.PLAYER_STATE_PLAYING || state == MediaStatus.PLAYER_STATE_BUFFERING,
            buffering = state == MediaStatus.PLAYER_STATE_BUFFERING,
        )
    }

    private val mediaCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() {
            val status = client?.mediaStatus ?: return
            if (status.playerState == MediaStatus.PLAYER_STATE_IDLE && status.idleReason == MediaStatus.IDLE_REASON_FINISHED) {
                if (!finishHandled && loadingVideo == null) {
                    finishHandled = true
                    PlayerController.castDidFinish()
                }
            }
            if (status.playerState == MediaStatus.PLAYER_STATE_IDLE && status.idleReason == MediaStatus.IDLE_REASON_ERROR) {
                Log.debug("cast: TV reported a playback error")
                statusText = "TV không phát được video này. Thử lại hoặc dùng điện thoại."
            }
        }
    }

    // MARK: Playback control

    fun play() {
        val remote = client ?: return
        if (remote.mediaInfo == null || remote.playerState == MediaStatus.PLAYER_STATE_IDLE) {
            PlayerController.currentVideo?.let { load(it, PlayerController.streamsFor(it.id), PlayerController.currentTime) }
            return
        }
        remote.play()
    }

    fun pause() {
        client?.pause()
    }

    fun seek(seconds: Double) {
        client?.seek(MediaSeekOptions.Builder().setPosition((seconds * 1000).toLong()).build())
    }

    fun stopMedia() {
        loadingVideo = null
        client?.stop()
    }
}
