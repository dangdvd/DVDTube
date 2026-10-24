package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.ChannelTab
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.PagedFeed
import com.dangdvd.dvdtube.ui.screens.ChannelState
import com.dangdvd.dvdtube.ui.screens.PlaylistState
import kotlinx.coroutines.launch

/** Long-press menu of a video card. */
@Composable
fun TvVideoOptions(video: VideoItem, onDismiss: () -> Unit) {
    var choosingPlaylist by remember { mutableStateOf(false) }
    if (choosingPlaylist) {
        TvDialog("Lưu vào danh sách phát", onDismiss) {
            LibraryStore.playlists.forEach { playlist ->
                val contains = playlist.videos.any { it.id == video.id }
                TvOptionRow(playlist.name, selected = contains, value = "${playlist.videos.size} video", onClick = {
                    if (contains) {
                        LibraryStore.remove(video.id, playlist.id)
                        Toasts.show("Đã xóa khỏi ${playlist.name}")
                    } else {
                        LibraryStore.add(video, playlist.id)
                        Toasts.show("Đã lưu vào ${playlist.name}")
                    }
                    onDismiss()
                })
            }
            TvOptionRow("Danh sách phát mới", icon = Icons.Default.PlaylistAdd, onClick = {
                val created = LibraryStore.createPlaylist("Danh sách ${LibraryStore.playlists.size + 1}", video)
                Toasts.show("Đã tạo ${created.name}")
                onDismiss()
            })
        }
        return
    }
    TvDialog(video.title.ifEmpty { "Video" }, onDismiss) {
        TvOptionRow("Phát", icon = Icons.Default.PlayArrow, onClick = {
            onDismiss()
            TvNav.play(video)
        })
        TvOptionRow(
            if (LibraryActions.isInWatchLater(video.id)) "Xóa khỏi Xem sau" else "Lưu vào Xem sau",
            icon = Icons.Default.Schedule,
            onClick = {
                LibraryActions.toggleWatchLater(video)
                onDismiss()
            },
        )
        TvOptionRow("Lưu vào danh sách phát trên máy", icon = Icons.Default.PlaylistAdd, onClick = { choosingPlaylist = true })
        video.channelId?.let { id ->
            TvOptionRow("Mở kênh ${video.channelName ?: ""}".trim(), icon = Icons.Default.AccountCircle, onClick = {
                onDismiss()
                TvNav.openChannel(id, video.channelName ?: "")
            })
        }
        TvOptionRow("Không quan tâm", icon = Icons.Default.VisibilityOff, onClick = {
            HiddenContentStore.hide(video)
            Toasts.show("Đã ẩn video này")
            onDismiss()
        })
    }
}

/** A paged grid of feed items (with optional header rows spanning the full width). */
@Composable
fun TvFeedGrid(
    feed: PagedFeed,
    modifier: Modifier = Modifier,
    columns: Int = 4,
    emptyTitle: String = "Không có nội dung",
    header: LazyGridScope.() -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val gridState = rememberLazyGridState()
    val initial = remember { FocusRequester() }
    var hasFocus by remember { mutableStateOf(false) }
    var optionsFor by remember { mutableStateOf<VideoItem?>(null) }

    LaunchedEffect(feed) { feed.load() }
    val items = HiddenContentStore.filter(feed.items).flattenShorts().distinctBy { it.key }
    val videos = items.mapNotNull { it.videoOrNull }

    LaunchedEffect(gridState, feed) {
        snapshotFlow { (gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) to gridState.layoutInfo.totalItemsCount }
            .collect { (last, total) ->
                if (total > 0 && last >= total - 8 && feed.canLoadMore && !feed.isLoadingMore && !feed.isLoading) feed.loadMore()
            }
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        modifier = modifier.fillMaxSize().onFocusChanged { hasFocus = it.hasFocus },
        state = gridState,
        contentPadding = PaddingValues(start = TvInsets.horizontal, end = TvInsets.horizontal, bottom = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        header()
        itemsIndexed(items, key = { _, item -> item.key }) { index, item ->
            TvFeedCard(
                item, videos,
                modifier = Modifier.tvFocusItem(item.key, if (index == 0) initial else null),
                width = null,
                onOptions = { optionsFor = it },
            )
        }
        when {
            feed.isLoading && items.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) { TvLoading() }
            feed.error != null && items.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
                TvMessage("Không tải được nội dung", feed.error) {
                    TvButton("Thử lại", onClick = { scope.launch { feed.load(force = true) } })
                }
            }
            feed.hasLoaded && items.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) { TvMessage(emptyTitle, feed.message) }
            feed.isLoadingMore -> item(span = { GridItemSpan(maxLineSpan) }) { TvLoading() }
        }
    }
    InitialFocus(initial, ready = items.isNotEmpty()) { hasFocus }
    optionsFor?.let { video -> TvVideoOptions(video) { optionsFor = null } }
}

/** A grid of plain videos (history, local playlists…). */
@Composable
fun TvVideoGrid(
    videos: List<VideoItem>,
    modifier: Modifier = Modifier,
    emptyTitle: String = "Chưa có video",
    progress: (VideoItem) -> Float? = { null },
    header: LazyGridScope.() -> Unit = {},
) {
    val initial = remember { FocusRequester() }
    var hasFocus by remember { mutableStateOf(false) }
    var optionsFor by remember { mutableStateOf<VideoItem?>(null) }
    val videos = videos.distinctBy { it.id }
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = modifier.fillMaxSize().onFocusChanged { hasFocus = it.hasFocus },
        contentPadding = PaddingValues(start = TvInsets.horizontal, end = TvInsets.horizontal, bottom = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        header()
        itemsIndexed(videos, key = { _, video -> video.id }) { index, video ->
            TvVideoCard(
                video,
                onClick = { TvNav.play(video, videos) },
                modifier = Modifier.tvFocusItem(video.id, if (index == 0) initial else null),
                width = null,
                progress = progress(video),
                onLongClick = { optionsFor = video },
            )
        }
        if (videos.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { TvMessage(emptyTitle) }
    }
    InitialFocus(initial, ready = videos.isNotEmpty()) { hasFocus }
    optionsFor?.let { video -> TvVideoOptions(video) { optionsFor = null } }
}

private fun LazyGridScope.fullWidth(key: String, content: @Composable () -> Unit) =
    item(key = key, span = { GridItemSpan(maxLineSpan) }) { content() }

// MARK: Channel

private val tvChannelTabs = listOf(ChannelTab.VIDEOS, ChannelTab.SHORTS, ChannelTab.STREAMS, ChannelTab.PLAYLISTS)

@Composable
fun TvChannelScreen(route: TvRoute.Channel) {
    val state = TvNav.model(route.key) { ChannelState(route.channel) }
    LaunchedEffect(Unit) { state.load() }
    val page = state.page
    if (page == null) {
        Column(Modifier.fillMaxSize()) {
            TvScreenTitle(route.channel.name.ifEmpty { "Kênh" })
            val error = state.error
            if (error != null) TvMessage("Không tải được kênh", error) else TvLoading()
        }
        return
    }
    val channel = page.channel
    val tab = if (state.tab in tvChannelTabs) state.tab else ChannelTab.VIDEOS
    val model = state.model(tab) ?: return
    TvFeedGrid(model, emptyTitle = "Kênh chưa có nội dung ở mục này") {
        fullWidth("header") {
            Row(Modifier.fillMaxWidth().padding(top = TvInsets.vertical, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TvAvatar(channel.avatar, 88.dp, channel.name)
                Spacer(Modifier.width(20.dp))
                Column(Modifier.weight(1f)) {
                    Text(channel.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, maxLines = 1)
                    val detail = listOfNotNull(channel.handle, channel.subscriberText, channel.videoCountText).joinToString(" • ")
                    if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText, maxLines = 1)
                }
                val subscribed = LibraryActions.isSubscribed(channel.id)
                TvButton(
                    if (subscribed) "Đã đăng ký" else "Đăng ký",
                    onClick = { LibraryActions.toggleSubscription(channel) },
                    selected = subscribed,
                    accent = !subscribed,
                    modifier = Modifier.tvFocusItem("subscribe"),
                )
            }
        }
        fullWidth("tabs") {
            TvChipRow(tvChannelTabs, tab, { it.title }, { state.tab = it }, inset = 0.dp)
        }
    }
}

// MARK: Playlists

@Composable
fun TvPlaylistScreen(route: TvRoute.Playlist) {
    val state = TvNav.model(route.key) { PlaylistState(route.playlist.id, route.playlist) }
    val header = state.header
    TvFeedGrid(state.feed, emptyTitle = "Danh sách phát trống") {
        fullWidth("header") {
            Column(Modifier.padding(top = TvInsets.vertical, bottom = 8.dp)) {
                Text(header.title.ifEmpty { "Danh sách phát" }, style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold, maxLines = 2)
                val detail = listOfNotNull(header.channelName, header.videoCountText).joinToString(" • ")
                if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText)
                Spacer(Modifier.padding(top = 12.dp))
                PlayButtons(state.feed.videos)
            }
        }
    }
}

@Composable
private fun PlayButtons(videos: List<VideoItem>) {
    if (videos.isEmpty()) return
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        TvButton("Phát tất cả", onClick = { TvNav.play(videos.first(), videos) }, icon = Icons.Default.PlayArrow, accent = true,
            modifier = Modifier.tvFocusItem("play-all"))
        TvButton("Trộn bài", onClick = {
            val shuffled = videos.shuffled()
            TvNav.play(shuffled.first(), shuffled)
        }, icon = Icons.Default.Shuffle, modifier = Modifier.tvFocusItem("shuffle"))
    }
}

@Composable
fun TvLocalPlaylistScreen(route: TvRoute.LocalPlaylist) {
    val playlist = LibraryStore.playlist(route.id)
    if (playlist == null) {
        TvMessage("Danh sách phát không còn nữa")
        return
    }
    TvVideoGrid(playlist.videos, emptyTitle = "Danh sách phát trống") {
        fullWidth("header") {
            Column(Modifier.padding(top = TvInsets.vertical, bottom = 8.dp)) {
                Text(playlist.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text("${playlist.videos.size} video • trên máy này", style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText)
                Spacer(Modifier.padding(top = 12.dp))
                PlayButtons(playlist.videos)
            }
        }
    }
}

@Composable
fun TvAccountFeedScreen(route: TvRoute.AccountFeed) {
    val feed = TvNav.model(route.key) { FeedModel { YouTubeService.accountFeed(route.browseId) } }
    TvFeedGrid(feed) {
        fullWidth("title") { TvScreenTitle(route.title, inset = 0.dp) }
    }
}

// MARK: Library

private class TvLibraryModels {
    val watchLater = FeedModel { YouTubeService.accountFeed("VLWL") }
    val liked = FeedModel { YouTubeService.accountFeed("VLLL") }
    val playlists = FeedModel { YouTubeService.accountFeed("FEplaylist_aggregation") }
    var sessionKey = AccountStore.sessionKey
}

@Composable
fun TvLibraryScreen() {
    var models by remember { mutableStateOf(TvNav.model("library") { TvLibraryModels() }) }
    val signedIn = AccountStore.isSignedIn
    LaunchedEffect(AccountStore.sessionKey) {
        if (models.sessionKey != AccountStore.sessionKey) models = TvLibraryModels()
        if (AccountStore.isSignedIn) {
            launch { models.watchLater.load() }
            launch { models.liked.load() }
            launch { models.playlists.load() }
        }
    }
    val initial = remember { FocusRequester() }
    var hasFocus by remember { mutableStateOf(false) }
    var optionsFor by remember { mutableStateOf<VideoItem?>(null) }

    val history = LibraryStore.history.map { it.video }.distinctBy { it.id }
    val watchLater = (if (signedIn) models.watchLater.videos else LibraryStore.watchLater).distinctBy { it.id }
    val liked = (if (signedIn) models.liked.videos else LibraryStore.liked).distinctBy { it.id }
    val accountPlaylists = if (signedIn) {
        models.playlists.items.mapNotNull { (it as? FeedItem.Playlist)?.playlist }.distinctBy { it.id }
    } else {
        emptyList()
    }
    val local = LibraryStore.playlists.distinctBy { it.id }

    LazyColumn(Modifier.fillMaxSize().onFocusChanged { hasFocus = it.hasFocus }, contentPadding = PaddingValues(bottom = 48.dp)) {
        item("title") { TvScreenTitle("Thư viện", subtitle = if (signedIn) AccountStore.profile?.name else "Lưu trên TV này") }
        var first = true
        fun shelf(key: String, title: String, videos: List<VideoItem>, progress: (VideoItem) -> Float? = { null }) {
            if (videos.isEmpty()) return
            val isFirst = first
            first = false
            item(key) {
                TvShelf(title) {
                    itemsIndexed(videos.take(30), key = { _, video -> video.id }) { index, video ->
                        TvVideoCard(
                            video,
                            onClick = { TvNav.play(video, videos) },
                            modifier = Modifier.tvFocusItem("$key-${video.id}", if (isFirst && index == 0) initial else null),
                            progress = progress(video),
                            onLongClick = { optionsFor = video },
                        )
                    }
                }
            }
        }
        shelf("history", "Nhật ký xem", history) { video ->
            LibraryStore.history.firstOrNull { it.video.id == video.id }?.progress?.toFloat()
        }
        shelf("watchLater", "Xem sau", watchLater)
        shelf("liked", "Video đã thích", liked)
        if (local.isNotEmpty() || accountPlaylists.isNotEmpty()) {
            item("playlists") {
                TvShelf("Danh sách phát") {
                    items(local, key = { "local-${it.id}" }) { playlist ->
                        TvPlaylistCard(
                            com.dangdvd.dvdtube.core.PlaylistItem(
                                id = playlist.id,
                                title = playlist.name,
                                thumbnail = playlist.videos.firstOrNull()?.displayThumbnail,
                                channelName = "Trên máy này",
                                videoCountText = "${playlist.videos.size} video",
                            ),
                            onClick = { TvNav.open(TvRoute.LocalPlaylist(playlist.id)) },
                            modifier = Modifier.tvFocusItem("local-${playlist.id}"),
                        )
                    }
                    items(accountPlaylists, key = { "account-${it.id}" }) { playlist ->
                        TvPlaylistCard(playlist, onClick = { TvNav.open(TvRoute.Playlist(playlist)) },
                            modifier = Modifier.tvFocusItem("account-${playlist.id}"))
                    }
                }
            }
        }
        if (history.isEmpty() && watchLater.isEmpty() && liked.isEmpty() && local.isEmpty() && accountPlaylists.isEmpty()) {
            item("empty") {
                TvMessage("Thư viện đang trống", "Video bạn xem, lưu vào Xem sau hoặc thích sẽ xuất hiện ở đây.")
            }
        }
        if (signedIn) {
            item("account-history") {
                Row(Modifier.padding(start = TvInsets.horizontal, top = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    TvButton("Nhật ký xem trên YouTube", onClick = { TvNav.open(TvRoute.AccountFeed("Nhật ký xem", "FEhistory")) },
                        modifier = Modifier.tvFocusItem("feed-history"))
                    TvButton("Tất cả danh sách phát", onClick = { TvNav.open(TvRoute.AccountFeed("Danh sách phát", "FEplaylist_aggregation")) },
                        modifier = Modifier.tvFocusItem("feed-playlists"))
                }
            }
        }
    }
    InitialFocus(initial, ready = history.isNotEmpty() || watchLater.isNotEmpty() || liked.isNotEmpty()) { hasFocus }
    optionsFor?.let { video -> TvVideoOptions(video) { optionsFor = null } }
}
