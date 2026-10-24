package com.dangdvd.dvdtube.ui.watch

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.Comment
import com.dangdvd.dvdtube.core.CommentSortOption
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.formatDuration
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.parseDuration
import com.dangdvd.dvdtube.core.services.CaptionCue
import com.dangdvd.dvdtube.core.services.CaptionLoader
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.ErrorState
import com.dangdvd.dvdtube.ui.components.LoadingState
import com.dangdvd.dvdtube.ui.components.RemoteImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Timestamps seek, hashtags search and URLs open, like in the official app. */
fun linkifiedText(text: String, linkColor: Color): AnnotatedString = buildAnnotatedString {
    val pattern = Regex("""(https?://\S+)|(#[\p{L}\p{N}_]+)|\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b""")
    val style = TextLinkStyles(SpanStyle(color = linkColor))
    var last = 0
    for (match in pattern.findAll(text)) {
        append(text.substring(last, match.range.first))
        val value = match.value
        when {
            match.groups[1] != null -> withLink(LinkAnnotation.Url(value, style)) { append(value) }
            match.groups[2] != null -> withLink(LinkAnnotation.Clickable(value, style, LinkInteractionListener {
                Router.open(Route.SearchResults(value))
            })) { append(value) }
            else -> {
                val seconds = parseDuration(value)
                withLink(LinkAnnotation.Clickable(value, style, LinkInteractionListener {
                    seconds?.let { PlayerController.seek(it.toDouble()) }
                })) { append(value) }
            }
        }
        last = match.range.last + 1
    }
    append(text.substring(last))
}

@Composable
private fun SheetTitle(title: String, onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Đóng") }
    }
    HorizontalDivider()
}

// MARK: Description

@Composable
fun DescriptionSheet(info: WatchInfo, onTranscript: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetTitle("Nội dung mô tả", onDismiss)
        LazyColumn(Modifier.fillMaxWidth().navigationBarsPadding(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item {
                Column(Modifier.padding(16.dp)) {
                    Text(info.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.SpaceEvenly, modifier = Modifier.fillMaxWidth()) {
                        Stat(info.likeCountText ?: "–", "Lượt thích")
                        Stat(info.viewCountText?.substringBefore(" ") ?: "–", "Lượt xem")
                        Stat(info.dateText ?: info.relativeDateText ?: "–", "Ngày đăng")
                    }
                    Spacer(Modifier.height(14.dp))
                    val description = info.description.orEmpty()
                    if (description.isNotBlank()) {
                        Text(
                            linkifiedText(description, MaterialTheme.colorScheme.primary),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.fillMaxWidth()
                                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), RoundedCornerShape(10.dp))
                                .padding(12.dp),
                        )
                    }
                }
            }
            if (info.chapters.isNotEmpty()) {
                item { Text("Chương", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(16.dp, 4.dp)) }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(info.chapters) { chapter ->
                            Column(Modifier.width(150.dp).clickable { PlayerController.seek(chapter.startSeconds.toDouble()); onDismiss() }) {
                                RemoteImage(chapter.thumbnail, Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                                Text(chapter.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(formatDuration(chapter.startSeconds), style = MaterialTheme.typography.labelSmall, color = Brand)
                            }
                        }
                    }
                }
            }
            if (PlayerController.captionTracks.isNotEmpty()) {
                item {
                    TextButton(onClick = onTranscript, modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp)) {
                        Text("Hiện bản ghi")
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Comments

class CommentsModel(private val initialToken: String) {
    var comments by mutableStateOf(listOf<Comment>())
        private set
    var sortOptions by mutableStateOf(listOf<CommentSortOption>())
        private set
    var selectedSort by mutableStateOf<String?>(null)
        private set
    var countText by mutableStateOf<String?>(null)
        private set
    var createParams by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var isLoadingMore by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var replies by mutableStateOf(mapOf<String, List<Comment>>())
        private set
    var repliesNext by mutableStateOf(mapOf<String, String?>())
        private set
    var loadingReplies by mutableStateOf(setOf<String>())
        private set
    /** Likes / dislikes given in this sheet, by comment id ("LIKED", "DISLIKED", "INDIFFERENT"). */
    var likeStates by mutableStateOf(mapOf<String, String>())
        private set
    private var next: String? = null
    private var currentToken = initialToken

    val canLoadMore: Boolean get() = next != null

    suspend fun load(token: String = currentToken) {
        currentToken = token
        isLoading = true
        error = null
        try {
            val (page, sorts) = YouTubeService.comments(token)
            comments = page.comments
            next = page.continuation
            countText = page.countText ?: countText
            createParams = page.createParams ?: createParams
            if (sorts.isNotEmpty()) {
                sortOptions = sorts
                if (selectedSort == null) selectedSort = sorts.first().token
            }
            replies = emptyMap()
            repliesNext = emptyMap()
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            error = failure.message ?: "Không tải được bình luận."
        } finally {
            isLoading = false
        }
    }

    suspend fun sort(option: CommentSortOption) {
        selectedSort = option.token
        load(option.token)
    }

    suspend fun loadMore() {
        val token = next ?: return
        if (isLoadingMore) return
        isLoadingMore = true
        try {
            val (page, _) = YouTubeService.comments(token)
            val existing = comments.map { it.id }.toSet()
            comments = comments + page.comments.filter { it.id !in existing }
            next = if (page.continuation == token) null else page.continuation
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            next = null
        } finally {
            isLoadingMore = false
        }
    }

    suspend fun loadReplies(comment: Comment) {
        val token = repliesNext[comment.id] ?: comment.repliesToken ?: return
        if (comment.id in loadingReplies) return
        loadingReplies = loadingReplies + comment.id
        try {
            val (page, _) = YouTubeService.comments(token)
            replies = replies + (comment.id to (replies[comment.id].orEmpty() + page.comments))
            repliesNext = repliesNext + (comment.id to page.continuation)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            Toasts.show("Không tải được phản hồi")
        } finally {
            loadingReplies = loadingReplies - comment.id
        }
    }

    fun likeState(comment: Comment): String = likeStates[comment.id] ?: comment.likeState

    /** Like (or dislike) a comment on the account; shown at once, undone if YouTube refuses. */
    suspend fun rate(comment: Comment, dislike: Boolean) {
        if (!AccountStore.isSignedIn) {
            Toasts.show("Đăng nhập để thích bình luận")
            return
        }
        val current = likeState(comment)
        val target = when {
            dislike -> if (current == "DISLIKED") "INDIFFERENT" else "DISLIKED"
            else -> if (current == "LIKED") "INDIFFERENT" else "LIKED"
        }
        val token = when {
            target == "LIKED" -> comment.likeToken
            target == "DISLIKED" -> comment.dislikeToken
            current == "LIKED" -> comment.unlikeToken
            else -> comment.undislikeToken
        }
        if (token == null) {
            Toasts.show("Không thể đánh giá bình luận này")
            return
        }
        likeStates = likeStates + (comment.id to target)
        try {
            InnerTube.performCommentAction(token)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            likeStates = likeStates + (comment.id to current)
            Toasts.show("Không gửi được: ${failure.message}")
        }
    }

    suspend fun post(text: String, replyTo: Comment?): Boolean {
        return try {
            if (replyTo != null) {
                InnerTube.createReply(text, replyTo.replyParams ?: return false)
                Toasts.show("Đã gửi phản hồi")
                repliesNext = repliesNext - replyTo.id
                replies = replies - replyTo.id
                loadReplies(replyTo)
            } else {
                InnerTube.createComment(text, createParams ?: return false)
                Toasts.show("Đã đăng bình luận")
                load()
            }
            true
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            Toasts.show("Không gửi được: ${failure.message}")
            false
        }
    }
}

@Composable
fun CommentsSheet(token: String, onDismiss: () -> Unit) {
    val model = remember(token, AccountStore.sessionKey) { CommentsModel(token) }
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<Comment?>(null) }
    var sending by remember { mutableStateOf(false) }
    LaunchedEffect(model) { model.load() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetTitle("Bình luận" + (model.countText?.let { "  $it" } ?: ""), onDismiss)
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f).imePadding()) {
            if (model.sortOptions.size > 1) {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(model.sortOptions) { option ->
                        FilterChip(selected = model.selectedSort == option.token, onClick = { scope.launch { model.sort(option) } },
                            label = { Text(option.title) })
                    }
                }
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    model.isLoading && model.comments.isEmpty() -> item { LoadingState() }
                    model.error != null && model.comments.isEmpty() -> item { ErrorState(model.error ?: "") { scope.launch { model.load() } } }
                    model.comments.isEmpty() -> item {
                        Text("Chưa có bình luận nào.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    else -> {
                        itemsIndexed(model.comments, key = { index, comment -> comment.id + "#" + index }) { index, comment ->
                            CommentRow(
                                comment, model.likeState(comment),
                                onRate = { dislike -> scope.launch { model.rate(comment, dislike) } },
                                onReply = if (comment.replyParams != null) ({ replyTo = comment }) else null,
                            )
                            val loaded = model.replies[comment.id].orEmpty()
                            loaded.forEach { reply ->
                                CommentRow(reply, model.likeState(reply), indent = true,
                                    onRate = { dislike -> scope.launch { model.rate(reply, dislike) } }, onReply = null)
                            }
                            val hasMore = if (loaded.isEmpty()) comment.repliesToken != null else model.repliesNext[comment.id] != null
                            if (hasMore) {
                                TextButton(
                                    onClick = { scope.launch { model.loadReplies(comment) } },
                                    modifier = Modifier.padding(start = 56.dp),
                                ) {
                                    if (comment.id in model.loadingReplies) {
                                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text(if (loaded.isEmpty()) (comment.replyCountText?.let { "$it phản hồi" } ?: "Xem phản hồi") else "Xem thêm phản hồi")
                                    }
                                }
                            }
                            if (index >= model.comments.size - 3 && model.canLoadMore) {
                                LaunchedEffect(model.comments.size) { model.loadMore() }
                            }
                        }
                        if (model.isLoadingMore) item { LoadingState() }
                    }
                }
            }
            HorizontalDivider()
            if (!AccountStore.isSignedIn) {
                TextButton(onClick = { onDismiss(); Router.signIn() }, modifier = Modifier.padding(8.dp).navigationBarsPadding()) {
                    Text("Đăng nhập để bình luận")
                }
            } else if (model.createParams != null || replyTo != null) {
                Column(Modifier.navigationBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp)) {
                    replyTo?.let { target ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Phản hồi ${target.authorName}", style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            IconButton(onClick = { replyTo = null }) { Icon(Icons.Default.Close, "Hủy", Modifier.size(18.dp)) }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(AccountStore.profile?.avatar, 32.dp, AccountStore.profile?.name ?: "")
                        Spacer(Modifier.width(8.dp))
                        OutlinedTextField(
                            value = draft, onValueChange = { draft = it },
                            placeholder = { Text(if (replyTo != null) "Thêm phản hồi…" else "Thêm bình luận…") },
                            modifier = Modifier.weight(1f), maxLines = 4,
                        )
                        IconButton(
                            onClick = {
                                val text = draft.trim()
                                if (text.isEmpty() || sending) return@IconButton
                                sending = true
                                scope.launch {
                                    if (model.post(text, replyTo)) {
                                        draft = ""
                                        replyTo = null
                                    }
                                    sending = false
                                }
                            },
                            enabled = draft.isNotBlank() && !sending,
                        ) {
                            if (sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(Icons.AutoMirrored.Filled.Send, "Gửi")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CommentRow(
    comment: Comment,
    likeState: String,
    indent: Boolean = false,
    onRate: (dislike: Boolean) -> Unit,
    onReply: (() -> Unit)?,
) {
    Row(Modifier.fillMaxWidth().padding(start = if (indent) 56.dp else 12.dp, end = 12.dp, top = 8.dp, bottom = 4.dp)) {
        Avatar(
            comment.authorAvatar, if (indent) 26.dp else 36.dp, comment.authorName,
            Modifier.clickable(enabled = comment.authorChannelId != null) {
                comment.authorChannelId?.let { Router.openChannel(it, comment.authorName, comment.authorAvatar) }
            },
        )
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            if (comment.isPinned) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.PushPin, null, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(" Đã ghim", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            val header = listOfNotNull(comment.authorName, comment.publishedText).joinToString(" • ")
            Text(
                header, style = MaterialTheme.typography.labelMedium,
                color = if (comment.isCreator) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = if (comment.isCreator) FontWeight.Bold else FontWeight.Normal,
                modifier = if (comment.isCreator) Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50))
                    .padding(horizontal = 6.dp) else Modifier,
            )
            Spacer(Modifier.height(2.dp))
            Text(linkifiedText(comment.text, MaterialTheme.colorScheme.primary), style = MaterialTheme.typography.bodyMedium)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                val liked = likeState == "LIKED"
                val disliked = likeState == "DISLIKED"
                val tint = MaterialTheme.colorScheme.onSurfaceVariant
                Icon(
                    if (liked) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp, "Thích",
                    Modifier.size(28.dp).clickable { onRate(false) }.padding(6.dp),
                    tint = if (liked) MaterialTheme.colorScheme.onSurface else tint,
                )
                val count = if (liked) comment.likeCountLikedText ?: comment.likeCountText else comment.likeCountText
                Text(count ?: "", style = MaterialTheme.typography.labelSmall, color = tint)
                Spacer(Modifier.width(6.dp))
                Icon(
                    if (disliked) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown, "Không thích",
                    Modifier.size(28.dp).clickable { onRate(true) }.padding(6.dp),
                    tint = if (disliked) MaterialTheme.colorScheme.onSurface else tint,
                )
                if (comment.isHearted) {
                    Spacer(Modifier.width(10.dp))
                    Icon(Icons.Default.Favorite, "Được tim", Modifier.size(14.dp), tint = Brand)
                }
                if (onReply != null) {
                    Spacer(Modifier.width(12.dp))
                    Text("Phản hồi", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable(onClick = onReply).padding(4.dp))
                }
            }
        }
    }
}

// MARK: Transcript

@Composable
fun TranscriptSheet(onDismiss: () -> Unit) {
    val tracks = PlayerController.captionTracks
    var track by remember { mutableStateOf(PlayerController.selectedCaption ?: tracks.firstOrNull { !it.isAutoGenerated } ?: tracks.firstOrNull()) }
    var cues by remember { mutableStateOf<List<CaptionCue>?>(null) }
    var failed by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    LaunchedEffect(track) {
        val selected = track ?: return@LaunchedEffect
        cues = null
        failed = false
        cues = runCatching { CaptionLoader.load(selected, null) }.getOrElse { failed = true; emptyList() }
    }
    val time = PlayerController.currentTime
    val currentIndex = cues?.indexOfLast { it.start <= time } ?: -1
    LaunchedEffect(currentIndex) {
        if (currentIndex >= 0 && !listState.isScrollInProgress) listState.animateScrollToItem(maxOf(currentIndex - 2, 0))
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetTitle("Bản ghi", onDismiss)
        if (tracks.size > 1) {
            LazyRow(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(tracks) { option ->
                    FilterChip(selected = option == track, onClick = { track = option }, label = { Text(option.name) })
                }
            }
        }
        val loaded = cues
        Box(Modifier.fillMaxWidth().fillMaxHeight(0.85f)) {
            when {
                loaded == null -> LoadingState()
                loaded.isEmpty() -> Text(if (failed) "Không tải được bản ghi." else "Video không có bản ghi.",
                    Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> LazyColumn(state = listState, modifier = Modifier.navigationBarsPadding()) {
                    itemsIndexed(loaded) { index, cue ->
                        Row(
                            Modifier.fillMaxWidth()
                                .background(if (index == currentIndex) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                                .clickable { PlayerController.seek(cue.start) }
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            Text(formatTime(cue.start), style = MaterialTheme.typography.labelMedium, color = Brand,
                                modifier = Modifier.width(56.dp))
                            Text(cue.text, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }
}

// MARK: Queue

@Composable
fun QueueSheet(onDismiss: () -> Unit) {
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = maxOf(PlayerController.queueIndex - 1, 0))
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetTitle("Hàng đợi • ${PlayerController.queueIndex + 1}/${PlayerController.queue.size}", onDismiss)
        LazyColumn(Modifier.fillMaxWidth().fillMaxHeight(0.8f).navigationBarsPadding(), state = listState) {
            itemsIndexed(PlayerController.queue, key = { index, video -> video.id + "#" + index }) { index, video ->
                val current = index == PlayerController.queueIndex
                Row(
                    Modifier.fillMaxWidth()
                        .background(if (current) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
                        .clickable { PlayerController.playQueueItem(index) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (current) "▶" else "${index + 1}", Modifier.width(24.dp), style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    RemoteImage(video.displayThumbnail, Modifier.width(110.dp).aspectRatio(16f / 9f))
                    Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                        Text(video.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        video.channelName?.let {
                            Text(it, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (!current) {
                        IconButton(onClick = { PlayerController.removeFromQueue(index) }) { Icon(Icons.Default.Close, "Xóa khỏi hàng đợi") }
                    }
                }
            }
        }
    }
}
