package com.dangdvd.dvdtube.ui.watch

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.LiveChatInfo
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.innertube.LiveChatChunk
import com.dangdvd.dvdtube.core.innertube.LiveChatMessage
import com.dangdvd.dvdtube.core.innertube.LiveChatParser
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.ErrorState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Polls the chat of a live stream, or plays back a finished stream's chat in sync with
 * the video.
 */
class LiveChatModel(val info: LiveChatInfo) {
    var messages by mutableStateOf(listOf<LiveChatMessage>())
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(true)
        private set
    var hasEnded by mutableStateOf(false)
        private set
    var sendParams by mutableStateOf<String?>(null)
        private set
    var restrictedMessage by mutableStateOf<String?>(null)
        private set
    var selectedMode by mutableStateOf(info.modes.first())
        private set
    /** Chat views offered by the chat page (starts with the watch page's default view). */
    var modes by mutableStateOf(info.modes)
        private set

    private var job: Job? = null
    private val seenIds = HashSet<String>()

    fun start() {
        job?.cancel()
        messages = emptyList()
        seenIds.clear()
        error = null
        hasEnded = false
        isLoading = true
        val mode = selectedMode
        job = AppScope.launch { if (info.isReplay) runReplay(mode) else runLive(mode) }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    fun select(mode: LiveChatInfo.Mode) {
        if (mode == selectedMode) return
        selectedMode = mode
        start()
    }

    // MARK: Live

    private suspend fun runLive(mode: LiveChatInfo.Mode) {
        var token = mode.continuation
        // Like youtube.com, the first request opens the chat frame; later ones poll the API.
        var fromPage = true
        var failures = 0
        var fetches = 0
        while (kotlin.coroutines.coroutineContext.isActive) {
            try {
                val json = if (fromPage) InnerTube.liveChatPage(token, replay = false) else InnerTube.liveChat(token)
                val chunk = LiveChatParser.parse(json)
                if (fromPage) adoptModes(json)
                fetches++
                if (fetches <= 2) {
                    Log.debug("live chat: ${chunk.messages.size} messages via ${if (fromPage) "page" else "api"}, next=${chunk.continuation != null}, canSend=${chunk.sendParams != null}")
                }
                failures = 0
                fromPage = false
                apply(chunk)
                val next = chunk.continuation
                if (next == null) {
                    hasEnded = true
                    return
                }
                token = next
                delay((chunk.timeoutMs ?: 5000).coerceIn(1000, 8000).toLong())
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                failures++
                isLoading = false
                Log.debug("live chat ${if (fromPage) "page" else "poll"} failed: ${failure.message}")
                if (fromPage) {
                    // The frame did not load: try the API with the same token.
                    fromPage = false
                } else if (failures >= 2) {
                    // The polling token may have expired: start over from the frame.
                    token = mode.continuation
                    fromPage = true
                }
                if (failures >= 4) error = failure.message ?: "Không tải được trò chuyện."
                delay(3000)
            }
        }
    }

    // MARK: Replay

    /** Fetches chunks around the playback position and releases each message when the video reaches it. */
    private suspend fun runReplay(mode: LiveChatInfo.Mode) {
        var pending = listOf<LiveChatMessage>()
        var next: String? = null
        var seekToken: String? = null
        var fromPage = true
        var lastMs = -1L
        var exhausted = false

        while (kotlin.coroutines.coroutineContext.isActive) {
            val nowMs = (PlayerController.currentTime * 1000).toLong()
            // A seek: start over from the new position.
            if (lastMs >= 0 && (nowMs < lastMs - 3000 || nowMs > lastMs + 20_000)) {
                messages = emptyList()
                seenIds.clear()
                pending = emptyList()
                if (seekToken != null) next = seekToken else fromPage = true
                exhausted = false
            }
            lastMs = nowMs

            val needsMore = pending.isEmpty() || (pending.last().offsetMs ?: 0) < nowMs + 5000
            if (needsMore && !exhausted && (fromPage || next != null)) {
                try {
                    val json = if (fromPage) InnerTube.liveChatPage(mode.continuation, replay = true)
                    else InnerTube.liveChatReplay(next ?: mode.continuation, nowMs)
                    val chunk = LiveChatParser.parse(json)
                    val wasPage = fromPage
                    if (wasPage) adoptModes(json)
                    fromPage = false
                    error = null
                    // Only what is around the current position (the frame starts at 0:00).
                    val pendingIds = pending.map { it.id }.toSet()
                    val fresh = chunk.messages.filter {
                        it.id !in seenIds && it.id !in pendingIds && (it.offsetMs ?: 0) >= nowMs - 30_000
                    }
                    pending = (pending + fresh).sortedBy { it.offsetMs ?: 0 }
                    seekToken = chunk.seekContinuation ?: seekToken
                    next = chunk.continuation
                    val seek = chunk.seekContinuation
                    if (wasPage && seek != null && (chunk.messages.lastOrNull()?.offsetMs ?: 0) < nowMs - 10_000) next = seek
                    exhausted = next == null
                    if (exhausted && pending.isEmpty()) hasEnded = true
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (failure: Exception) {
                    Log.debug("live chat replay ${if (fromPage) "page" else "fetch"} failed: ${failure.message}")
                    if (fromPage) {
                        fromPage = false
                        next = mode.continuation
                    } else {
                        error = failure.message ?: "Không tải được trò chuyện."
                        delay(4000)
                    }
                }
            }
            isLoading = false

            val due = pending.takeWhile { (it.offsetMs ?: 0) <= nowMs }
            if (due.isNotEmpty()) {
                pending = pending.drop(due.size)
                append(due)
            }
            delay(500)
        }
    }

    /** The page's own menu has tokens that work for switching views. */
    private fun adoptModes(json: JNode) {
        val pageModes = LiveChatParser.modes(json)
        if (pageModes.size <= 1) return
        modes = pageModes
        pageModes.firstOrNull { it.title == selectedMode.title }?.let { selectedMode = it }
    }

    private fun apply(chunk: LiveChatChunk) {
        isLoading = false
        error = null
        chunk.sendParams?.let { sendParams = it }
        chunk.restrictedMessage?.let { restrictedMessage = it }
        if (chunk.removedIds.isNotEmpty()) {
            val removed = chunk.removedIds.toSet()
            messages = messages.filter { it.id !in removed }
        }
        append(chunk.messages)
    }

    private fun append(newMessages: List<LiveChatMessage>) {
        val fresh = newMessages.filter { seenIds.add(it.id) }
        if (fresh.isEmpty()) return
        messages = (messages + fresh).takeLast(MAX_MESSAGES)
    }

    suspend fun send(text: String): Boolean {
        val params = sendParams ?: return false
        return try {
            append(LiveChatParser.parse(InnerTube.sendLiveChatMessage(text, params)).messages)
            true
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            Toasts.show("Không gửi được tin nhắn: ${failure.message}")
            false
        }
    }

    companion object {
        private const val MAX_MESSAGES = 250
    }
}

@Composable
fun LiveChatSheet(info: LiveChatInfo, onDismiss: () -> Unit) {
    val model = remember(info) { LiveChatModel(info) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var followLatest by remember { mutableStateOf(true) }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var modesOpen by remember { mutableStateOf(false) }

    DisposableEffect(model) {
        model.start()
        onDispose { model.stop() }
    }
    LaunchedEffect(model.messages.lastOrNull()?.id) {
        if (followLatest && model.messages.isNotEmpty()) listState.scrollToItem(model.messages.size - 1)
    }
    LaunchedEffect(listState) {
        // Scrolling up to read older messages pauses auto-scroll; reaching the end resumes it.
        snapshotFlow { listState.isScrollInProgress to listState.canScrollForward }.collect { (scrolling, canScroll) ->
            if (scrolling && canScroll) followLatest = false
            if (!canScroll) followLatest = true
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (info.isReplay) "Phát lại nội dung trò chuyện" else "Trò chuyện trực tiếp",
                    style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (model.modes.size > 1) {
                    Text(model.selectedMode.title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (model.modes.size > 1) {
                Box {
                    IconButton(onClick = { modesOpen = true }) { Icon(Icons.Default.FilterList, "Chế độ xem") }
                    DropdownMenu(expanded = modesOpen, onDismissRequest = { modesOpen = false }) {
                        model.modes.forEach { mode ->
                            DropdownMenuItem(
                                text = { Text(mode.title) },
                                leadingIcon = { if (mode == model.selectedMode) Icon(Icons.Default.Check, null) },
                                onClick = {
                                    modesOpen = false
                                    followLatest = true
                                    model.select(mode)
                                },
                            )
                        }
                    }
                }
            }
            IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Đóng") }
        }
        HorizontalDivider()
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                LazyColumn(state = listState, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
                    items(model.messages, key = { it.id }) { message -> ChatRow(message, info.isReplay) }
                }
                if (model.messages.isEmpty()) {
                    Box(Modifier.fillMaxWidth().padding(top = 48.dp), contentAlignment = Alignment.Center) {
                        when {
                            model.isLoading -> CircularProgressIndicator()
                            model.error != null -> ErrorState(model.error ?: "") { model.start() }
                            model.hasEnded -> Text("Cuộc trò chuyện đã kết thúc", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            info.isReplay -> Text("Tin nhắn sẽ hiện theo thời điểm của video.", color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall)
                            else -> Text("Chưa có tin nhắn.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                if (!followLatest && model.messages.isNotEmpty()) {
                    FilledTonalButton(
                        onClick = {
                            followLatest = true
                            scope.launch { listState.scrollToItem(model.messages.size - 1) }
                        },
                        modifier = Modifier.align(Alignment.BottomCenter).padding(8.dp),
                    ) {
                        Icon(Icons.Default.ArrowDownward, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Tin nhắn mới nhất")
                    }
                }
            }
            if (!info.isReplay) {
                HorizontalDivider()
                Box(Modifier.navigationBarsPadding()) {
                    when {
                        AccountStore.isSignedIn && model.sendParams != null -> Row(
                            Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(AccountStore.profile?.avatar, 28.dp, AccountStore.profile?.name ?: "")
                            Spacer(Modifier.width(8.dp))
                            OutlinedTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = { Text("Trò chuyện…") }, maxLines = 3)
                            IconButton(
                                onClick = {
                                    val text = draft.trim()
                                    if (text.isEmpty() || sending) return@IconButton
                                    sending = true
                                    scope.launch {
                                        if (model.send(text)) {
                                            draft = ""
                                            followLatest = true
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
                        AccountStore.isSignedIn && model.restrictedMessage != null -> Notice(model.restrictedMessage ?: "")
                        !AccountStore.isSignedIn -> Notice("Đăng nhập để tham gia trò chuyện") {
                            onDismiss()
                            Router.signIn()
                        }
                        else -> {}
                    }
                }
            }
        }
    }
}

@Composable
private fun Notice(text: String, onClick: (() -> Unit)? = null) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().clickable(enabled = onClick != null) { onClick?.invoke() }.padding(14.dp),
    )
}

@Composable
private fun ChatRow(message: LiveChatMessage, showsTime: Boolean) {
    when (val kind = message.kind) {
        is LiveChatMessage.Kind.Paid -> {
            val color = kind.color?.let { Color(it.toInt()) } ?: Color(0xFFFFA000)
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).background(color, RoundedCornerShape(10.dp)).padding(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(message.authorPhoto, 26.dp, message.author)
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(message.author, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Color.Black)
                        Text(kind.amount, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = Color.Black)
                    }
                }
                if (message.text.isNotEmpty()) Text(message.text, style = MaterialTheme.typography.bodyMedium, color = Color.Black,
                    modifier = Modifier.padding(top = 4.dp))
            }
        }
        is LiveChatMessage.Kind.Membership -> Column(
            Modifier.fillMaxWidth().padding(vertical = 4.dp).background(Color(0x400F9D58), RoundedCornerShape(10.dp)).padding(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(message.authorPhoto, 26.dp, message.author)
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(message.author, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                    Text(kind.header, style = MaterialTheme.typography.labelSmall)
                }
            }
            if (message.text.isNotEmpty()) Text(message.text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
        }
        LiveChatMessage.Kind.System -> Text(message.text, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 4.dp))
        LiveChatMessage.Kind.Text -> Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
            Avatar(message.authorPhoto, 24.dp, message.author)
            Spacer(Modifier.width(8.dp))
            val authorColor = when {
                message.isOwner -> Color(0xFFFFD600)
                message.isModerator -> Color(0xFF5E84F1)
                message.isMember -> Color(0xFF2BA640)
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
            Text(buildAnnotatedString {
                if (showsTime) {
                    val time = message.timestampText ?: message.offsetMs?.let { formatTime(it / 1000.0) }
                    if (time != null) withStyle(SpanStyle(color = Color.Gray)) { append("$time  ") }
                }
                withStyle(SpanStyle(color = authorColor, fontWeight = FontWeight.SemiBold)) {
                    append(message.author + (if (message.isVerified) " ✓" else "") + "  ")
                }
                append(message.text)
            }, style = MaterialTheme.typography.bodySmall)
        }
    }
}
