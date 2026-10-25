package com.dangdvd.dvdtube.core

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.core.storage.HiddenContentStore
import com.dangdvd.dvdtube.core.storage.WatchTimeStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.ShortsPlayer
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Calendar
import java.util.Locale

/**
 * "Kiểm soát của phụ huynh": a 4-digit PIN (salted SHA-256) protects restricted mode, a daily
 * watch-time limit, allowed hours, blocked keywords / channels and a few switches. There is no
 * account recovery: "Quên mã PIN" resets every parental setting.
 */
object ParentalControls {
    enum class LockReason(val title: String, val message: String) {
        DAILY_LIMIT("Đã hết thời gian xem hôm nay", "Đã dùng hết thời gian xem cho phép hôm nay."),
        OUTSIDE_WINDOW("Ngoài khung giờ được xem", "Bây giờ không nằm trong khung giờ được xem."),
    }

    /** Something waiting for the PIN (opening the settings, signing out…). */
    class PinRequest(val title: String, val action: () -> Unit)

    /** Shown full screen over the app while set. */
    var lockReason by mutableStateOf<LockReason?>(null)
        private set
    var pinRequest by mutableStateOf<PinRequest?>(null)
        private set
    /** The parental settings stay open without the PIN for a few minutes after it was entered. */
    private var unlockedUntil by mutableStateOf(0L)
    private var started = false

    val isEnabled: Boolean get() = AppSettings.parentalEnabled && AppSettings.parentalPinHash.isNotEmpty()
    val restrictedModeActive: Boolean get() = isEnabled && AppSettings.parentalRestricted
    val hidesComments: Boolean get() = isEnabled && AppSettings.parentalHideComments
    val hidesShorts: Boolean get() = isEnabled && AppSettings.parentalHideShorts
    val searchDisabled: Boolean get() = isEnabled && AppSettings.parentalNoSearch
    val settingsUnlocked: Boolean get() = !isEnabled || System.currentTimeMillis() < unlockedUntil

    // MARK: PIN

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    fun isValidPin(pin: String): Boolean = pin.length == 4 && pin.all { it in '0'..'9' }

    fun checkPin(pin: String): Boolean {
        val stored = AppSettings.parentalPinHash
        if (stored.isEmpty() || !isValidPin(pin)) return false
        return MessageDigest.isEqual(sha256(AppSettings.parentalPinSalt + pin).toByteArray(), stored.toByteArray())
    }

    private fun setPin(pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        AppSettings.parentalPinSalt = salt
        AppSettings.parentalPinHash = sha256(salt + pin)
    }

    /** First activation (or a new PIN). */
    fun enable(pin: String) {
        setPin(pin)
        AppSettings.parentalEnabled = true
        unlockedUntil = System.currentTimeMillis() + 5 * 60_000L
        Log.debug("parental controls: on")
    }

    fun changePin(pin: String) = setPin(pin)

    fun disable() {
        AppSettings.parentalEnabled = false
        lockReason = null
        Log.debug("parental controls: off")
    }

    /** "Quên mã PIN": everything back to defaults. */
    fun resetAll() {
        AppSettings.parentalEnabled = false
        AppSettings.parentalPinHash = ""
        AppSettings.parentalPinSalt = ""
        AppSettings.parentalRestricted = true
        AppSettings.parentalDailyLimit = 0
        AppSettings.parentalWindowEnabled = false
        AppSettings.parentalWindowStart = 7 * 60
        AppSettings.parentalWindowEnd = 21 * 60
        AppSettings.parentalKeywords = ""
        AppSettings.parentalHideComments = false
        AppSettings.parentalHideShorts = false
        AppSettings.parentalNoSearch = false
        AppSettings.parentalOverrideUntil = 0L
        lockReason = null
        unlockedUntil = 0L
        Log.debug("parental controls: reset")
    }

    fun lockSettings() {
        unlockedUntil = 0L
    }

    /** Runs [action] at once, or after the right PIN when parental controls are on. */
    fun guard(title: String, action: () -> Unit) {
        if (settingsUnlocked) action() else pinRequest = PinRequest(title, action)
    }

    /** True when the PIN was right (the waiting action then runs). */
    fun submitPin(pin: String): Boolean {
        if (!checkPin(pin)) return false
        unlockedUntil = System.currentTimeMillis() + 5 * 60_000L
        val request = pinRequest
        pinRequest = null
        request?.action?.invoke()
        return true
    }

    fun cancelPin() {
        pinRequest = null
    }

    // MARK: Content filter

    /** Lower case without diacritics ("Đá Bóng" → "da bong"). */
    fun normalize(text: String): String =
        Normalizer.normalize(text.lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .replace('đ', 'd')

    @Volatile private var keywordCache: Pair<String, List<String>> = "" to emptyList()

    private val keywords: List<String>
        get() {
            val raw = AppSettings.parentalKeywords
            val cached = keywordCache
            if (cached.first == raw) return cached.second
            val parsed = raw.split(',', '\n', ';').map { normalize(it).trim() }.filter { it.isNotEmpty() }.distinct()
            keywordCache = raw to parsed
            return parsed
        }

    fun allows(video: VideoItem): Boolean {
        if (!isEnabled) return true
        if (AppSettings.parentalHideShorts && video.isShort) return false
        if (HiddenContentStore.isChannelHidden(video.channelId)) return false
        val words = keywords
        if (words.isEmpty()) return true
        val haystack = normalize(video.title) + "\n" + normalize(video.channelName.orEmpty())
        return words.none { haystack.contains(it) }
    }

    fun allows(channel: ChannelItem): Boolean {
        if (!isEnabled) return true
        if (HiddenContentStore.isChannelHidden(channel.id)) return false
        val words = keywords
        if (words.isEmpty()) return true
        val name = normalize(channel.name)
        return words.none { name.contains(it) }
    }

    fun allows(playlist: PlaylistItem): Boolean {
        if (!isEnabled) return true
        val words = keywords
        if (words.isEmpty()) return true
        val text = normalize(playlist.title) + "\n" + normalize(playlist.channelName.orEmpty())
        return words.none { text.contains(it) }
    }

    /** Leaves out blocked videos, channels and (when hidden) Shorts from any feed. */
    fun filter(items: List<FeedItem>): List<FeedItem> {
        if (!isEnabled) return items
        return items.mapNotNull { item ->
            when (item) {
                is FeedItem.Video -> if (allows(item.video)) item else null
                is FeedItem.Channel -> if (allows(item.channel)) item else null
                is FeedItem.Playlist -> if (allows(item.playlist)) item else null
                is FeedItem.Shorts -> {
                    if (AppSettings.parentalHideShorts) null
                    else item.items.filter(::allows).takeIf { it.isNotEmpty() }?.let { FeedItem.Shorts(it) }
                }
            }
        }
    }

    fun filterVideos(videos: List<VideoItem>): List<VideoItem> = if (!isEnabled) videos else videos.filter(::allows)

    // MARK: Watch time

    private fun minuteOfDay(time: Long): Int {
        val calendar = Calendar.getInstance().apply { timeInMillis = time }
        return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    }

    fun isInWindow(time: Long = System.currentTimeMillis()): Boolean {
        val start = AppSettings.parentalWindowStart
        val end = AppSettings.parentalWindowEnd
        if (start == end) return true
        val minute = minuteOfDay(time)
        return if (start < end) minute in start until end else minute >= start || minute < end
    }

    /** Why watching is not allowed right now, if it isn't. */
    fun currentRestriction(now: Long = System.currentTimeMillis()): LockReason? {
        if (!isEnabled) return null
        if (now < AppSettings.parentalOverrideUntil) return null
        if (AppSettings.parentalWindowEnabled && !isInWindow(now)) return LockReason.OUTSIDE_WINDOW
        val limit = AppSettings.parentalDailyLimit
        if (limit > 0 && WatchTimeStore.seconds(0) >= limit * 60.0) return LockReason.DAILY_LIMIT
        return null
    }

    /** Seconds of watching left today (null without a limit). */
    val remainingSeconds: Int?
        get() {
            val limit = AppSettings.parentalDailyLimit
            if (!isEnabled || limit <= 0) return null
            return (limit * 60 - WatchTimeStore.seconds(0)).toInt().coerceAtLeast(0)
        }

    /** Checked before playback starts: false (and the lock appears) when watching isn't allowed now. */
    fun canPlay(): Boolean {
        val reason = currentRestriction() ?: return true
        lockReason = reason
        return false
    }

    /** After the PIN on the lock screen: +[minutes], or the rest of today when null. */
    fun extend(minutes: Int?) {
        val now = System.currentTimeMillis()
        AppSettings.parentalOverrideUntil = if (minutes == null) {
            Calendar.getInstance().apply {
                timeInMillis = now
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
        } else {
            maxOf(now, AppSettings.parentalOverrideUntil) + minutes * 60_000L
        }
        lockReason = null
    }

    /** Hides the lock screen (playback stays blocked until the PIN extends the time). */
    fun dismissLock() {
        lockReason = null
    }

    /** Pauses everything once the limit is reached or the allowed hours end. */
    fun startMonitor() {
        if (started) return
        started = true
        AppScope.launch {
            while (isActive) {
                delay(1000)
                runCatching { tick() }
            }
        }
    }

    private fun tick() {
        if (!isEnabled) {
            if (lockReason != null) lockReason = null
            return
        }
        val shorts = ShortsPlayer.isPlaying
        // Shorts count towards the daily limit too (regular playback is counted by the player).
        if (shorts && !PlayerController.isPlaying) WatchTimeStore.add(1.0)
        if (AppSettings.parentalDailyLimit <= 0 && !AppSettings.parentalWindowEnabled) return
        val reason = currentRestriction() ?: return
        if (PlayerController.isPlaying || shorts) {
            PlayerController.pause()
            ShortsPlayer.pause()
            lockReason = reason
            Log.debug("parental controls: playback stopped (${reason.name})")
        }
    }
}
