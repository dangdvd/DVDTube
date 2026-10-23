package com.dangdvd.dvdtube.ui.components

import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Loading / error / empty states and the items of a [PagedFeed], for use inside a
 * LazyColumn. The feed loads itself when it first appears.
 */
fun LazyListScope.pagedFeed(
    feed: PagedFeed,
    scope: CoroutineScope,
    compact: Boolean = false,
    emptyTitle: String = "Không có nội dung",
) {
    when {
        (feed.isLoading || !feed.hasLoaded) && feed.items.isEmpty() && feed.error == null -> item(key = "feed-loading") {
            LaunchedEffect(feed) { feed.load() }
            LoadingState()
        }
        feed.error != null && feed.items.isEmpty() -> item(key = "feed-error") {
            ErrorState(feed.error ?: "") { scope.launch { feed.load(force = true) } }
        }
        feed.items.isEmpty() -> item(key = "feed-empty") {
            EmptyState(Icons.Default.VideoLibrary, emptyTitle, feed.message)
        }
        else -> feedItems(feed.items, compact, feed.isLoadingMore,
            if (feed.canLoadMore) ({ scope.launch { feed.loadMore() } }) else null)
    }
}
