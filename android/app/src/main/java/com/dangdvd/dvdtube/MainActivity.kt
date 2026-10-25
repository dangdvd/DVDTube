package com.dangdvd.dvdtube

import android.Manifest
import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.net.Uri
import android.os.Bundle
import android.util.Rational
import android.view.OrientationEventListener
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.snapshotFlow
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.TvLogin
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.AppUpdater
import com.dangdvd.dvdtube.core.services.AutoDownloadWorker
import com.dangdvd.dvdtube.core.services.NewVideoWorker
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.core.sync.LanSync
import com.dangdvd.dvdtube.ui.AppTab
import com.dangdvd.dvdtube.widget.AppWidgets
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.player.PlaybackService
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.tv.TvActivity
import com.dangdvd.dvdtube.ui.DVDTubeTheme
import com.dangdvd.dvdtube.ui.MainScreen
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var orientationListener: OrientationEventListener? = null
    /** Fullscreen was entered by turning the phone (so turning it back leaves it). */
    private var fullscreenFromRotation = false

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (TvActivity.isTelevision(this)) {
            // On a TV, links and shared text open in the TV interface.
            startActivity(Intent(intent).setClass(this, TvActivity::class.java))
            finish()
            return
        }
        enableEdgeToEdge()
        setContent { DVDTubeTheme { MainScreen() } }
        // A recreated activity gets the launch intent again: it was already handled.
        if (savedInstanceState == null) {
            // Last session's queue, paused in the mini player ("Tiếp tục phát…"); a link opened now replaces it.
            if (!opensContent(intent)) PlayerController.restoreLastSession()
            handleIntent(intent)
        }
        NewVideoWorker.createChannel(this)
        NewVideoWorker.sync(this)
        AutoDownloadWorker.sync(this)
        lifecycleScope.launch { AppUpdater.checkAtLaunch() }
        // Home screen widgets follow the history.
        lifecycleScope.launch {
            snapshotFlow { LibraryStore.history.firstOrNull()?.let { it.video.id to (it.position / 30).toInt() } }
                .collect {
                    delay(3000)
                    AppWidgets.requestRefresh(this@MainActivity, network = false)
                }
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            // The media notification (background playback controls) needs it.
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        observePlayerLayout()
        setupRotationToFullscreen()
    }

    override fun onResume() {
        super.onResume()
        // Back from "install unknown apps": continue a pending update.
        AppUpdater.resumePendingInstall(this)
    }

    override fun onStart() {
        super.onStart()
        // Binding the media session service keeps playback alive in the background.
        controllerFuture = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
        orientationListener?.enable()
    }

    override fun onStop() {
        super.onStop()
        orientationListener?.disable()
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        if (!isInPictureInPictureMode && !isChangingConfigurations) PlayerController.appDidEnterBackground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (TvActivity.isTelevision(this)) {
            startActivity(Intent(intent).setClass(this, TvActivity::class.java))
            return
        }
        handleIntent(intent)
    }

    /** Whether [intent] opens something itself (then the last session is not restored). */
    private fun opensContent(intent: Intent?): Boolean {
        intent ?: return false
        if (intent.getStringExtra(NewVideoWorker.EXTRA_VIDEO_ID) != null) return true
        val data = intent.data
        if (data != null && data.scheme == "dvdtube") return data.host == "watch"
        return intent.action == Intent.ACTION_VIEW || intent.action == Intent.ACTION_SEND
    }

    /** YouTube links, shared text, `dvdtube://` links and taps on "new video" notifications. */
    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val data = intent.data
        if (data != null && data.scheme == "dvdtube") {
            handleDvdtubeLink(data, intent.dataString ?: "")
            return
        }
        intent.getStringExtra(NewVideoWorker.EXTRA_VIDEO_ID)?.let { id ->
            PlayerController.play(VideoItem(id = id, title = intent.getStringExtra(NewVideoWorker.EXTRA_TITLE) ?: ""))
            return
        }
        val text = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return
        val link = Regex("https?://\\S+").find(text)?.value ?: text
        val videoId = YouTubeService.videoId(link)
        when {
            videoId != null -> {
                val isShort = link.contains("/shorts/")
                val video = VideoItem(id = videoId, isShort = isShort)
                if (isShort) Router.openShorts(listOf(video), video) else PlayerController.play(video)
            }
            link.contains("/@") || link.contains("/channel/") -> {
                val id = link.substringAfter("/channel/", "").substringBefore('/').substringBefore('?').ifEmpty {
                    "@" + link.substringAfter("/@").substringBefore('/').substringBefore('?')
                }
                Router.openChannel(id)
            }
            link.contains("list=") -> {
                val list = link.substringAfter("list=").substringBefore('&')
                Router.open(Route.Playlist(com.dangdvd.dvdtube.core.PlaylistItem(list)))
            }
            intent.action == Intent.ACTION_SEND -> Router.open(Route.SearchResults(text))
        }
    }

    /**
     * `dvdtube://watch?v=<id>[&t=<s>]`, `search?q=`, `shorts`, `music`, `sync?…`, `tv-login?…`
     * (and `home` / `subscriptions` from the widgets).
     */
    private fun handleDvdtubeLink(data: Uri, text: String) {
        when (data.host) {
            // The QR code of "Sign in from the phone" on DVDTube for TV.
            "tv-login" -> {
                val invite = TvLogin.parse(text)
                if (invite == null) Toasts.show("Mã đăng nhập TV không hợp lệ hoặc không thuộc mạng nội bộ") else Router.tvLoginInvite = invite
            }
            "sync" -> {
                val invite = LanSync.parse(text)
                if (invite == null) Toasts.show("Mã đồng bộ không hợp lệ hoặc không thuộc mạng nội bộ") else Router.syncInvite = invite
            }
            "watch" -> {
                val id = data.getQueryParameter("v")?.trim()?.takeIf { it.isNotEmpty() } ?: return
                val start = data.getQueryParameter("t")?.trim()?.removeSuffix("s")?.toDoubleOrNull()?.takeIf { it > 0 }
                PlayerController.play(VideoItem(id = id), startAt = start)
            }
            "search" -> {
                val query = data.getQueryParameter("q")?.trim().orEmpty()
                if (query.isEmpty()) Router.open(Route.Search()) else Router.open(Route.SearchResults(query))
            }
            "shorts" -> Router.select(AppTab.SHORTS)
            "music" -> Router.open(Route.Music())
            "subscriptions" -> Router.select(AppTab.SUBSCRIPTIONS)
            "home" -> Router.select(AppTab.HOME)
        }
    }

    // MARK: Fullscreen, orientation and Picture in Picture

    private fun observePlayerLayout() {
        lifecycleScope.launch {
            snapshotFlow {
                PlayerLayout(PlayerController.isExpanded, PlayerController.isFullscreen, PlayerController.currentVideo != null,
                    PlayerController.isPortraitFullscreen, PlayerController.fullscreenRotation)
            }
                .collect { (expanded, fullscreen, hasVideo, upright, rotation) ->
                    // Vertical videos fill the screen upright; only wide ones turn it sideways,
                    // unless the screen was turned with the rotate buttons.
                    requestedOrientation = when {
                        fullscreen && rotation != null -> orientationFor(rotation)
                        fullscreen && !upright -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        else -> ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
                    }
                    if (!fullscreen) fullscreenFromRotation = false
                    val controller = WindowCompat.getInsetsController(window, window.decorView)
                    if (fullscreen && expanded) {
                        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        controller.hide(WindowInsetsCompat.Type.systemBars())
                    } else {
                        controller.show(WindowInsetsCompat.Type.systemBars())
                    }
                    updatePictureInPictureParams(hasVideo)
                }
        }
        lifecycleScope.launch {
            snapshotFlow { PlayerController.isPlaying to AppSettings.autoPictureInPicture }.collect {
                updatePictureInPictureParams(PlayerController.currentVideo != null)
            }
        }
    }

    private data class PlayerLayout(
        val expanded: Boolean,
        val fullscreen: Boolean,
        val hasVideo: Boolean,
        val upright: Boolean,
        val rotation: Int?,
    )

    /** The fixed screen orientation that shows content turned by [rotation] (Surface.ROTATION_*). */
    private fun orientationFor(rotation: Int): Int {
        @Suppress("DEPRECATION")
        val current = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay)?.rotation ?: 0
        val portraitNow = resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
        val naturallyPortrait = (current % 2 == 0) == portraitNow
        val byRotation = if (naturallyPortrait) {
            intArrayOf(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE,
                ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT, ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE)
        } else {
            intArrayOf(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT,
                ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
        }
        return byRotation[rotation and 3]
    }

    /** Turning the phone sideways on the watch page enters fullscreen, like the official app. */
    private fun setupRotationToFullscreen() {
        orientationListener = object : OrientationEventListener(this) {
            override fun onOrientationChanged(angle: Int) {
                if (angle == ORIENTATION_UNKNOWN) return
                val landscape = angle in 60..120 || angle in 240..300
                val portrait = angle <= 25 || angle >= 335
                if (landscape && PlayerController.isExpanded && !PlayerController.isFullscreen && PlayerController.currentVideo != null) {
                    fullscreenFromRotation = true
                    PlayerController.isFullscreen = true
                } else if (portrait && PlayerController.isFullscreen && fullscreenFromRotation &&
                    PlayerController.fullscreenRotation == null
                ) {
                    PlayerController.isFullscreen = false
                }
            }
        }
    }

    private val shouldAutoEnterPip: Boolean
        get() = AppSettings.autoPictureInPicture && PlayerController.isPlaying && !PlayerController.isCasting &&
            PlayerController.currentVideo != null

    private fun updatePictureInPictureParams(hasVideo: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(hasVideo && shouldAutoEnterPip)
            builder.setSeamlessResizeEnabled(true)
        }
        runCatching { setPictureInPictureParams(builder.build()) }
    }

    fun enterPictureInPicture() {
        if (PlayerController.currentVideo == null) return
        runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 12+ enters PiP by itself (setAutoEnterEnabled).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && shouldAutoEnterPip) enterPictureInPicture()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PlayerController.isInPictureInPicture = isInPictureInPictureMode
        if (!isInPictureInPictureMode && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) {
            // Back from the floating window: continue in the full player.
            PlayerController.isExpanded = true
        }
    }
}
