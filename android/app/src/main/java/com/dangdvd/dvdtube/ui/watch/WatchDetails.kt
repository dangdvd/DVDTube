package com.dangdvd.dvdtube.ui.watch

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.DownloadDone
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.LiveChatInfo
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.VideoQuality
import com.dangdvd.dvdtube.core.WatchInfo
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.core.services.NumberText
import com.dangdvd.dvdtube.core.services.ReturnYouTubeDislike
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.ui.player.SleepTimerSheet
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.DownloadState
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.ErrorState
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.LoadingState
import com.dangdvd.dvdtube.ui.components.SubscribeButton
import com.dangdvd.dvdtube.ui.components.feedItems
import com.dangdvd.dvdtube.ui.components.shareText
import kotlinx.coroutines.launch

sealed class WatchSheet {
    data object Description : WatchSheet()
    data class Comments(val token: String) : WatchSheet()
    data object Transcript : WatchSheet()
    data object Queue : WatchSheet()
    data class Chat(val info: LiveChatInfo) : WatchSheet()
    data object SleepTimer : WatchSheet()
    data object Lyrics : WatchSheet()
}

/** The video as it should be saved to the library (details from the watch page). */
fun enrichedVideo(video: VideoItem, info: WatchInfo?): VideoItem {
    info ?: return video
    return video.copy(
        title = video.title.ifEmpty { info.title },
        channelName = video.channelName ?: info.channel?.name,
        channelId = video.channelId ?: info.channel?.id,
        channelAvatar = video.channelAvatar ?: info.channel?.avatar,
        viewCountText = video.viewCountText ?: info.shortViewCountText,
        publishedText = video.publishedText ?: info.relativeDateText,
    )
}

@Composable
fun WatchDetails(modifier: Modifier = Modifier) {
    val video = PlayerController.currentVideo ?: return
    val info = PlayerController.watchInfo?.takeIf { it.videoId == video.id }
    var sheet by remember(video.id) { mutableStateOf<WatchSheet?>(null) }
    val related = remember(info) { info?.let { loaded -> FeedModel { loaded.related } } }
    val scope = rememberCoroutineScope()
    LaunchedEffect(related) { related?.load() }
    LaunchedEffect(info) {
        val channel = info?.channel ?: return@LaunchedEffect
        if (AccountStore.isSignedIn) info.isSubscribed?.let { AccountStore.noteSubscription(channel.id, it) }
    }

    LazyColumn(modifier.fillMaxSize()) {
        item(key = "header") { Header(video, info) { sheet = it } }
        if (info == null) {
            item(key = "state") {
                val error = PlayerController.watchInfoError
                if (error != null) ErrorState(error) { PlayerController.refreshWatchInfo() } else LoadingState()
            }
        } else {
            info.channel?.let { channel ->
                item(key = "channel") {
                    Row(
                        Modifier.fillMaxWidth().clickable { Router.open(Route.Channel(channel)) }.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(channel.avatar, 40.dp, channel.name)
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text(channel.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            channel.subscriberText?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            }
                        }
                        SubscribeButton(channel, compact = true)
                    }
                }
            }
            item(key = "community") {
                val chat = info.liveChat
                when {
                    com.dangdvd.dvdtube.core.ParentalControls.hidesComments -> Unit
                    chat != null -> InfoCard(
                        if (chat.isReplay) "Phát lại nội dung trò chuyện" else "Trò chuyện trực tiếp",
                        if (chat.isReplay) "Xem lại tin nhắn đồng bộ theo video" else "Tham gia trò chuyện cùng mọi người",
                    ) { sheet = WatchSheet.Chat(chat) }
                    info.commentsToken != null -> InfoCard("Bình luận", info.commentCountText ?: "Xem bình luận") {
                        sheet = WatchSheet.Comments(info.commentsToken)
                    }
                    else -> InfoCard("Bình luận", "Bình luận đã bị tắt", null)
                }
            }
            if (PlayerController.queue.size > 1) {
                item(key = "queue") {
                    InfoCard("Hàng đợi", "${PlayerController.queueIndex + 1}/${PlayerController.queue.size} • " +
                        (PlayerController.queue.getOrNull(PlayerController.queueIndex + 1)?.let { "Tiếp theo: ${it.title}" } ?: "Video cuối")) {
                        sheet = WatchSheet.Queue
                    }
                }
            }
            if (related != null) {
                feedItems(HiddenContentStore.filter(related.items), compact = true, isLoadingMore = related.isLoadingMore,
                    onLoadMore = if (related.canLoadMore) ({ scope.launch { related.loadMore() } }) else null)
            }
        }
        item(key = "bottom") { Spacer(Modifier.height(24.dp)) }
    }

    when (val current = sheet) {
        WatchSheet.Description -> if (info != null) DescriptionSheet(info, onTranscript = { sheet = WatchSheet.Transcript }) { sheet = null }
        is WatchSheet.Comments -> CommentsSheet(current.token) { sheet = null }
        WatchSheet.Transcript -> TranscriptSheet { sheet = null }
        WatchSheet.Queue -> QueueSheet { sheet = null }
        is WatchSheet.Chat -> LiveChatSheet(current.info) { sheet = null }
        WatchSheet.SleepTimer -> SleepTimerSheet { sheet = null }
        WatchSheet.Lyrics -> com.dangdvd.dvdtube.ui.music.LyricsSheet(video.id) { sheet = null }
        null -> {}
    }
}

@Composable
private fun Header(video: VideoItem, info: WatchInfo?, open: (WatchSheet) -> Unit) {
    val context = LocalContext.current
    val item = enrichedVideo(video, info)
    val originalTitle = info?.title ?: video.title.ifEmpty { PlayerController.playerInfo?.title ?: "" }
    // DeArrow's title when there is one; the original stays a long press away.
    val title = com.dangdvd.dvdtube.ui.components.rememberDeArrow(video.copy(title = originalTitle)).title
    Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Column(
            Modifier.fillMaxWidth()
                .combinedClickable(
                    enabled = info != null || title != originalTitle,
                    onClick = { if (info != null) open(WatchSheet.Description) },
                    onLongClick = { if (title != originalTitle) com.dangdvd.dvdtube.player.Toasts.show("Tiêu đề gốc: $originalTitle") },
                )
                .padding(horizontal = 12.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2,
                overflow = TextOverflow.Ellipsis)
            val meta = listOfNotNull(info?.shortViewCountText ?: info?.viewCountText ?: video.viewCountText,
                info?.relativeDateText ?: video.publishedText).joinToString(" • ")
            Text(
                (if (meta.isEmpty()) "" else "$meta  ") + if (info != null) "...thêm" else "",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                val liked = LibraryActions.isLiked(video.id, info?.likeStatus)
                val disliked = LibraryActions.isDisliked(video.id, info?.likeStatus)
                Row(
                    Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50)),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        Modifier.clickable { LibraryActions.toggleLike(item, info?.likeStatus) }.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(if (liked) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp, "Thích", Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(info?.likeCountText ?: "Thích", style = MaterialTheme.typography.labelLarge)
                    }
                    Box(Modifier.width(1.dp).height(20.dp).background(MaterialTheme.colorScheme.outlineVariant))
                    // Return YouTube Dislike's estimate (YouTube hides the real count).
                    val dislikes by produceState<Long?>(null, video.id, AppSettings.showDislikes) {
                        value = if (AppSettings.showDislikes && !video.isLive) ReturnYouTubeDislike.dislikes(video.id) else null
                    }
                    Row(
                        Modifier.clickable { LibraryActions.toggleDislike(item, info?.likeStatus) }.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(if (disliked) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown, "Không thích", Modifier.size(18.dp))
                        dislikes?.let {
                            Spacer(Modifier.width(6.dp))
                            Text(NumberText.compact(it), style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
            info?.liveChat?.takeIf { !com.dangdvd.dvdtube.core.ParentalControls.hidesComments }?.let { chat ->
                item { ActionChip(Icons.AutoMirrored.Filled.Chat, "Trò chuyện") { open(WatchSheet.Chat(chat)) } }
            }
            item {
                var shareMenu by remember { mutableStateOf(false) }
                Box {
                    ActionChip(Icons.Default.Share, "Chia sẻ") {
                        if (PlayerController.currentTime > 5 && !video.isLive) shareMenu = true
                        else shareText(context, video.shareUrl, title)
                    }
                    DropdownMenu(expanded = shareMenu, onDismissRequest = { shareMenu = false }) {
                        DropdownMenuItem(text = { Text("Chia sẻ video") }, onClick = {
                            shareMenu = false
                            shareText(context, video.shareUrl, title)
                        })
                        val seconds = PlayerController.currentTime.toInt()
                        DropdownMenuItem(text = { Text("Chia sẻ tại ${formatTime(seconds.toDouble())}") }, onClick = {
                            shareMenu = false
                            shareText(context, "https://youtu.be/${video.id}?t=$seconds", title)
                        })
                    }
                }
            }
            if (!PlayerController.isCasting && !PlayerController.isLocalPlayback) {
                item {
                    ActionChip(
                        if (PlayerController.isAudioOnly) Icons.Default.HeadsetOff else Icons.Default.Headphones,
                        if (PlayerController.isAudioOnly) "Bật hình" else "Chỉ âm thanh",
                    ) { PlayerController.switchAudioOnly(!PlayerController.isAudioOnly) }
                }
            }
            item {
                ActionChip(Icons.Default.Bedtime, PlayerController.sleepTimerLabel?.let { "Hẹn giờ $it" } ?: "Hẹn giờ tắt") {
                    open(WatchSheet.SleepTimer)
                }
            }
            item { ActionChip(Icons.AutoMirrored.Filled.PlaylistAdd, "Lưu") { Router.playlistSheetVideo = item } }
            if (!video.isLive) {
                item {
                    val state = DownloadManager.states[video.id]
                    val downloaded = DownloadManager.isDownloaded(video.id)
                    val label = when {
                        downloaded -> "Đã tải"
                        state is DownloadState.Downloading -> "${(state.progress * 100).toInt()}%"
                        state is DownloadState.Preparing || state is DownloadState.Merging -> "Đang tải…"
                        state is DownloadState.Queued -> "Đang chờ…"
                        else -> "Tải xuống"
                    }
                    var downloadMenu by remember { mutableStateOf(false) }
                    Box {
                        ActionChip(if (downloaded) Icons.Default.DownloadDone else Icons.Default.Download, label) {
                            if (!downloaded && (state == null || state is DownloadState.Failed)) downloadMenu = true
                        }
                        DropdownMenu(expanded = downloadMenu, onDismissRequest = { downloadMenu = false }) {
                            listOf(VideoQuality.P1080, VideoQuality.P720, VideoQuality.P480, VideoQuality.P360).forEach { quality ->
                                DropdownMenuItem(
                                    text = { Text("Video ${quality.title}" + if (quality == AppSettings.downloadQuality) " (mặc định)" else "") },
                                    onClick = {
                                        downloadMenu = false
                                        DownloadManager.download(item, quality = quality)
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("Chỉ âm thanh (m4a)") },
                                leadingIcon = { Icon(Icons.Default.Headphones, null) },
                                onClick = {
                                    downloadMenu = false
                                    DownloadManager.download(item, audioOnly = true)
                                },
                            )
                        }
                    }
                }
            }
            if (!video.isLive) {
                item { ActionChip(Icons.Default.MusicNote, "Lời bài hát") { open(WatchSheet.Lyrics) } }
            }
            if (PlayerController.captionTracks.isNotEmpty()) {
                item { ActionChip(Icons.AutoMirrored.Filled.Notes, "Bản ghi") { open(WatchSheet.Transcript) } }
            }
            if (PlayerController.queue.size > 1) {
                item { ActionChip(Icons.AutoMirrored.Filled.QueueMusic, "Hàng đợi") { open(WatchSheet.Queue) } }
            }
        }
    }
}

@Composable
private fun ActionChip(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50)).clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun InfoCard(title: String, subtitle: String, onClick: (() -> Unit)?) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
            .clickable(enabled = onClick != null) { onClick?.invoke() }
            .padding(12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(2.dp))
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
