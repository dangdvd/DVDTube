package com.dangdvd.dvdtube.player

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.dangdvd.dvdtube.cast.CastController
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.CaptionTrack
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.PlayerInfo
import com.dangdvd.dvdtube.core.SponsorSegment
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.innertube.InnerTubeException
import com.dangdvd.dvdtube.core.services.CaptionCue
import com.dangdvd.dvdtube.core.services.CaptionLoader
import com.dangdvd.dvdtube.core.services.SponsorBlock
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.LibraryStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.abs
import kotlin.math.ceil

/**
 * Owns the one ExoPlayer used for regular videos and everything around it: queue, history,
 * captions, SponsorBlock, the media notification, background audio and the web fallback.
 */
object PlayerController {
    private lateinit var appContext: Context
    lateinit var exo: ExoPlayer
        private set
    /** What the media session (notification, headset buttons) controls. */
    lateinit var sessionPlayer: Player
        private set

    // MARK: Published state

    var currentVideo by mutableStateOf<VideoItem?>(null)
        private set
    var playerInfo by mutableStateOf<PlayerInfo?>(null)
        private set
    var watchInfo by mutableStateOf<WatchInfo?>(null)
        private set
    var watchInfoError by mutableStateOf<String?>(null)
        private set
    var playbackError by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isBuffering by mutableStateOf(false)
        private set
    var currentTime by mutableStateOf(0.0)
        private set
    var duration by mutableStateOf(0.0)
        private set
    var bufferedTime by mutableStateOf(0.0)
        private set
    var adWaitRemaining by mutableStateOf(0)
        private set
    var isLocalPlayback by mutableStateOf(false)
        private set
    /** True while the official web embed is used because the native stream was refused. */
    var usesWebPlayer by mutableStateOf(false)
        private set
    var webFallbackReason by mutableStateOf<String?>(null)
        private set

    var isExpanded by mutableStateOf(false)
    var isFullscreen by mutableStateOf(false)
    var isInPictureInPicture by mutableStateOf(false)

    var quality by mutableStateOf(VideoQuality.AUTO)
        private set
    var rate by mutableStateOf(1f)
        private set

    var captionTracks by mutableStateOf(listOf<CaptionTrack>())
        private set
    var selectedCaption by mutableStateOf<CaptionTrack?>(null)
        private set
    var captionTranslation by mutableStateOf<String?>(null)
        private set
    var currentCaption by mutableStateOf<String?>(null)
        private set
    private var captionCues = listOf<CaptionCue>()

    var sponsorSegments by mutableStateOf(listOf<SponsorSegment>())
        private set

    var queue by mutableStateOf(listOf<VideoItem>())
        private set
    var queueIndex by mutableStateOf(0)
        private set

    var isLooping by mutableStateOf(false)
        private set
    var sleepTimerEnd by mutableStateOf<Long?>(null)
        private set
    var sleepAtEndOfVideo by mutableStateOf(false)
        private set
    var isSpeedBoosted by mutableStateOf(false)
        private set
    /** Pinch in fullscreen: crop to fill the screen. */
    var videoFill by mutableStateOf(false)
        private set
    var upNext by mutableStateOf<VideoItem?>(null)
        private set
    var upNextCountdown by mutableStateOf(0)
        private set

    val hasNext: Boolean get() = queueIndex + 1 < queue.size || nextAutoplayVideo != null
    val hasPrevious: Boolean get() = queueIndex > 0 || currentTime > 5
    val autoplayEnabled: Boolean get() = AppSettings.autoplay
    val isCasting: Boolean get() = CastController.isConnected

    // MARK: Private state

    private var loadJob: Job? = null
    private var watchJob: Job? = null
    private var sleepJob: Job? = null
    private var upNextJob: Job? = null
    private val skippedSegments = HashSet<Double>()
    private var lastHistorySave = 0L
    private var fallbackStage = 0
    private var pendingSeek: Double? = null
    private var webView: WebView? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private val dataSourceFactory by lazy {
        val http = OkHttpDataSource.Factory(InnerTube.client)
            .setUserAgent(APIConfig.playerProfiles.first().resolvedUserAgent(APIConfig.gl))
        DefaultDataSource.Factory(appContext, http)
    }

    fun init(context: Context) {
        appContext = context.applicationContext
        exo = ExoPlayer.Builder(appContext)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        exo.addListener(listener)
        sessionPlayer = SessionPlayer(exo)
        rate = AppSettings.playbackSpeed
        startTicker()
    }

    // MARK: Public API

    fun play(video: VideoItem, newQueue: List<VideoItem>? = null, startAt: Double? = null) {
        ShortsPlayer.pause()
        if (video.id == currentVideo?.id && playbackError == null && newQueue == null) {
            isExpanded = true
            if (!isPlaying) resume()
            return
        }
        saveProgress()
        when {
            newQueue != null -> {
                queue = newQueue
                queueIndex = newQueue.indexOfFirst { it.id == video.id }.coerceAtLeast(0)
            }
            queue.any { it.id == video.id } -> queueIndex = queue.indexOfFirst { it.id == video.id }
            else -> {
                queue = listOf(video)
                queueIndex = 0
            }
        }
        start(video, startAt)
        isExpanded = true
    }

    fun playQueueItem(index: Int) {
        if (index !in queue.indices) return
        saveProgress()
        queueIndex = index
        start(queue[index], null)
    }

    fun addToQueue(video: VideoItem) {
        if (currentVideo == null) {
            play(video)
            return
        }
        queue = queue.filter { it.id != video.id || it.id == currentVideo?.id } + video
        Toasts.show("Đã thêm vào hàng đợi")
    }

    fun removeFromQueue(index: Int) {
        if (index !in queue.indices || index == queueIndex) return
        queue = queue.toMutableList().also { it.removeAt(index) }
        if (index < queueIndex) queueIndex--
    }

    fun playNext() {
        if (queueIndex + 1 < queue.size) {
            playQueueItem(queueIndex + 1)
        } else {
            val next = nextAutoplayVideo ?: return
            saveProgress()
            queue = queue + next
            queueIndex = queue.size - 1
            start(next, null)
        }
    }

    fun playPrevious() {
        if (currentTime > 5 || queueIndex == 0) seek(0.0) else playQueueItem(queueIndex - 1)
    }

    fun togglePlayPause() = if (isPlaying) pause() else resume()

    fun resume() {
        if (isCasting) {
            CastController.play()
            return
        }
        if (usesWebPlayer) {
            webCommand("var v=document.querySelector('video'); if (v) v.play();")
            return
        }
        val video = currentVideo ?: return
        if (exo.mediaItemCount == 0) {
            start(video, currentTime)
            return
        }
        if (exo.playbackState == Player.STATE_ENDED || (duration > 0 && currentTime >= duration - 0.5)) exo.seekTo(0)
        if (exo.playbackState == Player.STATE_IDLE) exo.prepare()
        exo.play()
    }

    fun pause() {
        if (isCasting) {
            CastController.pause()
            saveProgress()
            return
        }
        if (usesWebPlayer) webCommand("var v=document.querySelector('video'); if (v) v.pause();")
        exo.pause()
        saveProgress()
    }

    fun seek(seconds: Double) {
        val target = maxOf(0.0, if (duration > 0) minOf(seconds, duration - 0.25) else seconds)
        currentTime = target
        when {
            isCasting -> CastController.seek(target)
            usesWebPlayer -> webCommand("var v=document.querySelector('video'); if (v) v.currentTime=$target;")
            else -> exo.seekTo((target * 1000).toLong())
        }
    }

    fun skip(seconds: Double) = seek(currentTime + seconds)

    fun close() {
        saveProgress()
        if (isCasting) CastController.stopMedia()
        cancelUpNext()
        loadJob?.cancel()
        watchJob?.cancel()
        exo.stop()
        exo.clearMediaItems()
        currentVideo = null
        playerInfo = null
        watchInfo = null
        usesWebPlayer = false
        queue = emptyList()
        isExpanded = false
        isFullscreen = false
        isPlaying = false
    }

    fun retry() {
        val video = currentVideo ?: return
        start(video, if (currentTime > 0) currentTime else null)
    }

    fun setQuality(value: VideoQuality) {
        quality = value
        applyQuality()
        val video = currentVideo
        if (fallbackStage >= 2 && video != null && !isLocalPlayback) {
            // Separate video + audio cannot adapt: rebuild at the new quality.
            start(video, currentTime)
        }
    }

    fun setPlaybackRate(value: Float) {
        rate = value
        exo.setPlaybackSpeed(value)
        AppSettings.playbackSpeed = value
    }

    fun selectCaption(track: CaptionTrack?, translateTo: String? = null) {
        selectedCaption = track
        captionTranslation = translateTo
        captionCues = emptyList()
        currentCaption = null
        AppSettings.captionsEnabled = track != null
        track ?: return
        val videoId = currentVideo?.id
        AppScope.launch {
            val cues = runCatching { CaptionLoader.load(track, translateTo) }.getOrDefault(emptyList())
            if (currentVideo?.id != videoId || selectedCaption != track) return@launch
            captionCues = cues
            if (cues.isEmpty()) Toasts.show("Không tải được phụ đề")
        }
    }

    fun refreshWatchInfo() {
        val video = currentVideo ?: return
        loadWatchInfo(video.id)
    }

    // MARK: Loading

    private fun start(video: VideoItem, startAt: Double?) {
        upNextJob?.cancel()
        upNext = null
        isLooping = false
        exo.repeatMode = Player.REPEAT_MODE_OFF
        endSpeedBoost()
        loadJob?.cancel()
        exo.stop()
        exo.clearMediaItems()
        currentVideo = video
        playerInfo = null
        playbackError = null
        currentTime = startAt ?: 0.0
        duration = video.durationSeconds?.toDouble() ?: 0.0
        bufferedTime = 0.0
        adWaitRemaining = 0
        sponsorSegments = emptyList()
        skippedSegments.clear()
        captionTracks = emptyList()
        selectedCaption = null
        captionCues = emptyList()
        currentCaption = null
        fallbackStage = 0
        isLocalPlayback = false
        usesWebPlayer = false
        webFallbackReason = null
        quality = defaultQuality()
        isLoading = true
        pendingSeek = startAt ?: if (AppSettings.resumePlayback) LibraryStore.resumePosition(video.id) else null
        if (AppSettings.saveHistory) LibraryStore.recordWatch(video, pendingSeek ?: 0.0, duration)
        loadWatchInfo(video.id)

        if (isCasting) {
            // Plays on the TV; the phone only shows the controls.
            isLoading = false
            CastController.load(video, null, pendingSeek ?: 0.0)
            pendingSeek = null
            return
        }
        loadJob = AppScope.launch { loadStream(video) }
    }

    private fun defaultQuality(): VideoQuality {
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
        return if (connectivity?.isActiveNetworkMetered == true) AppSettings.cellularQuality else AppSettings.wifiQuality
    }

    private fun loadWatchInfo(videoId: String) {
        watchJob?.cancel()
        watchInfo = null
        watchInfoError = null
        watchJob = AppScope.launch {
            try {
                val info = YouTubeService.watchInfo(videoId)
                if (currentVideo?.id != videoId) return@launch
                watchInfo = info
                enrichCurrentVideo(info)
                val channel = info.channel
                val subscribed = info.isSubscribed
                if (channel != null && subscribed != null) AccountStore.noteSubscription(channel.id, subscribed)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                watchInfoError = error.message
            }
        }
    }

    private suspend fun loadStream(video: VideoItem) {
        DownloadManager.localFile(video.id)?.let { file ->
            isLocalPlayback = true
            startSource(progressive(Uri.fromFile(file).toString(), video), video)
            return
        }
        try {
            val info = YouTubeService.player(video.id)
            if (currentVideo?.id != video.id) return
            playerInfo = info
            Log.debug("stream ${video.id}: hls=${info.hlsUrl != null} adaptive=${info.adaptiveFormats.size} muxed=${info.muxedFormats.size} captions=${info.captions.size} adWait=${(info.availableAt - System.currentTimeMillis()) / 1000}s")
            captionTracks = info.captions
            if (duration <= 0 && info.lengthSeconds != null) duration = info.lengthSeconds.toDouble()
            enrichCurrentVideo(info)

            var remaining = info.availableAt - System.currentTimeMillis()
            while (remaining > 300) {
                adWaitRemaining = ceil(remaining / 1000.0).toInt()
                delay(minOf(remaining, 1000L))
                remaining = info.availableAt - System.currentTimeMillis()
            }
            adWaitRemaining = 0

            val source = makeSource(info, fallbackStage, video) ?: throw InnerTubeException.NoStreams()
            if (currentVideo?.id != video.id) return
            startSource(source, video)
            loadExtras(video.id, info)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (currentVideo?.id != video.id) return
            Log.debug("stream ${video.id} failed: ${error.message}")
            if (shouldUseWebFallback(error)) {
                switchToWebPlayer(error.message)
                return
            }
            isLoading = false
            playbackError = error.message ?: "Không phát được video."
        }
    }

    private fun mediaItem(uri: String, video: VideoItem): MediaItem =
        MediaItem.Builder()
            .setUri(uri)
            .setMediaId(video.id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(video.title.ifEmpty { playerInfo?.title })
                    .setArtist(video.channelName ?: playerInfo?.author)
                    .setArtworkUri(Uri.parse(video.displayThumbnail))
                    .build(),
            )
            .build()

    private fun progressive(uri: String, video: VideoItem): MediaSource =
        ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem(uri, video))

    /** Stage 0: HLS (adaptive, best). Stage 1: muxed progressive. Stage 2: video + audio merged. */
    private fun makeSource(info: PlayerInfo, stage: Int, video: VideoItem): MediaSource? {
        for (s in stage..2) {
            when (s) {
                0 -> info.hlsUrl?.let {
                    fallbackStage = 0
                    return HlsMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem(it, video))
                }
                1 -> info.muxedFormats.filter { it.mimeType.contains("mp4") }.maxByOrNull { it.height ?: 0 }?.let {
                    fallbackStage = 1
                    return progressive(it.url, video)
                }
                else -> {
                    val videoFormat = info.bestVideo(quality.maxHeight ?: 1080)
                    val audioFormat = info.bestAudio
                    if (videoFormat != null && audioFormat != null) {
                        fallbackStage = 2
                        return MergingMediaSource(progressive(videoFormat.url, video), progressive(audioFormat.url, video))
                    }
                }
            }
        }
        return null
    }

    private fun startSource(source: MediaSource, video: VideoItem) {
        if (currentVideo?.id != video.id) return
        exo.setMediaSource(source)
        applyQuality()
        exo.setPlaybackSpeed(rate)
        exo.prepare()
        pendingSeek?.takeIf { it > 0 }?.let {
            exo.seekTo((it * 1000).toLong())
            currentTime = it
        }
        pendingSeek = null
        exo.playWhenReady = true
    }

    private fun applyQuality() {
        val height = quality.maxHeight
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setMaxVideoSize(if (height == null) Int.MAX_VALUE else height * 16 / 9 + 1, height ?: Int.MAX_VALUE)
            .build()
    }

    private fun loadExtras(videoId: String, info: PlayerInfo) {
        if (AppSettings.sponsorBlockEnabled && !info.isLive) {
            val categories = AppSettings.sponsorBlockCategories
            AppScope.launch {
                val segments = SponsorBlock.segments(videoId, categories)
                if (currentVideo?.id == videoId) sponsorSegments = segments
            }
        }
        if (AppSettings.captionsEnabled) {
            val preferred = AppSettings.captionLanguage
            val exact = info.captions.firstOrNull { it.languageCode.startsWith(preferred) && !it.isAutoGenerated }
            if (exact != null) {
                selectCaption(exact)
            } else {
                info.captions.firstOrNull { it.isTranslatable }?.let { selectCaption(it, preferred) }
            }
        }
    }

    private fun enrichCurrentVideo(info: PlayerInfo) {
        val video = currentVideo ?: return
        if (video.id != info.videoId) return
        var updated = video
        if (updated.title.isEmpty()) updated = updated.copy(title = info.title)
        if (updated.channelName == null) updated = updated.copy(channelName = info.author)
        if (updated.channelId == null) updated = updated.copy(channelId = info.channelId)
        if (updated.durationSeconds == null && info.lengthSeconds != null && !info.isLive) {
            updated = updated.copy(durationSeconds = info.lengthSeconds, durationText = com.dangdvd.dvdtube.core.formatDuration(info.lengthSeconds))
        }
        if (info.isLive && !updated.isLive) updated = updated.copy(isLive = true)
        if (updated != video) {
            currentVideo = updated
            replaceInQueue(updated)
        }
    }

    private fun enrichCurrentVideo(info: WatchInfo) {
        val video = currentVideo ?: return
        if (video.id != info.videoId) return
        var updated = video
        if (updated.title.isEmpty() && info.title.isNotEmpty()) updated = updated.copy(title = info.title)
        info.channel?.let { channel ->
            updated = updated.copy(
                channelName = updated.channelName ?: channel.name,
                channelId = updated.channelId ?: channel.id,
                channelAvatar = updated.channelAvatar ?: channel.avatar,
            )
            LibraryStore.updateSubscription(channel)
        }
        if (updated != video) {
            currentVideo = updated
            replaceInQueue(updated)
        }
    }

    private fun replaceInQueue(video: VideoItem) {
        val index = queue.indexOfFirst { it.id == video.id }
        if (index >= 0) queue = queue.toMutableList().also { it[index] = video }
    }

    private val nextAutoplayVideo: VideoItem?
        get() {
            if (!AppSettings.autoplay) return null
            val related = watchInfo?.related?.videos ?: return null
            val recent = LibraryStore.history.take(50).map { it.video.id }.toSet() + queue.map { it.id }
            return related.firstOrNull { it.id !in recent && !it.isLive && !it.isShort } ?: related.firstOrNull { !it.isShort }
        }

    // MARK: Player events

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            if (isCasting || usesWebPlayer) return
            isPlaying = playing || (exo.playWhenReady && exo.playbackState == Player.STATE_BUFFERING)
        }

        override fun onPlaybackStateChanged(state: Int) {
            if (isCasting || usesWebPlayer) return
            isBuffering = state == Player.STATE_BUFFERING
            when (state) {
                Player.STATE_READY -> {
                    isLoading = false
                    playbackError = null
                    val total = exo.duration
                    if (total != C.TIME_UNSET && total > 0) duration = total / 1000.0
                }
                Player.STATE_ENDED -> handleEnded()
                else -> Unit
            }
            isPlaying = exo.isPlaying || (exo.playWhenReady && state == Player.STATE_BUFFERING)
        }

        override fun onPlayerError(error: PlaybackException) {
            val message = error.message ?: "Không phát được video."
            Log.debug("player error at stage $fallbackStage: ${error.errorCodeName} $message")
            val info = playerInfo
            val video = currentVideo ?: return
            if (info != null && fallbackStage < 2 && !isLocalPlayback) {
                // Try the next way of playing the same video.
                val resumeAt = currentTime
                fallbackStage += 1
                loadJob = AppScope.launch {
                    val next = makeSource(info, fallbackStage, video)
                    if (next != null) {
                        pendingSeek = resumeAt
                        startSource(next, video)
                    } else if (AppSettings.webPlayerFallback) {
                        switchToWebPlayer(message)
                    } else {
                        isLoading = false
                        playbackError = message
                    }
                }
            } else if (AppSettings.webPlayerFallback && !isLocalPlayback) {
                switchToWebPlayer(message)
            } else {
                isLoading = false
                playbackError = message
            }
        }
    }

    private fun handleEnded() {
        saveProgress(completed = true)
        if (sleepAtEndOfVideo) {
            sleepAtEndOfVideo = false
            isPlaying = false
            Toasts.show("Đã hết giờ hẹn – tạm dừng phát")
            return
        }
        val hasQueued = queueIndex + 1 < queue.size
        val next = if (hasQueued) queue[queueIndex + 1] else nextAutoplayVideo
        if ((!AppSettings.autoplay && !hasQueued) || next == null) {
            isPlaying = false
            return
        }
        // "Up next" card with a short countdown, like the official app.
        isPlaying = false
        upNext = next
        upNextJob?.cancel()
        upNextJob = AppScope.launch {
            for (remaining in 5 downTo 1) {
                upNextCountdown = remaining
                delay(1000)
            }
            if (upNext != null) {
                upNext = null
                playNext()
            }
        }
    }

    // MARK: Player extras

    fun cancelUpNext() {
        upNextJob?.cancel()
        upNext = null
    }

    fun playUpNextNow() {
        upNextJob?.cancel()
        upNext = null
        playNext()
    }

    fun setLooping(on: Boolean) {
        isLooping = on
        exo.repeatMode = if (on) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        Toasts.show(if (on) "Đã bật phát lặp lại" else "Đã tắt phát lặp lại")
    }

    /** `null` turns the timer off, `0` stops at the end of the current video. */
    fun setSleepTimer(minutes: Int?) {
        sleepJob?.cancel()
        sleepTimerEnd = null
        sleepAtEndOfVideo = false
        if (minutes == null) {
            Toasts.show("Đã tắt hẹn giờ")
            return
        }
        if (minutes == 0) {
            sleepAtEndOfVideo = true
            Toasts.show("Sẽ dừng khi hết video này")
            return
        }
        val millis = minutes * 60_000L
        sleepTimerEnd = System.currentTimeMillis() + millis
        Toasts.show("Sẽ dừng phát sau $minutes phút")
        sleepJob = AppScope.launch {
            delay(millis)
            sleepTimerEnd = null
            pause()
            Toasts.show("Đã hết giờ hẹn – tạm dừng phát")
        }
    }

    /** Touch and hold the video to watch at 2x until released. */
    fun beginSpeedBoost() {
        if (!isPlaying || usesWebPlayer || isCasting || isSpeedBoosted) return
        isSpeedBoosted = true
        exo.setPlaybackSpeed(2f)
    }

    fun endSpeedBoost() {
        if (!isSpeedBoosted) return
        isSpeedBoosted = false
        exo.setPlaybackSpeed(rate)
    }

    fun setVideoFill(fill: Boolean) {
        if (fill == videoFill) return
        videoFill = fill
        Toasts.show(if (fill) "Thu phóng để lấp đầy màn hình" else "Kích thước gốc")
    }

    fun toggleAutoplay() {
        AppSettings.autoplay = !AppSettings.autoplay
        Toasts.show(if (AppSettings.autoplay) "Tự động phát: Bật" else "Tự động phát: Tắt")
    }

    // MARK: Ticker

    private fun startTicker() {
        AppScope.launch {
            while (isActive) {
                delay(250)
                runCatching { tick() }
            }
        }
    }

    private fun tick() {
        if (isCasting || usesWebPlayer || exo.mediaItemCount == 0) return
        val seconds = exo.currentPosition / 1000.0
        if (abs(seconds - currentTime) > 0.2) currentTime = seconds
        val buffered = exo.bufferedPosition / 1000.0
        if (abs(buffered - bufferedTime) > 1) bufferedTime = buffered
        val total = exo.duration
        if (total != C.TIME_UNSET && total > 0 && abs(total / 1000.0 - duration) > 1) duration = total / 1000.0
        val id = currentVideo?.id ?: return
        if (seconds > 10) AccountStore.reportWatched(id, duration)

        sponsorSegments.firstOrNull { seconds >= it.start && seconds < it.end - 0.5 }?.let { segment ->
            if (skippedSegments.add(segment.start)) {
                seek(segment.end)
                Toasts.show("Đã bỏ qua: ${SponsorBlock.title(segment.category)}")
            }
        }

        if (captionCues.isNotEmpty()) {
            val text = captionCues.filter { seconds >= it.start && seconds < it.end }.takeLast(2).joinToString("\n") { it.text }
            val caption = text.ifEmpty { null }
            if (caption != currentCaption) currentCaption = caption
        }

        if (System.currentTimeMillis() - lastHistorySave > 10_000) saveProgress()
    }

    private fun saveProgress(completed: Boolean = false) {
        val video = currentVideo ?: return
        if (currentTime <= 0 && !completed) return
        lastHistorySave = System.currentTimeMillis()
        LibraryStore.updatePosition(video.id, if (completed) duration else currentTime, duration)
    }

    /** Called when the app goes to the background without Picture in Picture. */
    fun appDidEnterBackground() {
        saveProgress()
        if (currentVideo == null || isCasting) return
        if (!AppSettings.backgroundPlayback && !isInPictureInPicture) pause()
    }

    // MARK: Web player fallback

    private fun shouldUseWebFallback(error: Exception): Boolean {
        if (!AppSettings.webPlayerFallback || isLocalPlayback) return false
        return when (error) {
            is InnerTubeException.LoginRequired, is InnerTubeException.NoStreams, is InnerTubeException.Http -> true
            is InnerTubeException -> false
            is java.io.IOException -> false
            else -> true
        }
    }

    fun switchToWebPlayer(reason: String? = null) {
        if (currentVideo == null) return
        Log.debug("switching to web player: ${reason ?: "manual"}")
        loadJob?.cancel()
        exo.stop()
        exo.clearMediaItems()
        pendingSeek = if (currentTime > 1) currentTime else pendingSeek
        usesWebPlayer = true
        webFallbackReason = reason
        playbackError = null
        adWaitRemaining = 0
        isLoading = true
    }

    fun switchToNativePlayer() {
        val video = currentVideo ?: return
        usesWebPlayer = false
        start(video, if (currentTime > 1) currentTime else null)
    }

    /** Start offset for the embed (resume position or where native playback stopped). */
    val webStartTime: Double get() = pendingSeek ?: 0.0

    fun registerWebView(view: WebView?) {
        webView = view
    }

    fun handleWebEvent(time: Double, total: Double, paused: Boolean, isAd: Boolean, error: String?) {
        mainHandler.post {
            if (!usesWebPlayer) return@post
            if (!error.isNullOrEmpty()) {
                if (playbackError != error) Log.debug("web player error: $error")
                isLoading = false
                playbackError = error
                return@post
            }
            if (time >= 0 && !isAd) {
                currentTime = time
                if (time > 0) isLoading = false
            }
            if (isAd) Log.debug("web player: skipping an ad")
            if (total > 0 && !isAd) duration = total
            isPlaying = !paused
            if (System.currentTimeMillis() - lastHistorySave > 10_000) saveProgress()
        }
    }

    private fun webCommand(script: String) {
        webView?.evaluateJavascript(script, null)
    }

    // MARK: Chromecast

    /** The TV took over: stop local playback (the phone becomes a remote). */
    fun castDidConnect() {
        loadJob?.cancel()
        if (usesWebPlayer) {
            webCommand("var v=document.querySelector('video'); if (v) v.pause();")
            usesWebPlayer = false
        }
        exo.stop()
        exo.clearMediaItems()
        endSpeedBoost()
        isLoading = false
        isBuffering = false
        playbackError = null
        adWaitRemaining = 0
    }

    fun applyCastStatus(time: Double, total: Double?, playing: Boolean, buffering: Boolean) {
        val id = currentVideo?.id ?: return
        currentTime = time
        if (total != null && total > 0) duration = total
        isPlaying = playing
        isBuffering = buffering
        if (time > 10) AccountStore.reportWatched(id, duration)
        if (System.currentTimeMillis() - lastHistorySave > 10_000) saveProgress()
    }

    fun castDidFinish() = handleEnded()

    /** Casting stopped: the phone continues from the same position when play is pressed. */
    fun castDidEnd() {
        isPlaying = false
        isBuffering = false
        saveProgress()
    }

    /** The phone's own stream info for the TV (avoids a second player request). */
    fun streamsFor(videoId: String): PlayerInfo? = playerInfo?.takeIf { it.videoId == videoId }

    /** Local file of a downloaded video, if any (cannot be cast). */
    fun localFile(videoId: String): File? = DownloadManager.localFile(videoId)

    /** Notification / headset controls go through the app's own logic. */
    private class SessionPlayer(player: ExoPlayer) : ForwardingPlayer(player) {
        override fun getAvailableCommands(): Player.Commands =
            super.getAvailableCommands().buildUpon()
                .add(Player.COMMAND_SEEK_TO_NEXT)
                .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build()

        override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)

        override fun play() = PlayerController.resume()
        override fun pause() = PlayerController.pause()
        override fun seekToNext() = PlayerController.playNext()
        override fun seekToNextMediaItem() = PlayerController.playNext()
        override fun seekToPrevious() = PlayerController.playPrevious()
        override fun seekToPreviousMediaItem() = PlayerController.playPrevious()
    }
}
