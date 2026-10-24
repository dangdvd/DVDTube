package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.ChannelAbout
import com.dangdvd.dvdtube.core.ChannelPage
import com.dangdvd.dvdtube.core.ChannelTab
import com.dangdvd.dvdtube.core.CommunityPost
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.PostAttachment
import com.dangdvd.dvdtube.core.PostsPage
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.player.Toasts
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
import com.dangdvd.dvdtube.ui.components.VideoRow
import com.dangdvd.dvdtube.ui.components.pagedFeed
import com.dangdvd.dvdtube.ui.components.shareText
import com.dangdvd.dvdtube.ui.rememberRouteModel
import com.dangdvd.dvdtube.ui.watch.linkifiedText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** A channel's community posts, paged. */
class PostsModel(private val loader: suspend () -> PostsPage) {
    var posts by mutableStateOf(listOf<CommunityPost>())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var isLoadingMore by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var hasLoaded by mutableStateOf(false)
        private set
    private var continuation: String? = null

    val canLoadMore: Boolean get() = continuation != null

    suspend fun load() {
        if (isLoading) return
        isLoading = true
        error = null
        try {
            val page = loader()
            posts = page.posts
            continuation = page.continuation
            hasLoaded = true
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            error = failure.message ?: "Không tải được bài đăng."
        } finally {
            isLoading = false
        }
    }

    suspend fun loadMore() {
        val token = continuation ?: return
        if (isLoadingMore) return
        isLoadingMore = true
        try {
            val page = YouTubeService.channelPostsMore(token)
            val known = posts.map { it.id }.toSet()
            posts = posts + page.posts.filter { it.id !in known }
            continuation = if (page.continuation == token) null else page.continuation
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            continuation = null
        } finally {
            isLoadingMore = false
        }
    }
}

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

    private var postsModel: PostsModel? = null

    fun posts(): PostsModel? {
        val loaded = page ?: return null
        return postsModel ?: PostsModel { YouTubeService.channelPosts(loaded.channel.id, loaded.tabParams[ChannelTab.POSTS]) }
            .also { postsModel = it }
    }

    var about by mutableStateOf<ChannelAbout?>(null)
        private set
    var aboutError by mutableStateOf<String?>(null)
        private set
    var aboutLoaded by mutableStateOf(false)
        private set

    suspend fun loadAbout() {
        val loaded = page ?: return
        if (aboutLoaded) return
        aboutError = null
        try {
            about = YouTubeService.channelAbout(loaded.channel.id, loaded.aboutToken, loaded.tabParams[ChannelTab.ABOUT])
            aboutLoaded = true
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            aboutError = failure.message ?: "Không tải được thông tin kênh."
        }
    }

    /** Search within the channel: the field is shown while [searching]; results for [searchQuery]. */
    var searching by mutableStateOf(false)
    var searchQuery by mutableStateOf<String?>(null)
        private set
    var searchModel by mutableStateOf<FeedModel?>(null)
        private set

    fun search(query: String) {
        val loaded = page ?: return
        val text = query.trim()
        if (text.isEmpty()) return
        searchQuery = text
        searchModel = FeedModel { YouTubeService.channelSearch(loaded.channel.id, text) }
    }

    fun toggleSearch() {
        if (searching) {
            searching = false
            searchQuery = null
            searchModel = null
        } else {
            searching = true
        }
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
        if (page != null) {
            IconButton(onClick = { state.toggleSearch() }) {
                Icon(if (state.searching) Icons.Default.Close else Icons.Default.Search, "Tìm trong kênh")
            }
        }
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
            if (state.searching) {
                item(key = "search") {
                    var text by remember { mutableStateOf(state.searchQuery ?: "") }
                    OutlinedTextField(
                        value = text, onValueChange = { text = it },
                        placeholder = { Text("Tìm trong kênh ${channel.name}") },
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Search, null) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { state.search(text) }),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                }
                val results = state.searchModel
                if (results != null) {
                    pagedFeed(results, scope, compact = true, emptyTitle = "Không tìm thấy video nào trong kênh")
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
            if (state.tab == ChannelTab.POSTS) {
                val posts = state.posts() ?: return@LazyColumn
                when {
                    !posts.hasLoaded && posts.error == null -> item(key = "posts-loading") {
                        LaunchedEffect(posts) { posts.load() }
                        LoadingState()
                    }
                    posts.error != null && posts.posts.isEmpty() -> item(key = "posts-error") {
                        ErrorState(posts.error ?: "") { scope.launch { posts.load() } }
                    }
                    posts.posts.isEmpty() -> item(key = "posts-empty") {
                        Text("Kênh chưa có bài đăng nào.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    else -> {
                        items(posts.posts, key = { "post-" + it.id }) { post -> PostCard(post) }
                        if (posts.canLoadMore) item(key = "posts-more") {
                            LaunchedEffect(posts.posts.size) { posts.loadMore() }
                            LoadingState()
                        }
                    }
                }
                return@LazyColumn
            }
            if (state.tab == ChannelTab.ABOUT) {
                item(key = "about") {
                    LaunchedEffect(state) { state.loadAbout() }
                    val about = state.about
                    val aboutError = state.aboutError
                    when {
                        about != null -> AboutSection(about)
                        aboutError != null -> ErrorState(aboutError) { scope.launch { state.loadAbout() } }
                        state.aboutLoaded -> Text(page.description ?: "Kênh chưa có phần giới thiệu.", Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodyMedium)
                        else -> LoadingState()
                    }
                }
                return@LazyColumn
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

/** One community post: text, image(s), a video or a poll. */
@Composable
private fun PostCard(post: CommunityPost) {
    var expanded by remember(post.id) { mutableStateOf(false) }
    var overflowing by remember(post.id) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(post.authorAvatar, 32.dp, post.authorName)
            Column(Modifier.padding(start = 10.dp)) {
                Text(post.authorName, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                post.publishedText?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (post.text.isNotBlank()) {
            Text(
                linkifiedText(post.text, MaterialTheme.colorScheme.primary),
                style = MaterialTheme.typography.bodyMedium,
                maxLines = if (expanded) Int.MAX_VALUE else 5,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { if (!expanded) overflowing = it.hasVisualOverflow },
                modifier = Modifier.padding(top = 8.dp),
            )
            if (overflowing || expanded) {
                Text(if (expanded) "Ẩn bớt" else "Xem thêm", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable { expanded = !expanded }.padding(vertical = 4.dp))
            }
        }
        when (val attachment = post.attachment) {
            is PostAttachment.Images -> if (attachment.urls.size == 1) {
                RemoteImage(attachment.urls.first(), Modifier.fillMaxWidth().aspectRatio(1f).padding(top = 8.dp).clip(RoundedCornerShape(10.dp)))
            } else {
                LazyRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(attachment.urls) { url ->
                        RemoteImage(url, Modifier.width(240.dp).aspectRatio(1f).clip(RoundedCornerShape(10.dp)))
                    }
                }
            }
            is PostAttachment.Video -> Box(Modifier.padding(top = 8.dp)) { VideoRow(attachment.video) }
            is PostAttachment.Poll -> Column(Modifier.padding(top = 8.dp)) {
                attachment.choices.forEach { choice ->
                    Text(
                        choice, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    )
                }
                attachment.totalVotes?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp))
                }
            }
            null -> {}
        }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ThumbUp, "Lượt thích", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(" ${post.likeCountText ?: ""}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(16.dp))
            Icon(Icons.AutoMirrored.Filled.Chat, "Bình luận", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(" ${post.commentCountText ?: ""}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The channel's "About": description, links and figures. */
@Composable
private fun AboutSection(about: ChannelAbout) {
    val uriHandler = LocalUriHandler.current
    fun open(url: String) {
        runCatching { uriHandler.openUri(url) }.onFailure { Toasts.show("Không mở được liên kết") }
    }
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        about.description?.takeIf { it.isNotBlank() }?.let { description ->
            Text("Nội dung mô tả", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            SelectionContainer {
                Text(description, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp, bottom = 16.dp))
            }
        }
        if (about.links.isNotEmpty()) {
            Text("Liên kết", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            about.links.forEach { link ->
                Row(
                    Modifier.fillMaxWidth().clickable { open(link.url) }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Link, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.padding(start = 14.dp)) {
                        Text(link.title, style = MaterialTheme.typography.bodyMedium)
                        Text(link.displayUrl ?: link.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
        Text("Thông tin khác", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        val facts = listOf(
            Icons.Default.Public to about.channelUrl,
            Icons.Default.People to about.subscriberCountText,
            Icons.Default.PlayCircle to about.videoCountText,
            Icons.AutoMirrored.Filled.TrendingUp to about.viewCountText,
            Icons.Default.Info to about.joinedDateText,
            Icons.Default.LocationOn to about.country,
        )
        facts.forEach { (icon, value) ->
            if (!value.isNullOrBlank()) {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 14.dp))
                }
            }
        }
    }
}

class PlaylistState(val playlistId: String, seed: PlaylistItem) {
    var header by mutableStateOf(seed)
    val feed = FeedModel { YouTubeService.playlist(playlistId).also { header = it.playlist }.page }
    var preparingDownload by mutableStateOf(false)
        private set

    /** Loads every page of the playlist (up to 200 videos), then queues them for download. */
    fun downloadAll(audioOnly: Boolean) {
        if (preparingDownload) return
        preparingDownload = true
        com.dangdvd.dvdtube.core.storage.AppScope.launch {
            try {
                val videos = runCatching { YouTubeService.playlistVideos(playlistId) }.getOrNull() ?: feed.videos
                if (videos.isEmpty()) Toasts.show("Danh sách phát không có video để tải") else DownloadManager.downloadAll(videos, audioOnly)
            } finally {
                preparingDownload = false
            }
        }
    }
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
                        var downloadMenu by remember { mutableStateOf(false) }
                        Box(Modifier.padding(top = 8.dp)) {
                            OutlinedButton(onClick = { downloadMenu = true }, enabled = !state.preparingDownload, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.Download, null)
                                Spacer(Modifier.width(6.dp))
                                Text(if (state.preparingDownload) "Đang lấy danh sách video…" else "Tải xuống tất cả")
                            }
                            DropdownMenu(expanded = downloadMenu, onDismissRequest = { downloadMenu = false }) {
                                DropdownMenuItem(
                                    text = { Text("Video (chất lượng tải xuống trong Cài đặt)") },
                                    leadingIcon = { Icon(Icons.Default.Download, null) },
                                    onClick = { downloadMenu = false; state.downloadAll(audioOnly = false) },
                                )
                                DropdownMenuItem(
                                    text = { Text("Chỉ âm thanh (m4a)") },
                                    leadingIcon = { Icon(Icons.Default.Headphones, null) },
                                    onClick = { downloadMenu = false; state.downloadAll(audioOnly = true) },
                                )
                            }
                        }
                    }
                }
            }
            pagedFeed(state.feed, scope, compact = true, emptyTitle = "Danh sách phát trống")
        }
    }
}
