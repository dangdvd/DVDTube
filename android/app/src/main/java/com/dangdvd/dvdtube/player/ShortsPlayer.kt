package com.dangdvd.dvdtube.player

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.PlayerInfo
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.innertube.InnerTubeException
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AppScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** A second, lightweight player dedicated to the Shorts feed (looping, prefetching). */
object ShortsPlayer {
    lateinit var exo: ExoPlayer
        private set

    var currentId by mutableStateOf<String?>(null)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var progress by mutableStateOf(0f)
        private set
    /** Shorts shown through the web embed because YouTube refused the native stream. */
    var webFallbackIds by mutableStateOf(setOf<String>())
        private set

    /** After a bot check, skip the player API for a while instead of hammering it. */
    private var blockedUntil = 0L
    private val cache = HashMap<String, PlayerInfo>()
    private var loadJob: Job? = null
    private lateinit var appContext: Context

    private val dataSourceFactory by lazy {
        DefaultDataSource.Factory(
            appContext,
            OkHttpDataSource.Factory(InnerTube.client).setUserAgent(APIConfig.playerProfiles.first().resolvedUserAgent(APIConfig.gl)),
        )
    }

    fun init(context: Context) {
        appContext = context.applicationContext
        exo = ExoPlayer.Builder(appContext).build().apply {
            repeatMode = Player.REPEAT_MODE_ONE
            addListener(object : Player.Listener {
                override fun onIsPlayingChanged(playing: Boolean) {
                    ShortsPlayer.isPlaying = playing
                    if (playing) ShortsPlayer.isLoading = false
                }

                override fun onPlayerError(playbackError: PlaybackException) {
                    Log.debug("short ${currentId ?: "?"} error: ${playbackError.errorCodeName}")
                    val id = currentId ?: return
                    if (AppSettings.webPlayerFallback) webFallbackIds = webFallbackIds + id else error = playbackError.message
                    ShortsPlayer.isLoading = false
                }
            })
        }
        AppScope.launch {
            while (isActive) {
                delay(200)
                val total = exo.duration
                if (total != C.TIME_UNSET && total > 0) progress = (exo.currentPosition.toFloat() / total).coerceIn(0f, 1f)
            }
        }
    }

    fun play(video: VideoItem) {
        PlayerController.pause()
        if (currentId == video.id) {
            resume()
            return
        }
        currentId = video.id
        error = null
        progress = 0f
        isLoading = true
        exo.stop()
        exo.clearMediaItems()
        loadJob?.cancel()
        if (AppSettings.webPlayerFallback && (System.currentTimeMillis() < blockedUntil || video.id in webFallbackIds)) {
            webFallbackIds = webFallbackIds + video.id
            isLoading = false
            return
        }
        loadJob = AppScope.launch {
            try {
                val info = info(video.id)
                var remaining = info.availableAt - System.currentTimeMillis()
                while (remaining > 300) {
                    delay(minOf(remaining, 1000L))
                    remaining = info.availableAt - System.currentTimeMillis()
                }
                if (currentId != video.id) return@launch
                val hls = info.hlsUrl
                val source = if (hls != null) {
                    HlsMediaSource.Factory(dataSourceFactory).createMediaSource(MediaItem.fromUri(hls))
                } else {
                    val url = info.muxedFormats.firstOrNull()?.url ?: throw InnerTubeException.NoStreams()
                    ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(MediaItem.fromUri(url))
                }
                Log.debug("short ${video.id}: playing ${if (hls != null) "HLS" else "muxed"}")
                exo.setMediaSource(source)
                exo.prepare()
                exo.playWhenReady = true
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                if (currentId != video.id) return@launch
                isLoading = false
                if (failure is InnerTubeException.LoginRequired && AppSettings.webPlayerFallback) {
                    Log.debug("short ${video.id}: bot check, using web player")
                    blockedUntil = System.currentTimeMillis() + 10 * 60_000
                    webFallbackIds = webFallbackIds + video.id
                } else {
                    error = failure.message
                }
            }
        }
    }

    /** Fetches stream info ahead of time for the next Shorts. */
    fun prefetch(videos: List<VideoItem>) {
        if (System.currentTimeMillis() < blockedUntil) return
        for (video in videos.take(2)) {
            if (cache.containsKey(video.id)) continue
            AppScope.launch { runCatching { info(video.id) } }
        }
    }

    private suspend fun info(videoId: String): PlayerInfo {
        cache[videoId]?.let { return it }
        val info = YouTubeService.player(videoId)
        cache[videoId] = info
        if (cache.size > 30) cache.keys.firstOrNull()?.let { cache.remove(it) }
        return info
    }

    fun resume() {
        if (currentId == null) return
        PlayerController.pause()
        exo.play()
    }

    fun pause() {
        if (::exo.isInitialized) exo.pause()
    }

    fun toggle() = if (exo.isPlaying) pause() else resume()

    fun stop() {
        loadJob?.cancel()
        currentId = null
        if (::exo.isInitialized) {
            exo.stop()
            exo.clearMediaItems()
        }
    }
}
