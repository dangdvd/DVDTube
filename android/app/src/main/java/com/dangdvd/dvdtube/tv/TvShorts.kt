package com.dangdvd.dvdtube.tv

import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.ShortsPlayer
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.screens.ShortsFeed
import kotlinx.coroutines.launch

/** Shorts one after another: up / down for the previous / next one, center to pause. */
@Composable
fun TvShortsScreen() {
    val feed = TvNav.model("shorts") { ShortsFeed() }
    var index by remember { mutableIntStateOf(feed.index) }
    val scope = rememberCoroutineScope()
    val videoFocus = remember { FocusRequester() }
    var videoFocused by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val pending = TvNav.consumePendingShorts()
        if (pending != null) {
            feed.show(pending.first, pending.second)
            index = feed.index
        } else if (feed.items.isEmpty()) {
            feed.load(reset = true)
            index = 0
        }
        runCatching { videoFocus.requestFocus() }
    }
    DisposableEffect(Unit) { onDispose { ShortsPlayer.pause() } }

    val items = feed.items
    val current = items.getOrNull(index)
    LaunchedEffect(current?.id) {
        val video = current ?: return@LaunchedEffect
        feed.index = index
        ShortsPlayer.play(video)
        ShortsPlayer.prefetch(items.drop(index + 1))
        if (index >= items.size - 3) feed.load(reset = false)
    }

    fun move(step: Int) {
        val next = (index + step).coerceIn(0, maxOf(items.size - 1, 0))
        if (next != index) index = next
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            when (event.key) {
                Key.DirectionUp -> { move(-1); true }
                Key.DirectionDown -> { move(1); true }
                Key.MediaNext -> { move(1); true }
                Key.MediaPrevious -> { move(-1); true }
                Key.MediaPlayPause -> { ShortsPlayer.toggle(); true }
                else -> false
            }
        },
    ) {
        if (current == null) {
            if (feed.isLoading) {
                CircularProgressIndicator(color = Brand, modifier = Modifier.align(Alignment.Center))
            } else {
                TvMessage("Không tải được Shorts", feed.error, Modifier.align(Alignment.Center)) {
                    TvButton("Thử lại", onClick = { scope.launch { feed.load(reset = true) } })
                }
            }
            return@Box
        }

        TvImage(current.shortsThumbnail, Modifier.fillMaxSize().blur(40.dp))
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.6f)))

        Row(Modifier.fillMaxSize().padding(vertical = 20.dp), horizontalArrangement = Arrangement.Center) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .aspectRatio(9f / 16f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.Black)
                    .onFocusChanged { videoFocused = it.isFocused }
                    .onKeyEvent { event ->
                        val select = event.key == Key.DirectionCenter || event.key == Key.Enter || event.key == Key.NumPadEnter
                        if (event.type == KeyEventType.KeyDown && select) {
                            ShortsPlayer.toggle()
                            true
                        } else {
                            false
                        }
                    }
                    .focusRequester(videoFocus)
                    .focusable(),
            ) {
                if (current.id in ShortsPlayer.webFallbackIds) {
                    Column(Modifier.align(Alignment.Center).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Short này chỉ phát được bằng trình phát chính", color = Color.White,
                            style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.height(12.dp))
                        TvButton("Phát", onClick = { TvNav.play(current.copy(isShort = false)) }, icon = Icons.Default.PlayArrow)
                    }
                } else {
                    AndroidView(
                        factory = { context ->
                            PlayerView(context).apply {
                                useController = false
                                setShutterBackgroundColor(android.graphics.Color.BLACK)
                                subtitleView?.visibility = View.GONE
                                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                                isFocusable = false
                                player = ShortsPlayer.exo
                            }
                        },
                        onRelease = { it.player = null },
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (ShortsPlayer.isLoading) CircularProgressIndicator(color = Brand, modifier = Modifier.align(Alignment.Center))
                    if (!ShortsPlayer.isPlaying && !ShortsPlayer.isLoading && videoFocused) {
                        Text("❚❚", color = Color.White, style = MaterialTheme.typography.displaySmall, modifier = Modifier.align(Alignment.Center))
                    }
                }
                // Progress of the short at the bottom edge.
                Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.3f))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(ShortsPlayer.progress.coerceIn(0f, 1f)).background(Color.White))
                }
                Column(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth()
                        .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.8f))))
                        .padding(16.dp),
                ) {
                    current.channelName?.let {
                        Text(it, color = Color.White, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1)
                    }
                    Text(current.title, color = Color.White, style = MaterialTheme.typography.bodyMedium, maxLines = 3,
                        overflow = TextOverflow.Ellipsis)
                }
            }

            Spacer(Modifier.width(28.dp))
            Column(Modifier.fillMaxHeight(), verticalArrangement = Arrangement.Center) {
                val liked = LibraryActions.isLiked(current.id)
                TvIconButton(if (liked) Icons.Default.ThumbUp else Icons.Outlined.ThumbUp, "Thích", { LibraryActions.toggleLike(current) },
                    active = liked)
                Spacer(Modifier.height(18.dp))
                current.channelId?.let { id ->
                    TvIconButton(Icons.Default.AccountCircle, "Mở kênh", { TvNav.openChannel(id, current.channelName ?: "") })
                    Spacer(Modifier.height(18.dp))
                }
                TvIconButton(Icons.Default.KeyboardArrowUp, "Short trước", { move(-1) })
                Spacer(Modifier.height(18.dp))
                TvIconButton(Icons.Default.KeyboardArrowDown, "Short tiếp theo", { move(1) })
            }
        }
    }
}
