package com.dangdvd.dvdtube.tv

import android.app.UiModeManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.lifecycleScope
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.cast.DvdCastReceiver
import com.dangdvd.dvdtube.core.services.AppUpdater
import com.dangdvd.dvdtube.core.services.NewVideoWorker
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.player.PlaybackService
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.ShortsPlayer
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** DVDTube on Android TV: the 10-foot interface, driven with the remote's D-pad. */
class TvActivity : ComponentActivity() {
    private var controllerFuture: ListenableFuture<MediaController>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { TvApp() }
        if (savedInstanceState == null) handleIntent(intent)
        // "Truyền tới DVDTube": phones and PCs on the network can send videos to this TV.
        DvdCastReceiver.start(this)
        lifecycleScope.launch { AppUpdater.checkAtLaunch() }
        // The launcher's "Xem tiếp" row follows the history.
        lifecycleScope.launch {
            snapshotFlow { LibraryStore.history.take(12).map { it.video.id to (it.position / 30).toInt() } }
                .collect {
                    delay(4000)
                    if (isTelevision(this@TvActivity)) runCatching { TvWatchNext.sync(this@TvActivity, LibraryStore.history) }
                }
        }
        // Keep the screen on while a video plays.
        lifecycleScope.launch {
            snapshotFlow { PlayerController.isPlaying || ShortsPlayer.isPlaying }.collect { playing ->
                if (playing) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        AppUpdater.resumePendingInstall(this)
    }

    override fun onDestroy() {
        if (isFinishing) DvdCastReceiver.stop()
        super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        // The media session (remote / Assistant play-pause) lives in the playback service.
        controllerFuture = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
    }

    override fun onStop() {
        super.onStop()
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        if (!isChangingConfigurations) {
            // TV convention: leaving the app (Home button, input change) pauses.
            PlayerController.pause()
            ShortsPlayer.pause()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** YouTube links (from MainActivity on a TV) and shared / searched text. */
    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val data = intent.data
        if (data != null && data.scheme == "dvdtube") {
            handleDvdtubeLink(data)
            return
        }
        intent.getStringExtra(NewVideoWorker.EXTRA_VIDEO_ID)?.let { id ->
            TvNav.play(VideoItem(id = id, title = intent.getStringExtra(NewVideoWorker.EXTRA_TITLE) ?: ""))
            return
        }
        val text = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_SEARCH -> intent.getStringExtra("query")
            else -> null
        }?.trim() ?: return
        if (text.isEmpty()) return
        val link = Regex("https?://\\S+").find(text)?.value ?: text
        val videoId = YouTubeService.videoId(link)
        when {
            videoId != null -> {
                val isShort = link.contains("/shorts/")
                val video = VideoItem(id = videoId, isShort = isShort)
                if (isShort) TvNav.openShorts(listOf(video), video) else TvNav.play(video)
            }
            link.contains("/@") || link.contains("/channel/") -> {
                val id = link.substringAfter("/channel/", "").substringBefore('/').substringBefore('?').ifEmpty {
                    "@" + link.substringAfter("/@").substringBefore('/').substringBefore('?')
                }
                TvNav.openChannel(ChannelItem(id = id))
            }
            link.contains("list=") -> TvNav.open(TvRoute.Playlist(PlaylistItem(link.substringAfter("list=").substringBefore('&'))))
            intent.action != Intent.ACTION_VIEW -> TvNav.open(TvRoute.SearchResults(text))
        }
    }

    /** `dvdtube://watch?v=<id>[&t=<s>]` (Watch Next), `search?q=`, `shorts`, `music` and `sync` (shows the QR code). */
    private fun handleDvdtubeLink(data: android.net.Uri) {
        when (data.host) {
            "watch" -> {
                val id = data.getQueryParameter("v")?.trim()?.takeIf { it.isNotEmpty() } ?: return
                val start = data.getQueryParameter("t")?.trim()?.removeSuffix("s")?.toDoubleOrNull()?.takeIf { it > 0 }
                val known = LibraryStore.history.firstOrNull { it.video.id == id }?.video ?: VideoItem(id = id)
                TvNav.play(known, startAt = start)
            }
            "search" -> {
                val query = data.getQueryParameter("q")?.trim().orEmpty()
                if (query.isEmpty()) TvNav.select(TvSection.SEARCH) else TvNav.open(TvRoute.SearchResults(query))
            }
            "shorts" -> TvNav.select(TvSection.SHORTS)
            "music" -> TvNav.select(TvSection.MUSIC)
            "sync" -> TvNav.open(TvRoute.SyncReceive())
            "home" -> TvNav.select(TvSection.HOME)
            "subscriptions" -> TvNav.select(TvSection.SUBSCRIPTIONS)
        }
    }

    companion object {
        /** Android TV / Google TV (or any device in TV mode). */
        fun isTelevision(context: Context): Boolean {
            val uiMode = context.getSystemService(UiModeManager::class.java)?.currentModeType
            return uiMode == Configuration.UI_MODE_TYPE_TELEVISION ||
                context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        }
    }
}
