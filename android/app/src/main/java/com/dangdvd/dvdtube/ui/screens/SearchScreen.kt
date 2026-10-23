package com.dangdvd.dvdtube.ui.screens

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.NorthWest
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.services.SearchFilter
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Route
import com.dangdvd.dvdtube.ui.Router
import com.dangdvd.dvdtube.ui.components.FeedModel
import com.dangdvd.dvdtube.ui.components.pagedFeed
import com.dangdvd.dvdtube.ui.rememberRouteModel
import kotlinx.coroutines.delay

private fun submitSearch(query: String) {
    val text = query.trim()
    if (text.isEmpty()) return
    // A pasted YouTube link opens the video directly.
    YouTubeService.videoId(text)?.let { id ->
        Router.back()
        PlayerController.play(com.dangdvd.dvdtube.core.VideoItem(id = id))
        return
    }
    LibraryStore.addSearch(text)
    Router.back()
    Router.open(Route.SearchResults(text))
}

/** Voice search through the system speech recognizer. */
@Composable
fun rememberVoiceSearch(onResult: (String) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let(onResult)
    }
    return {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (AppSettings.language == "vi") "vi-VN" else AppSettings.language)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Hãy nói nội dung cần tìm")
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            Toasts.show("Máy chưa có dịch vụ nhận dạng giọng nói")
        }
    }
}

@Composable
fun SearchScreen(route: Route.Search, initial: String = "") {
    var query by rememberSaveable { mutableStateOf(initial) }
    var suggestions by remember { mutableStateOf(listOf<String>()) }
    val focus = remember { FocusRequester() }
    val voice = rememberVoiceSearch { submitSearch(it) }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        if (query.isBlank()) {
            suggestions = emptyList()
            return@LaunchedEffect
        }
        delay(200)
        suggestions = runCatching { YouTubeService.suggestions(query) }.getOrDefault(emptyList())
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = { Router.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại") } },
                title = {
                    TextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("Tìm kiếm trên YouTube") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { submitSearch(query) }),
                        trailingIcon = {
                            if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Default.Close, "Xóa") }
                        },
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                        ),
                        shape = RoundedCornerShape(24.dp),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                },
                actions = { IconButton(onClick = voice) { Icon(Icons.Default.Mic, "Tìm bằng giọng nói") } },
            )
        },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            val history = LibraryStore.searchHistory.filter { query.isBlank() || it.contains(query, ignoreCase = true) }.take(if (query.isBlank()) 20 else 4)
            items(history, key = { "h-$it" }) { item ->
                SuggestionRow(item, isHistory = true, onFill = { query = "$item " }, onRemove = { LibraryStore.removeSearch(item) }) { submitSearch(item) }
            }
            items(suggestions.filter { it !in history }, key = { "s-$it" }) { item ->
                SuggestionRow(item, isHistory = false, onFill = { query = "$item " }, onRemove = null) { submitSearch(item) }
            }
            if (query.isBlank() && LibraryStore.searchHistory.isNotEmpty()) {
                item {
                    TextButton(onClick = { LibraryStore.clearSearchHistory() }, modifier = Modifier.padding(8.dp)) { Text("Xóa lịch sử tìm kiếm") }
                }
            }
        }
    }
}

@Composable
private fun SuggestionRow(text: String, isHistory: Boolean, onFill: () -> Unit, onRemove: (() -> Unit)?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(if (isHistory) Icons.Default.History else Icons.Default.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(16.dp))
        Text(text, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
        if (onRemove != null) IconButton(onClick = onRemove) { Icon(Icons.Default.Close, "Xóa", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        IconButton(onClick = onFill) { Icon(Icons.Default.NorthWest, "Điền", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

class SearchResultsState(val query: String) {
    var filter by mutableStateOf(SearchFilter.ALL)
    val models = mutableStateMapOf<SearchFilter, FeedModel>()
    fun model(filter: SearchFilter): FeedModel = models.getOrPut(filter) { FeedModel { YouTubeService.search(query, filter) } }
}

@Composable
fun SearchResultsScreen(route: Route.SearchResults) {
    val state = rememberRouteModel(route.key) { SearchResultsState(route.query) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val voice = rememberVoiceSearch { text ->
        LibraryStore.addSearch(text)
        Router.back()
        Router.open(Route.SearchResults(text))
    }
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = { Router.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại") } },
                title = {
                    Text(
                        route.query, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(24.dp))
                            .clickable { Router.open(Route.Search()) }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    )
                },
                actions = { IconButton(onClick = voice) { Icon(Icons.Default.Mic, "Tìm bằng giọng nói") } },
            )
        },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), state = listState) {
            item(key = "filters") {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(SearchFilter.entries) { filter ->
                        FilterChip(selected = state.filter == filter, onClick = { state.filter = filter }, label = { Text(filter.title) })
                    }
                }
            }
            pagedFeed(state.model(state.filter), scope, compact = true, emptyTitle = "Không tìm thấy kết quả")
        }
    }
}
