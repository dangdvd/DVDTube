package com.dangdvd.dvdtube.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.SlowMotionVideo
import androidx.compose.material.icons.filled.Subscriptions
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.SlowMotionVideo
import androidx.compose.material.icons.outlined.Subscriptions
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.ui.account.AccountFeedScreen
import com.dangdvd.dvdtube.ui.account.AccountSwitcherSheet
import com.dangdvd.dvdtube.ui.account.NotificationsScreen
import com.dangdvd.dvdtube.ui.account.SignInDialog
import com.dangdvd.dvdtube.ui.account.TvLoginDialog
import com.dangdvd.dvdtube.ui.components.SaveToPlaylistSheet
import com.dangdvd.dvdtube.ui.player.MainWebPlayer
import com.dangdvd.dvdtube.ui.player.AmbientGlow
import com.dangdvd.dvdtube.ui.player.EqualizerScreen
import com.dangdvd.dvdtube.ui.player.MiniPlayer
import com.dangdvd.dvdtube.ui.player.PictureInPictureContent
import com.dangdvd.dvdtube.ui.player.PlayerBox
import com.dangdvd.dvdtube.ui.screens.ChannelScreen
import com.dangdvd.dvdtube.ui.screens.DiagnosticsScreen
import com.dangdvd.dvdtube.ui.screens.DownloadsScreen
import com.dangdvd.dvdtube.ui.screens.HistoryScreen
import com.dangdvd.dvdtube.ui.screens.HiddenContentScreen
import com.dangdvd.dvdtube.ui.screens.HomeScreen
import com.dangdvd.dvdtube.ui.screens.LibraryScreen
import com.dangdvd.dvdtube.ui.screens.LikedScreen
import com.dangdvd.dvdtube.ui.screens.LocalPlaylistScreen
import com.dangdvd.dvdtube.ui.screens.PlaylistScreen
import com.dangdvd.dvdtube.ui.screens.SearchResultsScreen
import com.dangdvd.dvdtube.ui.screens.SearchScreen
import com.dangdvd.dvdtube.ui.screens.SettingsScreen
import com.dangdvd.dvdtube.ui.screens.ShortsScreen
import com.dangdvd.dvdtube.ui.screens.SubscriptionsManagerScreen
import com.dangdvd.dvdtube.ui.screens.SubscriptionsScreen
import com.dangdvd.dvdtube.ui.screens.WatchLaterScreen
import com.dangdvd.dvdtube.ui.screens.WatchTimeScreen
import com.dangdvd.dvdtube.ui.screens.WellbeingReminderDialog
import com.dangdvd.dvdtube.ui.upload.UploadDialog
import com.dangdvd.dvdtube.ui.watch.WatchDetails

@Composable
fun MainScreen() {
    if (PlayerController.isInPictureInPicture) {
        PictureInPictureContent()
        return
    }
    val tab = Router.selectedTab
    val expanded = PlayerController.isExpanded && PlayerController.currentVideo != null
    val stateHolder = rememberSaveableStateHolder()
    val context = LocalContext.current

    BackHandler {
        when {
            PlayerController.isFullscreen -> PlayerController.isFullscreen = false
            expanded -> PlayerController.isExpanded = false
            Router.back() -> Unit
            tab != AppTab.HOME -> Router.select(AppTab.HOME)
            // Like the official app: leave without stopping what plays in the background.
            else -> (context as? Activity)?.moveTaskToBack(true)
        }
    }

    // Light status bar icons over the black player and the Shorts feed.
    val view = LocalView.current
    val dark = isDarkTheme()
    val lightBars = !dark && !expanded && tab != AppTab.SHORTS
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = lightBars
        WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !dark && tab != AppTab.SHORTS
    }

    // The embed only lives while it is the active player.
    LaunchedEffect(PlayerController.usesWebPlayer) {
        if (!PlayerController.usesWebPlayer) {
            PlayerController.registerWebView(null)
            MainWebPlayer.destroy()
        }
    }
    LaunchedEffect(AccountStore.isSignedIn) {
        if (AccountStore.isSignedIn) AccountStore.refreshNotificationCount()
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                val top = Router.stack(tab).lastOrNull()
                stateHolder.SaveableStateProvider(top?.key ?: "root-${tab.name}") {
                    if (top == null) TabRoot(tab) else RouteScreen(top)
                }
            }
            if (PlayerController.currentVideo != null && !expanded && tab != AppTab.SHORTS) MiniPlayer()
            BottomBar(tab)
        }

        AnimatedVisibility(
            visible = expanded,
            enter = slideInVertically { it },
            exit = slideOutVertically { it },
        ) { ExpandedPlayer() }

        Toasts.message?.let { message ->
            Text(
                message,
                color = MaterialTheme.colorScheme.inverseOnSurface,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(start = 24.dp, end = 24.dp, bottom = if (expanded) 32.dp else 140.dp)
                    .background(MaterialTheme.colorScheme.inverseSurface, RoundedCornerShape(8.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
    }

    Router.playlistSheetVideo?.let { video -> SaveToPlaylistSheet(video) { Router.playlistSheetVideo = null } }
    if (Router.showAccountSwitcher) AccountSwitcherSheet { Router.showAccountSwitcher = false }
    if (Router.showSignIn) SignInDialog(addingAccount = Router.signInAddsAccount) { Router.showSignIn = false }
    if (Router.showUpload) UploadDialog { Router.showUpload = false }
    Router.tvLoginInvite?.let { invite -> TvLoginDialog(invite) { Router.tvLoginInvite = null } }
    WellbeingReminderDialog()
}

@Composable
private fun ExpandedPlayer() {
    // Swallows touches so nothing underneath reacts while the watch page is open.
    val blocker = Modifier.pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }
    if (PlayerController.isFullscreen) {
        Box(Modifier.fillMaxSize().background(Color.Black).then(blocker)) {
            // Clear of the camera cutout, which sits over the top of the video when upright.
            PlayerBox(Modifier.fillMaxSize().displayCutoutPadding(), fullscreen = true)
        }
    } else {
        val ambient = AppSettings.ambientMode && isDarkTheme()
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).then(blocker)) {
            Box(Modifier.fillMaxWidth().background(Color.Black).statusBarsPadding()) {
                PlayerBox(Modifier.fillMaxWidth().aspectRatio(16f / 9f), fullscreen = false)
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                // Ambient mode: the video's colours glow into the page below the player.
                if (ambient) AmbientGlow(Modifier.fillMaxWidth().height(110.dp))
                WatchDetails(Modifier.fillMaxSize().navigationBarsPadding())
            }
        }
    }
}

@Composable
private fun TabRoot(tab: AppTab) {
    when (tab) {
        AppTab.HOME -> HomeScreen()
        AppTab.SHORTS -> ShortsScreen()
        AppTab.SUBSCRIPTIONS -> SubscriptionsScreen()
        AppTab.LIBRARY -> LibraryScreen()
    }
}

@Composable
private fun RouteScreen(route: Route) {
    when (route) {
        is Route.Search -> SearchScreen(route)
        is Route.SearchResults -> SearchResultsScreen(route)
        is Route.Channel -> ChannelScreen(route)
        is Route.Playlist -> PlaylistScreen(route)
        is Route.LocalPlaylist -> LocalPlaylistScreen(route)
        is Route.History -> HistoryScreen()
        is Route.WatchLater -> WatchLaterScreen(route)
        is Route.Liked -> LikedScreen(route)
        is Route.Downloads -> DownloadsScreen()
        is Route.SubscriptionsManager -> SubscriptionsManagerScreen()
        is Route.AccountFeed -> AccountFeedScreen(route)
        is Route.Notifications -> NotificationsScreen()
        is Route.Settings -> SettingsScreen()
        is Route.Diagnostics -> DiagnosticsScreen()
        is Route.WatchTime -> WatchTimeScreen()
        is Route.HiddenContent -> HiddenContentScreen()
        is Route.Equalizer -> EqualizerScreen()
    }
}

@Composable
private fun BottomBar(selected: AppTab) {
    val shorts = selected == AppTab.SHORTS
    val colors = if (shorts) {
        NavigationBarItemDefaults.colors(
            selectedIconColor = Color.White, selectedTextColor = Color.White, indicatorColor = Color.White.copy(alpha = 0.15f),
            unselectedIconColor = Color.White.copy(alpha = 0.7f), unselectedTextColor = Color.White.copy(alpha = 0.7f),
        )
    } else {
        NavigationBarItemDefaults.colors()
    }
    NavigationBar(containerColor = if (shorts) Color.Black else MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
        TabItem(AppTab.HOME, selected, "Trang chủ", Icons.Filled.Home, Icons.Outlined.Home, colors)
        TabItem(AppTab.SHORTS, selected, "Shorts", Icons.Filled.SlowMotionVideo, Icons.Outlined.SlowMotionVideo, colors)
        TabItem(AppTab.SUBSCRIPTIONS, selected, "Kênh đăng ký", Icons.Filled.Subscriptions, Icons.Outlined.Subscriptions, colors)
        TabItem(AppTab.LIBRARY, selected, "Bạn", Icons.Filled.VideoLibrary, Icons.Outlined.VideoLibrary, colors,
            badge = DownloadManager.activeCount)
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(
    tab: AppTab,
    selected: AppTab,
    label: String,
    filled: ImageVector,
    outlined: ImageVector,
    colors: androidx.compose.material3.NavigationBarItemColors,
    badge: Int = 0,
) {
    NavigationBarItem(
        selected = tab == selected,
        onClick = { Router.select(tab) },
        icon = {
            BadgedBox(badge = { if (badge > 0) Badge { Text("$badge") } }) {
                Icon(if (tab == selected) filled else outlined, label)
            }
        },
        label = { Text(label, maxLines = 1) },
        colors = colors,
    )
}
