package com.dangdvd.dvdtube.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AccountPlaylistOption
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.LibraryActions
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.Toasts
import kotlinx.coroutines.launch

/** "Save to playlist": Watch later, the account's playlists (signed in) and on-device playlists. */
@Composable
fun SaveToPlaylistSheet(video: VideoItem, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val signedIn = AccountStore.isSignedIn
    var accountPlaylists by remember { mutableStateOf<List<AccountPlaylistOption>?>(null) }
    var creating by remember { mutableStateOf<Boolean?>(null) } // true = on the account, false = on the device
    LaunchedEffect(video.id, signedIn) {
        if (signedIn) accountPlaylists = runCatching { YouTubeService.accountPlaylistOptions(video.id) }.getOrDefault(emptyList())
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 12.dp)) {
            Text("Lưu video vào…", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            Text(video.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 16.dp))
            CheckLine("Xem sau", LibraryActions.isInWatchLater(video.id)) { LibraryActions.toggleWatchLater(video) }

            if (signedIn) {
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                Header("Danh sách phát trên YouTube") { creating = true }
                val options = accountPlaylists
                if (options == null) {
                    Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) }
                } else {
                    options.filter { it.id != "WL" }.forEach { option ->
                        CheckLine(option.title, option.containsVideo) {
                            val add = !option.containsVideo
                            accountPlaylists = options.map { if (it.id == option.id) it.copy(containsVideo = add) else it }
                            scope.launch {
                                runCatching {
                                    if (add) InnerTube.editPlaylist(option.id, add = video.id) else InnerTube.editPlaylist(option.id, remove = video.id)
                                }.onSuccess {
                                    Toasts.show(if (add) "Đã lưu vào ${option.title}" else "Đã xóa khỏi ${option.title}")
                                }.onFailure {
                                    accountPlaylists = accountPlaylists?.map { if (it.id == option.id) it.copy(containsVideo = !add) else it }
                                    Toasts.show("Không cập nhật được danh sách phát")
                                }
                            }
                        }
                    }
                }
            }

            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Header("Danh sách phát trên máy") { creating = false }
            LibraryStore.playlists.forEach { playlist ->
                val contains = playlist.videos.any { it.id == video.id }
                CheckLine(playlist.name, contains) {
                    if (contains) LibraryStore.remove(video.id, playlist.id) else LibraryStore.add(video, playlist.id)
                    Toasts.show(if (contains) "Đã xóa khỏi ${playlist.name}" else "Đã lưu vào ${playlist.name}")
                }
            }
            if (LibraryStore.playlists.isEmpty()) {
                Text("Chưa có danh sách phát trên máy.", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
        }
    }

    creating?.let { onAccount ->
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { creating = null },
            title = { Text(if (onAccount) "Danh sách phát mới trên YouTube" else "Danh sách phát mới trên máy") },
            text = { OutlinedTextField(name, { name = it }, singleLine = true, placeholder = { Text("Tên danh sách phát") }) },
            confirmButton = {
                TextButton(enabled = name.isNotBlank(), onClick = {
                    val title = name.trim()
                    creating = null
                    if (onAccount) {
                        scope.launch {
                            runCatching { InnerTube.createPlaylist(title, video.id) }
                                .onSuccess {
                                    Toasts.show("Đã tạo \"$title\" (riêng tư) và lưu video")
                                    accountPlaylists = runCatching { YouTubeService.accountPlaylistOptions(video.id) }.getOrNull() ?: accountPlaylists
                                }
                                .onFailure { Toasts.show("Không tạo được danh sách phát") }
                        }
                    } else {
                        LibraryStore.createPlaylist(title, video)
                        Toasts.show("Đã tạo \"$title\" và lưu video")
                    }
                }) { Text("Tạo") }
            },
            dismissButton = { TextButton(onClick = { creating = null }) { Text("Hủy") } },
        )
    }
}

@Composable
private fun Header(title: String, onCreate: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        TextButton(onClick = onCreate) {
            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
            Text("Tạo mới")
        }
    }
}

@Composable
private fun CheckLine(title: String, checked: Boolean, onToggle: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = { onToggle() })
        Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
