package com.dangdvd.dvdtube.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.PlaylistItem
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.ShortsPlayer
import java.util.UUID

enum class AppTab { HOME, SHORTS, SUBSCRIPTIONS, LIBRARY }

/** Screens pushed onto a tab. Every instance has its own key (its models live under it). */
sealed class Route {
    val key: String = UUID.randomUUID().toString()

    class Search : Route()
    class SearchResults(val query: String) : Route()
    class Channel(val channel: ChannelItem) : Route()
    class Playlist(val playlist: PlaylistItem) : Route()
    class LocalPlaylist(val id: String) : Route()
    class History : Route()
    class WatchLater : Route()
    class Liked : Route()
    class Downloads : Route()
    class SubscriptionsManager : Route()
    class AccountFeed(val title: String, val browseId: String) : Route()
    class Notifications : Route()
    class Settings : Route()
    class Diagnostics : Route()
    class WatchTime : Route()
    class HiddenContent : Route()
    class Equalizer : Route()
}

/**
 * Navigation state for every tab, so the watch page can push a channel or playlist onto
 * whichever tab is visible (the same way the official app behaves).
 */
object Router {
    var selectedTab by mutableStateOf(AppTab.HOME)
        private set
    private val stacks = AppTab.entries.associateWith { mutableStateListOf<Route>() }
    /** Screen models kept while their screen is on a stack (survive pushing another screen). */
    private val models = HashMap<String, Any>()
    /** Bumped when the user taps the already-selected tab (scroll to top). */
    val reselectCounter = mutableStateMapOf<AppTab, Int>()

    /** Video for which the "save to playlist" sheet is shown. */
    var playlistSheetVideo by mutableStateOf<VideoItem?>(null)
    var showSignIn by mutableStateOf(false)
    /** The sign-in screen adds another Google account instead of replacing the session. */
    var signInAddsAccount by mutableStateOf(false)
    var showAccountSwitcher by mutableStateOf(false)
    var showUpload by mutableStateOf(false)
    /** A TV's "sign in from the phone" QR code was opened: confirm before sending the session. */
    var tvLoginInvite by mutableStateOf<com.dangdvd.dvdtube.core.TvLogin.Invite?>(null)

    /** Shorts tapped somewhere else (search, home shelf, channel) to open in the Shorts tab. */
    var pendingShorts by mutableStateOf<Pair<List<VideoItem>, String>?>(null)
        private set

    fun stack(tab: AppTab): SnapshotStateList<Route> = stacks.getValue(tab)

    fun select(tab: AppTab) {
        if (tab == selectedTab) {
            val stack = stack(tab)
            if (stack.isEmpty()) reselectCounter[tab] = (reselectCounter[tab] ?: 0) + 1 else popToRoot(tab)
            return
        }
        if (tab != AppTab.SHORTS) ShortsPlayer.pause() else PlayerController.isExpanded = false
        selectedTab = tab
    }

    fun open(route: Route) {
        PlayerController.isExpanded = false
        if (selectedTab == AppTab.SHORTS) selectedTab = AppTab.HOME
        stack(selectedTab).add(route)
    }

    fun openChannel(id: String, name: String = "", avatar: String? = null) =
        open(Route.Channel(ChannelItem(id = id, name = name, avatar = avatar)))

    fun openShorts(items: List<VideoItem>, start: VideoItem) {
        PlayerController.isExpanded = false
        PlayerController.pause()
        pendingShorts = items to start.id
        selectedTab = AppTab.SHORTS
    }

    fun consumePendingShorts(): Pair<List<VideoItem>, String>? = pendingShorts.also { pendingShorts = null }

    /** Pops the visible tab's top screen. Returns false when there is nothing to pop. */
    fun back(): Boolean {
        val stack = stack(selectedTab)
        val removed = stack.removeLastOrNull() ?: return false
        models.remove(removed.key)
        return true
    }

    private fun popToRoot(tab: AppTab) {
        val stack = stack(tab)
        stack.forEach { models.remove(it.key) }
        stack.clear()
    }

    fun signIn(addingAccount: Boolean = false) {
        signInAddsAccount = addingAccount
        showSignIn = true
    }

    @Suppress("UNCHECKED_CAST")
    fun <T : Any> model(key: String, create: () -> T): T = models.getOrPut(key, create) as T
}

/** A screen model that survives while its screen stays on the navigation stack. */
@Composable
fun <T : Any> rememberRouteModel(key: String, create: () -> T): T = remember(key) { Router.model(key, create) }
