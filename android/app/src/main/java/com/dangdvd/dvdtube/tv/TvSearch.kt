package com.dangdvd.dvdtube.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.screens.rememberVoiceSearch
import kotlinx.coroutines.delay

/** What the search screen shows: the query being typed and the results of the last search. */
class TvSearchState {
    var query by mutableStateOf("")
    var submitted by mutableStateOf<String?>(null)
        private set
    var results by mutableStateOf<FeedModel?>(null)
        private set

    fun submit(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        query = trimmed
        // A pasted / dictated YouTube link plays directly.
        YouTubeService.videoId(trimmed)?.let { id ->
            TvNav.play(VideoItem(id = id))
            return
        }
        LibraryStore.addSearch(trimmed)
        submitted = trimmed
        results = FeedModel { YouTubeService.search(trimmed) }
    }
}

@Composable
fun TvSearchScreen() {
    val state = TvNav.model("search") { TvSearchState() }
    SearchContent(state)
}

/** Results for a query opened from elsewhere (shared text, "search" intent). */
@Composable
fun TvSearchResultsScreen(route: TvRoute.SearchResults) {
    val state = TvNav.model(route.key) { TvSearchState().also { it.submit(route.query) } }
    SearchContent(state)
}

@Composable
private fun SearchContent(state: TvSearchState) {
    var editing by remember { mutableStateOf(state.submitted == null) }
    var suggestions by remember { mutableStateOf(listOf<String>()) }
    val fieldFocus = remember { FocusRequester() }
    val boxFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val voice = rememberVoiceSearch { text ->
        editing = false
        state.submit(text)
    }

    LaunchedEffect(state.query) {
        val query = state.query.trim()
        if (query.isEmpty()) {
            suggestions = emptyList()
            return@LaunchedEffect
        }
        delay(250)
        suggestions = runCatching { YouTubeService.suggestions(query) }.getOrDefault(emptyList())
    }
    LaunchedEffect(editing) {
        delay(50)
        if (editing) {
            runCatching { fieldFocus.requestFocus() }
            keyboard?.show()
        }
    }

    fun search(text: String) {
        editing = false
        keyboard?.hide()
        state.submit(text)
    }

    val header: androidx.compose.foundation.lazy.grid.LazyGridScope.() -> Unit = {
        item(key = "search-box", span = { GridItemSpan(maxLineSpan) }) {
            Row(Modifier.padding(top = TvInsets.vertical, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (editing) {
                    Box(
                        Modifier.weight(1f).background(TvColors.focused, RoundedCornerShape(50)).padding(horizontal = 22.dp, vertical = 14.dp),
                    ) {
                        BasicTextField(
                            value = state.query,
                            onValueChange = { state.query = it },
                            singleLine = true,
                            textStyle = TextStyle(color = TvColors.onFocused, fontSize = 20.sp),
                            cursorBrush = SolidColor(Brand),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { search(state.query) }),
                            modifier = Modifier.fillMaxWidth().focusRequester(fieldFocus),
                        )
                        if (state.query.isEmpty()) {
                            Text("Tìm trên YouTube", color = TvColors.onFocused.copy(alpha = 0.5f), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                } else {
                    TvButton(
                        state.query.ifEmpty { "Tìm trên YouTube" },
                        onClick = { editing = true },
                        icon = Icons.Default.Search,
                        modifier = Modifier.weight(1f).focusRequester(boxFocus).tvFocusItem("search-box"),
                    )
                }
                Spacer(Modifier.width(14.dp))
                TvIconButton(Icons.Default.Mic, "Tìm bằng giọng nói", { voice() }, modifier = Modifier.tvFocusItem("voice"))
            }
        }
        val words = if (state.query.isNotBlank() && state.query.trim() != state.submitted) suggestions.distinct() else emptyList()
        val history = LibraryStore.searchHistory.distinct().take(12)
        if (words.isNotEmpty() || (state.submitted == null && history.isNotEmpty())) {
            item(key = "words", span = { GridItemSpan(maxLineSpan) }) {
                LazyRow(
                    Modifier.fillMaxWidth().focusRestorer(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (words.isNotEmpty()) {
                        items(words, key = { "s-$it" }) { word ->
                            TvButton(word, onClick = { search(word) }, icon = Icons.Default.Search, modifier = Modifier.tvFocusItem("s-$word"))
                        }
                    } else {
                        items(history, key = { "h-$it" }) { word ->
                            TvButton(word, onClick = { search(word) }, icon = Icons.Default.History, modifier = Modifier.tvFocusItem("h-$word"))
                        }
                    }
                }
            }
        }
        state.submitted?.let { query ->
            item(key = "results-title", span = { GridItemSpan(maxLineSpan) }) {
                Text("Kết quả cho \"$query\"", style = MaterialTheme.typography.titleLarge, color = Color.White,
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))
            }
        }
    }

    val results = state.results
    if (results != null) {
        TvFeedGrid(results, emptyTitle = "Không tìm thấy kết quả", header = header)
    } else {
        // Nothing searched yet: just the box, suggestions and history.
        val empty = remember { FeedModel { com.dangdvd.dvdtube.core.FeedPage.EMPTY } }
        TvFeedGrid(empty, emptyTitle = "Nhập nội dung cần tìm hoặc bấm micro để nói", header = header)
    }
    LaunchedEffect(Unit) {
        if (!editing) {
            delay(200)
            runCatching { boxFocus.requestFocus() }
        }
    }
}
