package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import com.dangdvd.dvdtube.core.ChannelPage
import com.dangdvd.dvdtube.core.ChannelTab
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.ErrorState
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.LoadingState
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.components.SubscribeButton
import com.dangdvd.dvdtube.ui.components.pagedFeed
import com.dangdvd.dvdtube.ui.components.shareText
import com.dangdvd.dvdtube.ui.rememberRouteModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class ChannelState(val seed: com.dangdvd.dvdtube.core.ChannelItem) {
    var page by mutableStateOf<ChannelPage?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var tab by mutableStateOf(ChannelTab.VIDEOS)
    private val tabModels = mutableStateMapOf<ChannelTab, FeedModel>()

    suspend fun load() {
        if (page != null) return
        error = null
        try {
            val loaded = YouTubeService.channel(seed.id)
            tabModels[loaded.initialTab] = FeedModel { loaded.initialPage }
            tab = loaded.initialTab
            page = loaded
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            error = failure.message ?: "Không tải được kênh."
        }
    }

    fun model(tab: ChannelTab): FeedModel? {
        val loaded = page ?: return null
        return tabModels.getOrPut(tab) { FeedModel { YouTubeService.channelTab(loaded.channel.id, tab, loaded.tabParams[tab]) } }
    }
}

@Composable
fun ChannelScreen(route: Route.Channel) {
    val state = rememberRouteModel(route.key) { ChannelState(route.channel) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(false) }
    LaunchedEffect(state) { state.load() }
    val page = state.page
    val channel = page?.channel ?: route.channel

    ScreenScaffold(channel.name, actions = {
        IconButton(onClick = {
            val handle = channel.handle?.takeIf { it.startsWith("@") }
            shareText(context, "https://www.youtube.com/" + (handle ?: "channel/${channel.id}"), channel.name)
        }) { Icon(Icons.Default.Share, "Chia sẻ") }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item(key = "header") {
                Column {
                    page?.banner?.let { RemoteImage(it, Modifier.fillMaxWidth().aspectRatio(6.2f).padding(horizontal = 12.dp).clip(RoundedCornerShape(12.dp))) }
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(channel.avatar, 72.dp, channel.name)
                        Column(Modifier.weight(1f).padding(start = 14.dp)) {
                            Text(channel.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2,
                                overflow = TextOverflow.Ellipsis)
                            val details = listOfNotNull(channel.handle, channel.subscriberText, channel.videoCountText).joinToString(" • ")
                            if (details.isNotEmpty()) {
                                Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    page?.description?.takeIf { it.isNotBlank() }?.let { description ->
                        Text(
                            description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = if (expanded) Int.MAX_VALUE else 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 16.dp).clickable { expanded = !expanded },
                        )
                    }
                    Box(Modifier.fillMaxWidth().padding(16.dp, 10.dp)) { if (page != null) SubscribeButton(channel) }
                }
            }
            if (page == null) {
                item(key = "state") {
                    val error = state.error
                    if (error != null) ErrorState(error) { scope.launch { state.load() } } else LoadingState()
                }
                return@LazyColumn
            }
            stickyHeader(key = "tabs") {
                val tabs = ChannelTab.entries
                ScrollableTabRow(selectedTabIndex = tabs.indexOf(state.tab), edgePadding = 12.dp) {
                    tabs.forEach { tab ->
                        Tab(selected = state.tab == tab, onClick = { state.tab = tab }, text = { Text(tab.title) })
                    }
                }
            }
            val model = state.model(state.tab) ?: return@LazyColumn
            if (state.tab == ChannelTab.SHORTS) {
                val shorts = model.items.flatMap { item ->
                    when (item) {
                        is FeedItem.Video -> listOf(item.video.copy(isShort = true))
                        is FeedItem.Shorts -> item.items
                        else -> emptyList()
                    }
                }
                if (!model.hasLoaded || shorts.isEmpty()) {
                    pagedFeed(model, scope, emptyTitle = "Kênh chưa có Shorts")
                } else {
                    items(shorts.chunked(3), key = { row -> "shorts-" + row.first().id }) { row ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            row.forEach { short ->
                                Box(Modifier.weight(1f).aspectRatio(9f / 16f).clip(RoundedCornerShape(6.dp)).clickable { Router.openShorts(shorts, short) }) {
                                    RemoteImage(short.shortsThumbnail, Modifier.fillMaxSize())
                                    short.viewCountText?.let {
                                        Text(it, color = Color.White, style = MaterialTheme.typography.labelSmall,
                                            modifier = Modifier.align(Alignment.BottomStart).padding(6.dp))
                                    }
                                }
                            }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                    if (model.canLoadMore) item { LaunchedEffect(shorts.size) { model.loadMore() } }
                }
            } else {
                pagedFeed(model, scope, compact = true, emptyTitle = "Không có nội dung")
            }
        }
    }
}

class PlaylistState(val playlistId: String, seed: PlaylistItem) {
    var header by mutableStateOf(seed)
    val feed = FeedModel { YouTubeService.playlist(playlistId).also { header = it.playlist }.page }
}

@Composable
fun PlaylistScreen(route: Route.Playlist) {
    val state = rememberRouteModel(route.key) { PlaylistState(route.playlist.id, route.playlist) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val header = state.header
    ScreenScaffold(header.title.ifEmpty { "Danh sách phát" }, actions = {
        IconButton(onClick = { shareText(context, "https://www.youtube.com/playlist?list=${state.playlistId}", header.title) }) {
            Icon(Icons.Default.Share, "Chia sẻ")
        }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item(key = "header") {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    val thumbnail = header.thumbnail ?: state.feed.videos.firstOrNull()?.displayThumbnail
                    if (thumbnail != null) RemoteImage(thumbnail, Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)))
                    Spacer(Modifier.height(12.dp))
                    Text(header.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    val details = listOfNotNull(header.channelName, header.videoCountText).joinToString(" • ")
                    if (details.isNotEmpty()) Text(details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val videos = state.feed.videos
                    if (videos.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = { PlayerController.play(videos.first(), videos) }, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Default.PlayArrow, null)
                                Spacer(Modifier.width(6.dp))
                                Text("Phát tất cả")
                            }
                            FilledTonalButton(onClick = { val shuffled = videos.shuffled(); PlayerController.play(shuffled.first(), shuffled) },
                                modifier = Modifier.weight(1f)) {
                                Icon(Icons.Default.Shuffle, null)
                                Spacer(Modifier.width(6.dp))
                                Text("Trộn bài")
                            }
                        }
                    }
                }
            }
            pagedFeed(state.feed, scope, compact = true, emptyTitle = "Danh sách phát trống")
        }
    }
}
