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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material.icons.automirrored.outlined.PlaylistPlay
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.Avatar
import com.dangdvd.dvdtube.ui.components.DownloadStatus
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.components.SectionHeader
import com.dangdvd.dvdtube.ui.components.Thumbnail
import com.dangdvd.dvdtube.ui.components.VideoMenu
import com.dangdvd.dvdtube.ui.components.VideoRow
import com.dangdvd.dvdtube.ui.components.pagedFeed
import com.dangdvd.dvdtube.ui.rememberRouteModel
import kotlinx.coroutines.launch

@Composable
fun LibraryScreen() {
    val history = LibraryStore.history
    val signedIn = AccountStore.isSignedIn
    var creating by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { AppLogo() },
                actions = {
                    if (signedIn) NotificationBell()
                    IconButton(onClick = { Router.open(Route.Search()) }) { Icon(Icons.Outlined.Search, "Tìm kiếm") }
                    IconButton(onClick = { Router.open(Route.Settings()) }) { Icon(Icons.Outlined.Settings, "Cài đặt") }
                },
            )
        },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item { AccountHeader() }
            item {
                SectionHeader("Nhật ký xem") {
                    TextButton(onClick = { Router.open(Route.History()) }) { Text("Xem tất cả") }
                }
                if (history.isEmpty()) {
                    Text("Video bạn xem sẽ xuất hiện ở đây.", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
                } else {
                    LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(history.take(15), key = { it.video.id }) { entry ->
                            Column(Modifier.width(150.dp).clickable { com.dangdvd.dvdtube.ui.components.openVideo(entry.video) }) {
                                Thumbnail(entry.video, Modifier.fillMaxWidth())
                                Text(entry.video.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 4.dp))
                                entry.video.channelName?.let {
                                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
            }
            if (signedIn) {
                item { SectionHeader("Tài khoản YouTube") }
                item { LibraryRow(Icons.Outlined.History, "Nhật ký xem trên YouTube") { Router.open(Route.AccountFeed("Nhật ký xem", "FEhistory")) } }
                item { LibraryRow(Icons.AutoMirrored.Outlined.PlaylistPlay, "Danh sách phát của bạn") {
                    Router.open(Route.AccountFeed("Danh sách phát", "FEplaylist_aggregation"))
                } }
                AccountStore.profile?.channelId?.let { id ->
                    item { LibraryRow(Icons.Outlined.AccountCircle, "Kênh của bạn") { Router.openChannel(id, AccountStore.profile?.name ?: "") } }
                }
                item { LibraryRow(Icons.Outlined.Notifications, "Thông báo") { Router.open(Route.Notifications()) } }
                item { HorizontalDivider() }
            }
            item { LibraryRow(Icons.Outlined.Schedule, "Xem sau", if (signedIn) null else "${LibraryStore.watchLater.size} video") { Router.open(Route.WatchLater()) } }
            item { LibraryRow(Icons.Outlined.ThumbUp, "Video đã thích", if (signedIn) null else "${LibraryStore.liked.size} video") { Router.open(Route.Liked()) } }
            item {
                LibraryRow(Icons.Outlined.Download, "Nội dung tải xuống", "${DownloadManager.downloads.size} video") { Router.open(Route.Downloads()) }
            }
            item { LibraryRow(Icons.Outlined.People, "Quản lý kênh đăng ký") { Router.open(Route.SubscriptionsManager()) } }
            item {
                SectionHeader("Danh sách phát trên máy") {
                    IconButton(onClick = { creating = true }) { Icon(Icons.Default.Add, "Tạo danh sách phát") }
                }
            }
            if (LibraryStore.playlists.isEmpty()) {
                item {
                    Text("Chưa có danh sách phát. Nhấn + để tạo.", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                }
            }
            items(LibraryStore.playlists, key = { it.id }) { playlist ->
                Row(
                    Modifier.fillMaxWidth().clickable { Router.open(Route.LocalPlaylist(playlist.id)) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(96.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center) {
                        val first = playlist.videos.firstOrNull()
                        if (first != null) RemoteImage(first.displayThumbnail, Modifier.fillMaxSize())
                        else Icon(Icons.AutoMirrored.Filled.PlaylistPlay, null)
                    }
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(playlist.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${playlist.videos.size} video", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
    if (creating) {
        NameDialog("Danh sách phát mới", "", onDismiss = { creating = false }) { name ->
            LibraryStore.createPlaylist(name)
            creating = false
        }
    }
}

@Composable
private fun AccountHeader() {
    val profile = AccountStore.profile
    if (AccountStore.isSignedIn && profile != null) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(profile.avatar, 64.dp, profile.name)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(profile.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
                listOfNotNull(profile.handle, profile.email).firstOrNull()?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
                Text("Chuyển đổi tài khoản", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 4.dp).clickable { Router.showAccountSwitcher = true })
            }
        }
    } else {
        Column(
            Modifier.fillMaxWidth().padding(16.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f), RoundedCornerShape(14.dp)).padding(16.dp),
        ) {
            Text("Đăng nhập YouTube", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("Dùng kênh đăng ký, danh sách phát, lượt thích, bình luận và đề xuất của tài khoản Google. Không đăng nhập vẫn dùng được đầy đủ trên máy.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 6.dp))
            Button(onClick = { Router.signIn() }) { Text("Đăng nhập") }
        }
    }
}

@Composable
private fun LibraryRow(icon: ImageVector, title: String, detail: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null)
        Spacer(Modifier.width(20.dp))
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun NameDialog(title: String, initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it }, singleLine = true, placeholder = { Text("Tên danh sách phát") }) },
        confirmButton = { TextButton(onClick = { onConfirm(name.trim()) }, enabled = name.isNotBlank()) { Text("Lưu") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } },
    )
}

/** Play all / shuffle buttons above a list of videos. */
@Composable
private fun PlayAllBar(videos: List<VideoItem>) {
    if (videos.isEmpty()) return
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = { PlayerController.play(videos.first(), videos) }, modifier = Modifier.weight(1f)) {
            Icon(Icons.Default.PlayArrow, null)
            Spacer(Modifier.width(6.dp))
            Text("Phát tất cả")
        }
        FilledTonalButton(onClick = { val shuffled = videos.shuffled(); PlayerController.play(shuffled.first(), shuffled) }, modifier = Modifier.weight(1f)) {
            Icon(Icons.Default.Shuffle, null)
            Spacer(Modifier.width(6.dp))
            Text("Trộn bài")
        }
    }
}

// MARK: History

@Composable
fun HistoryScreen() {
    var confirmClear by remember { mutableStateOf(false) }
    val history = LibraryStore.history
    ScreenScaffold("Nhật ký xem", actions = {
        if (history.isNotEmpty()) IconButton(onClick = { confirmClear = true }) { Icon(Icons.Default.Delete, "Xóa nhật ký") }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            if (history.isEmpty()) item { EmptyState(Icons.Outlined.History, "Chưa có video nào trong nhật ký") }
            items(history, key = { it.video.id }) { entry ->
                VideoRow(entry.video, trailing = {
                    IconButton(onClick = { LibraryStore.removeFromHistory(entry.video.id) }) { Icon(Icons.Default.Close, "Xóa khỏi nhật ký") }
                })
            }
        }
    }
    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Xóa toàn bộ nhật ký xem?") },
            confirmButton = { TextButton(onClick = { LibraryStore.clearHistory(); confirmClear = false }) { Text("Xóa") } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Hủy") } },
        )
    }
}

// MARK: Watch later & liked (account lists when signed in)

@Composable
fun WatchLaterScreen(route: Route.WatchLater) {
    if (AccountStore.isSignedIn) {
        AccountListScreen(route.key, "Xem sau", "VLWL")
        return
    }
    val videos = LibraryStore.watchLater
    ScreenScaffold("Xem sau") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item { PlayAllBar(videos) }
            if (videos.isEmpty()) item { EmptyState(Icons.Outlined.Schedule, "Chưa có video nào", "Chọn \"Lưu vào Xem sau\" trong menu của video.") }
            items(videos, key = { it.id }) { video ->
                VideoRow(video, videos, trailing = {
                    IconButton(onClick = { LibraryStore.toggleWatchLater(video) }) { Icon(Icons.Default.Close, "Xóa") }
                })
            }
        }
    }
}

@Composable
fun LikedScreen(route: Route.Liked) {
    if (AccountStore.isSignedIn) {
        AccountListScreen(route.key, "Video đã thích", "VLLL")
        return
    }
    val videos = LibraryStore.liked
    ScreenScaffold("Video đã thích") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item { PlayAllBar(videos) }
            if (videos.isEmpty()) item { EmptyState(Icons.Outlined.ThumbUp, "Chưa thích video nào") }
            items(videos, key = { it.id }) { video -> VideoRow(video, videos) }
        }
    }
}

@Composable
private fun AccountListScreen(key: String, title: String, browseId: String) {
    val model = rememberRouteModel(key + AccountStore.sessionKey) { FeedModel { com.dangdvd.dvdtube.core.services.YouTubeService.accountFeed(browseId) } }
    val scope = rememberCoroutineScope()
    ScreenScaffold(title) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            if (model.hasLoaded) item { PlayAllBar(model.videos) }
            pagedFeed(model, scope, compact = true, emptyTitle = "Chưa có video nào")
        }
    }
}

// MARK: Local playlist

@Composable
fun LocalPlaylistScreen(route: Route.LocalPlaylist) {
    val playlist = LibraryStore.playlist(route.id)
    var renaming by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    if (playlist == null) {
        ScreenScaffold("Danh sách phát") { padding ->
            EmptyState(Icons.Outlined.VideoLibrary, "Danh sách phát đã bị xóa", modifier = Modifier.padding(padding))
        }
        return
    }
    ScreenScaffold(playlist.name, actions = {
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Tùy chọn") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Đổi tên") }, leadingIcon = { Icon(Icons.Default.Edit, null) },
                    onClick = { menu = false; renaming = true })
                DropdownMenuItem(text = { Text("Xóa danh sách phát") }, leadingIcon = { Icon(Icons.Default.Delete, null) },
                    onClick = { menu = false; LibraryStore.deletePlaylist(playlist.id); Router.back() })
            }
        }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item { PlayAllBar(playlist.videos) }
            if (playlist.videos.isEmpty()) item { EmptyState(Icons.Outlined.VideoLibrary, "Danh sách phát trống", "Thêm video bằng \"Lưu vào danh sách phát\".") }
            itemsIndexed(playlist.videos, key = { _, video -> video.id }) { index, video ->
                VideoRow(video, playlist.videos, trailing = {
                    VideoMenu(video) { close ->
                        if (index > 0) DropdownMenuItem(text = { Text("Chuyển lên") }, onClick = { close(); LibraryStore.moveVideo(playlist.id, index, index - 1) })
                        if (index < playlist.videos.size - 1) DropdownMenuItem(text = { Text("Chuyển xuống") },
                            onClick = { close(); LibraryStore.moveVideo(playlist.id, index, index + 1) })
                        DropdownMenuItem(text = { Text("Xóa khỏi danh sách phát") }, leadingIcon = { Icon(Icons.Default.Delete, null) },
                            onClick = { close(); LibraryStore.remove(video.id, playlist.id) })
                    }
                })
            }
        }
    }
    if (renaming) {
        NameDialog("Đổi tên danh sách phát", playlist.name, onDismiss = { renaming = false }) { name ->
            LibraryStore.renamePlaylist(playlist.id, name)
            renaming = false
        }
    }
}

// MARK: Downloads

@Composable
fun DownloadsScreen() {
    val downloads = DownloadManager.downloads
    val active = DownloadManager.states.filterKeys { id -> downloads.none { it.video.id == id } }
    var confirmDelete by remember { mutableStateOf(false) }
    ScreenScaffold("Nội dung tải xuống", actions = {
        if (downloads.isNotEmpty()) IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Default.Delete, "Xóa tất cả") }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            if (downloads.isNotEmpty()) {
                item {
                    Text("${downloads.size} video • ${android.text.format.Formatter.formatShortFileSize(LocalContext.current, DownloadManager.totalSize)}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                }
            }
            if (downloads.isEmpty() && active.isEmpty()) {
                item { EmptyState(Icons.Outlined.Download, "Chưa có video tải xuống", "Chọn \"Tải xuống\" trên trang video để xem khi không có mạng.") }
            }
            items(active.keys.toList(), key = { "active-$it" }) { id ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(id, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    DownloadStatus(id)
                    IconButton(onClick = { DownloadManager.cancel(id) }) { Icon(Icons.Default.Close, "Hủy") }
                }
            }
            items(downloads, key = { it.video.id }) { download ->
                VideoRow(download.video, downloads.map { it.video }, trailing = {
                    VideoMenu(download.video) { close ->
                        DropdownMenuItem(text = { Text("Lưu vào thư viện ảnh") }, onClick = { close(); DownloadManager.exportToGallery(download.video.id) })
                        DropdownMenuItem(text = { Text("Xóa bản tải xuống") }, leadingIcon = { Icon(Icons.Default.Delete, null) },
                            onClick = { close(); DownloadManager.delete(download.video.id) })
                    }
                })
                Text(
                    listOfNotNull(download.qualityLabel, android.text.format.Formatter.formatShortFileSize(LocalContext.current, download.fileSize)).joinToString(" • "),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 190.dp, bottom = 6.dp),
                )
            }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Xóa tất cả video đã tải xuống?") },
            confirmButton = { TextButton(onClick = { DownloadManager.deleteAll(); confirmDelete = false }) { Text("Xóa") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Hủy") } },
        )
    }
}

// MARK: Subscriptions manager

@Composable
fun SubscriptionsManagerScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val importer = rememberCsvImporter()
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        val ok = runCatching {
            context.contentResolver.openOutputStream(uri)?.use { it.write(LibraryStore.exportSubscriptionsCsv().toByteArray()) }
        }.isSuccess
        Toasts.show(if (ok) "Đã xuất danh sách kênh" else "Không ghi được tệp")
    }
    val signedIn = AccountStore.isSignedIn
    val channels: List<ChannelItem> = if (signedIn) AccountStore.subscribedChannels else LibraryStore.subscriptions
    ScreenScaffold("Kênh đăng ký") { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(
                        if (signedIn) "${channels.size} kênh của tài khoản ${AccountStore.profile?.name ?: ""}"
                        else "${channels.size} kênh lưu trên máy (không cần tài khoản)",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
                        if (signedIn) {
                            OutlinedButton(onClick = { scope.launch { AccountStore.refreshSubscriptions() } }) { Text("Làm mới") }
                        } else {
                            OutlinedButton(onClick = { importer() }) { Text("Nhập CSV") }
                            OutlinedButton(onClick = { exporter.launch("subscriptions.csv") }, enabled = channels.isNotEmpty()) { Text("Xuất CSV") }
                        }
                    }
                }
            }
            if (channels.isEmpty()) item { EmptyState(Icons.Outlined.People, "Chưa đăng ký kênh nào") }
            items(channels, key = { it.id }) { channel -> com.dangdvd.dvdtube.ui.components.ChannelRow(channel) }
        }
    }
}
