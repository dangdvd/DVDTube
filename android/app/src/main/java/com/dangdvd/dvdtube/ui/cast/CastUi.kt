package com.dangdvd.dvdtube.ui.cast

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.CastConnected
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.mediarouter.media.MediaRouter
import com.dangdvd.dvdtube.cast.CastController
import com.dangdvd.dvdtube.cast.DvdCastSender
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.google.android.gms.cast.framework.CastContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The merged device picker ("Truyền tới thiết bị"): DVDTube TVs / PCs first, then Chromecast. */
object CastPicker {
    var isVisible by mutableStateOf(false)
        private set
    /** Video to send once a device is picked (from a ⋮ menu). */
    var pendingVideo: VideoItem? = null
        private set
    /** "Thêm vào hàng đợi trên TV": queue instead of play. */
    var queueOnly = false
        private set

    fun open(video: VideoItem? = null, queueOnly: Boolean = false) {
        pendingVideo = video
        this.queueOnly = queueOnly
        isVisible = true
    }

    fun dismiss() {
        isVisible = false
        pendingVideo = null
        queueOnly = false
    }
}

/** The cast button of the top bars and the player: opens the merged picker. */
@Composable
fun CastButton(light: Boolean = false, modifier: Modifier = Modifier) {
    val connected = PlayerController.isCasting
    val tint = when {
        connected -> Brand
        light -> MaterialTheme.colorScheme.onSurface
        else -> Color.White
    }
    IconButton(
        onClick = { if (DvdCastSender.isConnected) DvdCastSender.showRemote = true else CastPicker.open() },
        modifier = modifier,
    ) {
        Icon(if (connected) Icons.Default.CastConnected else Icons.Default.Cast, "Truyền tới TV", tint = tint)
    }
}

@Composable
private fun DeviceRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    selected: Boolean = false,
    trailing: @Composable () -> Unit = {},
    onClick: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (selected) Brand else MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        trailing()
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 4.dp))
}

@Composable
fun CastPickerSheet() {
    if (!CastPicker.isVisible) return
    val context = LocalContext.current
    var adding by remember { mutableStateOf(false) }
    DisposableEffect(Unit) {
        DvdCastSender.startDiscovery()
        onDispose { DvdCastSender.stopDiscovery() }
    }
    // Chromecast devices through MediaRouter (picking one starts a Cast session).
    val router = remember { runCatching { MediaRouter.getInstance(context) }.getOrNull() }
    val selector = remember { if (CastController.isAvailable) runCatching { CastContext.getSharedInstance(context).mergedSelector }.getOrNull() else null }
    var routes by remember { mutableStateOf(listOf<MediaRouter.RouteInfo>()) }
    DisposableEffect(router, selector) {
        if (router == null || selector == null) return@DisposableEffect onDispose {}
        fun refresh() {
            routes = router.routes.filter { !it.isDefaultOrBluetooth && it.isEnabled && it.matchesSelector(selector) }
        }
        val callback = object : MediaRouter.Callback() {
            override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) = refresh()
            override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) = refresh()
            override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = refresh()
        }
        router.addCallback(selector, callback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY)
        refresh()
        onDispose { router.removeCallback(callback) }
    }

    fun pick(device: DvdCastSender.Device) {
        val video = CastPicker.pendingVideo
        val queueOnly = CastPicker.queueOnly
        CastPicker.dismiss()
        if (queueOnly && video != null) {
            DvdCastSender.connect(device, null)
            DvdCastSender.queueOnReceiver(video, next = false)
        } else {
            DvdCastSender.connect(device, video)
        }
        Toasts.show("Đang phát trên ${device.name}")
    }

    ModalBottomSheet(onDismissRequest = { CastPicker.dismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 12.dp)) {
            Row(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Truyền tới thiết bị", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (DvdCastSender.isDiscovering) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
            val dvd = DvdCastSender.connected
            if (dvd != null || CastController.isConnected) {
                SectionLabel("Đang kết nối")
                DeviceRow(Icons.Default.CastConnected, dvd?.name ?: CastController.deviceName ?: "TV", "Chạm để điều khiển", selected = true,
                    trailing = {
                        TextButton(onClick = {
                            CastPicker.dismiss()
                            if (dvd != null) DvdCastSender.disconnect() else CastController.disconnect()
                        }) { Text("Ngắt kết nối") }
                    }) {
                    CastPicker.dismiss()
                    if (dvd != null) DvdCastSender.showRemote = true else PlayerController.isExpanded = PlayerController.currentVideo != null
                }
                HorizontalDivider()
            }
            SectionLabel("DVDTube trên TV và máy tính")
            val devices = DvdCastSender.devices.filter { it.id != dvd?.id }
            if (devices.isEmpty()) {
                Text(
                    if (DvdCastSender.isDiscovering) "Đang tìm… Hãy mở DVDTube trên TV hoặc máy tính cùng mạng Wi-Fi."
                    else "Không thấy thiết bị nào. Hãy mở DVDTube trên TV hoặc máy tính cùng mạng Wi-Fi.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
            }
            devices.forEach { device ->
                DeviceRow(
                    if (device.isDesktop) Icons.Default.Computer else Icons.Default.Tv,
                    device.name,
                    (if (device.manual) "Đã thêm bằng địa chỉ • " else "") + device.address,
                    trailing = {
                        if (device.manual) {
                            IconButton(onClick = { DvdCastSender.removeManual(device) }) { Icon(Icons.Default.Close, "Xóa thiết bị") }
                        }
                    },
                ) { pick(device) }
            }
            DeviceRow(Icons.Default.Add, "Thêm thiết bị bằng địa chỉ IP", "Khi mạng chặn tìm thiết bị tự động") { adding = true }
            if (CastController.isAvailable) {
                HorizontalDivider()
                SectionLabel("Chromecast / Google TV")
                if (routes.isEmpty()) {
                    Text("Không thấy thiết bị Chromecast nào.", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                }
                routes.forEach { route ->
                    DeviceRow(Icons.Default.Cast, route.name, route.description?.takeIf { it.isNotBlank() }, selected = route.isSelected) {
                        if (DvdCastSender.isConnected) DvdCastSender.disconnect(stopReceiver = true)
                        CastPicker.dismiss()
                        runCatching { router?.selectRoute(route) }.onFailure { Toasts.show("Không kết nối được tới ${route.name}") }
                    }
                }
            }
        }
    }
    if (adding) AddDeviceDialog(onDismiss = { adding = false }) { device ->
        adding = false
        pick(device)
    }
}

/** "Thêm thiết bị bằng địa chỉ IP": `192.168.1.20:8766`. */
@Composable
private fun AddDeviceDialog(onDismiss: () -> Unit, onAdded: (DvdCastSender.Device) -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { if (!checking) onDismiss() },
        title = { Text("Thêm thiết bị bằng địa chỉ IP") },
        text = {
            Column {
                Text("Xem địa chỉ trong Cài đặt của DVDTube trên TV hoặc máy tính (mục Truyền tới DVDTube).",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    text, { text = it; error = null },
                    singleLine = true,
                    placeholder = { Text("192.168.1.20:8766") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Uri),
                    isError = error != null,
                    modifier = Modifier.padding(top = 8.dp),
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
            }
        },
        confirmButton = {
            TextButton(enabled = text.isNotBlank() && !checking, onClick = {
                checking = true
                scope.launch {
                    try {
                        onAdded(DvdCastSender.addManual(text))
                    } catch (cancel: CancellationException) {
                        throw cancel
                    } catch (failure: Exception) {
                        error = failure.message ?: "Không thêm được thiết bị."
                    } finally {
                        checking = false
                    }
                }
            }) { Text(if (checking) "Đang kiểm tra…" else "Kết nối") }
        },
        dismissButton = { TextButton(enabled = !checking, onClick = onDismiss) { Text("Hủy") } },
    )
}

/** "Đang phát trên <name>": the remote control of a DVDTube receiver. */
@Composable
fun DvdRemoteSheet() {
    val device = DvdCastSender.connected
    if (!DvdCastSender.showRemote || device == null) return
    val status = DvdCastSender.status
    val video = status?.video ?: PlayerController.currentVideo
    var scrub by remember { mutableStateOf<Float?>(null) }
    var volume by remember { mutableStateOf<Float?>(null) }
    ModalBottomSheet(onDismissRequest = { DvdCastSender.showRemote = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (device.isDesktop) Icons.Default.Computer else Icons.Default.Tv, null, tint = Brand)
                Spacer(Modifier.width(10.dp))
                Text("Đang phát trên ${device.name}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            DvdCastSender.statusText?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            }
            status?.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(12.dp))
            if (video != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(128.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
                        RemoteImage(video.displayThumbnail, Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(video.title.ifEmpty { "Video" }, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        video.channelName?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                    }
                }
            } else {
                Text("Chưa phát gì trên ${device.name}.", style = MaterialTheme.typography.bodyMedium)
            }
            val duration = status?.duration ?: PlayerController.duration
            val position = status?.position ?: PlayerController.currentTime
            if (duration > 0) {
                Slider(
                    value = scrub ?: (position / duration).toFloat().coerceIn(0f, 1f),
                    onValueChange = { scrub = it },
                    onValueChangeFinished = {
                        scrub?.let { DvdCastSender.control("seek", it * duration) }
                        scrub = null
                    },
                    modifier = Modifier.padding(top = 8.dp),
                )
                Row {
                    Text(formatTime(scrub?.let { it * duration } ?: position), style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.weight(1f))
                    Text(formatTime(duration), style = MaterialTheme.typography.labelMedium)
                }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { DvdCastSender.control("previous") }) { Icon(Icons.Default.SkipPrevious, "Video trước", Modifier.size(30.dp)) }
                IconButton(onClick = { DvdCastSender.control("skip", -10.0) }) { Icon(Icons.Default.Replay10, "Lùi 10 giây", Modifier.size(30.dp)) }
                val playing = status?.state == "playing" || status?.state == "buffering"
                FilledTonalButton(onClick = { DvdCastSender.control("toggle") }, modifier = Modifier.size(64.dp)) {
                    Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (playing) "Tạm dừng" else "Phát", Modifier.size(30.dp))
                }
                IconButton(onClick = { DvdCastSender.control("skip", 10.0) }) { Icon(Icons.Default.Forward10, "Tới 10 giây", Modifier.size(30.dp)) }
                IconButton(onClick = { DvdCastSender.control("next") }) { Icon(Icons.Default.SkipNext, "Video tiếp theo", Modifier.size(30.dp)) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val muted = status?.muted == true
                IconButton(onClick = { DvdCastSender.setMuted(!muted) }) {
                    Icon(if (muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp, if (muted) "Bật tiếng" else "Tắt tiếng")
                }
                Slider(
                    value = volume ?: if (muted) 0f else status?.volume ?: 1f,
                    onValueChange = { volume = it },
                    onValueChangeFinished = {
                        volume?.let { DvdCastSender.setVolume(it) }
                        volume = null
                    },
                    modifier = Modifier.weight(1f),
                )
            }
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { DvdCastSender.disconnect() }, modifier = Modifier.weight(1f)) { Text("Ngắt kết nối") }
                FilledTonalButton(onClick = { DvdCastSender.disconnect(resumeHere = true) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.PhoneAndroid, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Tiếp tục trên thiết bị này", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
