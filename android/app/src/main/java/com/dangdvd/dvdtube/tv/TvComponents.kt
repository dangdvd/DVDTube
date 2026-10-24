package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import androidx.tv.material3.darkColorScheme
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.ui.Brand
import kotlinx.coroutines.delay

/** Colours of the TV interface (always dark, readable from the sofa). */
object TvColors {
    val background = Color(0xFF0F0F0F)
    val surface = Color(0xFF1F1F1F)
    val surfaceHigh = Color(0xFF2B2B2B)
    val secondaryText = Color(0xFFAAAAAA)
    val focused = Color(0xFFF1F1F1)
    val onFocused = Color(0xFF0F0F0F)
}

/** Overscan-safe margins of the 10-foot layout. */
object TvInsets {
    val horizontal = 48.dp
    val vertical = 27.dp
}

@Composable
fun TvTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Brand,
            onPrimary = Color.White,
            background = TvColors.background,
            onBackground = Color.White,
            surface = TvColors.surface,
            onSurface = Color.White,
            surfaceVariant = TvColors.surfaceHigh,
            onSurfaceVariant = TvColors.secondaryText,
            inverseSurface = TvColors.focused,
            inverseOnSurface = TvColors.onFocused,
            border = Color.White,
        ),
        content = content,
    )
}

// MARK: Focus memory

/** Key of the screen being composed, for remembering which item had the focus. */
val LocalTvScreen = staticCompositionLocalOf { "" }

/**
 * Remembers the focused item of every screen, so coming back from the player (or another screen)
 * puts the focus back where it was, like the official TV app.
 */
object TvFocusMemory {
    private val lastFocused = HashMap<String, String>()
    private val pending = HashSet<String>()

    fun focused(screen: String, item: String) {
        lastFocused[screen] = item
    }

    /** The screen is shown again: its remembered item takes the focus once. */
    fun requestRestore(screen: String) {
        if (lastFocused.containsKey(screen)) pending += screen
    }

    fun hasPending(screen: String): Boolean = screen in pending

    fun take(screen: String, item: String): Boolean {
        if (screen !in pending || lastFocused[screen] != item) return false
        pending -= screen
        return true
    }

    fun forget(screen: String) {
        lastFocused -= screen
        pending -= screen
    }
}

/**
 * Focus plumbing of a focusable item: remembers it when focused, takes the focus back when its
 * screen is restored, and optionally takes the initial focus of the screen ([initial]).
 */
@Composable
fun Modifier.tvFocusItem(key: String, initial: FocusRequester? = null): Modifier {
    val screen = LocalTvScreen.current
    val requester = remember { FocusRequester() }
    LaunchedEffect(screen, key) {
        if (TvFocusMemory.take(screen, key)) {
            delay(60)
            runCatching { requester.requestFocus() }
        }
    }
    var result = this.focusRequester(requester)
    if (initial != null) result = result.focusRequester(initial)
    return result.onFocusChanged { if (it.isFocused) TvFocusMemory.focused(screen, key) }
}

/**
 * Gives the focus to [initial] once content is there, unless something on the screen already has
 * it or a remembered item is about to take it back.
 */
@Composable
fun InitialFocus(initial: FocusRequester, ready: Boolean, hasFocus: () -> Boolean) {
    val screen = LocalTvScreen.current
    LaunchedEffect(ready, screen) {
        if (!ready) return@LaunchedEffect
        delay(250)
        if (!hasFocus() && !TvFocusMemory.hasPending(screen)) runCatching { initial.requestFocus() }
    }
}

// MARK: Images

@Composable
fun TvImage(url: String?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    AsyncImage(
        model = ImageRequest.Builder(LocalContext.current).data(url).crossfade(true).build(),
        contentDescription = null,
        contentScale = contentScale,
        modifier = modifier.background(TvColors.surfaceHigh),
    )
}

@Composable
fun TvAvatar(url: String?, size: Dp, name: String = "", modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(TvColors.surfaceHigh), contentAlignment = Alignment.Center) {
        if (url.isNullOrEmpty()) {
            Text(name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold)
        } else {
            TvImage(url, Modifier.fillMaxSize())
        }
    }
}

// MARK: Focusable surfaces

private val cardShape = RoundedCornerShape(12.dp)

@Composable
private fun focusBorder(shape: androidx.compose.ui.graphics.Shape) =
    ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(3.dp, Color.White), shape = shape))

/** A focusable tile: lifts and gets a white outline when focused. */
@Composable
fun TvTile(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    shape: androidx.compose.ui.graphics.Shape = cardShape,
    focusedScale: Float = 1.06f,
    content: @Composable BoxScope.() -> Unit,
) {
    Surface(
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape = shape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = Color.White,
            focusedContainerColor = Color.White.copy(alpha = 0.12f),
            focusedContentColor = Color.White,
            pressedContainerColor = Color.White.copy(alpha = 0.2f),
            pressedContentColor = Color.White,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = focusedScale),
        border = focusBorder(shape),
        content = content,
    )
}

/** A pill button: grey normally, white with dark text when focused (or [selected]). */
@Composable
fun TvButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    selected: Boolean = false,
    accent: Boolean = false,
    enabled: Boolean = true,
) {
    val base = when {
        selected -> TvColors.focused
        accent -> Brand
        else -> TvColors.surfaceHigh
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(50)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = base,
            contentColor = if (selected) TvColors.onFocused else Color.White,
            focusedContainerColor = TvColors.focused,
            focusedContentColor = TvColors.onFocused,
            pressedContainerColor = TvColors.focused,
            pressedContentColor = TvColors.onFocused,
            disabledContainerColor = base.copy(alpha = 0.4f),
            disabledContentColor = Color.White.copy(alpha = 0.5f),
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
    ) {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(icon, null, Modifier.size(20.dp))
                if (text.isNotEmpty()) Spacer(Modifier.width(8.dp))
            }
            if (text.isNotEmpty()) Text(text, style = MaterialTheme.typography.titleSmall, maxLines = 1)
        }
    }
}

/** A round icon button (player controls). */
@Composable
fun TvIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    size: Dp = 52.dp,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(size),
        shape = ClickableSurfaceDefaults.shape(shape = CircleShape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (active) Brand.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.14f),
            contentColor = Color.White,
            focusedContainerColor = TvColors.focused,
            focusedContentColor = TvColors.onFocused,
            pressedContainerColor = TvColors.focused,
            pressedContentColor = TvColors.onFocused,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.12f),
    ) {
        Icon(icon, description, Modifier.align(Alignment.Center).size(size * 0.5f))
    }
}

// MARK: Cards

@Composable
fun TvVideoCard(
    video: VideoItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp? = 260.dp,
    progress: Float? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val sized = if (width != null) modifier.width(width) else modifier.fillMaxWidth()
    TvTile(onClick = onClick, onLongClick = onLongClick, modifier = sized) {
        Column(Modifier.padding(6.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
                TvImage(video.displayThumbnail, Modifier.fillMaxSize())
                val badge = when {
                    video.isLive -> "TRỰC TIẾP"
                    video.isShort -> "SHORTS"
                    else -> video.durationText
                }
                if (!badge.isNullOrEmpty()) {
                    Text(
                        badge,
                        color = Color.White,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp)
                            .background(if (video.isLive) Brand else Color.Black.copy(alpha = 0.8f), RoundedCornerShape(4.dp))
                            .padding(horizontal = 5.dp, vertical = 2.dp),
                    )
                }
                if (progress != null && progress > 0f) {
                    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color.White.copy(alpha = 0.35f))) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).background(Brand))
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                video.title.ifEmpty { "Video" },
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.heightIn(min = 40.dp),
            )
            val meta = video.metadataLine
            if (meta.isNotEmpty()) {
                Text(meta, style = MaterialTheme.typography.bodySmall, color = TvColors.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
fun TvChannelCard(channel: ChannelItem, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp? = 180.dp) {
    val sized = if (width != null) modifier.width(width) else modifier.fillMaxWidth()
    TvTile(onClick = onClick, modifier = sized) {
        Column(Modifier.fillMaxWidth().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            TvAvatar(channel.avatar, 96.dp, channel.name)
            Spacer(Modifier.height(10.dp))
            Text(channel.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, textAlign = TextAlign.Center,
                overflow = TextOverflow.Ellipsis)
            channel.subscriberText?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = TvColors.secondaryText, maxLines = 1)
            }
        }
    }
}

@Composable
fun TvPlaylistCard(playlist: PlaylistItem, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp? = 260.dp) {
    val sized = if (width != null) modifier.width(width) else modifier.fillMaxWidth()
    TvTile(onClick = onClick, modifier = sized) {
        Column(Modifier.padding(6.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
                TvImage(playlist.thumbnail, Modifier.fillMaxSize())
                Text(
                    playlist.videoCountText ?: "Danh sách phát",
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp)
                        .background(Color.Black.copy(alpha = 0.8f), RoundedCornerShape(4.dp))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(playlist.title.ifEmpty { "Danh sách phát" }, style = MaterialTheme.typography.titleSmall, maxLines = 2,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.heightIn(min = 40.dp))
            playlist.channelName?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = TvColors.secondaryText, maxLines = 1)
            }
        }
    }
}

/** Any feed item as a card (Shorts open in the Shorts player). */
@Composable
fun TvFeedCard(
    item: FeedItem,
    queue: List<VideoItem>,
    modifier: Modifier = Modifier,
    width: Dp? = 260.dp,
    onOptions: (VideoItem) -> Unit = {},
) {
    when (item) {
        is FeedItem.Video -> TvVideoCard(
            item.video, onClick = { TvNav.play(item.video, queue) }, modifier = modifier, width = width,
            onLongClick = { onOptions(item.video) },
        )
        is FeedItem.Channel -> TvChannelCard(item.channel, onClick = { TvNav.openChannel(item.channel) }, modifier = modifier,
            width = width?.let { minOf(it, 200.dp) })
        is FeedItem.Playlist -> TvPlaylistCard(item.playlist, onClick = { TvNav.open(TvRoute.Playlist(item.playlist)) },
            modifier = modifier, width = width)
        is FeedItem.Shorts -> {
            val first = item.items.firstOrNull() ?: return
            TvVideoCard(first, onClick = { TvNav.openShorts(item.items, first) }, modifier = modifier, width = width)
        }
    }
}

/** Flattens Shorts shelves into single items (each short is its own card on TV). */
fun List<FeedItem>.flattenShorts(): List<FeedItem> = flatMap { item ->
    if (item is FeedItem.Shorts) item.items.map { FeedItem.Video(it.copy(isShort = true)) } else listOf(item)
}

/** A titled horizontal row of cards. Focus comes back to the last focused card of the row. */
@Composable
fun TvShelf(title: String, modifier: Modifier = Modifier, inset: Dp = TvInsets.horizontal, content: LazyListScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(top = 18.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = inset, bottom = 8.dp),
        )
        LazyRow(
            modifier = Modifier.fillMaxWidth().focusRestorer(),
            contentPadding = PaddingValues(horizontal = inset, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            content = content,
        )
    }
}

// MARK: States

@Composable
fun TvLoading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Brand)
    }
}

@Composable
fun TvMessage(title: String, message: String? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        if (message != null) {
            Spacer(Modifier.height(8.dp))
            Text(message, style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText, textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 640.dp))
        }
        if (action != null) {
            Spacer(Modifier.height(18.dp))
            action()
        }
    }
}

@Composable
fun TvScreenTitle(title: String, modifier: Modifier = Modifier, subtitle: String? = null, inset: Dp = TvInsets.horizontal) {
    Column(modifier.padding(start = inset, end = inset, top = TvInsets.vertical, bottom = 8.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText, maxLines = 2)
        }
    }
}

// MARK: Dialogs

/** A centered dialog for choices (D-pad and Back work inside it). */
@Composable
fun TvDialog(title: String, onDismiss: () -> Unit, width: Dp = 560.dp, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        TvTheme {
            Column(
                Modifier.width(width).heightIn(max = 500.dp)
                    .background(TvColors.surface, RoundedCornerShape(20.dp))
                    .padding(horizontal = 24.dp, vertical = 20.dp),
            ) {
                Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Color.White)
                Spacer(Modifier.height(12.dp))
                Column(Modifier.verticalScroll(rememberScrollState())) { content() }
            }
        }
    }
}

/** One choice in a [TvDialog] or a settings list. */
@Composable
fun TvOptionRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    value: String? = null,
    subtitle: String? = null,
    icon: ImageVector? = null,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().padding(vertical = 3.dp),
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(12.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = Color.White,
            focusedContainerColor = TvColors.focused,
            focusedContentColor = TvColors.onFocused,
            pressedContainerColor = TvColors.focused,
            pressedContentColor = TvColors.onFocused,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(icon, null, Modifier.size(24.dp))
                Spacer(Modifier.width(14.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) {
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, maxLines = 3,
                        color = androidx.tv.material3.LocalContentColor.current.copy(alpha = 0.7f))
                }
            }
            if (value != null) {
                Spacer(Modifier.width(12.dp))
                Text(value, style = MaterialTheme.typography.bodyLarge, maxLines = 1,
                    color = androidx.tv.material3.LocalContentColor.current.copy(alpha = 0.75f))
            }
            if (selected) {
                Spacer(Modifier.width(12.dp))
                Box(Modifier.size(12.dp).background(Brand, CircleShape))
            }
        }
    }
}

/** A row of chips (tabs, categories). */
@Composable
fun <T> TvChipRow(
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    inset: Dp = TvInsets.horizontal,
) {
    LazyRow(
        modifier.fillMaxWidth().focusRestorer(),
        contentPadding = PaddingValues(horizontal = inset, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(options.size) { index ->
            val option = options[index]
            TvButton(label(option), onClick = { onSelect(option) }, selected = option == selected,
                modifier = Modifier.tvFocusItem("chip-${label(option)}"))
        }
    }
}
