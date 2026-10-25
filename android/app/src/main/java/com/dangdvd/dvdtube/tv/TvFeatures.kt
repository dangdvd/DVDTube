package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.ParentalControls
import com.dangdvd.dvdtube.core.alarm.AlarmRepeat
import com.dangdvd.dvdtube.core.alarm.AlarmSource
import com.dangdvd.dvdtube.core.alarm.PlaybackAlarm
import com.dangdvd.dvdtube.core.alarm.PlaybackAlarms
import com.dangdvd.dvdtube.core.services.AppUpdater
import com.dangdvd.dvdtube.core.services.Lyrics
import com.dangdvd.dvdtube.core.services.MusicFilter
import com.dangdvd.dvdtube.core.services.MusicItem
import com.dangdvd.dvdtube.core.services.MusicPage
import com.dangdvd.dvdtube.core.services.MusicRecents
import com.dangdvd.dvdtube.core.services.YouTubeMusic
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.core.sync.LanSync
import com.dangdvd.dvdtube.core.sync.SyncReceiver
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.music.MusicSearchState
import com.dangdvd.dvdtube.ui.screens.alarmNextText
import com.dangdvd.dvdtube.ui.screens.clockText
import com.dangdvd.dvdtube.ui.screens.parentalLimitOptions
import com.dangdvd.dvdtube.ui.screens.parentalLimitTitle
import com.dangdvd.dvdtube.ui.screens.watchedTodayText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private fun onOff(value: Boolean) = if (value) "Bật" else "Tắt"

// MARK: PIN

/** 4 dots and a number pad for the remote (the remote's digit keys work too). */
@Composable
fun TvPinPad(pin: String, error: String?, onChange: (String) -> Unit, onDone: (String) -> Unit, first: FocusRequester? = null) {
    fun type(digit: Char) {
        if (pin.length >= 4) return
        val next = pin + digit
        onChange(next)
        if (next.length == 4) onDone(next)
    }
    Column(
        Modifier.onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            val digit = when (event.key) {
                Key.Zero, Key.NumPad0 -> '0'
                Key.One, Key.NumPad1 -> '1'
                Key.Two, Key.NumPad2 -> '2'
                Key.Three, Key.NumPad3 -> '3'
                Key.Four, Key.NumPad4 -> '4'
                Key.Five, Key.NumPad5 -> '5'
                Key.Six, Key.NumPad6 -> '6'
                Key.Seven, Key.NumPad7 -> '7'
                Key.Eight, Key.NumPad8 -> '8'
                Key.Nine, Key.NumPad9 -> '9'
                else -> null
            }
            if (digit != null) {
                type(digit)
                true
            } else {
                false
            }
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            for (index in 0 until 4) {
                Box(Modifier.size(18.dp).background(if (index < pin.length) Brand else TvColors.surfaceHigh, CircleShape))
            }
        }
        Text(error ?: " ", color = Brand, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 8.dp))
        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "OK")).forEachIndexed { rowIndex, row ->
            Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEachIndexed { columnIndex, label ->
                    val modifier = if (rowIndex == 0 && columnIndex == 0 && first != null) Modifier.width(76.dp).focusRequester(first) else Modifier.width(76.dp)
                    TvButton(label, onClick = {
                        when (label) {
                            "⌫" -> onChange(pin.dropLast(1))
                            "OK" -> if (pin.length == 4) onDone(pin)
                            else -> type(label.first())
                        }
                    }, modifier = modifier, accent = label == "OK" && pin.length == 4)
                }
            }
        }
    }
}

/** The PIN asked by [ParentalControls.guard] on the TV. */
@Composable
fun TvPinPrompt() {
    val request = ParentalControls.pinRequest ?: return
    var pin by remember(request) { mutableStateOf("") }
    var error by remember(request) { mutableStateOf<String?>(null) }
    var forgot by remember(request) { mutableStateOf(false) }
    val first = remember { FocusRequester() }
    LaunchedEffect(request, forgot) {
        delay(150)
        runCatching { first.requestFocus() }
    }
    if (forgot) {
        TvDialog("Quên mã PIN?", { forgot = false }) {
            Text("Không có cách khôi phục mã PIN. Đặt lại sẽ xóa mã PIN và tắt toàn bộ kiểm soát của phụ huynh.",
                color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(12.dp))
            TvOptionRow("Đặt lại kiểm soát của phụ huynh", onClick = {
                ParentalControls.cancelPin()
                ParentalControls.resetAll()
                Toasts.show("Đã đặt lại kiểm soát của phụ huynh")
            }, modifier = Modifier.focusRequester(first))
            TvOptionRow("Hủy", onClick = { forgot = false })
        }
        return
    }
    TvDialog("Nhập mã PIN", { ParentalControls.cancelPin() }, width = 460.dp) {
        Text(request.title, color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(12.dp))
        TvPinPad(pin, error, onChange = { pin = it; error = null }, onDone = { value ->
            if (!ParentalControls.submitPin(value)) {
                error = "Sai mã PIN"
                pin = ""
            }
        }, first = first)
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton("Quên mã PIN", onClick = { forgot = true })
            TvButton("Hủy", onClick = { ParentalControls.cancelPin() })
        }
    }
}

/** "Đã hết thời gian xem hôm nay" / outside the allowed hours, on the TV. */
@Composable
fun TvParentalLock() {
    val reason = ParentalControls.lockReason ?: return
    var pin by remember(reason) { mutableStateOf("") }
    var error by remember(reason) { mutableStateOf<String?>(null) }
    var unlocked by remember(reason) { mutableStateOf(false) }
    val first = remember { FocusRequester() }
    LaunchedEffect(reason, unlocked) {
        delay(150)
        runCatching { first.requestFocus() }
    }
    TvDialog(reason.title, { ParentalControls.dismissLock() }, width = 620.dp) {
        Text(reason.message + " Hôm nay đã xem ${watchedTodayText()}.", color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(12.dp))
        if (!unlocked) {
            Text("Phụ huynh nhập mã PIN để cho xem thêm", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            TvPinPad(pin, error, onChange = { pin = it; error = null }, onDone = { value ->
                if (ParentalControls.checkPin(value)) unlocked = true else {
                    error = "Sai mã PIN"
                    pin = ""
                }
            }, first = first)
            TvButton("Đóng", onClick = { ParentalControls.dismissLock() }, modifier = Modifier.padding(top = 8.dp))
        } else {
            TvOptionRow("Thêm 15 phút", onClick = { ParentalControls.extend(15) }, modifier = Modifier.focusRequester(first))
            TvOptionRow("Thêm 30 phút", onClick = { ParentalControls.extend(30) })
            TvOptionRow("Hết hôm nay", onClick = { ParentalControls.extend(null) })
        }
    }
}

// MARK: Update

@Composable
fun TvUpdateDialog() {
    val release = AppUpdater.available ?: return
    val context = LocalContext.current
    val progress = AppUpdater.progress
    val first = remember { FocusRequester() }
    LaunchedEffect(release) {
        delay(200)
        runCatching { first.requestFocus() }
    }
    TvDialog("Có bản mới v${release.version}", { if (progress == null) AppUpdater.available = null }, width = 700.dp) {
        Text("Bạn đang dùng v${AppUpdater.currentVersion}. Bản cập nhật cài đè lên bản hiện tại và giữ nguyên dữ liệu.",
            color = TvColors.secondaryText, style = MaterialTheme.typography.bodyLarge)
        if (release.notes.isNotBlank()) {
            Text(release.notes.take(600), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
        }
        if (progress != null) {
            Text("Đang tải… ${(progress * 100).toInt()}%", color = Brand, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
        }
        Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton(if (release.apkUrl == null) "Mở trang tải" else "Cập nhật", onClick = { AppUpdater.downloadAndInstall(context, release) },
                accent = true, enabled = progress == null, modifier = Modifier.focusRequester(first))
            TvButton(if (progress != null) "Hủy tải" else "Để sau", onClick = {
                if (progress != null) AppUpdater.cancelDownload()
                AppUpdater.available = null
            })
        }
    }
}

// MARK: Music

private fun musicVideos(items: List<MusicItem>) = items.filter { it.isPlayable }.mapNotNull { it.asVideo() }

private fun openTvMusicItem(item: MusicItem, context: List<MusicItem>) {
    if (item.isPlayable) {
        val video = item.asVideo() ?: return
        TvNav.play(video, musicVideos(context).ifEmpty { listOf(video) }, music = true)
        return
    }
    val browseId = item.browseId ?: item.playlistId?.let { "VL$it" } ?: return
    TvNav.open(TvRoute.MusicBrowse(browseId, item.title))
}

@Composable
private fun TvMusicCard(item: MusicItem, context: List<MusicItem>, modifier: Modifier = Modifier) {
    TvTile(onClick = { openTvMusicItem(item, context) }, modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(6.dp)) {
            val shape = if (item.kind == MusicItem.Kind.ARTIST) CircleShape else RoundedCornerShape(10.dp)
            TvImage(item.thumbnail, Modifier.fillMaxWidth().aspectRatio(1f).clip(shape))
            Spacer(Modifier.height(8.dp))
            Text(item.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.heightIn(min = 40.dp))
            val detail = item.subtitle.ifEmpty { listOfNotNull(item.artists, item.durationText).joinToString(" • ") }
            if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = TvColors.secondaryText, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
        }
    }
}

/** "Nghe nhạc" on the TV: YouTube Music search with tabs, and recently played songs. */
@Composable
fun TvMusicScreen() {
    val state = TvNav.model("music") { MusicSearchState() }
    var editing by remember { mutableStateOf(false) }
    val field = remember { FocusRequester() }
    val box = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(editing) {
        delay(60)
        if (editing) {
            runCatching { field.requestFocus() }
            keyboard?.show()
        }
    }
    LaunchedEffect(Unit) {
        delay(250)
        if (!editing) runCatching { box.requestFocus() }
    }
    val page = state.page
    val results = page?.sections?.flatMap { it.items }.orEmpty().distinctBy { it.key }
    val recents = MusicRecents.list.map { video ->
        MusicItem(MusicItem.Kind.SONG, video.title, video.channelName ?: "", video.thumbnail ?: video.displayThumbnail,
            videoId = video.id, artists = video.channelName, artistId = video.channelId, durationText = video.durationText)
    }
    val shown = if (state.submitted != null) results else recents
    LazyVerticalGrid(
        columns = GridCells.Fixed(5),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = TvInsets.horizontal, end = TvInsets.horizontal, bottom = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "search", span = { GridItemSpan(maxLineSpan) }) {
            Column(Modifier.padding(top = TvInsets.vertical)) {
                Text("Nghe nhạc", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                if (editing) {
                    Box(Modifier.fillMaxWidth().background(TvColors.focused, RoundedCornerShape(50)).padding(horizontal = 22.dp, vertical = 14.dp)) {
                        BasicTextField(
                            value = state.query,
                            onValueChange = { state.query = it },
                            singleLine = true,
                            textStyle = TextStyle(color = TvColors.onFocused, fontSize = 20.sp),
                            cursorBrush = SolidColor(Brand),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = {
                                editing = false
                                keyboard?.hide()
                                state.search()
                            }),
                            modifier = Modifier.fillMaxWidth().focusRequester(field),
                        )
                        if (state.query.isEmpty()) Text("Tìm bài hát, nghệ sĩ, album…", color = TvColors.onFocused.copy(alpha = 0.5f))
                    }
                } else {
                    TvButton(state.query.ifEmpty { "Tìm bài hát, nghệ sĩ, album…" }, onClick = { editing = true }, icon = Icons.Default.Search,
                        modifier = Modifier.fillMaxWidth().focusRequester(box).tvFocusItem("music-search"))
                }
            }
        }
        item(key = "tabs", span = { GridItemSpan(maxLineSpan) }) {
            TvChipRow(MusicFilter.entries.toList(), state.filter, { it.title }, { state.select(it) }, inset = 0.dp)
        }
        item(key = "title", span = { GridItemSpan(maxLineSpan) }) {
            Text(
                when {
                    state.submitted != null -> "Kết quả cho \"${state.submitted}\""
                    recents.isNotEmpty() -> "Nghe gần đây"
                    else -> "Tìm một bài hát để bắt đầu nghe (chỉ âm thanh, bài sau nối tiếp bài trước)"
                },
                style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 6.dp),
            )
        }
        when {
            state.isLoading -> item(key = "loading", span = { GridItemSpan(maxLineSpan) }) { TvLoading() }
            state.error != null -> item(key = "error", span = { GridItemSpan(maxLineSpan) }) { TvMessage("Không tìm được", state.error) }
            state.submitted != null && shown.isEmpty() -> item(key = "empty", span = { GridItemSpan(maxLineSpan) }) { TvMessage("Không tìm thấy kết quả") }
        }
        itemsIndexed(shown, key = { _, item -> item.key }) { _, item ->
            TvMusicCard(item, shown, Modifier.tvFocusItem("music-" + item.key))
        }
    }
}

/** An album / artist / playlist of YouTube Music on the TV. */
@Composable
fun TvMusicBrowseScreen(route: TvRoute.MusicBrowse) {
    var reload by remember { mutableIntStateOf(0) }
    val result by produceState<Result<MusicPage>?>(null, route.browseId, reload) {
        value = try {
            Result.success(YouTubeMusic.browse(route.browseId))
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            Result.failure(failure)
        }
    }
    val page = result?.getOrNull()
    val first = remember { FocusRequester() }
    LaunchedEffect(page) {
        if (page == null) return@LaunchedEffect
        delay(250)
        runCatching { first.requestFocus() }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 48.dp)) {
        item("title") { TvScreenTitle(page?.title ?: route.title, subtitle = page?.subtitle) }
        when {
            result == null -> item("loading") { TvLoading() }
            page == null -> item("error") {
                TvMessage("Không tải được trang này", result?.exceptionOrNull()?.message) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TvButton("Thử lại", onClick = { reload++ }, icon = Icons.Default.Refresh)
                        if (route.browseId.startsWith("UC")) TvButton("Mở trang kênh", onClick = { TvNav.openChannel(route.browseId, route.title) })
                    }
                }
            }
            else -> {
                val songs = page.songs
                item("actions") {
                    Row(Modifier.padding(start = TvInsets.horizontal, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        if (songs.isNotEmpty()) {
                            TvButton("Phát", onClick = { TvNav.play(songs.first(), songs, music = true) }, icon = Icons.Default.PlayArrow,
                                accent = true, modifier = Modifier.focusRequester(first))
                            TvButton("Trộn bài", onClick = {
                                val shuffled = songs.shuffled()
                                TvNav.play(shuffled.first(), shuffled, music = true)
                            }, icon = Icons.Default.Shuffle)
                        }
                        if (route.browseId.startsWith("UC")) {
                            TvButton("Mở trang kênh", onClick = { TvNav.openChannel(route.browseId, page.title ?: route.title) },
                                modifier = if (songs.isEmpty()) Modifier.focusRequester(first) else Modifier)
                        }
                    }
                }
                page.sections.forEachIndexed { index, section ->
                    item("section-$index") {
                        TvShelf(section.title ?: if (index == 0) "Bài hát" else "Thêm") {
                            itemsIndexed(section.items, key = { _, item -> item.key }) { _, item ->
                                TvMusicCard(item, section.items, Modifier.width(190.dp).tvFocusItem("browse-$index-${item.key}"))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "Lời bài hát" in the TV player: timed lyrics follow the song. */
@Composable
fun TvLyricsDialog(videoId: String, onDismiss: () -> Unit) {
    val lyrics by produceState<Result<Lyrics?>?>(null, videoId) {
        value = try {
            Result.success(YouTubeMusic.lyrics(videoId))
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            Result.failure(failure)
        }
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(150)
        runCatching { focus.requestFocus() }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        TvTheme {
            Column(
                Modifier.width(820.dp).height(520.dp).background(TvColors.surface, RoundedCornerShape(20.dp)).padding(24.dp),
            ) {
                Text("Lời bài hát", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                val loaded = lyrics?.getOrNull()
                when {
                    lyrics == null -> Box(Modifier.fillMaxSize().focusRequester(focus).focusable(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Brand)
                    }
                    loaded == null -> Box(Modifier.fillMaxSize().focusRequester(focus).focusable(), contentAlignment = Alignment.Center) {
                        Text(if (lyrics?.isFailure == true) "Không tải được lời bài hát" else "Chưa có lời bài hát cho bài này",
                            color = TvColors.secondaryText, style = MaterialTheme.typography.titleMedium)
                    }
                    else -> {
                        val lines = if (loaded.isTimed) loaded.lines.map { it.text.ifEmpty { "♪" } } else loaded.text.split('\n')
                        val nowMs = (PlayerController.currentTime * 1000).toLong()
                        val active = if (loaded.isTimed && PlayerController.currentVideo?.id == videoId) loaded.lines.indexOfLast { it.startMs <= nowMs } else -1
                        val listState = rememberLazyListState()
                        LaunchedEffect(active) {
                            if (active >= 0) runCatching { listState.animateScrollToItem(maxOf(active - 3, 0)) }
                        }
                        LazyColumn(Modifier.fillMaxSize().focusRequester(focus).focusable(), state = listState) {
                            itemsIndexed(lines) { index, line ->
                                Text(
                                    line,
                                    fontSize = 22.sp,
                                    fontWeight = if (index == active) FontWeight.Bold else FontWeight.Normal,
                                    color = if (index == active) Brand else Color.White.copy(alpha = if (active >= 0 && index < active) 0.5f else 0.85f),
                                    modifier = Modifier.padding(vertical = 4.dp),
                                )
                            }
                            loaded.source?.let { source ->
                                item { Text(source, color = TvColors.secondaryText, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 12.dp)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: Sync

/** "Đồng bộ thư viện" on the TV: the TV receives, a phone scans the QR code. */
@Composable
fun TvSyncReceiveScreen() {
    val context = LocalContext.current
    var generation by remember { mutableIntStateOf(0) }
    val receiver = remember(generation) { SyncReceiver(context) }
    val button = remember { FocusRequester() }
    DisposableEffect(receiver) {
        receiver.start()
        onDispose { receiver.stop() }
    }
    var expired by remember(generation) { mutableStateOf(false) }
    LaunchedEffect(generation) {
        delay(LanSync.LIFETIME_MS)
        expired = true
        receiver.stop()
    }
    LaunchedEffect(Unit) {
        delay(300)
        runCatching { button.requestFocus() }
    }
    Row(
        Modifier.fillMaxSize().padding(horizontal = TvInsets.horizontal, vertical = TvInsets.vertical),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(320.dp).background(Color.White, RoundedCornerShape(16.dp)).padding(14.dp), contentAlignment = Alignment.Center) {
            val link = receiver.link
            when {
                receiver.result != null -> Text("✓", color = Brand, style = MaterialTheme.typography.displayLarge)
                expired -> Text("Mã đã hết hạn", color = Color.Black, style = MaterialTheme.typography.titleLarge)
                link != null -> {
                    val image = remember(link) { TvPairingServer.qrCode(link) }
                    Image(image, "Mã QR đồng bộ", Modifier.fillMaxSize())
                }
                receiver.error != null -> Text(receiver.error ?: "", color = Color.Black, style = MaterialTheme.typography.bodyLarge)
                else -> CircularProgressIndicator(color = Brand)
            }
        }
        Spacer(Modifier.width(48.dp))
        Column(Modifier.weight(1f)) {
            val result = receiver.result
            Text(if (result != null) "Đã đồng bộ" else "Đồng bộ thư viện", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            if (result != null) {
                Text(result.text, style = MaterialTheme.typography.titleLarge)
            } else {
                Text(
                    "Quét mã bằng DVDTube trên điện thoại (Cài đặt › Đồng bộ & sao lưu › Quét mã QR) hoặc Camera trên iPhone. " +
                        "Kênh đăng ký, nhật ký xem, Xem sau, video đã thích, danh sách phát và nhật ký tìm kiếm của hai thiết bị được gộp lại; không xóa gì.",
                    style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText,
                )
                receiver.address?.let {
                    Text("${receiver.deviceName} • $it", style = MaterialTheme.typography.bodyMedium, color = TvColors.secondaryText, modifier = Modifier.padding(top = 8.dp))
                }
                if (receiver.isBusy) Text("Đang đồng bộ…", color = Brand, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                TvButton("Tạo mã mới", onClick = { generation++ }, icon = Icons.Default.Refresh, modifier = Modifier.focusRequester(button))
                TvButton("Xong", onClick = { TvNav.back() })
            }
        }
    }
}

// MARK: Parental controls

private enum class TvParentalDialog { LIMIT, START, END, KEYWORDS, NEW_PIN, TURN_OFF }

private val halfHours = (0 until 48).map { it * 30 }

@Composable
fun TvParentalScreen() {
    var dialog by remember { mutableStateOf<TvParentalDialog?>(null) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(250)
        runCatching { first.requestFocus() }
    }
    fun change(action: () -> Unit) = ParentalControls.guard("Nhập mã PIN để thay đổi Kiểm soát của phụ huynh", action)
    val row = Modifier.widthIn(max = 820.dp)
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = TvInsets.horizontal, end = TvInsets.horizontal, top = TvInsets.vertical, bottom = 48.dp),
    ) {
        item("title") {
            Text("Kiểm soát của phụ huynh", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(bottom = 8.dp))
        }
        if (!ParentalControls.isEnabled) {
            item("intro") {
                Text(
                    "Bảo vệ bằng mã PIN 4 chữ số: chế độ hạn chế, giới hạn thời gian xem mỗi ngày, khung giờ được xem, chặn từ khóa và kênh, ẩn Shorts, tắt tìm kiếm.",
                    style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText, modifier = Modifier.widthIn(max = 820.dp).padding(bottom = 12.dp),
                )
                TvOptionRow("Bật và đặt mã PIN", onClick = { dialog = TvParentalDialog.NEW_PIN }, modifier = row.focusRequester(first))
            }
        } else {
            item("today") {
                val remaining = ParentalControls.remainingSeconds
                Text("Hôm nay đã xem ${watchedTodayText()}" + (remaining?.let { ", còn ${it / 60} phút" } ?: ""),
                    style = MaterialTheme.typography.bodyLarge, color = TvColors.secondaryText, modifier = Modifier.padding(bottom = 8.dp))
            }
            item("restricted") {
                TvOptionRow("Chế độ hạn chế", value = onOff(AppSettings.parentalRestricted), modifier = row.focusRequester(first),
                    onClick = { change { AppSettings.parentalRestricted = !AppSettings.parentalRestricted } })
            }
            item("limit") {
                TvOptionRow("Giới hạn thời gian xem mỗi ngày", value = parentalLimitTitle(AppSettings.parentalDailyLimit), modifier = row,
                    onClick = { change { dialog = TvParentalDialog.LIMIT } })
            }
            item("window") {
                TvOptionRow("Khung giờ được xem", value = if (AppSettings.parentalWindowEnabled) "${clockText(AppSettings.parentalWindowStart)} – ${clockText(AppSettings.parentalWindowEnd)}" else "Tắt",
                    modifier = row, onClick = { change { AppSettings.parentalWindowEnabled = !AppSettings.parentalWindowEnabled } })
            }
            if (AppSettings.parentalWindowEnabled) {
                item("start") { TvOptionRow("Từ", value = clockText(AppSettings.parentalWindowStart), modifier = row, onClick = { change { dialog = TvParentalDialog.START } }) }
                item("end") { TvOptionRow("Đến", value = clockText(AppSettings.parentalWindowEnd), modifier = row, onClick = { change { dialog = TvParentalDialog.END } }) }
            }
            item("keywords") {
                val words = AppSettings.parentalKeywords.split(',', '\n', ';').count { it.isNotBlank() }
                TvOptionRow("Chặn từ khóa", value = if (words == 0) "Chưa có" else "$words từ", modifier = row, onClick = { change { dialog = TvParentalDialog.KEYWORDS } })
            }
            item("channels") {
                TvOptionRow("Chặn kênh", value = "${HiddenContentStore.channelCount} kênh", modifier = row,
                    subtitle = "Kênh đã chọn \"Không đề xuất kênh này\" bị ẩn ở mọi nơi. Chọn để bỏ chặn tất cả.",
                    onClick = { change { HiddenContentStore.channels.forEach { HiddenContentStore.unhideChannel(it.id) } } })
            }
            item("comments") { TvOptionRow("Ẩn bình luận", value = onOff(AppSettings.parentalHideComments), modifier = row, onClick = { change { AppSettings.parentalHideComments = !AppSettings.parentalHideComments } }) }
            item("shorts") { TvOptionRow("Ẩn Shorts", value = onOff(AppSettings.parentalHideShorts), modifier = row, onClick = { change { AppSettings.parentalHideShorts = !AppSettings.parentalHideShorts } }) }
            item("search") { TvOptionRow("Tắt tìm kiếm", value = onOff(AppSettings.parentalNoSearch), modifier = row, onClick = { change { AppSettings.parentalNoSearch = !AppSettings.parentalNoSearch } }) }
            item("pin") { TvOptionRow("Đổi mã PIN", modifier = row, onClick = { change { dialog = TvParentalDialog.NEW_PIN } }) }
            item("lock") { TvOptionRow("Khóa lại ngay", modifier = row, onClick = { ParentalControls.lockSettings(); TvNav.back() }) }
            item("off") { TvOptionRow("Tắt kiểm soát của phụ huynh", modifier = row, onClick = { change { dialog = TvParentalDialog.TURN_OFF } }) }
        }
    }
    when (dialog) {
        TvParentalDialog.LIMIT -> TvDialog("Giới hạn thời gian xem mỗi ngày", { dialog = null }) {
            parentalLimitOptions.forEach { minutes ->
                TvOptionRow(parentalLimitTitle(minutes), selected = AppSettings.parentalDailyLimit == minutes, onClick = {
                    AppSettings.parentalDailyLimit = minutes
                    dialog = null
                })
            }
        }
        TvParentalDialog.START, TvParentalDialog.END -> {
            val start = dialog == TvParentalDialog.START
            TvDialog(if (start) "Được xem từ" else "Được xem đến", { dialog = null }) {
                halfHours.forEach { minutes ->
                    val current = if (start) AppSettings.parentalWindowStart else AppSettings.parentalWindowEnd
                    TvOptionRow(clockText(minutes), selected = current == minutes, onClick = {
                        if (start) AppSettings.parentalWindowStart = minutes else AppSettings.parentalWindowEnd = minutes
                        dialog = null
                    })
                }
            }
        }
        TvParentalDialog.KEYWORDS -> TvKeywordsDialog { dialog = null }
        TvParentalDialog.NEW_PIN -> TvNewPinDialog(onDismiss = { dialog = null }) { pin ->
            if (ParentalControls.isEnabled) {
                ParentalControls.changePin(pin)
                Toasts.show("Đã đổi mã PIN")
            } else {
                ParentalControls.enable(pin)
                Toasts.show("Đã bật kiểm soát của phụ huynh")
            }
            dialog = null
        }
        TvParentalDialog.TURN_OFF -> TvDialog("Tắt kiểm soát của phụ huynh?", { dialog = null }) {
            TvOptionRow("Tắt", onClick = { ParentalControls.disable(); dialog = null })
            TvOptionRow("Hủy", onClick = { dialog = null })
        }
        null -> Unit
    }
}

@Composable
private fun TvKeywordsDialog(onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(AppSettings.parentalKeywords) }
    val field = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) {
        delay(150)
        runCatching { field.requestFocus() }
        keyboard?.show()
    }
    TvDialog("Chặn từ khóa", onDismiss, width = 700.dp) {
        Text("Ngăn cách các từ bằng dấu phẩy. Không phân biệt hoa thường và dấu.", color = TvColors.secondaryText)
        Box(Modifier.fillMaxWidth().padding(vertical = 10.dp).background(TvColors.focused, RoundedCornerShape(12.dp)).padding(14.dp)) {
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                textStyle = TextStyle(color = TvColors.onFocused, fontSize = 18.sp),
                cursorBrush = SolidColor(Brand),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { keyboard?.hide() }),
                modifier = Modifier.fillMaxWidth().focusRequester(field),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton("Lưu", onClick = { AppSettings.parentalKeywords = text.trim(); onDismiss() }, accent = true)
            TvButton("Hủy", onClick = onDismiss)
        }
    }
}

@Composable
private fun TvNewPinDialog(onDismiss: () -> Unit, onPin: (String) -> Unit) {
    var firstPin by remember { mutableStateOf<String?>(null) }
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(firstPin) {
        delay(150)
        runCatching { focus.requestFocus() }
    }
    TvDialog(if (firstPin == null) "Đặt mã PIN mới" else "Nhập lại mã PIN", onDismiss, width = 460.dp) {
        Text("Mã PIN gồm 4 chữ số. Nếu quên, chỉ có thể đặt lại toàn bộ kiểm soát của phụ huynh.", color = TvColors.secondaryText)
        Spacer(Modifier.height(10.dp))
        TvPinPad(pin, error, onChange = { pin = it; error = null }, onDone = { value ->
            val previous = firstPin
            if (previous == null) {
                firstPin = value
                pin = ""
            } else if (previous == value) {
                onPin(value)
            } else {
                error = "Hai mã PIN không khớp"
                firstPin = null
                pin = ""
            }
        }, first = focus)
    }
}

// MARK: Alarms

@Composable
fun TvAlarmsScreen() {
    val context = LocalContext.current
    var editing by remember { mutableStateOf<PlaybackAlarm?>(null) }
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(250)
        runCatching { first.requestFocus() }
    }
    PlaybackAlarms.list
    val alarms = PlaybackAlarms.alarms
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = TvInsets.horizontal, end = TvInsets.horizontal, top = TvInsets.vertical, bottom = 48.dp),
    ) {
        item("title") {
            Text("Hẹn giờ phát", style = MaterialTheme.typography.headlineMedium)
            Text("TV tự bắt đầu phát vào giờ đã hẹn, âm lượng tăng dần trong 30 giây.", color = TvColors.secondaryText,
                style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(bottom = 10.dp))
        }
        item("add") {
            TvOptionRow("Thêm hẹn giờ", icon = Icons.Default.Add, onClick = { editing = PlaybackAlarm() }, modifier = Modifier.widthIn(max = 820.dp).focusRequester(first))
        }
        alarms.forEach { alarm ->
            item(alarm.id) {
                TvOptionRow(
                    "${alarm.timeText} • ${alarm.repeat.title}",
                    subtitle = "${alarm.sourceText()} • ${alarmNextText(alarm)}",
                    value = onOff(alarm.enabled),
                    icon = Icons.Default.Alarm,
                    onClick = { editing = alarm },
                    modifier = Modifier.widthIn(max = 820.dp),
                )
            }
        }
    }
    editing?.let { alarm ->
        TvAlarmEditor(alarm, onDismiss = { editing = null }, onDelete = {
            PlaybackAlarms.delete(context, alarm.id)
            editing = null
        }) { saved ->
            PlaybackAlarms.upsert(context, saved)
            Toasts.show(if (saved.enabled) "Đã hẹn giờ phát lúc ${saved.timeText}" else "Đã tắt hẹn giờ ${saved.timeText}")
            editing = null
        }
    }
}

/** A value changed with ◀ ▶ on the remote. */
@Composable
private fun TvStepRow(label: String, value: String, onStep: (Int) -> Unit, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = { onStep(1) },
        modifier = modifier.fillMaxWidth().padding(vertical = 3.dp).onFocusChanged { focused = it.isFocused }.onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            when (event.key) {
                Key.DirectionLeft -> { onStep(-1); true }
                Key.DirectionRight -> { onStep(1); true }
                else -> false
            }
        },
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(12.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = Color.White,
            focusedContainerColor = TvColors.focused,
            focusedContentColor = TvColors.onFocused,
            pressedContainerColor = TvColors.focused,
            pressedContentColor = TvColors.onFocused,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text(if (focused) "◀  $value  ▶" else value, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.End)
        }
    }
}

@Composable
private fun TvAlarmEditor(initial: PlaybackAlarm, onDismiss: () -> Unit, onDelete: () -> Unit, onSave: (PlaybackAlarm) -> Unit) {
    var alarm by remember(initial.id) { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(150)
        runCatching { focus.requestFocus() }
    }
    val sources = AlarmSource.entries.filter { it != AlarmSource.LINK || alarm.source == AlarmSource.LINK }
    val playlists = LibraryStore.playlists
    TvDialog(if (PlaybackAlarms.alarm(initial.id) == null) "Thêm hẹn giờ phát" else "Sửa hẹn giờ phát", onDismiss, width = 700.dp) {
        TvStepRow("Giờ", String.format(java.util.Locale.ROOT, "%02d", alarm.hour), { step ->
            alarm = alarm.copy(hour = (alarm.hour + step + 24) % 24)
        }, Modifier.focusRequester(focus))
        TvStepRow("Phút", String.format(java.util.Locale.ROOT, "%02d", alarm.minute), { step ->
            alarm = alarm.copy(minute = (alarm.minute + step * 5 + 60) % 60 / 5 * 5)
        })
        TvStepRow("Lặp lại", alarm.repeat.title, { step ->
            val options = AlarmRepeat.entries
            alarm = alarm.copy(repeat = options[(options.indexOf(alarm.repeat) + step + options.size) % options.size])
        })
        TvStepRow("Nội dung", alarm.source.title, { step ->
            val index = sources.indexOf(alarm.source).coerceAtLeast(0)
            val next = sources[(index + step + sources.size) % sources.size]
            alarm = alarm.copy(source = next, playlistId = if (next == AlarmSource.LOCAL_PLAYLIST) alarm.playlistId ?: playlists.firstOrNull()?.id else alarm.playlistId)
        })
        if (alarm.source == AlarmSource.LOCAL_PLAYLIST) {
            TvStepRow("Danh sách phát", playlists.firstOrNull { it.id == alarm.playlistId }?.name ?: "Chưa có danh sách", { step ->
                if (playlists.isNotEmpty()) {
                    val index = playlists.indexOfFirst { it.id == alarm.playlistId }.coerceAtLeast(0)
                    alarm = alarm.copy(playlistId = playlists[(index + step + playlists.size) % playlists.size].id)
                }
            })
        }
        TvOptionRow("Âm lượng tăng dần (30 giây)", value = onOff(alarm.fadeIn), onClick = { alarm = alarm.copy(fadeIn = !alarm.fadeIn) })
        TvOptionRow("Chỉ phát âm thanh", value = onOff(alarm.audioOnly), onClick = { alarm = alarm.copy(audioOnly = !alarm.audioOnly) })
        TvOptionRow("Đang bật", value = onOff(alarm.enabled), onClick = { alarm = alarm.copy(enabled = !alarm.enabled) })
        val valid = alarm.source != AlarmSource.LOCAL_PLAYLIST || playlists.any { it.id == alarm.playlistId }
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TvButton("Lưu", onClick = { onSave(alarm) }, accent = true, enabled = valid)
            if (PlaybackAlarms.alarm(initial.id) != null) TvButton("Xóa", onClick = onDelete, icon = Icons.Default.Delete)
            TvButton("Hủy", onClick = onDismiss)
        }
    }
}
