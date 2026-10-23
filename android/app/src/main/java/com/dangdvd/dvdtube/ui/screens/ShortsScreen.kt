package com.dangdvd.dvdtube.ui.screens

import android.content.Context
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Comment
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.services.SearchFilter
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.ShortsPlayer
import com.dangdvd.dvdtube.ui.AppTab
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.SingleFlight
import com.dangdvd.dvdtube.ui.components.shareText
import com.dangdvd.dvdtube.ui.player.WebPlayerHost
import com.dangdvd.dvdtube.ui.rememberRouteModel
import com.dangdvd.dvdtube.ui.watch.CommentsSheet
import com.dangdvd.dvdtube.ui.watch.enrichedVideo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The Shorts feed: an endless list of Shorts from searches, or the ones opened elsewhere. */
class ShortsFeed {
    var items by mutableStateOf(listOf<VideoItem>())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var index = 0
    /** Bumped when [show] replaces the feed, so the pager jumps to the new start. */
    var generation by mutableStateOf(0)
        private set
    private var continuation: String? = null
    private var queryIndex = 0

    private val queries: List<String>
        get() = if (APIConfig.hl == "vi") listOf("shorts", "shorts việt nam", "hài hước shorts", "âm nhạc shorts", "ẩm thực shorts", "thể thao shorts")
        else listOf("shorts", "funny shorts", "music shorts", "food shorts", "sports shorts")

    fun show(list: List<VideoItem>, startId: String) {
        items = list.map { it.copy(isShort = true) }
        index = items.indexOfFirst { it.id == startId }.coerceAtLeast(0)
        continuation = null
        generation++
    }

    private val flight = SingleFlight()

    suspend fun load(reset: Boolean) = flight.run { fetch(reset) }

    private suspend fun fetch(reset: Boolean) {
        isLoading = true
        error = null
        try {
            if (reset) {
                continuation = null
                queryIndex = queries.indices.random()
            }
            val token = continuation
            val page = if (token != null) YouTubeService.searchMore(token) else {
                YouTubeService.search(queries[queryIndex % queries.size], SearchFilter.SHORTS).also { queryIndex++ }
            }
            continuation = page.continuation
            val watched = LibraryStore.history.take(300).filter { it.video.isShort }.map { it.video.id }.toSet()
            val existing = items.map { it.id }.toSet()
            var fresh = page.videos.filter { it.isShort && it.id !in existing && it.id !in watched }
            if (fresh.isEmpty()) fresh = page.videos.filter { it.id !in existing }
            fresh = fresh.map { it.copy(isShort = true) }
            if (reset) {
                items = fresh
                index = 0
                generation++
            } else {
                items = items + fresh
            }
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            if (items.isEmpty()) error = failure.message ?: "Không tải được Shorts."
        } finally {
            isLoading = false
        }
    }
}

private object ShortsViewHolder {
    private var view: PlayerView? = null

    fun view(context: Context): PlayerView {
        view?.let { existing ->
            (existing.parent as? ViewGroup)?.removeView(existing)
            return existing
        }
        return PlayerView(context.applicationContext).apply {
            useController = false
            setShutterBackgroundColor(android.graphics.Color.BLACK)
            subtitleView?.visibility = View.GONE
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            player = ShortsPlayer.exo
        }.also { view = it }
    }
}

/** Embed used for Shorts that YouTube refuses to stream natively. */
private val ShortsWebPlayer = WebPlayerHost { }

@Composable
fun ShortsScreen() {
    val feed = rememberRouteModel("shorts") { ShortsFeed() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Router.pendingShorts) {
        val pending = Router.consumePendingShorts()
        if (pending != null) feed.show(pending.first, pending.second)
        else if (feed.items.isEmpty()) feed.load(reset = true)
    }
    DisposableEffect(Unit) {
        onDispose {
            ShortsPlayer.pause()
            ShortsWebPlayer.destroy()
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        val items = feed.items
        when {
            items.isEmpty() && feed.isLoading -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
            items.isEmpty() && feed.error != null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(feed.error ?: "", color = Color.White)
                Spacer(Modifier.height(10.dp))
                Button(onClick = { scope.launch { feed.load(reset = true) } }) { Text("Thử lại") }
            }
            items.isNotEmpty() -> {
                val pager = rememberPagerState(initialPage = feed.index.coerceIn(0, items.size - 1)) { feed.items.size }
                LaunchedEffect(feed.generation) {
                    if (pager.currentPage != feed.index && feed.index < feed.items.size) pager.scrollToPage(feed.index)
                }
                LaunchedEffect(pager) {
                    snapshotFlow { pager.currentPage }.collect { page ->
                        feed.index = page
                        val list = feed.items
                        val video = list.getOrNull(page) ?: return@collect
                        if (Router.selectedTab == AppTab.SHORTS) ShortsPlayer.play(video)
                        ShortsPlayer.prefetch(list.drop(page + 1))
                        LibraryStore.recordWatch(video, 0.0, (video.durationSeconds ?: 0).toDouble())
                        if (page >= list.size - 3) scope.launch { feed.load(reset = false) }
                    }
                }
                VerticalPager(pager, Modifier.fillMaxSize(), key = { feed.items.getOrNull(it)?.id ?: it.toString() }, beyondViewportPageCount = 1) { page ->
                    val video = feed.items.getOrNull(page) ?: return@VerticalPager
                    ShortPage(video, isCurrent = page == pager.currentPage)
                }
            }
        }
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Shorts", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(start = 8.dp).weight(1f))
            IconButton(onClick = { Router.open(Route.Search()) }) { Icon(Icons.Outlined.Search, "Tìm kiếm", tint = Color.White) }
        }
    }
}

@Composable
private fun ShortPage(video: VideoItem, isCurrent: Boolean) {
    val context = LocalContext.current
    var commentsToken by remember { mutableStateOf<String?>(null) }
    val info by produceState<WatchInfo?>(null, video.id, isCurrent) {
        if (isCurrent && value == null) value = runCatching { YouTubeService.watchInfo(video.id) }.getOrNull()
    }
    val item = enrichedVideo(video, info)
    val web = video.id in ShortsPlayer.webFallbackIds

    Box(
        Modifier.fillMaxSize().background(Color.Black).pointerInput(video.id) {
            detectTapGestures(onTap = { ShortsPlayer.toggle() })
        },
    ) {
        if (isCurrent && web) {
            AndroidView(factory = { ShortsWebPlayer.view(it) }, modifier = Modifier.fillMaxSize())
            LaunchedEffect(video.id) { if (ShortsWebPlayer.videoId != video.id) ShortsWebPlayer.load(video.id, 0.0, loop = true) }
        } else if (isCurrent && ShortsPlayer.currentId == video.id && !ShortsPlayer.isLoading) {
            AndroidView(factory = { ShortsViewHolder.view(it) }, modifier = Modifier.fillMaxSize())
        } else {
            RemoteImage(video.shortsThumbnail, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        }
        if (isCurrent && !web) {
            if (ShortsPlayer.isLoading) CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
            else if (!ShortsPlayer.isPlaying && ShortsPlayer.currentId == video.id && ShortsPlayer.error == null) {
                Icon(Icons.Default.PlayArrow, "Phát", tint = Color.White.copy(alpha = 0.8f), modifier = Modifier.align(Alignment.Center).size(72.dp))
            }
            ShortsPlayer.error?.let {
                Text(it, color = Color.White, modifier = Modifier.align(Alignment.Center).padding(24.dp)
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(8.dp)).padding(10.dp))
            }
        }

        // Actions on the right.
        Column(
            Modifier.align(Alignment.BottomEnd).padding(end = 8.dp, bottom = 90.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val liked = LibraryActions.isLiked(video.id, info?.likeStatus)
            val disliked = LibraryActions.isDisliked(video.id, info?.likeStatus)
            ShortAction(if (liked) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp, info?.likeCountText ?: "Thích") {
                LibraryActions.toggleLike(item, info?.likeStatus)
            }
            ShortAction(if (disliked) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown, "Không thích") {
                LibraryActions.toggleDislike(item, info?.likeStatus)
            }
            ShortAction(Icons.AutoMirrored.Filled.Comment, info?.commentCountText ?: "Bình luận") {
                commentsToken = info?.commentsToken
            }
            ShortAction(Icons.Default.Share, "Chia sẻ") { shareText(context, video.shareUrl, video.title) }
            var menu by remember { mutableStateOf(false) }
            Box {
                ShortAction(Icons.Default.MoreVert, "") { menu = true }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Lưu vào danh sách phát") }, onClick = { menu = false; Router.playlistSheetVideo = item })
                    DropdownMenuItem(
                        text = { Text(if (DownloadManager.isDownloaded(video.id)) "Đã tải xuống" else "Tải xuống") },
                        enabled = !DownloadManager.isDownloaded(video.id),
                        onClick = { menu = false; DownloadManager.download(item) },
                    )
                }
            }
        }

        // Channel and title at the bottom.
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 12.dp, end = 72.dp, bottom = 20.dp)) {
            val channel = info?.channel
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(channel?.avatar ?: video.channelAvatar, 32.dp, channel?.name ?: video.channelName ?: "",
                    Modifier.clickable(enabled = (channel?.id ?: video.channelId) != null) {
                        (channel?.id ?: video.channelId)?.let { Router.openChannel(it, channel?.name ?: video.channelName ?: "") }
                    })
                Spacer(Modifier.width(8.dp))
                Text(channel?.name ?: video.channelName ?: "", color = Color.White, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (channel != null) {
                    Spacer(Modifier.width(8.dp))
                    val subscribed = LibraryActions.isSubscribed(channel.id)
                    Button(
                        onClick = { LibraryActions.toggleSubscription(channel) },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (subscribed) Color.White.copy(alpha = 0.25f) else Color.White,
                            contentColor = if (subscribed) Color.White else Color.Black,
                        ),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                        modifier = Modifier.height(32.dp),
                    ) { Text(if (subscribed) "Đã đăng ký" else "Đăng ký", style = MaterialTheme.typography.labelMedium) }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(info?.title ?: video.title, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium)
        }
        if (isCurrent && !web) {
            LinearProgressIndicator(
                progress = { ShortsPlayer.progress },
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(2.dp),
                color = Color.White, trackColor = Color.White.copy(alpha = 0.25f),
            )
        }
    }
    commentsToken?.let { token -> CommentsSheet(token) { commentsToken = null } }
}

@Composable
private fun ShortAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick)) {
        Box(Modifier.size(46.dp).background(Color.Black.copy(alpha = 0.35f), RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = Color.White, modifier = Modifier.size(26.dp))
        }
        if (label.isNotEmpty()) Text(label, color = Color.White, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}
