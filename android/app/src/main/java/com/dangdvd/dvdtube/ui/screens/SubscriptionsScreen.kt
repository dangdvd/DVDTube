package com.dangdvd.dvdtube.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Subscriptions
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.RelativeDateParser
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.AppTab
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.LoadingState
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.SingleFlight
import com.dangdvd.dvdtube.ui.components.VideoCard
import com.dangdvd.dvdtube.ui.rememberRouteModel
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

class SubscriptionFeedModel {
    var videos by mutableStateOf(listOf<VideoItem>())
        private set
    var isLoading by mutableStateOf(false)
        private set
    private var loadedKey: String? = null
    var lastReselect = Router.reselectCounter[AppTab.SUBSCRIPTIONS] ?: 0

    private val flight = SingleFlight()

    suspend fun load(force: Boolean = false) {
        val key = currentKey()
        if (!force && key == loadedKey) return
        flight.run(restart = force) { fetch(key) }
    }

    private fun currentKey(): String =
        if (AccountStore.isSignedIn) "account:" + AccountStore.sessionKey else "local:" + LibraryStore.subscriptions.joinToString(",") { it.id }

    private suspend fun fetch(key: String) {
        val signedIn = AccountStore.isSignedIn
        val channels = LibraryStore.subscriptions
        // Signed in: YouTube's own subscription feed for the account.
        if (!signedIn && channels.isEmpty()) {
            videos = emptyList()
            loadedKey = key
            return
        }
        isLoading = true
        try {
            if (signedIn) {
                val page = runCatching { YouTubeService.accountFeed("FEsubscriptions") }.getOrNull() ?: return
                val now = System.currentTimeMillis()
                videos = page.videos.map { it.copy(publishedDate = it.publishedDate ?: RelativeDateParser.date(it.publishedText, now)) }
            } else {
                // Limit concurrency so dozens of subscriptions don't trigger rate limiting.
                val limit = Semaphore(6)
                val collected = coroutineScope {
                    channels.map { channel -> async { limit.withPermit { YouTubeService.latestVideos(channel).take(15) } } }.awaitAll().flatten()
                }
                val seen = HashSet<String>()
                videos = collected.filter { seen.add(it.id) }.sortedByDescending { it.publishedDate ?: 0 }
            }
            loadedKey = key
        } finally {
            isLoading = false
        }
    }
}

private enum class SubscriptionFilter(val title: String) { ALL("Tất cả"), TODAY("Hôm nay"), VIDEOS("Video"), SHORTS("Shorts") }

private fun openAllChannels() {
    Router.open(if (AccountStore.isSignedIn) Route.AccountFeed("Kênh đăng ký", "FEchannels") else Route.SubscriptionsManager())
}

@Composable
fun SubscriptionsScreen() {
    val model = rememberRouteModel("subscriptions") { SubscriptionFeedModel() }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var filter by remember { mutableStateOf(SubscriptionFilter.ALL) }
    var refreshing by remember { mutableStateOf(false) }
    val channels: List<ChannelItem> = if (AccountStore.isSignedIn) AccountStore.subscribedChannels else LibraryStore.subscriptions
    val reselect = Router.reselectCounter[AppTab.SUBSCRIPTIONS] ?: 0
    val importer = rememberCsvImporter()

    LaunchedEffect(AccountStore.sessionKey, LibraryStore.subscriptions.size) { model.load() }
    LaunchedEffect(reselect) {
        if (reselect != model.lastReselect) {
            model.lastReselect = reselect
            listState.animateScrollToItem(0)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { AppLogo() },
                actions = {
                    IconButton(onClick = ::openAllChannels) { Icon(Icons.Outlined.People, "Quản lý kênh") }
                    IconButton(onClick = { Router.open(Route.Search()) }) { Icon(Icons.Outlined.Search, "Tìm kiếm") }
                    AccountButton()
                },
            )
        },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    if (AccountStore.isSignedIn) AccountStore.refreshSubscriptions()
                    model.load(force = true)
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(Modifier.fillMaxSize(), state = listState) {
                if (channels.isEmpty() && model.videos.isEmpty() && !model.isLoading) {
                    item {
                        EmptyState(
                            Icons.Outlined.Subscriptions,
                            "Chưa đăng ký kênh nào",
                            "Nhấn \"Đăng ký\" trên trang kênh, đăng nhập Google để dùng kênh đăng ký của tài khoản, hoặc nhập tệp subscriptions.csv từ Google Takeout.",
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                            if (!AccountStore.isSignedIn) {
                                Button(onClick = { Router.signIn() }) { Text("Đăng nhập") }
                                Spacer(Modifier.width(10.dp))
                            }
                            OutlinedButton(onClick = { importer() }) { Text("Nhập tệp CSV") }
                        }
                    }
                    return@LazyColumn
                }
                item(key = "channels") {
                    LazyRow(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(channels, key = { it.id }) { channel ->
                            Column(
                                Modifier.width(64.dp).clickable { Router.open(Route.Channel(channel)) },
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Avatar(channel.avatar, 56.dp, channel.name)
                                Text(channel.name, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    textAlign = TextAlign.Center)
                            }
                        }
                        item {
                            Box(Modifier.height(56.dp).clickable(onClick = ::openAllChannels), contentAlignment = Alignment.Center) {
                                Text("Tất cả", color = Brand, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 6.dp))
                            }
                        }
                    }
                }
                item(key = "filters") {
                    LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(bottom = 8.dp)) {
                        items(SubscriptionFilter.entries) { item ->
                            val selected = item == filter
                            Text(
                                item.title,
                                style = MaterialTheme.typography.labelLarge,
                                color = if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable { filter = item }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
                val dayAgo = System.currentTimeMillis() - 86_400_000L
                val videos = when (filter) {
                    SubscriptionFilter.ALL -> model.videos
                    SubscriptionFilter.TODAY -> model.videos.filter { (it.publishedDate ?: 0) > dayAgo }
                    SubscriptionFilter.VIDEOS -> model.videos.filter { !it.isShort }
                    SubscriptionFilter.SHORTS -> model.videos.filter { it.isShort }
                }
                when {
                    model.isLoading && model.videos.isEmpty() -> item { LoadingState() }
                    videos.isEmpty() -> item { EmptyState(Icons.Outlined.Subscriptions, "Không có video mới", "Kéo xuống để làm mới.") }
                    filter == SubscriptionFilter.SHORTS -> items(videos.chunked(2)) { row ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            row.forEach { short ->
                                Box(Modifier.weight(1f).aspectRatio(9f / 16f).clip(RoundedCornerShape(8.dp)).clickable { Router.openShorts(videos, short) }) {
                                    RemoteImage(short.shortsThumbnail, Modifier.fillMaxSize())
                                    Text(short.title, color = Color.White, style = MaterialTheme.typography.labelMedium, maxLines = 2,
                                        overflow = TextOverflow.Ellipsis, modifier = Modifier.align(Alignment.BottomStart).padding(8.dp))
                                }
                            }
                            if (row.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                    else -> {
                        val queue = videos.filter { !it.isShort }
                        items(videos, key = { it.id }) { video -> VideoCard(video, queue) }
                    }
                }
            }
        }
    }
}

/** Opens a file picker for a Google Takeout subscriptions.csv and imports it. */
@Composable
fun rememberCsvImporter(): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        val text = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() } }.getOrNull()
        if (text == null) {
            Toasts.show("Không đọc được tệp")
        } else {
            val count = LibraryStore.importSubscriptions(text)
            Toasts.show(if (count > 0) "Đã nhập $count kênh" else "Không tìm thấy kênh nào trong tệp")
        }
    }
    return { launcher.launch(arrayOf("text/*", "text/csv", "text/comma-separated-values", "application/octet-stream")) }
}
