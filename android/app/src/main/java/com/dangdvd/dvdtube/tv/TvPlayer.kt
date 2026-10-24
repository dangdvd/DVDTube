package com.dangdvd.dvdtube.tv

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionOff
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.HowToReg
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.WatchLater
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.outlined.WatchLater
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.player.Equalizer
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.player.VideoSurface
import com.dangdvd.dvdtube.ui.player.sleepDurationTitle
import kotlinx.coroutines.delay

private enum class Panel { NONE, CONTROLS, RELATED }

private enum class PlayerDialog { CAPTIONS, TRANSLATE, QUALITY, SPEED, AUDIO, EQUALIZER, SLEEP, INFO }

private fun speedTitle(speed: Float): String = if (speed == 1f) "Chuẩn" else "${speed}x".replace(".0x", "x")

private val KeyEvent.isDown: Boolean get() = type == KeyEventType.KeyDown

private fun KeyEvent.isSelect(): Boolean = key == Key.DirectionCenter || key == Key.Enter || key == Key.NumPadEnter

/** Seek step for the D-pad: 10 s, 30 s while the key is held down. */
private fun KeyEvent.seekStep(): Double = if (nativeKeyEvent.repeatCount >= 3) 30.0 else 10.0

/**
 * Full-screen player for the remote: center = play/pause, left/right = seek, up = controls,
 * down = "Up next" videos, back = hide controls, then leave.
 */
@Composable
fun TvPlayerScreen() {
    val video = PlayerController.currentVideo
    if (video == null) {
        LaunchedEffect(Unit) { TvNav.back() }
        return
    }
    var panel by remember { mutableStateOf(Panel.CONTROLS) }
    var dialog by remember { mutableStateOf<PlayerDialog?>(null) }
    var lastInput by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var seekCount by remember { mutableIntStateOf(0) }
    var flashing by remember { mutableStateOf(false) }
    var focusedLabel by remember { mutableStateOf<String?>(null) }
    val root = remember { FocusRequester() }
    val playButton = remember { FocusRequester() }
    val relatedFirst = remember { FocusRequester() }
    val upNextButton = remember { FocusRequester() }
    val errorButton = remember { FocusRequester() }

    fun touch() {
        lastInput = System.currentTimeMillis()
    }

    fun show(target: Panel) {
        panel = target
        touch()
    }

    fun hide() {
        panel = Panel.NONE
        runCatching { root.requestFocus() }
    }

    fun seekBy(seconds: Double) {
        PlayerController.skip(seconds)
        seekCount++
        touch()
    }

    LaunchedEffect(panel) {
        delay(40)
        when (panel) {
            Panel.CONTROLS -> runCatching { playButton.requestFocus() }
            Panel.RELATED -> runCatching { relatedFirst.requestFocus() }.onFailure { runCatching { playButton.requestFocus() } }
            Panel.NONE -> runCatching { root.requestFocus() }
        }
    }
    // A new video (autoplay, next in the queue): show its title for a moment.
    LaunchedEffect(video.id) { show(Panel.CONTROLS) }
    LaunchedEffect(panel, lastInput, PlayerController.isPlaying, dialog) {
        if (panel != Panel.NONE && PlayerController.isPlaying && dialog == null) {
            delay(6000)
            hide()
        }
    }
    LaunchedEffect(seekCount) {
        if (seekCount == 0) return@LaunchedEffect
        flashing = true
        delay(2000)
        flashing = false
    }
    val upNext = PlayerController.upNext
    LaunchedEffect(upNext?.id) {
        if (upNext != null) {
            delay(60)
            runCatching { upNextButton.requestFocus() }
        }
    }
    val error = PlayerController.playbackError
    LaunchedEffect(error) {
        if (error != null) {
            delay(60)
            runCatching { errorButton.requestFocus() }
        }
    }

    BackHandler {
        when {
            dialog != null -> dialog = null
            panel == Panel.RELATED -> show(Panel.CONTROLS)
            panel == Panel.CONTROLS -> hide()
            upNext != null -> PlayerController.cancelUpNext()
            else -> TvNav.closePlayer()
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onPreviewKeyEvent { event ->
                if (!event.isDown) return@onPreviewKeyEvent false
                touch()
                when (event.key) {
                    Key.MediaPlayPause -> { PlayerController.togglePlayPause(); true }
                    Key.MediaPlay -> { PlayerController.resume(); true }
                    Key.MediaPause -> { PlayerController.pause(); true }
                    Key.MediaFastForward -> { seekBy(event.seekStep()); true }
                    Key.MediaRewind -> { seekBy(-event.seekStep()); true }
                    Key.MediaNext -> { PlayerController.playNext(); true }
                    Key.MediaPrevious -> { PlayerController.playPrevious(); true }
                    else -> if (panel == Panel.NONE && upNext == null && error == null) {
                        when {
                            event.key == Key.DirectionLeft -> { seekBy(-event.seekStep()); true }
                            event.key == Key.DirectionRight -> { seekBy(event.seekStep()); true }
                            event.isSelect() -> {
                                PlayerController.togglePlayPause()
                                show(Panel.CONTROLS)
                                true
                            }
                            event.key == Key.DirectionUp -> { show(Panel.CONTROLS); true }
                            event.key == Key.DirectionDown -> { show(Panel.RELATED); true }
                            else -> false
                        }
                    } else {
                        false
                    }
                }
            }
            .focusRequester(root)
            .focusable(),
    ) {
        VideoSurface(Modifier.fillMaxSize())

        // Captions, above the controls while they are shown.
        PlayerController.currentCaption?.let { caption ->
            val size = (if (panel == Panel.NONE) 26f else 22f) * AppSettings.captionSize.scale
            Text(
                caption,
                color = Color.White,
                textAlign = TextAlign.Center,
                fontSize = size.sp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = if (panel == Panel.NONE) 48.dp else 230.dp, start = 80.dp, end = 80.dp)
                    .background(Color.Black.copy(alpha = AppSettings.captionBackground), RoundedCornerShape(6.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }

        StatusOverlay(errorButton)

        // Seek feedback while the controls are hidden.
        AnimatedVisibility(
            visible = panel == Panel.NONE && flashing,
            enter = fadeIn(), exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 56.dp, vertical = 32.dp)) {
                Text("${formatTime(PlayerController.currentTime)} / ${formatTime(PlayerController.duration)}",
                    color = Color.White, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                ProgressLine(focused = false)
            }
        }

        AnimatedVisibility(visible = panel != Panel.NONE, enter = fadeIn(), exit = fadeOut()) {
            ControlsOverlay(
                video = video,
                showRelated = panel == Panel.RELATED,
                focusedLabel = focusedLabel,
                playButton = playButton,
                relatedFirst = relatedFirst,
                onLabel = { focusedLabel = it },
                onInteract = { touch() },
                onSeek = { seekBy(it) },
                onShowRelated = { show(Panel.RELATED) },
                onShowControls = { show(Panel.CONTROLS) },
                onDialog = { dialog = it },
            )
        }

        upNext?.let { next ->
            Column(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 48.dp, bottom = if (panel == Panel.NONE) 40.dp else 250.dp)
                    .width(380.dp)
                    .background(TvColors.surface.copy(alpha = 0.95f), RoundedCornerShape(16.dp))
                    .padding(16.dp),
            ) {
                Text("Tiếp theo sau ${PlayerController.upNextCountdown} giây", color = TvColors.secondaryText,
                    style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TvImage(next.displayThumbnail, Modifier.width(120.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)))
                    Spacer(Modifier.width(12.dp))
                    Text(next.title, color = Color.White, style = MaterialTheme.typography.titleSmall, maxLines = 3,
                        overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TvButton("Phát ngay", onClick = { PlayerController.playUpNextNow() }, icon = Icons.Default.PlayArrow, accent = true,
                        modifier = Modifier.focusRequester(upNextButton))
                    TvButton("Hủy", onClick = {
                        PlayerController.cancelUpNext()
                        show(Panel.CONTROLS)
                    })
                }
            }
        }
    }

    when (dialog) {
        null -> Unit
        PlayerDialog.EQUALIZER -> TvEqualizerDialog { dialog = null }
        PlayerDialog.INFO -> TvVideoInfoDialog(PlayerController.watchInfo?.takeIf { it.videoId == video.id }) { dialog = null }
        else -> PlayerChoiceDialog(dialog!!, onOpen = { dialog = it }) { dialog = null }
    }
}

/** Loading, the pre-roll wait, and errors (with retry / web player). */
@Composable
private fun StatusOverlay(errorButton: FocusRequester) {
    val error = PlayerController.playbackError
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            error != null -> Column(
                Modifier.widthIn(max = 640.dp).background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(16.dp)).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Không phát được video", color = Color.White, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(8.dp))
                Text(error, color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TvButton("Thử lại", onClick = { PlayerController.retry() }, accent = true, modifier = Modifier.focusRequester(errorButton))
                    if (!PlayerController.usesWebPlayer && !PlayerController.isLocalPlayback) {
                        TvButton("Dùng trình phát web", onClick = { PlayerController.switchToWebPlayer("người dùng chọn") })
                    }
                }
            }
            PlayerController.adWaitRemaining > 0 -> Text(
                "Video sẽ bắt đầu sau ${PlayerController.adWaitRemaining} giây",
                color = Color.White,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(12.dp)).padding(16.dp),
            )
            PlayerController.isLoading || PlayerController.isBuffering -> CircularProgressIndicator(color = Brand, modifier = Modifier.size(56.dp))
        }
    }
}

/** Played, buffered and remaining time as a bar. */
@Composable
private fun ProgressLine(focused: Boolean, modifier: Modifier = Modifier) {
    val duration = PlayerController.duration
    val played = if (duration > 0) (PlayerController.currentTime / duration).toFloat().coerceIn(0f, 1f) else 0f
    val buffered = if (duration > 0) (PlayerController.bufferedTime / duration).toFloat().coerceIn(0f, 1f) else 0f
    BoxWithConstraints(modifier.fillMaxWidth().height(20.dp), contentAlignment = Alignment.CenterStart) {
        val barHeight = if (focused) 8.dp else 5.dp
        Box(Modifier.fillMaxWidth().height(barHeight).clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.3f))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(buffered).background(Color.White.copy(alpha = 0.4f)))
            Box(Modifier.fillMaxHeight().fillMaxWidth(played).background(Brand))
        }
        if (focused) {
            Box(Modifier.offset(x = maxWidth * played - 9.dp).size(18.dp).background(Brand, CircleShape))
        }
    }
}

/** "Most replayed": how often each part of the video is rewatched. */
@Composable
private fun HeatmapGraph(modifier: Modifier = Modifier) {
    val markers = PlayerController.heatmap
    val duration = PlayerController.duration
    if (markers.isEmpty() || duration <= 0) return
    Canvas(modifier.fillMaxWidth().height(34.dp)) {
        val path = Path()
        path.moveTo(0f, size.height)
        for (marker in markers) {
            val x = ((marker.start + marker.duration / 2) / duration).toFloat().coerceIn(0f, 1f) * size.width
            val y = size.height * (1f - marker.intensity.toFloat().coerceIn(0f, 1f))
            path.lineTo(x, y)
        }
        path.lineTo(size.width, size.height)
        path.close()
        drawPath(path, Color.White.copy(alpha = 0.28f))
    }
}

@Composable
private fun ControlsOverlay(
    video: com.dangdvd.dvdtube.core.VideoItem,
    showRelated: Boolean,
    focusedLabel: String?,
    playButton: FocusRequester,
    relatedFirst: FocusRequester,
    onLabel: (String) -> Unit,
    onInteract: () -> Unit,
    onSeek: (Double) -> Unit,
    onShowRelated: () -> Unit,
    onShowControls: () -> Unit,
    onDialog: (PlayerDialog) -> Unit,
) {
    val info = PlayerController.watchInfo?.takeIf { it.videoId == video.id }
    val channel = info?.channel
    Box(Modifier.fillMaxSize()) {
        // Title and channel at the top.
        Column(
            Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent)))
                .padding(horizontal = 56.dp, vertical = 32.dp),
        ) {
            Text(info?.title ?: video.title, color = Color.White, style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                TvAvatar(channel?.avatar ?: video.channelAvatar, 32.dp, channel?.name ?: video.channelName ?: "")
                Spacer(Modifier.width(10.dp))
                val line = listOfNotNull(
                    channel?.name ?: video.channelName,
                    info?.viewCountText ?: video.viewCountText,
                    info?.relativeDateText ?: video.publishedText,
                ).joinToString(" • ")
                Text(line, color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            }
        }

        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.9f))))
                .padding(start = 56.dp, end = 56.dp, top = 40.dp, bottom = 28.dp),
        ) {
            val jumpTarget = PlayerController.jumpAheadTarget
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${formatTime(PlayerController.currentTime)} / ${if (video.isLive) "TRỰC TIẾP" else formatTime(PlayerController.duration)}",
                    color = Color.White, style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.weight(1f))
                if (jumpTarget != null) {
                    TvButton("Tua tới đoạn hay", onClick = { PlayerController.jumpAhead() }, icon = Icons.Default.FastForward,
                        modifier = Modifier.onFocusChanged { if (it.isFocused) onLabel("Phần được xem lại nhiều nhất") })
                }
            }
            if (!video.isLive) {
                HeatmapGraph(Modifier.padding(top = 6.dp))
                SeekBar(onSeek = onSeek, onInteract = onInteract, onLabel = onLabel)
            }
            Spacer(Modifier.height(10.dp))
            Text(focusedLabel ?: "", color = TvColors.secondaryText, style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.height(20.dp))
            Spacer(Modifier.height(6.dp))
            ButtonsRow(video, info, playButton, onLabel, onDialog, onShowRelated = onShowRelated, showRelated = showRelated)
            if (showRelated) {
                RelatedRow(info, relatedFirst, onShowControls)
            } else {
                Text("▼  Tiếp theo", color = TvColors.secondaryText, style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(top = 10.dp))
            }
        }
    }
}

@Composable
private fun SeekBar(onSeek: (Double) -> Unit, onInteract: () -> Unit, onLabel: (String) -> Unit) {
    var focused by remember { mutableStateOf(false) }
    ProgressLine(
        focused = focused,
        modifier = Modifier
            .padding(vertical = 4.dp)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onLabel("◀ ▶ để tua")
            }
            .onKeyEvent { event ->
                if (!event.isDown) return@onKeyEvent false
                when {
                    event.key == Key.DirectionLeft -> { onSeek(-event.seekStep()); true }
                    event.key == Key.DirectionRight -> { onSeek(event.seekStep()); true }
                    event.isSelect() -> { PlayerController.togglePlayPause(); onInteract(); true }
                    else -> false
                }
            }
            .focusable(),
    )
}

@Composable
private fun ButtonsRow(
    video: com.dangdvd.dvdtube.core.VideoItem,
    info: WatchInfo?,
    playButton: FocusRequester,
    onLabel: (String) -> Unit,
    onDialog: (PlayerDialog) -> Unit,
    onShowRelated: () -> Unit,
    showRelated: Boolean,
) {
    val native = !PlayerController.usesWebPlayer && !PlayerController.isCasting
    Row(
        Modifier.onPreviewKeyEvent { event ->
            if (event.isDown && event.key == Key.DirectionDown && !showRelated) {
                onShowRelated()
                true
            } else {
                false
            }
        },
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        @Composable
        fun Control(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, active: Boolean = false, modifier: Modifier = Modifier,
                    onClick: () -> Unit) {
            TvIconButton(icon, label, onClick, modifier.onFocusChanged { if (it.isFocused) onLabel(label) }, active = active)
        }

        Control(Icons.Default.SkipPrevious, "Video trước") { PlayerController.playPrevious() }
        Control(
            if (PlayerController.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
            if (PlayerController.isPlaying) "Tạm dừng" else "Phát",
            modifier = Modifier.focusRequester(playButton),
        ) { PlayerController.togglePlayPause() }
        Control(Icons.Default.SkipNext, "Video tiếp theo") { PlayerController.playNext() }
        Spacer(Modifier.width(12.dp))
        if (PlayerController.captionTracks.isNotEmpty()) {
            val on = PlayerController.selectedCaption != null
            Control(if (on) Icons.Default.ClosedCaption else Icons.Default.ClosedCaptionOff,
                "Phụ đề: " + (PlayerController.selectedCaption?.name ?: "Tắt"), active = on) { onDialog(PlayerDialog.CAPTIONS) }
        }
        if (native) {
            Control(Icons.Default.HighQuality, "Chất lượng: ${PlayerController.quality.title}") { onDialog(PlayerDialog.QUALITY) }
            if (!video.isLive) Control(Icons.Default.Speed, "Tốc độ: ${speedTitle(PlayerController.rate)}") { onDialog(PlayerDialog.SPEED) }
            if (!PlayerController.isLocalPlayback) {
                Control(
                    if (PlayerController.isAudioOnly) Icons.Default.HeadsetOff else Icons.Default.Headphones,
                    if (PlayerController.isAudioOnly) "Bật lại hình" else "Chỉ phát âm thanh",
                    active = PlayerController.isAudioOnly,
                ) { PlayerController.switchAudioOnly(!PlayerController.isAudioOnly) }
            }
            if (PlayerController.audioTracks.size > 1) {
                Control(Icons.Default.RecordVoiceOver, "Bản âm thanh") { onDialog(PlayerDialog.AUDIO) }
            }
            Control(Icons.Default.GraphicEq, "Bộ chỉnh âm: " + if (Equalizer.isEnabled) Equalizer.presetTitle else "Tắt",
                active = Equalizer.isEnabled) { onDialog(PlayerDialog.EQUALIZER) }
        }
        Control(Icons.Default.Bedtime, "Hẹn giờ tắt: " + (PlayerController.sleepTimerLabel ?: "Tắt"),
            active = PlayerController.sleepTimerLabel != null) { onDialog(PlayerDialog.SLEEP) }
        val liked = LibraryActions.isLiked(video.id, info?.likeStatus)
        Control(if (liked) Icons.Default.ThumbUp else Icons.Outlined.ThumbUp, info?.likeCountText?.let { "Thích ($it)" } ?: "Thích",
            active = liked) { LibraryActions.toggleLike(video, info?.likeStatus) }
        val disliked = LibraryActions.isDisliked(video.id, info?.likeStatus)
        Control(if (disliked) Icons.Default.ThumbDown else Icons.Outlined.ThumbDown, "Không thích", active = disliked) {
            LibraryActions.toggleDislike(video, info?.likeStatus)
        }
        val later = LibraryActions.isInWatchLater(video.id)
        Control(if (later) Icons.Default.WatchLater else Icons.Outlined.WatchLater, if (later) "Đã lưu vào Xem sau" else "Xem sau",
            active = later) { LibraryActions.toggleWatchLater(video) }
        info?.channel?.let { channel ->
            val subscribed = LibraryActions.isSubscribed(channel.id)
            Control(if (subscribed) Icons.Default.HowToReg else Icons.Default.PersonAdd,
                if (subscribed) "Đã đăng ký ${channel.name}" else "Đăng ký ${channel.name}", active = subscribed) {
                LibraryActions.toggleSubscription(channel)
            }
            Control(Icons.Default.AccountCircle, "Mở kênh ${channel.name}") {
                TvNav.closePlayer()
                TvNav.openChannel(channel)
            }
        }
        Control(Icons.Default.Info, "Thông tin video") { onDialog(PlayerDialog.INFO) }
    }
}

@Composable
private fun RelatedRow(info: WatchInfo?, first: FocusRequester, onShowControls: () -> Unit) {
    val related = info?.related?.videos?.filter { !it.isShort }.orEmpty().distinctBy { it.id }
    Column(Modifier.padding(top = 14.dp)) {
        Text("Tiếp theo", color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (related.isEmpty()) {
            Text("Đang tải…", color = TvColors.secondaryText, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 12.dp))
            return
        }
        LazyRow(
            Modifier.onPreviewKeyEvent { event ->
                if (event.isDown && event.key == Key.DirectionUp) {
                    onShowControls()
                    true
                } else {
                    false
                }
            },
            contentPadding = PaddingValues(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            itemsIndexed(related, key = { _, item -> item.id }) { index, item ->
                TvVideoCard(
                    item,
                    onClick = { TvNav.play(item, related) },
                    width = 220.dp,
                    modifier = if (index == 0) Modifier.focusRequester(first) else Modifier,
                )
            }
        }
    }
}

@Composable
private fun PlayerChoiceDialog(kind: PlayerDialog, onOpen: (PlayerDialog) -> Unit, onDismiss: () -> Unit) {
    when (kind) {
        PlayerDialog.CAPTIONS -> TvDialog("Phụ đề", onDismiss) {
            TvOptionRow("Tắt", selected = PlayerController.selectedCaption == null, onClick = {
                PlayerController.selectCaption(null)
                onDismiss()
            })
            PlayerController.captionTracks.forEach { track ->
                TvOptionRow(track.name, selected = PlayerController.selectedCaption == track && PlayerController.captionTranslation == null,
                    onClick = {
                        PlayerController.selectCaption(track)
                        AppSettings.captionLanguage = track.languageCode.substringBefore('-')
                        onDismiss()
                    })
            }
            if (PlayerController.captionTracks.any { it.isTranslatable }) {
                TvOptionRow("Tự động dịch", value = PlayerController.captionTranslation?.let { code ->
                    AppSettings.languages.firstOrNull { it.first == code }?.second ?: code
                }, onClick = { onOpen(PlayerDialog.TRANSLATE) })
            }
        }
        PlayerDialog.TRANSLATE -> TvDialog("Tự động dịch phụ đề", onDismiss) {
            AppSettings.languages.forEach { (code, name) ->
                TvOptionRow(name, selected = PlayerController.captionTranslation == code, onClick = {
                    val tracks = PlayerController.captionTracks
                    val source = PlayerController.selectedCaption?.takeIf { it.isTranslatable }
                        ?: tracks.firstOrNull { it.isTranslatable && !it.isAutoGenerated }
                        ?: tracks.firstOrNull { it.isTranslatable }
                    if (source != null) PlayerController.selectCaption(source, code)
                    onDismiss()
                })
            }
        }
        PlayerDialog.QUALITY -> TvDialog("Chất lượng", onDismiss) {
            VideoQuality.entries.forEach { quality ->
                TvOptionRow(quality.title, selected = PlayerController.quality == quality, onClick = {
                    PlayerController.setQuality(quality)
                    onDismiss()
                })
            }
        }
        PlayerDialog.SPEED -> TvDialog("Tốc độ phát", onDismiss) {
            AppSettings.speeds.forEach { speed ->
                TvOptionRow(speedTitle(speed), selected = PlayerController.rate == speed, onClick = {
                    PlayerController.setPlaybackRate(speed)
                    onDismiss()
                })
            }
        }
        PlayerDialog.AUDIO -> TvDialog("Bản âm thanh", onDismiss) {
            PlayerController.audioTracks.forEach { option ->
                TvOptionRow(option.name + if (option.isDefault) " (gốc)" else "", selected = PlayerController.selectedAudioTrackId == option.id,
                    onClick = {
                        PlayerController.selectAudioTrack(option)
                        onDismiss()
                    })
            }
        }
        PlayerDialog.SLEEP -> TvDialog("Hẹn giờ tắt", onDismiss) {
            val running = PlayerController.sleepTimerLabel
            if (running != null) {
                TvOptionRow("Tắt hẹn giờ", value = running, onClick = {
                    PlayerController.setSleepTimer(null)
                    onDismiss()
                })
                if (!PlayerController.sleepAtEndOfVideo) {
                    TvOptionRow("Thêm 15 phút", onClick = {
                        PlayerController.extendSleepTimer(15)
                        onDismiss()
                    })
                }
            }
            AppSettings.sleepTimerOptions.forEach { minutes ->
                TvOptionRow(sleepDurationTitle(minutes), onClick = {
                    PlayerController.setSleepTimer(minutes)
                    onDismiss()
                })
            }
            TvOptionRow("Khi hết video này", selected = PlayerController.sleepAtEndOfVideo, onClick = {
                PlayerController.setSleepTimer(0)
                onDismiss()
            })
        }
        PlayerDialog.EQUALIZER, PlayerDialog.INFO -> Unit
    }
}

/** Title, numbers and the description (each paragraph focusable so the remote can scroll it). */
@Composable
private fun TvVideoInfoDialog(info: WatchInfo?, onDismiss: () -> Unit) {
    val video = PlayerController.currentVideo
    TvDialog(info?.title ?: video?.title ?: "Thông tin video", onDismiss, width = 760.dp) {
        val numbers = listOfNotNull(info?.viewCountText, info?.dateText, info?.likeCountText?.let { "$it lượt thích" }).joinToString(" • ")
        if (numbers.isNotEmpty()) Text(numbers, color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge)
        info?.channel?.let { channel ->
            Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                TvAvatar(channel.avatar, 36.dp, channel.name)
                Spacer(Modifier.width(10.dp))
                Text(listOfNotNull(channel.name, channel.subscriberText).joinToString(" • "), color = Color.White,
                    style = MaterialTheme.typography.titleMedium)
            }
        }
        val description = info?.description?.trim().orEmpty()
        if (description.isEmpty()) {
            Text(if (info == null) "Đang tải…" else "Video không có mô tả.", color = TvColors.secondaryText)
        } else {
            description.split(Regex("\n\\s*\n")).forEach { paragraph ->
                var focused by remember { mutableStateOf(false) }
                Text(
                    paragraph.trim(),
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .background(if (focused) Color.White.copy(alpha = 0.1f) else Color.Transparent, RoundedCornerShape(8.dp))
                        .onFocusChanged { focused = it.isFocused }
                        .focusable()
                        .padding(8.dp),
                )
            }
        }
    }
}
