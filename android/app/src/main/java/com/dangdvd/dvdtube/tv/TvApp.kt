package com.dangdvd.dvdtube.tv

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SlowMotionVideo
import androidx.compose.material.icons.filled.Subscriptions
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.ShortsPlayer
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.Brand
import java.util.UUID

/** Sections of the side menu. */
enum class TvSection(val title: String, val icon: ImageVector) {
    SEARCH("Tìm kiếm", Icons.Default.Search),
    HOME("Trang chủ", Icons.Default.Home),
    SHORTS("Shorts", Icons.Default.SlowMotionVideo),
    SUBSCRIPTIONS("Kênh đăng ký", Icons.Default.Subscriptions),
    LIBRARY("Thư viện", Icons.Default.VideoLibrary),
    ACCOUNT("Tài khoản", Icons.Default.AccountCircle),
    SETTINGS("Cài đặt", Icons.Default.Settings),
}

/** Screens opened on top of a section. */
sealed class TvRoute {
    val key: String = UUID.randomUUID().toString()

    class Player : TvRoute()
    class Channel(val channel: ChannelItem) : TvRoute()
    class Playlist(val playlist: PlaylistItem) : TvRoute()
    class LocalPlaylist(val id: String) : TvRoute()
    class AccountFeed(val title: String, val browseId: String) : TvRoute()
    class SearchResults(val query: String) : TvRoute()
    class Pairing : TvRoute()
    class WebSignIn : TvRoute()

    /** Shown without the side menu. */
    val isFullscreen: Boolean get() = this is Player || this is WebSignIn
}

/** Navigation of the TV interface: one section plus a stack of screens on top of it. */
object TvNav {
    var section by mutableStateOf(TvSection.HOME)
        private set
    val stack = mutableStateListOf<TvRoute>()
    private val models = HashMap<String, Any>()

    /** Shorts opened from a card, for the Shorts section to start with. */
    var pendingShorts: Pair<List<VideoItem>, String>? = null
        private set

    val screenKey: String get() = stack.lastOrNull()?.key ?: "section-${section.name}"

    fun select(target: TvSection) {
        stack.toList().forEach { models.remove(it.key); TvFocusMemory.forget(it.key) }
        stack.clear()
        if (target != TvSection.SHORTS) ShortsPlayer.pause()
        section = target
    }

    fun open(route: TvRoute) {
        if (route !is TvRoute.Player) ShortsPlayer.pause()
        stack.add(route)
    }

    /** Pops the top screen; the screen below gets its focus back. */
    fun back(): Boolean {
        val removed = stack.removeLastOrNull() ?: return false
        models.remove(removed.key)
        TvFocusMemory.forget(removed.key)
        TvFocusMemory.requestRestore(screenKey)
        return true
    }

    fun openChannel(channel: ChannelItem) = open(TvRoute.Channel(channel))

    fun openChannel(id: String, name: String = "") = openChannel(ChannelItem(id = id, name = name))

    /** Plays a video full screen (Shorts go to the Shorts player). */
    fun play(video: VideoItem, queue: List<VideoItem>? = null) {
        if (video.isShort) {
            openShorts(queue?.filter { it.isShort }?.ifEmpty { null } ?: listOf(video), video)
            return
        }
        ShortsPlayer.pause()
        val list = queue?.filter { !it.isShort }?.takeIf { list -> list.any { it.id == video.id } }
        PlayerController.play(video, list)
        if (stack.lastOrNull() !is TvRoute.Player) stack.add(TvRoute.Player())
    }

    /** Leaves the player and stops playback (TV convention: nothing keeps playing behind the menu). */
    fun closePlayer() {
        PlayerController.close()
        if (stack.lastOrNull() is TvRoute.Player) back()
    }

    fun openShorts(items: List<VideoItem>, start: VideoItem) {
        PlayerController.pause()
        pendingShorts = items.map { it.copy(isShort = true) } to start.id
        select(TvSection.SHORTS)
    }

    fun consumePendingShorts(): Pair<List<VideoItem>, String>? = pendingShorts.also { pendingShorts = null }

    @Suppress("UNCHECKED_CAST")
    fun <T : Any> model(key: String, create: () -> T): T = models.getOrPut(key, create) as T
}

/** Root of the TV interface. */
@Composable
fun TvApp() {
    TvTheme {
        val top = TvNav.stack.lastOrNull()
        val stateHolder = rememberSaveableStateHolder()
        val context = LocalContext.current
        var navHasFocus by remember { mutableStateOf(false) }
        val sectionFocus = remember { TvSection.entries.associateWith { FocusRequester() } }

        BackHandler {
            when {
                TvNav.stack.isNotEmpty() -> TvNav.back()
                !navHasFocus -> runCatching { sectionFocus.getValue(TvNav.section).requestFocus() }
                TvNav.section != TvSection.HOME -> TvNav.select(TvSection.HOME)
                else -> (context as? Activity)?.finish()
            }
        }

        Box(Modifier.fillMaxSize().background(TvColors.background)) {
            val screenKey = TvNav.screenKey
            if (top != null && top.isFullscreen) {
                stateHolder.SaveableStateProvider(screenKey) {
                    CompositionLocalProvider(LocalTvScreen provides screenKey) { RouteScreen(top) }
                }
            } else {
                Row(Modifier.fillMaxSize()) {
                    SideMenu(sectionFocus, onFocusChanged = { navHasFocus = it })
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        stateHolder.SaveableStateProvider(screenKey) {
                            CompositionLocalProvider(LocalTvScreen provides screenKey) {
                                if (top == null) SectionScreen(TvNav.section) else RouteScreen(top)
                            }
                        }
                    }
                }
            }

            Toasts.message?.let { message ->
                Text(
                    message,
                    color = TvColors.onFocused,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 36.dp, start = 120.dp, end = 120.dp)
                        .background(TvColors.focused, RoundedCornerShape(10.dp))
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun SectionScreen(section: TvSection) {
    when (section) {
        TvSection.SEARCH -> TvSearchScreen()
        TvSection.HOME -> TvHomeScreen()
        TvSection.SHORTS -> TvShortsScreen()
        TvSection.SUBSCRIPTIONS -> TvSubscriptionsScreen()
        TvSection.LIBRARY -> TvLibraryScreen()
        TvSection.ACCOUNT -> TvAccountScreen()
        TvSection.SETTINGS -> TvSettingsScreen()
    }
}

@Composable
private fun RouteScreen(route: TvRoute) {
    when (route) {
        is TvRoute.Player -> TvPlayerScreen()
        is TvRoute.Channel -> TvChannelScreen(route)
        is TvRoute.Playlist -> TvPlaylistScreen(route)
        is TvRoute.LocalPlaylist -> TvLocalPlaylistScreen(route)
        is TvRoute.AccountFeed -> TvAccountFeedScreen(route)
        is TvRoute.SearchResults -> TvSearchResultsScreen(route)
        is TvRoute.Pairing -> TvPairingScreen()
        is TvRoute.WebSignIn -> TvWebSignInScreen()
    }
}

/** Icons on the left; it widens with labels while it has the focus. */
@Composable
private fun SideMenu(focus: Map<TvSection, FocusRequester>, onFocusChanged: (Boolean) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxHeight()
            .background(if (expanded) TvColors.surface else Color.Transparent)
            .animateContentSize()
            .width(if (expanded) 230.dp else 84.dp)
            .onFocusChanged {
                expanded = it.hasFocus
                onFocusChanged(it.hasFocus)
            }
            .focusRestorer()
            .padding(horizontal = 12.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val profile = AccountStore.profile
        TvSection.entries.forEach { section ->
            val selected = TvNav.section == section
            Surface(
                onClick = { TvNav.select(section) },
                modifier = Modifier.focusRequester(focus.getValue(section)),
                shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(50)),
                colors = ClickableSurfaceDefaults.colors(
                    containerColor = Color.Transparent,
                    contentColor = if (selected) Color.White else TvColors.secondaryText,
                    focusedContainerColor = TvColors.focused,
                    focusedContentColor = TvColors.onFocused,
                    pressedContainerColor = TvColors.focused,
                    pressedContentColor = TvColors.onFocused,
                ),
                scale = ClickableSurfaceDefaults.scale(focusedScale = 1.03f),
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (section == TvSection.ACCOUNT && AccountStore.isSignedIn && profile != null) {
                        TvAvatar(profile.avatar, 28.dp, profile.name)
                    } else {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(section.icon, section.title, Modifier.size(28.dp))
                        }
                    }
                    if (expanded) {
                        Spacer(Modifier.width(14.dp))
                        Text(section.title, style = MaterialTheme.typography.titleMedium,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                    }
                }
            }
            if (selected && !expanded) {
                Box(Modifier.padding(start = 26.dp).width(8.dp).height(3.dp).background(Brand, RoundedCornerShape(2.dp)))
            }
        }
    }
}
