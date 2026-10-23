package com.dangdvd.dvdtube.ui.components

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.ContinuationKind
import com.dangdvd.dvdtube.core.FeedItem
import com.dangdvd.dvdtube.core.FeedPage
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.YouTubeService
import kotlinx.coroutines.CancellationException

/** Anything shown as a paginated feed (see [pagedFeed]). */
interface PagedFeed {
    val items: List<FeedItem>
    val isLoading: Boolean
    val isLoadingMore: Boolean
    val error: String?
    val message: String?
    val hasLoaded: Boolean
    val canLoadMore: Boolean
    suspend fun load(force: Boolean = false)
    suspend fun loadMore()
}

/** A paginated feed (search, browse, related…) loaded with [loader]. */
class FeedModel(private val loader: suspend () -> FeedPage) : PagedFeed {
    override var items by mutableStateOf(listOf<FeedItem>())
        private set
    override var isLoading by mutableStateOf(false)
        private set
    override var isLoadingMore by mutableStateOf(false)
        private set
    override var error by mutableStateOf<String?>(null)
        private set
    override var message by mutableStateOf<String?>(null)
        private set
    override var hasLoaded by mutableStateOf(false)
        private set
    private var continuation: String? = null
    private var kind = ContinuationKind.BROWSE
    private var generation = 0

    val videos: List<VideoItem>
        get() = items.flatMap {
            when (it) {
                is FeedItem.Video -> listOf(it.video)
                is FeedItem.Shorts -> it.items
                else -> emptyList()
            }
        }

    override val canLoadMore: Boolean get() = continuation != null

    override suspend fun load(force: Boolean) {
        if (!force && (hasLoaded || isLoading)) return
        val current = ++generation
        isLoading = true
        error = null
        try {
            val page = loader()
            if (current != generation) return
            items = page.items
            message = page.message
            continuation = page.continuation
            kind = page.kind
            hasLoaded = true
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            if (current == generation) error = failure.message ?: "Không tải được nội dung."
        } finally {
            if (current == generation) isLoading = false
        }
    }

    override suspend fun loadMore() {
        val token = continuation ?: return
        if (isLoadingMore || isLoading) return
        isLoadingMore = true
        val current = generation
        try {
            val page = YouTubeService.more(token, kind)
            if (current != generation) return
            val existing = items.map { it.key }.toSet()
            items = items + page.items.filter { it.key !in existing }
            continuation = if (page.continuation == token) null else page.continuation
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            continuation = null
        } finally {
            isLoadingMore = false
        }
    }
}
