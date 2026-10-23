package com.dangdvd.dvdtube.ui.player

import android.content.Context
import android.graphics.drawable.BitmapDrawable
import android.view.ContextThemeWrapper
import android.view.View
import android.view.ViewGroup
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.mediarouter.app.MediaRouteButton
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.dangdvd.dvdtube.cast.CastController
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.Storyboard
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.google.android.gms.cast.framework.CastButtonFactory
import kotlinx.coroutines.delay
import kotlin.math.abs

/** The web player used for regular videos (the Shorts feed has its own). */
val MainWebPlayer = WebPlayerHost { event ->
    PlayerController.handleWebEvent(event.time, event.duration, event.paused, event.isAd, event.error)
}

/** One PlayerView, moved between the mini player, the watch page and fullscreen. */
private object VideoViewHolder {
    private var view: PlayerView? = null

    fun view(context: Context): PlayerView {
        view?.let { existing ->
            (existing.parent as? ViewGroup)?.removeView(existing)
            return existing
        }
        return PlayerView(context.applicationContext).apply {
            useController = false
            setShutterBackgroundColor(android.graphics.Color.BLACK)
            setKeepContentOnPlayerReset(true)
            subtitleView?.visibility = View.GONE
            player = PlayerController.exo
        }.also { view = it }
    }
}

/** Just the picture: native video, the web embed or the "playing on TV" backdrop. */
@Composable
fun VideoSurface(modifier: Modifier = Modifier) {
    val video = PlayerController.currentVideo
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        when {
            PlayerController.isCasting -> CastingBackdrop()
            PlayerController.usesWebPlayer && video != null -> {
                AndroidView(
                    factory = { context -> MainWebPlayer.view(context).also { PlayerController.registerWebView(it) } },
                    modifier = Modifier.fillMaxSize(),
                )
                LaunchedEffect(video.id) {
                    if (MainWebPlayer.videoId != video.id) MainWebPlayer.load(video.id, PlayerController.webStartTime)
                }
            }
            else -> AndroidView(
                factory = { context -> VideoViewHolder.view(context) },
                update = {
                    it.resizeMode = if (PlayerController.videoFill && PlayerController.isFullscreen)
                        AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun CastingBackdrop() {
    val video = PlayerController.currentVideo
    Box(Modifier.fillMaxSize()) {
        RemoteImage(video?.displayThumbnail, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.65f)))
        Column(Modifier.align(Alignment.Center).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Cast, null, tint = Color.White, modifier = Modifier.size(36.dp))
            Spacer(Modifier.height(8.dp))
            Text("Đang phát trên ${CastController.deviceName ?: "TV"}", color = Color.White, fontWeight = FontWeight.SemiBold)
            CastController.statusText?.let {
                Text(it, color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            }
        }
    }
}

/** Google's Cast button (device picker, connected state). Hidden without Google Play services. */
@Composable
fun CastButton(light: Boolean = false, modifier: Modifier = Modifier) {
    if (!CastController.isAvailable) return
    val theme = if (light) androidx.mediarouter.R.style.Theme_MediaRouter_Light else androidx.mediarouter.R.style.Theme_MediaRouter
    AndroidView(
        factory = { context ->
            MediaRouteButton(ContextThemeWrapper(context, theme)).also { button ->
                runCatching { CastButtonFactory.setUpMediaRouteButton(context, button) }
            }
        },
        modifier = modifier.size(48.dp),
    )
}

/** The video with its gestures and controls (watch page and fullscreen). */
@Composable
fun PlayerBox(modifier: Modifier, fullscreen: Boolean) {
    var controlsVisible by remember { mutableStateOf(true) }
    var lastInteraction by remember { mutableLongStateOf(0L) }
    var seekFeedback by remember { mutableStateOf<Pair<Boolean, Long>?>(null) }
    var settingsOpen by remember { mutableStateOf(false) }
    val playing = PlayerController.isPlaying
    val web = PlayerController.usesWebPlayer

    LaunchedEffect(controlsVisible, playing, lastInteraction) {
        if (controlsVisible && playing) {
            delay(3500)
            controlsVisible = false
        }
    }
    LaunchedEffect(seekFeedback) {
        if (seekFeedback != null) {
            delay(700)
            seekFeedback = null
        }
    }

    Box(
        modifier
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = {
                        controlsVisible = !controlsVisible
                        lastInteraction = System.currentTimeMillis()
                    },
                    onDoubleTap = { offset ->
                        val forward = offset.x > size.width / 2
                        PlayerController.skip(if (forward) 10.0 else -10.0)
                        seekFeedback = forward to System.currentTimeMillis()
                    },
                    onLongPress = { PlayerController.beginSpeedBoost() },
                    onPress = {
                        tryAwaitRelease()
                        PlayerController.endSpeedBoost()
                    },
                )
            }
            .pointerInput(fullscreen) {
                val threshold = 56.dp.toPx()
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var dx = 0f
                    var dy = 0f
                    var zoom = 1f
                    var pinching = false
                    var dragging = false
                    var ignored = false
                    while (true) {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.count { it.pressed }
                        if (pressed == 0) break
                        if (!dragging && !pinching && event.changes.any { it.isConsumed }) ignored = true
                        if (ignored) continue
                        if (pressed >= 2) {
                            pinching = true
                            zoom *= event.calculateZoom()
                            event.changes.forEach { it.consume() }
                        } else if (!pinching) {
                            val pan = event.calculatePan()
                            dx += pan.x
                            dy += pan.y
                            if (!dragging && abs(dy) > viewConfiguration.touchSlop && abs(dy) > abs(dx)) dragging = true
                            if (dragging) event.changes.forEach { it.consume() }
                        }
                    }
                    if (ignored) return@awaitEachGesture
                    if (pinching) {
                        when {
                            !fullscreen && zoom > 1.15f -> PlayerController.isFullscreen = true
                            fullscreen && zoom > 1.15f -> PlayerController.setVideoFill(true)
                            fullscreen && zoom < 0.87f -> PlayerController.setVideoFill(false)
                        }
                    } else if (dragging) {
                        when {
                            dy < -threshold && !fullscreen -> PlayerController.isFullscreen = true
                            dy > threshold && fullscreen -> PlayerController.isFullscreen = false
                            dy > threshold -> PlayerController.isExpanded = false
                        }
                    }
                }
            },
    ) {
        VideoSurface(Modifier.fillMaxSize())
        CaptionOverlay(Modifier.align(Alignment.BottomCenter).padding(bottom = if (controlsVisible) 56.dp else 16.dp))
        StatusOverlays()

        if (web) {
            // The embed has its own controls; only keep ours for leaving and settings.
            WebPlayerBar(fullscreen, onSettings = { settingsOpen = true })
        } else {
            AnimatedVisibility(controlsVisible, enter = fadeIn(), exit = fadeOut()) {
                PlayerControls(
                    fullscreen = fullscreen,
                    onSettings = { settingsOpen = true },
                    onInteract = { lastInteraction = System.currentTimeMillis() },
                )
            }
        }

        seekFeedback?.let { (forward, _) ->
            Row(
                Modifier
                    .align(if (forward) Alignment.CenterEnd else Alignment.CenterStart)
                    .padding(horizontal = 40.dp)
                    .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (forward) Icons.Default.FastForward else Icons.Default.FastRewind, null, tint = Color.White)
                Spacer(Modifier.width(6.dp))
                Text("10 giây", color = Color.White, style = MaterialTheme.typography.labelLarge)
            }
        }
        if (PlayerController.isSpeedBoosted) {
            Row(
                Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(50))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("2x", color = Color.White, fontWeight = FontWeight.Bold)
                Icon(Icons.Default.FastForward, null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
        UpNextOverlay(Modifier.align(Alignment.Center))
    }
    if (settingsOpen) PlayerSettingsSheet(onDismiss = { settingsOpen = false })
}

@Composable
private fun WebPlayerBar(fullscreen: Boolean, onSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        SmallOverlayButton(if (fullscreen) Icons.Default.FullscreenExit else Icons.Default.KeyboardArrowDown) {
            if (fullscreen) PlayerController.isFullscreen = false else PlayerController.isExpanded = false
        }
        Spacer(Modifier.weight(1f))
        SmallOverlayButton(if (fullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen) {
            PlayerController.isFullscreen = !fullscreen
        }
        SmallOverlayButton(Icons.Default.Settings, onSettings)
    }
}

@Composable
private fun SmallOverlayButton(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.padding(2.dp).size(34.dp).background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(50)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
}

@Composable
private fun PlayerControls(fullscreen: Boolean, onSettings: () -> Unit, onInteract: () -> Unit) {
    val video = PlayerController.currentVideo
    val info = PlayerController.playerInfo
    val isLive = video?.isLive == true || info?.isLive == true
    var scrub by remember { mutableStateOf<Float?>(null) }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f))) {
        Row(Modifier.fillMaxWidth().align(Alignment.TopStart).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (fullscreen) PlayerController.isFullscreen = false else PlayerController.isExpanded = false }) {
                Icon(if (fullscreen) Icons.Default.KeyboardArrowDown else Icons.Default.KeyboardArrowDown, "Thu nhỏ", tint = Color.White)
            }
            if (fullscreen) {
                Text(video?.title ?: "", color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            } else {
                Spacer(Modifier.weight(1f))
            }
            CastButton()
            if (PlayerController.captionTracks.isNotEmpty()) {
                IconButton(onClick = { toggleCaptions(); onInteract() }) {
                    Icon(
                        if (PlayerController.selectedCaption != null) Icons.Default.ClosedCaption else Icons.Default.ClosedCaptionOff,
                        "Phụ đề", tint = Color.White,
                    )
                }
            }
            IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Cài đặt", tint = Color.White) }
        }

        Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { PlayerController.playPrevious(); onInteract() }, enabled = PlayerController.hasPrevious) {
                Icon(Icons.Default.SkipPrevious, "Trước", tint = if (PlayerController.hasPrevious) Color.White else Color.White.copy(alpha = 0.3f),
                    modifier = Modifier.size(32.dp))
            }
            Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                if ((PlayerController.isLoading || PlayerController.isBuffering) && !PlayerController.isPlaying) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(44.dp))
                } else {
                    val ended = !PlayerController.isPlaying && PlayerController.duration > 0 &&
                        PlayerController.currentTime >= PlayerController.duration - 0.5
                    IconButton(onClick = { PlayerController.togglePlayPause(); onInteract() }, modifier = Modifier.size(64.dp)) {
                        Icon(
                            when {
                                PlayerController.isPlaying -> Icons.Default.Pause
                                ended -> Icons.Default.Replay
                                else -> Icons.Default.PlayArrow
                            },
                            "Phát/Tạm dừng", tint = Color.White, modifier = Modifier.size(52.dp),
                        )
                    }
                }
            }
            IconButton(onClick = { PlayerController.playNext(); onInteract() }, enabled = PlayerController.hasNext) {
                Icon(Icons.Default.SkipNext, "Tiếp", tint = if (PlayerController.hasNext) Color.White else Color.White.copy(alpha = 0.3f),
                    modifier = Modifier.size(32.dp))
            }
        }

        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(horizontal = 12.dp)) {
            scrub?.let { fraction ->
                info?.storyboard?.let { storyboard ->
                    StoryboardPreview(storyboard, fraction, PlayerController.duration)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isLive) {
                    Text("● TRỰC TIẾP", color = Brand, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                } else {
                    val shown = scrub?.let { it * PlayerController.duration } ?: PlayerController.currentTime
                    Text("${formatTime(shown)} / ${formatTime(PlayerController.duration)}", color = Color.White,
                        style = MaterialTheme.typography.labelMedium)
                }
                chapterTitle(scrub?.let { it * PlayerController.duration } ?: PlayerController.currentTime)?.let {
                    Text("  •  $it", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.labelMedium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { PlayerController.isFullscreen = !fullscreen }) {
                    Icon(if (fullscreen) Icons.Default.FullscreenExit else Icons.Default.Fullscreen, "Toàn màn hình", tint = Color.White)
                }
            }
            if (!isLive) {
                SeekBar(onScrub = { scrub = it; onInteract() })
            }
            Spacer(Modifier.height(if (fullscreen) 16.dp else 2.dp))
        }
    }
}

private fun chapterTitle(seconds: Double): String? {
    val chapters = PlayerController.watchInfo?.chapters.orEmpty()
    return chapters.lastOrNull { it.startSeconds <= seconds }?.title
}

fun toggleCaptions() {
    if (PlayerController.selectedCaption != null) {
        PlayerController.selectCaption(null)
        return
    }
    val tracks = PlayerController.captionTracks
    val preferred = tracks.firstOrNull { it.languageCode.startsWith(AppSettings.captionLanguage) && !it.isAutoGenerated }
        ?: tracks.firstOrNull { it.languageCode.startsWith(AppSettings.captionLanguage) }
    if (preferred != null) {
        PlayerController.selectCaption(preferred)
    } else {
        val source = tracks.firstOrNull { !it.isAutoGenerated } ?: tracks.first()
        // No track in the preferred language: translate the best one when YouTube allows it.
        PlayerController.selectCaption(source, if (source.isTranslatable) AppSettings.captionLanguage else null)
    }
}

/** Progress, buffer, chapters and SponsorBlock segments; drag to scrub. */
@Composable
private fun SeekBar(onScrub: (Float?) -> Unit) {
    val duration = PlayerController.duration
    var drag by remember { mutableStateOf<Float?>(null) }
    val fraction = drag ?: if (duration > 0) (PlayerController.currentTime / duration).toFloat().coerceIn(0f, 1f) else 0f
    val buffered = if (duration > 0) (PlayerController.bufferedTime / duration).toFloat().coerceIn(0f, 1f) else 0f
    val segments = PlayerController.sponsorSegments
    val chapters = PlayerController.watchInfo?.chapters.orEmpty()
    Box(
        Modifier
            .fillMaxWidth()
            .height(26.dp)
            .pointerInput(duration) {
                detectTapGestures { offset ->
                    if (duration > 0) PlayerController.seek((offset.x / size.width).coerceIn(0f, 1f) * duration)
                }
            }
            .pointerInput(duration) {
                detectHorizontalDragGestures(
                    onDragStart = { offset ->
                        drag = (offset.x / size.width).coerceIn(0f, 1f)
                        onScrub(drag)
                    },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        drag = (change.position.x / size.width).coerceIn(0f, 1f)
                        onScrub(drag)
                    },
                    onDragEnd = {
                        drag?.let { if (duration > 0) PlayerController.seek(it * duration) }
                        drag = null
                        onScrub(null)
                    },
                    onDragCancel = {
                        drag = null
                        onScrub(null)
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxWidth().height(16.dp)) {
            val barHeight = if (drag != null) 5.dp.toPx() else 3.dp.toPx()
            val top = (size.height - barHeight) / 2
            val radius = CornerRadius(barHeight / 2)
            drawRoundRect(Color.White.copy(alpha = 0.3f), Offset(0f, top), Size(size.width, barHeight), radius)
            drawRoundRect(Color.White.copy(alpha = 0.5f), Offset(0f, top), Size(size.width * buffered, barHeight), radius)
            if (duration > 0) {
                segments.forEach { segment ->
                    val start = (segment.start / duration).toFloat().coerceIn(0f, 1f) * size.width
                    val end = (segment.end / duration).toFloat().coerceIn(0f, 1f) * size.width
                    drawRect(Color(0xFF00D400), Offset(start, top), Size(maxOf(end - start, 2f), barHeight))
                }
            }
            drawRoundRect(Brand, Offset(0f, top), Size(size.width * fraction, barHeight), radius)
            if (duration > 0) {
                chapters.drop(1).forEach { chapter ->
                    val x = (chapter.startSeconds / duration).toFloat() * size.width
                    drawRect(Color.Black, Offset(x - 1f, top), Size(2f, barHeight))
                }
            }
            drawCircle(Brand, radius = if (drag != null) 8.dp.toPx() else 6.dp.toPx(), center = Offset(size.width * fraction, size.height / 2))
        }
    }
}

private val storyboardCache = object : LinkedHashMap<String, ImageBitmap>(8, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ImageBitmap>?): Boolean = size > 6
}

/** Thumbnail of the position being scrubbed to (from YouTube's storyboard sprite sheets). */
@Composable
private fun StoryboardPreview(storyboard: Storyboard, fraction: Float, duration: Double) {
    val frame = storyboard.frame(fraction * duration, duration)
    val context = LocalContext.current
    val sheet by produceState(storyboardCache[frame.url], frame.url) {
        value = storyboardCache[frame.url] ?: run {
            val request = ImageRequest.Builder(context).data(frame.url).allowHardware(false).build()
            val result = context.imageLoader.execute(request)
            ((result as? SuccessResult)?.drawable as? BitmapDrawable)?.bitmap?.asImageBitmap()?.also { storyboardCache[frame.url] = it }
        }
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val previewWidth = 160.dp
        val previewHeight = previewWidth * (frame.height.toFloat() / maxOf(frame.width, 1))
        val x = (maxWidth - previewWidth) * fraction
        Column(Modifier.offset(x = x), horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(
                Modifier.width(previewWidth).height(previewHeight).background(Color.Black, RoundedCornerShape(6.dp)),
            ) {
                val image = sheet ?: return@Canvas
                if (frame.x + frame.width <= image.width && frame.y + frame.height <= image.height) {
                    drawImage(
                        image,
                        srcOffset = IntOffset(frame.x, frame.y),
                        srcSize = IntSize(frame.width, frame.height),
                        dstSize = IntSize(size.width.toInt(), size.height.toInt()),
                    )
                }
            }
            Text(formatTime(fraction * duration), color = Color.White, style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.width(previewWidth), textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun CaptionOverlay(modifier: Modifier) {
    val caption = PlayerController.currentCaption ?: return
    if (PlayerController.isCasting) return
    Text(
        caption,
        color = Color.White,
        fontSize = if (PlayerController.isFullscreen) 18.sp else 14.sp,
        textAlign = TextAlign.Center,
        modifier = modifier
            .padding(horizontal = 24.dp)
            .background(Color.Black.copy(alpha = 0.65f), RoundedCornerShape(4.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
private fun StatusOverlays() {
    val error = PlayerController.playbackError
    Box(Modifier.fillMaxSize()) {
        if (PlayerController.adWaitRemaining > 0 && !PlayerController.usesWebPlayer) {
            Text(
                "Video sẽ bắt đầu sau ${PlayerController.adWaitRemaining} giây (thời gian chờ thay cho quảng cáo)",
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.align(Alignment.BottomStart).padding(12.dp)
                    .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        if (error != null) {
            Column(
                Modifier.align(Alignment.Center).fillMaxWidth().background(Color.Black.copy(alpha = 0.75f)).padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(error, color = Color.White, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium,
                    maxLines = 4, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilledTonalButton(onClick = { PlayerController.retry() }) { Text("Thử lại") }
                    if (!PlayerController.usesWebPlayer) {
                        OutlinedButton(onClick = { PlayerController.switchToWebPlayer("người dùng chọn") }) {
                            Text("Trình phát web", color = Color.White)
                        }
                    } else {
                        OutlinedButton(onClick = { PlayerController.switchToNativePlayer() }) {
                            Text("Trình phát gốc", color = Color.White)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun UpNextOverlay(modifier: Modifier) {
    val next = PlayerController.upNext ?: return
    Column(
        modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.8f)).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Tiếp theo sau ${PlayerController.upNextCountdown} giây", color = Color.White.copy(alpha = 0.8f),
            style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.widthIn(max = 420.dp)) {
            RemoteImage(next.displayThumbnail, Modifier.width(120.dp).aspectRatio(16f / 9f))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(next.title, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                next.channelName?.let { Text(it, color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall, maxLines = 1) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = { PlayerController.cancelUpNext() }) { Text("Hủy", color = Color.White) }
            FilledTonalButton(onClick = { PlayerController.playUpNextNow() }) { Text("Phát ngay") }
        }
    }
}

/** Bar above the tab bar while a video plays minimized. */
@Composable
fun MiniPlayer(modifier: Modifier = Modifier) {
    val video = PlayerController.currentVideo ?: return
    val duration = PlayerController.duration
    Column(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable { PlayerController.isExpanded = true }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var dy = 0f
                    while (true) {
                        val event = awaitPointerEvent()
                        if (event.changes.none { it.pressed }) break
                        dy += event.calculatePan().y
                    }
                    if (dy < -40.dp.toPx()) PlayerController.isExpanded = true
                    if (dy > 40.dp.toPx()) PlayerController.close()
                }
            },
    ) {
        Row(Modifier.fillMaxWidth().height(60.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.fillMaxHeight().aspectRatio(16f / 9f)) {
                VideoSurface(Modifier.fillMaxSize())
            }
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(video.title.ifEmpty { PlayerController.playerInfo?.title ?: "" }, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                val subtitle = if (PlayerController.isCasting) "Đang phát trên ${CastController.deviceName ?: "TV"}"
                else video.channelName ?: PlayerController.playerInfo?.author ?: ""
                Text(subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (PlayerController.isLoading && !PlayerController.isPlaying) {
                CircularProgressIndicator(Modifier.padding(12.dp).size(24.dp), strokeWidth = 2.dp)
            } else {
                IconButton(onClick = { PlayerController.togglePlayPause() }) {
                    Icon(if (PlayerController.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, "Phát/Tạm dừng")
                }
            }
            IconButton(onClick = { PlayerController.close() }) { Icon(Icons.Default.Close, "Đóng") }
        }
        LinearProgressIndicator(
            progress = { if (duration > 0) (PlayerController.currentTime / duration).toFloat().coerceIn(0f, 1f) else 0f },
            modifier = Modifier.fillMaxWidth().height(2.dp),
            color = Brand,
            trackColor = Color.Transparent,
        )
    }
}

/** Shown in the Picture-in-Picture window: only the video. */
@Composable
fun PictureInPictureContent() {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        VideoSurface(Modifier.fillMaxSize())
        val caption = PlayerController.currentCaption
        if (caption != null) {
            Text(caption, color = Color.White, fontSize = 11.sp, textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.BottomCenter).padding(4.dp).background(Color.Black.copy(alpha = 0.6f)))
        }
    }
}
