package com.dangdvd.dvdtube.ui.upload

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.VideoUploader
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.components.Avatar

/** Upload a video from the phone to the signed-in channel. */
@Composable
fun UploadDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    var file by rememberSaveable { mutableStateOf<Uri?>(null) }
    var fileName by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var privacy by rememberSaveable { mutableStateOf(VideoUploader.Privacy.PRIVATE) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        file = uri
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "video"
        fileName = name
        if (title.isBlank()) title = name.substringBeforeLast('.')
        VideoUploader.reset()
    }
    val state = VideoUploader.state

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                TopAppBar(
                    title = { Text("Tải video lên") },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Đóng") } },
                )
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    val profile = AccountStore.profile
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(profile?.avatar, 36.dp, profile?.name ?: "")
                        Spacer(Modifier.width(10.dp))
                        Text("Kênh: ${profile?.name ?: "—"}", style = MaterialTheme.typography.titleSmall)
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(
                        Modifier.fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
                            .clickable(enabled = !VideoUploader.isBusy) {
                                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly))
                            }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.VideoFile, null, Modifier.size(32.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(if (file == null) "Chọn video từ thư viện" else fileName, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(title, { if (it.length <= 100) title = it }, Modifier.fillMaxWidth(), label = { Text("Tiêu đề") },
                        supportingText = { Text("${title.length}/100") }, enabled = !VideoUploader.isBusy)
                    OutlinedTextField(description, { if (it.length <= 5000) description = it }, Modifier.fillMaxWidth().height(140.dp),
                        label = { Text("Mô tả") }, enabled = !VideoUploader.isBusy)
                    Spacer(Modifier.height(12.dp))
                    Text("Chế độ hiển thị", style = MaterialTheme.typography.titleSmall)
                    VideoUploader.Privacy.entries.forEach { option ->
                        Row(Modifier.fillMaxWidth().clickable(enabled = !VideoUploader.isBusy) { privacy = option },
                            verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = privacy == option, onClick = { privacy = option }, enabled = !VideoUploader.isBusy)
                            Text(option.title)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    when (state) {
                        VideoUploader.State.Preparing -> {
                            Text("Đang chuẩn bị…")
                            LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 8.dp))
                        }
                        is VideoUploader.State.Uploading -> {
                            Text("Đang tải lên ${(state.progress * 100).toInt()}%")
                            LinearProgressIndicator(progress = { state.progress.toFloat() }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
                        }
                        VideoUploader.State.Creating -> {
                            Text("Đang tạo video trên kênh…")
                            LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 8.dp))
                        }
                        is VideoUploader.State.Done -> Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.CheckCircle, null, tint = Brand)
                            Spacer(Modifier.width(8.dp))
                            Text("Đã tải lên! YouTube đang xử lý video.")
                        }
                        is VideoUploader.State.Failed -> Text(state.message, color = MaterialTheme.colorScheme.error)
                        VideoUploader.State.Idle -> {}
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (VideoUploader.isBusy) {
                            OutlinedButton(onClick = { VideoUploader.cancel() }) { Text("Hủy tải lên") }
                        } else if (state is VideoUploader.State.Done) {
                            Button(onClick = {
                                onDismiss()
                                PlayerController.play(VideoItem(id = state.videoId, title = title))
                            }) { Text("Xem video") }
                            OutlinedButton(onClick = {
                                VideoUploader.reset()
                                file = null
                                title = ""
                                description = ""
                            }) { Text("Tải video khác") }
                        } else {
                            Button(
                                onClick = { file?.let { VideoUploader.start(context, it, title.trim(), description, privacy) } },
                                enabled = file != null && title.isNotBlank(),
                            ) { Text("Tải lên") }
                        }
                    }
                    TextButton(onClick = {
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://studio.youtube.com")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    }, modifier = Modifier.padding(top = 8.dp)) { Text("Mở YouTube Studio") }
                    Text(
                        "Video được tải thẳng lên kênh đang dùng (${if (AccountStore.identities.any { it.isSelected && it.isBrandAccount }) "kênh thương hiệu" else "tài khoản chính"}). " +
                            "Hãy giữ ứng dụng mở cho tới khi tải xong.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
