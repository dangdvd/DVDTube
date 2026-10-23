package com.dangdvd.dvdtube.ui.components

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SlowMotionVideo
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.DownloadState
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import kotlinx.coroutines.launch

/** Opens a video the way the official app does: Shorts in the Shorts pager, others in the player. */
fun openVideo(video: VideoItem, context: List<VideoItem>? = null) {
    if (video.isShort) {
        Router.openShorts(context?.filter { it.isShort }?.ifEmpty { null } ?: listOf(video), video)
    } else {
        PlayerController.play(video, context?.filter { !it.isShort }?.takeIf { it.size > 1 })
    }
}

fun shareText(context: android.content.Context, text: String, subject: String? = null) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
        subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
    }
    context.startActivity(Intent.createChooser(intent, "Chia sẻ"))
}

@Composable
fun Thumbnail(video: VideoItem, modifier: Modifier = Modifier, corner: Int = 10) {
    val history = LibraryStore.history
    val progress = remember(history, video.id) { history.firstOrNull { it.video.id == video.id }?.progress ?: 0.0 }
    Box(modifier.aspectRatio(16f / 9f).clip(RoundedCornerShape(corner.dp))) {
        RemoteImage(video.displayThumbnail, Modifier.fillMaxSize())
        val badge = when {
            video.isLive -> "TRỰC TIẾP"
            else -> video.durationText
        }
        if (badge != null) {
            Text(
                badge,
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(6.dp)
                    .background(if (video.isLive) Brand else Color.Black.copy(alpha = 0.8f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            )
        }
        if (progress > 0.02) {
            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(Color.White.copy(alpha = 0.35f))) {
                Box(Modifier.fillMaxWidth(progress.toFloat()).fillMaxHeight().background(Brand))
            }
        }
    }
}

/** Full-width card used on the home feed (thumbnail on top, avatar + text below). */
@Composable
fun VideoCard(video: VideoItem, context: List<VideoItem>? = null) {
    Column(Modifier.fillMaxWidth().clickable { openVideo(video, context) }) {
        Thumbnail(video, Modifier.fillMaxWidth(), corner = 0)
        Row(Modifier.padding(start = 12.dp, top = 10.dp, bottom = 14.dp), verticalAlignment = Alignment.Top) {
            Avatar(
                video.channelAvatar, 36.dp, video.channelName ?: "",
                Modifier.clickable(enabled = video.channelId != null) {
                    video.channelId?.let { Router.openChannel(it, video.channelName ?: "", video.channelAvatar) }
                },
            )
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(video.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(3.dp))
                Text(video.metadataLine, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            VideoMenu(video)
        }
    }
}

/** Compact row (thumbnail left) used in search results, related videos and lists. */
@Composable
fun VideoRow(video: VideoItem, context: List<VideoItem>? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().clickable { openVideo(video, context) }.padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Thumbnail(video, Modifier.width(168.dp))
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(video.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(3.dp))
            Text(video.metadataLine, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) trailing() else VideoMenu(video)
    }
}

@Composable
fun VideoMenu(video: VideoItem, extra: (@Composable (close: () -> Unit) -> Unit)? = null) {
    var open by remember { mutableStateOf(false) }
    val context = LocalContext.current
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Default.MoreVert, "Tùy chọn", Modifier.size(20.dp)) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("Thêm vào hàng đợi") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.QueueMusic, null) },
                onClick = { open = false; PlayerController.addToQueue(video) },
            )
            DropdownMenuItem(
                text = { Text(if (LibraryActions.isInWatchLater(video.id)) "Xóa khỏi Xem sau" else "Lưu vào Xem sau") },
                leadingIcon = { Icon(Icons.Default.Schedule, null) },
                onClick = { open = false; LibraryActions.toggleWatchLater(video) },
            )
            DropdownMenuItem(
                text = { Text("Lưu vào danh sách phát") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.PlaylistAdd, null) },
                onClick = { open = false; Router.playlistSheetVideo = video },
            )
            if (!video.isLive) {
                val downloaded = DownloadManager.isDownloaded(video.id)
                DropdownMenuItem(
                    text = { Text(if (downloaded) "Đã tải xuống" else "Tải xuống") },
                    leadingIcon = { Icon(if (downloaded) Icons.Default.DownloadDone else Icons.Default.Download, null) },
                    enabled = !downloaded,
                    onClick = { open = false; DownloadManager.download(video) },
                )
            }
            DropdownMenuItem(
                text = { Text("Chia sẻ") },
                leadingIcon = { Icon(Icons.Default.Share, null) },
                onClick = { open = false; shareText(context, video.shareUrl, video.title) },
            )
            extra?.invoke { open = false }
        }
    }
}

@Composable
fun ShortsShelf(items: List<VideoItem>, title: String = "Shorts") {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.SlowMotionVideo, null, tint = Brand)
            Spacer(Modifier.width(8.dp))
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.id }) { short ->
                Column(Modifier.width(150.dp).clickable { Router.openShorts(items, short) }) {
                    Box(Modifier.fillMaxWidth().aspectRatio(9f / 16f).clip(RoundedCornerShape(10.dp))) {
                        RemoteImage(short.shortsThumbnail, Modifier.fillMaxSize())
                        short.viewCountText?.let {
                            Text(it, color = Color.White, style = MaterialTheme.typography.labelSmall,
                                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp))
                        }
                    }
                    Text(short.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
    }
}

@Composable
fun SubscribeButton(channel: ChannelItem, compact: Boolean = false) {
    val subscribed = LibraryActions.isSubscribed(channel.id)
    if (subscribed) {
        FilledTonalButton(onClick = { LibraryActions.toggleSubscription(channel) },
            contentPadding = PaddingValues(horizontal = if (compact) 12.dp else 16.dp)) {
            Text("Đã đăng ký")
        }
    } else {
        Button(
            onClick = { LibraryActions.toggleSubscription(channel) },
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface,
                contentColor = MaterialTheme.colorScheme.surface),
            contentPadding = PaddingValues(horizontal = if (compact) 12.dp else 16.dp),
        ) { Text("Đăng ký") }
    }
}

@Composable
fun ChannelRow(channel: ChannelItem) {
    Row(
        Modifier.fillMaxWidth().clickable { Router.open(Route.Channel(channel)) }.padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(channel.avatar, 56.dp, channel.name)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(channel.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val details = listOfNotNull(channel.handle, channel.subscriberText).joinToString(" • ")
            if (details.isNotEmpty()) {
                Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        SubscribeButton(channel, compact = true)
    }
}

@Composable
fun PlaylistRow(playlist: PlaylistItem) {
    Row(
        Modifier.fillMaxWidth().clickable { Router.open(Route.Playlist(playlist)) }.padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.width(168.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
            RemoteImage(playlist.thumbnail, Modifier.fillMaxSize())
            Row(
                Modifier.align(Alignment.BottomEnd).padding(6.dp).background(Color.Black.copy(alpha = 0.8f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 5.dp, vertical = 1.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.VideoLibrary, null, Modifier.size(12.dp), tint = Color.White)
                playlist.videoCountText?.let {
                    Spacer(Modifier.width(3.dp))
                    Text(it, color = Color.White, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(playlist.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 2,
                overflow = TextOverflow.Ellipsis)
            playlist.channelName?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            Text("Danh sách phát", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun FeedItemView(item: FeedItem, compact: Boolean, context: List<VideoItem>) {
    when (item) {
        is FeedItem.Video -> if (compact) VideoRow(item.video, context) else VideoCard(item.video, context)
        is FeedItem.Channel -> ChannelRow(item.channel)
        is FeedItem.Playlist -> PlaylistRow(item.playlist)
        is FeedItem.Shorts -> ShortsShelf(item.items)
    }
}

/** Feed items for a LazyColumn, calling [onLoadMore] near the end. */
fun LazyListScope.feedItems(
    items: List<FeedItem>,
    compact: Boolean,
    isLoadingMore: Boolean,
    onLoadMore: (() -> Unit)?,
) {
    val context = items.flatMap { if (it is FeedItem.Video) listOf(it.video) else emptyList() }
    items(items.size, key = { items[it].key + "#" + it }) { index ->
        FeedItemView(items[index], compact, context)
        if (index >= items.size - 4 && onLoadMore != null) {
            LaunchedEffect(items.size) { onLoadMore() }
        }
    }
    if (isLoadingMore) {
        item(key = "loading-more") {
            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(28.dp))
            }
        }
    }
}

/** Standard feed screen body for a [FeedModel]: loading, error, empty and the list itself. */
@Composable
fun FeedList(
    model: FeedModel,
    compact: Boolean = false,
    state: LazyListState = rememberLazyListState(),
    emptyTitle: String = "Không có nội dung",
    header: (LazyListScope.() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(model) { model.load() }
    LazyColumn(Modifier.fillMaxSize(), state = state) {
        header?.invoke(this)
        when {
            model.isLoading && model.items.isEmpty() -> item { LoadingState() }
            model.error != null && model.items.isEmpty() -> item {
                ErrorState(model.error ?: "") { scope.launch { model.load(force = true) } }
            }
            model.items.isEmpty() && model.hasLoaded -> item {
                EmptyState(Icons.Default.VideoLibrary, emptyTitle, model.message)
            }
            else -> feedItems(model.items, compact, model.isLoadingMore,
                if (model.canLoadMore) ({ scope.launch { model.loadMore() } }) else null)
        }
    }
}

/** Download progress / state shown next to a video. */
@Composable
fun DownloadStatus(videoId: String) {
    when (val state = DownloadManager.states[videoId]) {
        is DownloadState.Downloading -> LinearProgressIndicator(progress = { state.progress.toFloat() }, Modifier.width(80.dp))
        DownloadState.Preparing, DownloadState.Merging -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        is DownloadState.Failed -> Text("Lỗi", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
        null -> if (DownloadManager.isDownloaded(videoId)) Icon(Icons.Default.CheckCircle, null, tint = Brand, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun rememberIsAtTop(state: LazyListState): Boolean {
    val atTop by remember(state) { derivedStateOf { state.firstVisibleItemIndex == 0 && state.firstVisibleItemScrollOffset < 10 } }
    return atTop
}
