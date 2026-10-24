package com.dangdvd.dvdtube.core.storage

import android.webkit.CookieManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.AccountIdentity
import com.dangdvd.dvdtube.core.AccountProfile
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.AuthSession
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/**
 * Signed-in Google/YouTube account: profile, subscriptions and the actions that are written
 * back to YouTube (subscribe, like, watch later, watch history).
 */
object AccountStore {
    private val json = Json { ignoreUnknownKeys = true }
    private const val PROFILE_KEY = "account.profile"

    var isSignedIn by mutableStateOf(false)
        private set
    var profile by mutableStateOf<AccountProfile?>(null)
        private set
    var subscribedChannels by mutableStateOf(listOf<ChannelItem>())
        private set
    var isRefreshing by mutableStateOf(false)
        private set
    var lastError by mutableStateOf<String?>(null)
        private set
    var unseenNotifications by mutableStateOf(0)
        private set
    var identities by mutableStateOf(listOf<AccountIdentity>())
        private set
    /** Changes whenever requests start running as a different account or channel. */
    var sessionKey by mutableStateOf("signed-out")
        private set

    /** Changes made in this session that win over the possibly stale lists. */
    private var subscriptionState by mutableStateOf(mapOf<String, Boolean>())
    /** "LIKE", "DISLIKE" or "INDIFFERENT" per video, set in this session. */
    private var ratingState by mutableStateOf(mapOf<String, String>())
    private var watchLaterState by mutableStateOf(mapOf<String, Boolean>())
    private val reportedWatched = HashSet<String>()

    fun init() {
        isSignedIn = AuthSession.isAuthenticated
        sessionKey = makeSessionKey(isSignedIn)
        if (isSignedIn) {
            profile = AppSettings.store.getString(PROFILE_KEY, null)
                ?.let { runCatching { json.decodeFromString(AccountProfile.serializer(), it) }.getOrNull() }
            AppScope.launch { refresh() }
        }
    }

    // MARK: Sign in / out

    /**
     * Validates the cookies with YouTube and stores them. Returns an error message on failure.
     * `addingAccount`: the cookies now also hold another Google account; switch to it.
     */
    suspend fun completeSignIn(cookies: Map<String, String>, fromWebLogin: Boolean, addingAccount: Boolean = false): String? {
        if (!AuthSession.hasAuthCookies(cookies)) return "Không tìm thấy cookie đăng nhập YouTube (cần LOGIN_INFO và SAPISID)."
        val previousCookies = AuthSession.cookieList
        val previousIdentity = AuthSession.currentIdentity
        AuthSession.replace(cookies)
        if (!addingAccount) AuthSession.currentIdentity = AuthSession.Identity()
        return try {
            val profile = YouTubeService.accountProfile()
                ?: return rollback(addingAccount, previousCookies, previousIdentity, "YouTube không chấp nhận phiên đăng nhập này. Hãy thử đăng nhập lại.")
            this.profile = profile
            saveProfile()
            isSignedIn = true
            lastError = null
            if (!fromWebLogin) installInWebView(cookies)
            if (addingAccount) {
                loadIdentities()
                // The account added last gets the highest index.
                val added = identities.filter { !it.isBrandAccount }.maxByOrNull { it.authUser }
                if (added != null && added.authUser != AuthSession.currentIdentity.authUser) {
                    switchTo(added)
                    return null
                }
            }
            resetAccountState()
            AppScope.launch { refreshSubscriptions() }
            AppScope.launch { loadIdentities() }
            null
        } catch (error: Exception) {
            rollback(addingAccount, previousCookies, previousIdentity, error.message ?: "Lỗi đăng nhập")
        }
    }

    private fun rollback(adding: Boolean, cookies: Map<String, String>, identity: AuthSession.Identity, message: String): String {
        if (adding && AuthSession.hasAuthCookies(cookies)) {
            // Keep the account that was already signed in.
            AuthSession.replace(cookies)
            AuthSession.currentIdentity = identity
        } else {
            AuthSession.clear()
        }
        return message
    }

    fun signOut() {
        AuthSession.clear()
        isSignedIn = false
        profile = null
        identities = emptyList()
        resetAccountState()
        AppSettings.store.edit().remove(PROFILE_KEY).apply()
        CookieManager.getInstance().removeAllCookies(null)
    }

    suspend fun refresh() {
        if (!isSignedIn || isRefreshing) return
        isRefreshing = true
        try {
            val fresh = runCatching { YouTubeService.accountProfile() }
            fresh.onSuccess { value ->
                if (value != null) {
                    profile = value
                    saveProfile()
                    lastError = null
                } else {
                    lastError = "Phiên đăng nhập có thể đã hết hạn. Hãy đăng nhập lại nếu nội dung tài khoản không hiện."
                }
            }.onFailure { lastError = it.message }
            refreshSubscriptions()
            refreshNotificationCount()
            if (identities.isEmpty()) loadIdentities()
        } finally {
            isRefreshing = false
        }
    }

    suspend fun refreshNotificationCount() {
        if (!isSignedIn) return
        runCatching { InnerTube.unseenNotificationCount() }.onSuccess { unseenNotifications = it }
    }

    fun markNotificationsSeen() {
        unseenNotifications = 0
    }

    suspend fun refreshSubscriptions() {
        if (!isSignedIn) return
        runCatching { YouTubeService.accountSubscriptions() }.onSuccess { subscribedChannels = it }
    }

    private fun saveProfile() {
        val value = profile ?: return
        AppSettings.store.edit().putString(PROFILE_KEY, json.encodeToString(AccountProfile.serializer(), value)).apply()
    }

    // MARK: Accounts & brand channels

    suspend fun loadIdentities() {
        if (!isSignedIn) return
        try {
            val current = AuthSession.currentIdentity
            var list = YouTubeService.accountIdentities()
            // Mark the identity requests actually run as (YouTube's own flag follows authuser 0).
            if (list.any { it.authUser == current.authUser && it.pageId == current.pageId }) {
                list = list.map { it.copy(isSelected = it.authUser == current.authUser && it.pageId == current.pageId) }
            }
            identities = list
        } catch (error: Exception) {
            Log.debug("account identities failed: ${error.message}")
        }
    }

    /** Runs every following request as another Google account or brand channel. */
    suspend fun switchTo(identity: AccountIdentity) {
        AuthSession.currentIdentity = AuthSession.Identity(identity.authUser, identity.pageId)
        resetAccountState()
        identities = identities.map { it.copy(isSelected = it.id == identity.id) }
        profile = AccountProfile(identity.name, identity.byline, identity.email, identity.avatar)
        sessionKey = makeSessionKey(true)
        Toasts.show("Đã chuyển sang ${identity.name}")
        refresh()
        PlayerController.refreshWatchInfo()
    }

    private fun resetAccountState() {
        subscribedChannels = emptyList()
        subscriptionState = emptyMap()
        ratingState = emptyMap()
        watchLaterState = emptyMap()
        reportedWatched.clear()
        unseenNotifications = 0
        sessionKey = makeSessionKey(AuthSession.isAuthenticated)
    }

    private fun makeSessionKey(signedIn: Boolean): String {
        if (!signedIn) return "signed-out"
        val identity = AuthSession.currentIdentity
        return "u${identity.authUser}-${identity.pageId ?: "main"}"
    }

    // MARK: Subscriptions

    fun isSubscribed(channelId: String): Boolean =
        subscriptionState[channelId] ?: subscribedChannels.any { it.id == channelId }

    /** Records what the watch page reported, without calling YouTube. */
    fun noteSubscription(channelId: String, subscribed: Boolean) {
        if (!subscriptionState.containsKey(channelId)) subscriptionState = subscriptionState + (channelId to subscribed)
    }

    suspend fun setSubscribed(channel: ChannelItem, subscribed: Boolean) {
        val previous = isSubscribed(channel.id)
        subscriptionState = subscriptionState + (channel.id to subscribed)
        try {
            InnerTube.subscription(channel.id, subscribed)
            subscribedChannels = if (subscribed) {
                if (subscribedChannels.any { it.id == channel.id }) subscribedChannels else listOf(channel) + subscribedChannels
            } else {
                subscribedChannels.filter { it.id != channel.id }
            }
            Toasts.show(if (subscribed) "Đã đăng ký ${channel.name}" else "Đã hủy đăng ký")
        } catch (error: Exception) {
            subscriptionState = subscriptionState + (channel.id to previous)
            Toasts.show("Không cập nhật được đăng ký: ${error.message}")
        }
    }

    // MARK: Likes

    fun rating(videoId: String, reported: String?): String = ratingState[videoId] ?: reported ?: "INDIFFERENT"

    suspend fun setRating(videoId: String, rating: String) {
        val previous = ratingState[videoId]
        ratingState = ratingState + (videoId to rating)
        val action = when (rating) {
            "LIKE" -> "like"
            "DISLIKE" -> "dislike"
            else -> "removelike"
        }
        try {
            InnerTube.like(videoId, action)
        } catch (error: Exception) {
            ratingState = if (previous == null) ratingState - videoId else ratingState + (videoId to previous)
            Toasts.show("Không cập nhật được lượt thích")
        }
    }

    // MARK: Watch later

    fun isInWatchLater(videoId: String): Boolean = watchLaterState[videoId] ?: false

    suspend fun setWatchLater(video: VideoItem, add: Boolean) {
        watchLaterState = watchLaterState + (video.id to add)
        try {
            if (add) InnerTube.editPlaylist("WL", add = video.id) else InnerTube.editPlaylist("WL", remove = video.id)
            Toasts.show(if (add) "Đã lưu vào Xem sau" else "Đã xóa khỏi Xem sau")
        } catch (error: Exception) {
            watchLaterState = watchLaterState + (video.id to !add)
            Toasts.show("Không cập nhật được Xem sau")
        }
    }

    // MARK: Watch history

    /** Called once playback has really started; adds the video to the YouTube history. */
    fun reportWatched(videoId: String, duration: Double) {
        if (!isSignedIn || !AppSettings.syncWatchHistory || !AppSettings.saveHistory || AppSettings.isIncognito ||
            !reportedWatched.add(videoId)
        ) return
        AppScope.launch(Dispatchers.IO) { InnerTube.markWatched(videoId, duration) }
    }

    // MARK: WebView session (used by the web player fallback and YouTube Studio)

    suspend fun installInWebView(cookies: Map<String, String>) = withContext(Dispatchers.Main) {
        val manager = CookieManager.getInstance()
        for ((name, value) in cookies) {
            val attributes = if (name.startsWith("__Host-")) "; Path=/; Secure" else "; Domain=.youtube.com; Path=/; Secure"
            manager.setCookie("https://www.youtube.com", "$name=$value$attributes; Max-Age=31536000")
        }
        manager.flush()
    }
}
