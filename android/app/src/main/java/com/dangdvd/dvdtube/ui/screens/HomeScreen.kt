package com.dangdvd.dvdtube.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.R
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.services.HomeCategory
import com.dangdvd.dvdtube.core.services.SearchFilter
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.ui.AppTab
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.PagedFeed
import com.dangdvd.dvdtube.ui.components.SingleFlight
import com.dangdvd.dvdtube.ui.components.pagedFeed
import com.dangdvd.dvdtube.ui.isDarkTheme
import com.dangdvd.dvdtube.ui.player.CastButton
import com.dangdvd.dvdtube.ui.rememberRouteModel
import com.dangdvd.dvdtube.ui.support.SupportDialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * "For you" feed built entirely on-device: videos related to what you watched, fresh
 * uploads from your subscriptions, Shorts and trending as a fallback.
 */
class HomeFeedModel : PagedFeed {
    override var items by mutableStateOf(listOf<FeedItem>())
        private set
    override var isLoading by mutableStateOf(false)
        private set
    override var isLoadingMore by mutableStateOf(false)
        private set
    override var error by mutableStateOf<String?>(null)
        private set
    override var hasLoaded by mutableStateOf(false)
        private set
    override val message: String? get() = null
    private var trendingContinuation by mutableStateOf<String?>(null)
    private var trendingKind = com.dangdvd.dvdtube.core.ContinuationKind.SEARCH
    override val canLoadMore: Boolean get() = trendingContinuation != null

    private val flight = SingleFlight()

    override suspend fun load(force: Boolean) {
        if (!force && hasLoaded) return
        flight.run(restart = force) { fetch() }
    }

    private suspend fun fetch() {
        isLoading = true
        error = null
        try {
            val seeds = LibraryStore.history.filter { !it.video.isShort }.take(4).map { it.video.id }
            val channels = LibraryStore.subscriptions.take(10)
            val watched = LibraryStore.history.take(200).map { it.video.id }.toSet()
            val weekAgo = System.currentTimeMillis() - 7 * 86_400_000L

            val (related, fresh, trending, shorts) = coroutineScope {
                val relatedJob = async {
                    seeds.map { seed -> async { runCatching { YouTubeService.watchInfo(seed).related.videos }.getOrDefault(emptyList()) } }.awaitAll()
                }
                val freshJob = async {
                    channels.map { channel -> async { YouTubeService.latestVideos(channel).filter { !it.isShort }.take(3) } }.awaitAll()
                        .flatten()
                        .filter { (it.publishedDate ?: 0) > weekAgo }
                        .sortedByDescending { it.publishedDate ?: 0 }
                }
                val trendingJob = async { runCatching { YouTubeService.category(HomeCategory.ALL) }.getOrNull() }
                val shortsJob = async {
                    runCatching { YouTubeService.search(if (APIConfig.hl == "vi") "shorts việt nam" else "shorts", SearchFilter.SHORTS) }.getOrNull()
                }
                HomeParts(relatedJob.await(), freshJob.await(), trendingJob.await(), shortsJob.await())
            }

            val seen = HashSet<String>()
            val result = ArrayList<FeedItem>()
            fun add(video: VideoItem) {
                if (video.isShort || video.id in watched || !seen.add(video.id)) return
                result += FeedItem.Video(video)
            }
            // Interleave: one fresh subscription upload, then two recommendations, repeat.
            val lists = related.map { it.iterator() }
            val freshIterator = fresh.iterator()
            var exhausted = false
            while (!exhausted) {
                exhausted = true
                if (freshIterator.hasNext()) { add(freshIterator.next()); exhausted = false }
                for (list in lists) repeat(2) { if (list.hasNext()) { add(list.next()); exhausted = false } }
            }
            trending?.items?.forEach { item -> item.videoOrNull?.let(::add) }

            val shortItems = shorts?.items.orEmpty().flatMap { item ->
                when (item) {
                    is FeedItem.Video -> if (item.video.isShort) listOf(item.video) else emptyList()
                    is FeedItem.Shorts -> item.items
                    else -> emptyList()
                }
            }
            if (shortItems.isNotEmpty()) result.add(minOf(3, result.size), FeedItem.Shorts(shortItems.take(12)))

            if (result.isEmpty() && trending == null) error = "Không thể kết nối tới YouTube. Kiểm tra mạng và thử lại."
            Log.debug("home: related=${related.map { it.size }} fresh=${fresh.size} trending=${trending?.items?.size ?: -1} shorts=${shortItems.size} total=${result.size}")
            items = result
            trendingContinuation = trending?.continuation
            trendingKind = trending?.kind ?: com.dangdvd.dvdtube.core.ContinuationKind.SEARCH
            hasLoaded = true
        } catch (cancel: CancellationException) {
            throw cancel
        } finally {
            isLoading = false
        }
    }

    override suspend fun loadMore() {
        val token = trendingContinuation ?: return
        if (isLoadingMore) return
        isLoadingMore = true
        try {
            val page = YouTubeService.more(token, trendingKind)
            val existing = items.map { it.key }.toSet()
            items = items + page.items.filter { it.key !in existing }
            trendingContinuation = if (page.continuation == token) null else page.continuation
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            trendingContinuation = null
        } finally {
            isLoadingMore = false
        }
    }

    private data class HomeParts(
        val related: List<List<VideoItem>>,
        val fresh: List<VideoItem>,
        val trending: com.dangdvd.dvdtube.core.FeedPage?,
        val shorts: com.dangdvd.dvdtube.core.FeedPage?,
    )
}

class HomeState {
    var category by mutableStateOf(HomeCategory.ALL)
    val forYou = HomeFeedModel()
    var accountHome by mutableStateOf(FeedModel { YouTubeService.accountFeed("FEwhat_to_watch") })
    val categoryModels = mutableStateMapOf<HomeCategory, FeedModel>()
    var sessionKey = AccountStore.sessionKey
    var lastReselect = Router.reselectCounter[AppTab.HOME] ?: 0

    fun model(category: HomeCategory): FeedModel =
        categoryModels.getOrPut(category) { FeedModel { YouTubeService.category(category) } }

    /** Personalised results differ per account. */
    fun resetForAccount() {
        categoryModels.clear()
        accountHome = FeedModel { YouTubeService.accountFeed("FEwhat_to_watch") }
    }
}

@Composable
fun HomeScreen() {
    val state = rememberRouteModel("home") { HomeState() }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var refreshing by remember { mutableStateOf(false) }
    val reselect = Router.reselectCounter[AppTab.HOME] ?: 0

    LaunchedEffect(AccountStore.sessionKey) {
        if (state.sessionKey != AccountStore.sessionKey) {
            state.sessionKey = AccountStore.sessionKey
            state.resetForAccount()
        }
    }
    LaunchedEffect(reselect) {
        if (reselect != state.lastReselect) {
            state.lastReselect = reselect
            listState.animateScrollToItem(0)
        }
    }

    Scaffold(topBar = { HomeTopBar() }, contentWindowInsets = WindowInsets(0)) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    val category = state.category
                    when {
                        category != HomeCategory.ALL -> state.model(category).load(force = true)
                        AccountStore.isSignedIn -> state.accountHome.load(force = true)
                        else -> state.forYou.load(force = true)
                    }
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(Modifier.fillMaxSize(), state = listState) {
                stickyHeader(key = "chips") {
                    LazyRow(
                        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(HomeCategory.entries) { category ->
                            val selected = state.category == category
                            Text(
                                category.title,
                                style = MaterialTheme.typography.labelLarge,
                                color = if (selected) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable { state.category = category }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
                item(key = "incognito") { IncognitoBanner() }
                val category = state.category
                when {
                    category == HomeCategory.ALL && AccountStore.isSignedIn -> {
                        val home = state.accountHome
                        if (home.hasLoaded && home.items.isEmpty() && home.error == null) {
                            // YouTube returned no recommendations (typically: watch history is off).
                            item(key = "notice") { AccountNotice(home.message) }
                            pagedFeed(state.forYou, scope, hidesDismissed = true)
                        } else {
                            pagedFeed(home, scope, hidesDismissed = true)
                        }
                    }
                    category == HomeCategory.ALL -> pagedFeed(state.forYou, scope, hidesDismissed = true)
                    else -> pagedFeed(state.model(category), scope, hidesDismissed = true)
                }
            }
        }
    }
}

@Composable
private fun AccountNotice(message: String?) {
    Row(
        Modifier.fillMaxWidth().padding(12.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)).padding(12.dp),
    ) {
        Icon(Icons.Default.Info, null, tint = Brand)
        Spacer(Modifier.width(10.dp))
        Column {
            Text("YouTube chưa có đề xuất cho tài khoản của bạn", style = MaterialTheme.typography.titleSmall)
            Text(
                message ?: "Thường là do Nhật ký xem của tài khoản đang tắt. Bật lại tại myactivity.google.com hoặc trong ứng dụng YouTube, rồi kéo xuống để làm mới.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text("Tạm thời hiển thị đề xuất dựa trên những gì bạn xem trong ứng dụng này.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun AppLogo() {
    BoxWithConstraints {
        val style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
        val measurer = rememberTextMeasurer()
        val density = LocalDensity.current
        val nameWidth = remember(style, density) { with(density) { measurer.measure("DVDTube", style).size.width.toDp() } }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.logo), null, Modifier.size(28.dp).clip(RoundedCornerShape(7.dp)))
            // On narrow phones the toolbar buttons leave no room for the name: show the icon alone.
            if (maxWidth >= 34.dp + nameWidth) {
                Spacer(Modifier.width(6.dp))
                Text("DVDTube", style = style, maxLines = 1, softWrap = false)
            }
        }
    }
}

@Composable
private fun HomeTopBar() {
    var showSupport by remember { mutableStateOf(false) }
    TopAppBar(
        title = { AppLogo() },
        actions = {
            IconButton(onClick = { showSupport = true }) { Icon(Icons.Outlined.FavoriteBorder, "Ủng hộ tác giả") }
            CastButton(light = !isDarkTheme())
            if (AccountStore.isSignedIn) {
                IconButton(onClick = { Router.showUpload = true }) { Icon(Icons.Outlined.AddBox, "Tải video lên") }
                NotificationBell()
            }
            IconButton(onClick = { Router.open(Route.Search()) }) { Icon(Icons.Outlined.Search, "Tìm kiếm") }
            AccountButton()
        },
    )
    if (showSupport) SupportDialog { showSupport = false }
}

@Composable
fun NotificationBell() {
    IconButton(onClick = { Router.open(Route.Notifications()) }) {
        BadgedBox(badge = {
            val count = AccountStore.unseenNotifications
            if (count > 0) Badge { Text(if (count > 9) "9+" else "$count") }
        }) { Icon(Icons.Outlined.Notifications, "Thông báo") }
    }
}

@Composable
fun AccountButton() {
    val profile = AccountStore.profile
    IconButton(onClick = { if (AccountStore.isSignedIn) Router.showAccountSwitcher = true else Router.signIn() }) {
        if (com.dangdvd.dvdtube.core.AppSettings.isIncognito) {
            Icon(Icons.Outlined.VisibilityOff, "Đang ẩn danh")
        } else {
            Avatar(if (AccountStore.isSignedIn) profile?.avatar else null, 28.dp, if (AccountStore.isSignedIn) profile?.name ?: "" else "?")
        }
    }
}
