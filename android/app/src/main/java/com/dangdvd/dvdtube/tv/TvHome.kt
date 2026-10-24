package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.HomeCategory
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.ui.components.PagedFeed
import com.dangdvd.dvdtube.ui.screens.HomeState
import com.dangdvd.dvdtube.ui.screens.SubscriptionFeedModel
import kotlinx.coroutines.launch

private val tvCategories = listOf(
    HomeCategory.ALL, HomeCategory.MUSIC, HomeCategory.GAMING, HomeCategory.LIVE,
    HomeCategory.NEWS, HomeCategory.SPORTS, HomeCategory.LEARNING, HomeCategory.PODCASTS,
)

/** Home: categories, "Continue watching", recommendations in rows, Shorts and new subscription videos. */
@Composable
fun TvHomeScreen() {
    val state = TvNav.model("home") { HomeState() }
    val subscriptions = TvNav.model("home-subscriptions") { SubscriptionFeedModel() }
    val scope = rememberCoroutineScope()
    val initial = remember { FocusRequester() }
    var hasFocus by remember { mutableStateOf(false) }
    var optionsFor by remember { mutableStateOf<VideoItem?>(null) }

    LaunchedEffect(AccountStore.sessionKey) {
        if (state.sessionKey != AccountStore.sessionKey) {
            state.sessionKey = AccountStore.sessionKey
            state.resetForAccount()
        }
        launch { subscriptions.load() }
    }

    val category = state.category
    val accountHome = state.accountHome
    // Signed in without recommendations (watch history off): fall back to the on-device feed.
    val accountEmpty = accountHome.hasLoaded && accountHome.items.isEmpty() && accountHome.error == null
    val feed: PagedFeed = when {
        category != HomeCategory.ALL -> state.model(category)
        AccountStore.isSignedIn && !accountEmpty -> accountHome
        else -> state.forYou
    }
    LaunchedEffect(feed) { feed.load() }

    val items = HiddenContentStore.filter(feed.items).distinctBy { it.key }
    val shorts = items.flatMap { item ->
        when (item) {
            is FeedItem.Shorts -> item.items
            is FeedItem.Video -> if (item.video.isShort) listOf(item.video) else emptyList()
            else -> emptyList()
        }
    }.distinctBy { it.id }
    val regular = items.filter { it !is FeedItem.Shorts && !(it is FeedItem.Video && it.video.isShort) }
    val rows = regular.chunked(10)
    val continueWatching = if (category == HomeCategory.ALL) {
        LibraryStore.history.filter { !it.video.isShort && it.progress in 0.03..0.95 }.distinctBy { it.video.id }.take(20)
    } else emptyList()
    val fresh = if (category == HomeCategory.ALL) subscriptions.videos.filter { !it.isShort }.distinctBy { it.id }.take(20) else emptyList()

    LazyColumn(
        Modifier.fillMaxSize().onFocusChanged { hasFocus = it.hasFocus },
        contentPadding = PaddingValues(top = TvInsets.vertical, bottom = 48.dp),
    ) {
        item("chips") {
            TvChipRow(tvCategories, category, { it.title }, { state.category = it })
        }
        if (continueWatching.isNotEmpty()) {
            item("continue") {
                TvShelf("Tiếp tục xem") {
                    itemsIndexed(continueWatching, key = { _, entry -> entry.video.id }) { index, entry ->
                        TvVideoCard(
                            entry.video,
                            onClick = { TvNav.play(entry.video) },
                            modifier = Modifier.tvFocusItem("continue-${entry.video.id}", if (index == 0) initial else null),
                            progress = entry.progress.toFloat(),
                            onLongClick = { optionsFor = entry.video },
                        )
                    }
                }
            }
        }
        rows.forEachIndexed { rowIndex, row ->
            item("row-$rowIndex") {
                val title = when {
                    category != HomeCategory.ALL -> if (rowIndex == 0) category.title else "Thêm ${category.title.lowercase()}"
                    rowIndex == 0 -> "Đề xuất cho bạn"
                    else -> "Có thể bạn sẽ thích"
                }
                val queue = row.mapNotNull { it.videoOrNull }
                TvShelf(title) {
                    itemsIndexed(row, key = { _, item -> item.key }) { index, item ->
                        val takesInitial = rowIndex == 0 && index == 0 && continueWatching.isEmpty()
                        TvFeedCard(
                            item, queue,
                            modifier = Modifier.tvFocusItem("home-${item.key}", if (takesInitial) initial else null),
                            onOptions = { optionsFor = it },
                        )
                    }
                }
                // Reaching the last row loads more recommendations.
                if (rowIndex == rows.lastIndex) {
                    LaunchedEffect(rows.size) { if (feed.canLoadMore) feed.loadMore() }
                }
            }
            if (rowIndex == 0 && shorts.isNotEmpty()) {
                item("shorts") {
                    TvShelf("Shorts") {
                        items(shorts.take(20), key = { "short-${it.id}" }) { video ->
                            TvVideoCard(video, onClick = { TvNav.openShorts(shorts, video) }, width = 170.dp,
                                modifier = Modifier.tvFocusItem("short-${video.id}"))
                        }
                    }
                }
            }
            if (rowIndex == 1 && fresh.isNotEmpty()) {
                item("fresh") {
                    TvShelf("Mới từ kênh đăng ký") {
                        items(fresh, key = { "fresh-${it.id}" }) { video ->
                            TvVideoCard(video, onClick = { TvNav.play(video, fresh) }, modifier = Modifier.tvFocusItem("fresh-${video.id}"),
                                onLongClick = { optionsFor = video })
                        }
                    }
                }
            }
        }
        when {
            feed.isLoading && items.isEmpty() -> item("loading") { TvLoading() }
            feed.error != null && items.isEmpty() -> item("error") {
                TvMessage("Không tải được trang chủ", feed.error) {
                    TvButton("Thử lại", onClick = { scope.launch { feed.load(force = true) } })
                }
            }
            feed.isLoadingMore -> item("more") { TvLoading() }
        }
    }
    InitialFocus(initial, ready = rows.isNotEmpty() || continueWatching.isNotEmpty()) { hasFocus }
    optionsFor?.let { video -> TvVideoOptions(video) { optionsFor = null } }
}

/** New videos from subscribed channels (the account's feed when signed in). */
@Composable
fun TvSubscriptionsScreen() {
    val model = TvNav.model("subscriptions") { SubscriptionFeedModel() }
    LaunchedEffect(AccountStore.sessionKey, LibraryStore.subscriptions.size) { model.load() }
    val channels = (if (AccountStore.isSignedIn) AccountStore.subscribedChannels else LibraryStore.subscriptions).distinctBy { it.id }
    val videos = model.videos.filter { !HiddenContentStore.isHidden(it) }
    TvVideoGrid(
        videos,
        emptyTitle = if (model.isLoading) "Đang tải…" else if (channels.isEmpty()) "Chưa đăng ký kênh nào" else "Chưa có video mới",
    ) {
        item(key = "title", span = { GridItemSpan(maxLineSpan) }) {
            TvScreenTitle("Kênh đăng ký", inset = 0.dp,
                subtitle = if (channels.isEmpty()) "Mở một kênh và chọn Đăng ký để xem video mới của kênh ở đây." else "${channels.size} kênh")
        }
        if (channels.isNotEmpty()) {
            item(key = "channels", span = { GridItemSpan(maxLineSpan) }) {
                TvShelf("Kênh", inset = 0.dp) {
                    items(channels, key = { "channel-${it.id}" }) { channel ->
                        TvChannelCard(channel, onClick = { TvNav.openChannel(channel) }, modifier = Modifier.tvFocusItem("channel-${channel.id}"))
                    }
                }
            }
        }
    }
}
