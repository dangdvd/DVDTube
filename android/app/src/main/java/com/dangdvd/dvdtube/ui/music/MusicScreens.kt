package com.dangdvd.dvdtube.ui.music

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.automirrored.filled.PlaylistPlay
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.formatTime
import com.dangdvd.dvdtube.core.services.Lyrics
import com.dangdvd.dvdtube.core.services.MusicFilter
import com.dangdvd.dvdtube.core.services.MusicItem
import com.dangdvd.dvdtube.core.services.MusicPage
import com.dangdvd.dvdtube.core.services.MusicRecents
import com.dangdvd.dvdtube.core.services.YouTubeMusic
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.EmptyState
import com.dangdvd.dvdtube.ui.components.ErrorState
import com.dangdvd.dvdtube.ui.components.LoadingState
import com.dangdvd.dvdtube.ui.components.RemoteImage
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import com.dangdvd.dvdtube.ui.player.SleepTimerSheet
import com.dangdvd.dvdtube.ui.player.VideoSurface
import com.dangdvd.dvdtube.ui.rememberRouteModel
import com.dangdvd.dvdtube.ui.watch.QueueSheet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Starts music mode with [video] in [queue] and shows the now-playing screen. */
fun playMusic(video: VideoItem, queue: List<VideoItem>) {
    PlayerController.play(video, queue.ifEmpty { listOf(video) }, music = true)
    PlayerController.isExpanded = false
    if (PlayerController.currentVideo?.id == video.id) Router.open(Route.NowPlaying())
}

/** Search of the music screen (kept while the screen is on the stack). */
class MusicSearchState {
    var query by mutableStateOf("")
    var submitted by mutableStateOf<String?>(null)
        private set
    var filter by mutableStateOf(MusicFilter.SONGS)
        private set
    var page by mutableStateOf<MusicPage?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var job: Job? = null

    fun search(text: String = query, newFilter: MusicFilter = filter) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        query = trimmed
        submitted = trimmed
        filter = newFilter
        job?.cancel()
        isLoading = true
        error = null
        page = null
        job = AppScope.launch {
            try {
                page = YouTubeMusic.search(trimmed, newFilter)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (failure: Exception) {
                error = failure.message ?: "Không tìm được."
            } finally {
                isLoading = false
            }
        }
    }

    fun select(newFilter: MusicFilter) {
        if (submitted != null) search(submitted ?: query, newFilter) else filter = newFilter
    }
}

private fun kindIcon(kind: MusicItem.Kind): ImageVector = when (kind) {
    MusicItem.Kind.SONG -> Icons.Default.MusicNote
    MusicItem.Kind.VIDEO -> Icons.Default.Videocam
    MusicItem.Kind.ALBUM -> Icons.Default.Album
    MusicItem.Kind.ARTIST -> Icons.Default.Person
    MusicItem.Kind.PLAYLIST -> Icons.AutoMirrored.Filled.PlaylistPlay
}

/** Opens an album / artist / playlist, or plays a song with the rest of [context] after it. */
fun openMusicItem(item: MusicItem, context: List<MusicItem>) {
    if (item.isPlayable) {
        val songs = context.filter { it.isPlayable }.mapNotNull { it.asVideo() }
        val video = item.asVideo() ?: return
        playMusic(video, songs)
        return
    }
    val browseId = item.browseId ?: item.playlistId?.let { "VL$it" } ?: return
    Router.open(Route.MusicBrowse(browseId, item.title))
}

@Composable
private fun MusicRow(item: MusicItem, context: List<MusicItem>) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable { openMusicItem(item, context) }.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val shape = if (item.kind == MusicItem.Kind.ARTIST) CircleShape else RoundedCornerShape(6.dp)
        Box(Modifier.size(52.dp).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            if (item.thumbnail != null) RemoteImage(item.thumbnail, Modifier.fillMaxSize())
            else Icon(kindIcon(item.kind), null)
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(item.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontWeight = if (PlayerController.currentVideo?.id == item.videoId && item.videoId != null) FontWeight.Bold else FontWeight.Normal,
                color = if (PlayerController.currentVideo?.id == item.videoId && item.videoId != null) Brand else MaterialTheme.colorScheme.onSurface)
            val detail = item.subtitle.ifEmpty { listOfNotNull(item.artists, item.album, item.durationText).joinToString(" • ") }
            if (detail.isNotEmpty()) {
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
            }
        }
        if (item.isPlayable) {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Tùy chọn") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    val video = item.asVideo()
                    if (video != null) {
                        DropdownMenuItem(text = { Text("Radio từ bài này") }, leadingIcon = { Icon(Icons.Default.Radio, null) }, onClick = {
                            menu = false
                            PlayerController.playRadio(video)
                            Router.open(Route.NowPlaying())
                        })
                        DropdownMenuItem(text = { Text("Phát tiếp theo") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.QueueMusic, null) }, onClick = {
                            menu = false
                            PlayerController.playAfterCurrent(video)
                        })
                        DropdownMenuItem(text = { Text("Thêm vào hàng đợi") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.PlaylistPlay, null) }, onClick = {
                            menu = false
                            PlayerController.addToQueue(video)
                        })
                        DropdownMenuItem(text = { Text("Lưu vào danh sách phát") }, onClick = {
                            menu = false
                            Router.playlistSheetVideo = video
                        })
                    }
                }
            }
        } else if (item.kind == MusicItem.Kind.ARTIST && item.browseId != null) {
            TextButton(onClick = { Router.openChannel(item.browseId, item.title, item.thumbnail) }) { Text("Kênh") }
        }
    }
}

/** "Nghe nhạc": YouTube Music search with tabs, and recently played songs. */
@Composable
fun MusicScreen(route: Route.Music) {
    val state = rememberRouteModel(route.key) { MusicSearchState() }
    val keyboard = LocalSoftwareKeyboardController.current
    ScreenScaffold("Nghe nhạc", actions = {
        if (PlayerController.isMusicMode && PlayerController.currentVideo != null) {
            IconButton(onClick = { Router.open(Route.NowPlaying()) }) { Icon(Icons.Default.GraphicEq, "Đang phát") }
        }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item(key = "search") {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = { state.query = it },
                    singleLine = true,
                    placeholder = { Text("Tìm bài hát, nghệ sĩ, album…") },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    trailingIcon = {
                        if (state.query.isNotEmpty()) IconButton(onClick = { state.query = "" }) { Icon(Icons.Default.Close, "Xóa") }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = {
                        keyboard?.hide()
                        state.search()
                    }),
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
            item(key = "tabs") {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(MusicFilter.entries.toList(), key = { it.name }) { filter ->
                        FilterChip(selected = state.filter == filter, onClick = { state.select(filter) }, label = { Text(filter.title) })
                    }
                }
            }
            val page = state.page
            when {
                state.isLoading -> item(key = "loading") { LoadingState() }
                state.error != null -> item(key = "error") { ErrorState(state.error ?: "") { state.search() } }
                page != null -> {
                    val all = page.sections.flatMap { it.items }.distinctBy { it.key }
                    if (all.isEmpty()) item(key = "empty") { EmptyState(Icons.Default.MusicNote, "Không tìm thấy kết quả") }
                    items(all, key = { "r-" + it.key }) { item -> MusicRow(item, all) }
                }
                else -> {
                    val recents = MusicRecents.list
                    if (recents.isEmpty()) {
                        item(key = "hint") {
                            EmptyState(Icons.Default.Headphones, "Tìm bài hát để bắt đầu nghe",
                                "Nhạc phát chỉ âm thanh (đổi trong Cài đặt), bài sau nối tiếp bài trước, có lời bài hát và radio.")
                        }
                    } else {
                        item(key = "recent-title") {
                            Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("Nghe gần đây", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                TextButton(onClick = { MusicRecents.clear() }) { Text("Xóa") }
                            }
                        }
                        val asItems = recents.map { video ->
                            MusicItem(MusicItem.Kind.SONG, video.title, video.channelName ?: "", video.thumbnail ?: video.displayThumbnail,
                                videoId = video.id, artists = video.channelName, artistId = video.channelId, durationText = video.durationText)
                        }
                        items(asItems, key = { "recent-" + it.key }) { item -> MusicRow(item, asItems) }
                    }
                }
            }
            item(key = "bottom") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

/** An album, artist or playlist page of YouTube Music. */
@Composable
fun MusicBrowseScreen(route: Route.MusicBrowse) {
    var reload by remember { mutableStateOf(0) }
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
    ScreenScaffold(page?.title ?: route.title) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            when {
                result == null -> item { LoadingState() }
                page == null -> item {
                    ErrorState(result?.exceptionOrNull()?.message ?: "Không tải được trang này.") { reload++ }
                    if (route.browseId.startsWith("UC")) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                            TextButton(onClick = { Router.openChannel(route.browseId, route.title) }) { Text("Mở trang kênh") }
                        }
                    }
                }
                else -> {
                    item(key = "header") {
                        Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            val round = route.browseId.startsWith("UC")
                            RemoteImage(page.thumbnail, Modifier.size(180.dp).clip(if (round) CircleShape else RoundedCornerShape(12.dp)))
                            Spacer(Modifier.height(10.dp))
                            Text(page.title ?: route.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                            page.subtitle?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                            }
                            val songs = page.songs
                            if (songs.isNotEmpty()) {
                                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Button(onClick = { playMusic(songs.first(), songs) }) {
                                        Icon(Icons.Default.PlayArrow, null)
                                        Spacer(Modifier.width(6.dp))
                                        Text("Phát")
                                    }
                                    FilledTonalButton(onClick = { val shuffled = songs.shuffled(); playMusic(shuffled.first(), shuffled) }) {
                                        Icon(Icons.Default.Shuffle, null)
                                        Spacer(Modifier.width(6.dp))
                                        Text("Trộn bài")
                                    }
                                }
                            }
                            if (route.browseId.startsWith("UC")) {
                                TextButton(onClick = { Router.openChannel(route.browseId, page.title ?: route.title) }) { Text("Mở trang kênh") }
                            }
                        }
                    }
                    page.sections.forEachIndexed { index, section ->
                        section.title?.let { title ->
                            item(key = "title-$index") {
                                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp))
                            }
                        }
                        items(section.items, key = { "s$index-" + it.key }) { item -> MusicRow(item, section.items) }
                    }
                }
            }
            item(key = "bottom") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// MARK: Lyrics

private sealed class LyricsState {
    data object Loading : LyricsState()
    data object Missing : LyricsState()
    data class Failed(val message: String) : LyricsState()
    data class Loaded(val lyrics: Lyrics) : LyricsState()
}

/** Lyrics of [videoId]; timed lyrics follow the playback (tap a line to jump to it). */
@Composable
fun LyricsView(videoId: String, modifier: Modifier = Modifier, large: Boolean = false) {
    val state by produceState<LyricsState>(LyricsState.Loading, videoId) {
        value = try {
            YouTubeMusic.lyrics(videoId)?.let { LyricsState.Loaded(it) } ?: LyricsState.Missing
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (failure: Exception) {
            LyricsState.Failed(failure.message ?: "Không tải được lời bài hát.")
        }
    }
    when (val current = state) {
        LyricsState.Loading -> Box(modifier, contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        LyricsState.Missing -> Box(modifier.padding(24.dp), contentAlignment = Alignment.Center) {
            Text("Chưa có lời bài hát cho bài này", color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        is LyricsState.Failed -> Box(modifier.padding(24.dp), contentAlignment = Alignment.Center) {
            Text(current.message, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        is LyricsState.Loaded -> {
            val lyrics = current.lyrics
            if (lyrics.isTimed && PlayerController.currentVideo?.id == videoId) {
                val listState = rememberLazyListState()
                val nowMs = (PlayerController.currentTime * 1000).toLong()
                val active = lyrics.lines.indexOfLast { it.startMs <= nowMs }
                LaunchedEffect(active) {
                    if (active >= 0) runCatching { listState.animateScrollToItem(maxOf(active - 2, 0)) }
                }
                LazyColumn(modifier, state = listState, contentPadding = PaddingValues(vertical = 16.dp, horizontal = 20.dp)) {
                    itemsIndexed(lyrics.lines) { index, line ->
                        val isActive = index == active
                        Text(
                            line.text.ifEmpty { "♪" },
                            fontSize = if (large) 22.sp else 18.sp,
                            fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                            color = if (isActive) Brand else MaterialTheme.colorScheme.onSurface.copy(alpha = if (index < active) 0.5f else 0.8f),
                            modifier = Modifier.fillMaxWidth().clickable { PlayerController.seek(line.startMs / 1000.0) }.padding(vertical = 6.dp),
                        )
                    }
                    lyrics.source?.let { source ->
                        item { Text(source, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp)) }
                    }
                }
            } else {
                Column(modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(lyrics.text, fontSize = if (large) 19.sp else 16.sp, lineHeight = if (large) 30.sp else 26.sp)
                    lyrics.source?.let {
                        Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
                    }
                }
            }
        }
    }
}

/** "Lời bài hát" on the watch page. */
@Composable
fun LyricsSheet(videoId: String, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Text("Lời bài hát", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        LyricsView(videoId, Modifier.fillMaxWidth().height(460.dp).navigationBarsPadding())
    }
}

// MARK: Now playing

@Composable
private fun SmallAction(icon: ImageVector, label: String, active: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, tint = if (active) Brand else MaterialTheme.colorScheme.onSurface)
        Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1, color = if (active) Brand else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Music mode's now-playing screen. */
@Composable
fun NowPlayingScreen() {
    val video = PlayerController.currentVideo
    var showLyrics by remember { mutableStateOf(false) }
    var showQueue by remember { mutableStateOf(false) }
    var showSleep by remember { mutableStateOf(false) }
    var scrub by remember { mutableStateOf<Float?>(null) }
    ScreenScaffold("Đang phát") { padding ->
        if (video == null) {
            EmptyState(Icons.Default.MusicNote, "Chưa phát bài nào", modifier = Modifier.padding(padding))
            return@ScreenScaffold
        }
        Column(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (showLyrics) {
                    LyricsView(video.id, Modifier.fillMaxSize(), large = true)
                } else if (!PlayerController.isAudioOnly && !PlayerController.isCasting) {
                    VideoSurface(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)))
                } else {
                    RemoteImage(
                        video.thumbnail ?: video.displayThumbnail,
                        Modifier.widthIn(max = 360.dp).fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(16.dp)),
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(video.title.ifEmpty { PlayerController.playerInfo?.title ?: "" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(video.channelName ?: PlayerController.playerInfo?.author ?: "", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, modifier = Modifier.clickable(enabled = video.channelId != null) {
                    video.channelId?.let { id -> Router.open(Route.MusicBrowse(id, video.channelName ?: "")) }
                })
            val duration = PlayerController.duration
            Slider(
                value = scrub ?: if (duration > 0) (PlayerController.currentTime / duration).toFloat().coerceIn(0f, 1f) else 0f,
                onValueChange = { scrub = it },
                onValueChangeFinished = {
                    scrub?.let { if (duration > 0) PlayerController.seek(it * duration) }
                    scrub = null
                },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Row(Modifier.fillMaxWidth()) {
                Text(formatTime(scrub?.let { it * duration } ?: PlayerController.currentTime), style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.weight(1f))
                Text(formatTime(duration), style = MaterialTheme.typography.labelMedium)
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { PlayerController.toggleShuffle() }) {
                    Icon(Icons.Default.Shuffle, "Trộn bài", tint = if (PlayerController.isShuffled) Brand else MaterialTheme.colorScheme.onSurface)
                }
                IconButton(onClick = { PlayerController.playPrevious() }) { Icon(Icons.Default.SkipPrevious, "Bài trước", Modifier.size(36.dp)) }
                Box(Modifier.size(72.dp).clip(CircleShape).background(Brand).clickable { PlayerController.togglePlayPause() }, contentAlignment = Alignment.Center) {
                    if (PlayerController.isLoading && !PlayerController.isPlaying) {
                        CircularProgressIndicator(color = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(32.dp))
                    } else {
                        Icon(if (PlayerController.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            if (PlayerController.isPlaying) "Tạm dừng" else "Phát", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(40.dp))
                    }
                }
                IconButton(onClick = { PlayerController.playNext() }) { Icon(Icons.Default.SkipNext, "Bài tiếp theo", Modifier.size(36.dp)) }
                IconButton(onClick = { PlayerController.cycleRepeat() }) {
                    Icon(if (PlayerController.isLooping) Icons.Default.RepeatOne else Icons.Default.Repeat, "Lặp lại",
                        tint = if (PlayerController.repeatAll || PlayerController.isLooping) Brand else MaterialTheme.colorScheme.onSurface)
                }
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                SmallAction(Icons.AutoMirrored.Filled.Notes, "Lời bài hát", active = showLyrics) { showLyrics = !showLyrics }
                SmallAction(Icons.AutoMirrored.Filled.QueueMusic, "Hàng đợi") { showQueue = true }
                SmallAction(Icons.Default.Radio, "Radio", active = PlayerController.isRadio) { PlayerController.playRadio(video) }
                SmallAction(Icons.Default.Bedtime, PlayerController.sleepTimerLabel ?: "Hẹn giờ", active = PlayerController.sleepTimerLabel != null) { showSleep = true }
                SmallAction(Icons.Default.GraphicEq, "EQ") { Router.open(Route.Equalizer()) }
                SmallAction(if (PlayerController.isAudioOnly) Icons.Default.Videocam else Icons.Default.Headphones,
                    if (PlayerController.isAudioOnly) "Xem video" else "Chỉ nghe") { PlayerController.switchAudioOnly(!PlayerController.isAudioOnly) }
            }
        }
    }
    if (showQueue) QueueSheet { showQueue = false }
    if (showSleep) SleepTimerSheet { showSleep = false }
}
