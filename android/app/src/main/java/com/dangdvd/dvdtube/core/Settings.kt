package com.dangdvd.dvdtube.core

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

enum class VideoQuality(val height: Int) {
    AUTO(0), P1080(1080), P720(720), P480(480), P360(360), P240(240), P144(144);

    val title: String get() = if (this == AUTO) "Tự động" else "${height}p"

    /** Upper bound for track selection; `null` lets the player adapt freely. */
    val maxHeight: Int? get() = if (this == AUTO) null else height

    companion object {
        fun fromHeight(height: Int): VideoQuality = entries.firstOrNull { it.height == height } ?: AUTO
    }
}

/** Caption text size, like the official app's caption options. */
enum class CaptionSize(val title: String, val scale: Float) {
    SMALL("Nhỏ", 0.8f), NORMAL("Bình thường", 1f), LARGE("Lớn", 1.3f), EXTRA_LARGE("Rất lớn", 1.6f)
}

enum class AppTheme(val title: String) {
    SYSTEM("Theo hệ thống"), LIGHT("Sáng"), DARK("Tối")
}

/**
 * A preference backed by SharedPreferences and observable from Compose: reading it in a
 * composable recomposes when it changes; assigning it saves it.
 */
private class Pref<T>(
    private val read: (SharedPreferences) -> T,
    private val write: (SharedPreferences.Editor, T) -> Unit,
) : ReadWriteProperty<Any?, T> {
    @Volatile private var state: MutableState<T>? = null

    private fun state(): MutableState<T> =
        state ?: synchronized(this) { state ?: mutableStateOf(read(AppSettings.store)).also { state = it } }

    override fun getValue(thisRef: Any?, property: KProperty<*>): T = state().value

    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        state().value = value
        AppSettings.store.edit().also { write(it, value) }.apply()
    }
}

private fun stringPref(key: String, default: String) =
    Pref({ it.getString(key, default) ?: default }, { e, v -> e.putString(key, v) })

private fun boolPref(key: String, default: Boolean) =
    Pref({ it.getBoolean(key, default) }, { e, v -> e.putBoolean(key, v) })

private fun intPref(key: String, default: Int) =
    Pref({ it.getInt(key, default) }, { e, v -> e.putInt(key, v) })

private fun qualityPref(key: String, default: VideoQuality) =
    Pref({ VideoQuality.fromHeight(it.getInt(key, default.height)) }, { e, v -> e.putInt(key, v.height) })

/** User preferences. */
object AppSettings {
    lateinit var store: SharedPreferences
        private set
    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
        store = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    }

    /** Mobile data (or another metered connection). */
    val isMeteredNetwork: Boolean
        get() = runCatching {
            appContext.getSystemService(android.net.ConnectivityManager::class.java)?.isActiveNetworkMetered == true
        }.getOrDefault(false)

    const val KEY_LANGUAGE = "hl"
    const val KEY_REGION = "gl"
    const val KEY_REMOTE_URL = "remoteConfigURL"

    var language: String by stringPref(KEY_LANGUAGE, "vi")
    var region: String by stringPref(KEY_REGION, "VN")
    var wifiQuality: VideoQuality by qualityPref("wifiQuality", VideoQuality.AUTO)
    var cellularQuality: VideoQuality by qualityPref("cellularQuality", VideoQuality.P720)
    var downloadQuality: VideoQuality by qualityPref("downloadQuality", VideoQuality.P720)
    var playbackSpeed: Float by Pref({ it.getFloat("speed", 1f) }, { e, v -> e.putFloat("speed", v) })
    var autoplay: Boolean by boolPref("autoplay", true)
    var backgroundPlayback: Boolean by boolPref("background", true)
    var autoPictureInPicture: Boolean by boolPref("autoPiP", true)
    var sponsorBlockEnabled: Boolean by boolPref("sponsorBlock", true)
    var sponsorBlockCategories: List<String> by Pref(
        { it.getStringSet("sponsorBlockCategories", null)?.toList() ?: listOf("sponsor", "selfpromo", "interaction") },
        { e, v -> e.putStringSet("sponsorBlockCategories", v.toSet()) },
    )
    var captionLanguage: String by stringPref("captionLanguage", "vi")
    var captionsEnabled: Boolean by boolPref("captions", false)
    var saveHistory: Boolean by boolPref("saveHistory", true)
    var resumePlayback: Boolean by boolPref("resume", true)
    var theme: AppTheme by Pref(
        { runCatching { AppTheme.valueOf(it.getString("theme", "SYSTEM") ?: "SYSTEM") }.getOrDefault(AppTheme.SYSTEM) },
        { e, v -> e.putString("theme", v.name) },
    )
    var remoteConfigUrl: String by stringPref(KEY_REMOTE_URL, "")
    var webPlayerFallback: Boolean by boolPref("webFallback", true)
    var notifyNewVideos: Boolean by boolPref("notify.newVideos", false)
    var syncWatchHistory: Boolean by boolPref("account.syncHistory", true)

    // Data saving
    /** Play only the audio stream (no picture), remembered between launches. */
    var audioOnlyMode: Boolean by boolPref("audioOnly", false)
    /** Switch to audio only automatically on mobile data. */
    var audioOnlyOnCellular: Boolean by boolPref("audioOnlyCellular", false)
    /** On mobile data: video up to 360p, the smallest audio stream, small thumbnails, no prefetching. */
    var dataSaver: Boolean by boolPref("dataSaver", false)
    var downloadOnWifiOnly: Boolean by boolPref("downloadWifiOnly", false)

    // Player
    var doubleTapSeconds: Int by intPref("doubleTapSeconds", 10)
    var captionSize: CaptionSize by Pref(
        { runCatching { CaptionSize.valueOf(it.getString("captionSize", "NORMAL") ?: "NORMAL") }.getOrDefault(CaptionSize.NORMAL) },
        { e, v -> e.putString("captionSize", v.name) },
    )
    /** Opacity of the box behind captions (0 = none). */
    var captionBackground: Float by Pref({ it.getFloat("captionBackground", 0.75f) }, { e, v -> e.putFloat("captionBackground", v) })

    // Digital wellbeing
    /** Minutes of watching before "Take a break" (0 = off). */
    var breakReminderMinutes: Int by intPref("breakReminder", 0)
    var bedtimeReminder: Boolean by boolPref("bedtimeReminder", false)
    /** Minutes after midnight. */
    var bedtimeStart: Int by intPref("bedtimeStart", 23 * 60)
    var bedtimeEnd: Int by intPref("bedtimeEnd", 7 * 60)

    // Sound
    /** Evens out loudness between videos (YouTube's "Stable volume"). */
    var stableVolume: Boolean by boolPref("stableVolume", true)
    var equalizerEnabled: Boolean by boolPref("eq.enabled", false)
    /** Id of the selected [com.dangdvd.dvdtube.player.EqPreset] ("custom" for the user's own bands). */
    var equalizerPreset: String by stringPref("eq.preset", "flat")
    /** The user's own band gains (dB), comma separated. */
    var equalizerCustomGains: String by stringPref("eq.custom", "")
    var equalizerAutoPreamp: Boolean by boolPref("eq.autoPreamp", true)
    var equalizerPreamp: Float by Pref({ it.getFloat("eq.preamp", 0f) }, { e, v -> e.putFloat("eq.preamp", v) })

    // Watch page
    /** Dislike counts from Return YouTube Dislike. */
    var showDislikes: Boolean by boolPref("ryd", true)
    /** A soft glow of the video's colours around the player in dark mode. */
    var ambientMode: Boolean by boolPref("ambientMode", true)
    /** Fullscreen: swipe up/down on the left for brightness, on the right for volume. */
    var swipeGestures: Boolean by boolPref("swipeGestures", true)

    // History
    /** Search queries are not saved. */
    var pauseSearchHistory: Boolean by boolPref("pauseSearchHistory", false)
    /** Nothing is added to the watch history (here or on the account); resume positions still work. */
    var pauseWatchHistory: Boolean
        get() = !saveHistory
        set(value) {
            saveHistory = !value
        }

    // Cast to DVDTube ("Truyền tới DVDTube")
    /** Android TV: accept videos sent from phones and PCs on the local network. */
    var castReceiverEnabled: Boolean by boolPref("cast.receiver", true)
    /** Receivers added by address (JSON list kept by the cast sender). */
    var manualCastDevices: String by stringPref("cast.manualDevices", "")
    /** "Chạm video khi TV đang phát": "ask", "playNow" or "queue". */
    var castTapAction: String by stringPref("cast.tapAction", "ask")
    var castSwipeHintShown: Boolean by boolPref("cast.swipeHintShown", false)

    // Music mode ("Nghe nhạc")
    /** Music mode plays only the sound by default. */
    var musicAudioOnly: Boolean by boolPref("music.audioOnly", true)

    // Automatic downloads ("Tự động tải")
    var autoDownloadEnabled: Boolean by boolPref("autoDownload.enabled", false)
    var autoDownloadChannels: Set<String> by Pref(
        { it.getStringSet("autoDownload.channels", null)?.toSet() ?: emptySet() },
        { e, v -> e.putStringSet("autoDownload.channels", HashSet(v)) },
    )
    var autoDownloadKeep: Int by intPref("autoDownload.keep", 3)
    var autoDownloadWifiOnly: Boolean by boolPref("autoDownload.wifiOnly", true)
    var autoDownloadAudioOnly: Boolean by boolPref("autoDownload.audioOnly", false)

    // DeArrow (crowd-sourced titles and thumbnails instead of clickbait)
    var deArrow: Boolean by boolPref("dearrow", true)
    var deArrowTitles: Boolean by boolPref("dearrow.titles", true)
    var deArrowThumbnails: Boolean by boolPref("dearrow.thumbnails", true)

    // Updates
    var autoUpdateCheck: Boolean by boolPref("update.auto", true)

    // Parental controls ("Kiểm soát của phụ huynh"): changed only through ParentalControls, behind the PIN.
    var parentalEnabled: Boolean by boolPref("parental.enabled", false)
    var parentalPinHash: String by stringPref("parental.pinHash", "")
    var parentalPinSalt: String by stringPref("parental.pinSalt", "")
    var parentalRestricted: Boolean by boolPref("parental.restricted", true)
    /** Minutes of playback allowed per day (0 = no limit). */
    var parentalDailyLimit: Int by intPref("parental.dailyLimit", 0)
    var parentalWindowEnabled: Boolean by boolPref("parental.window", false)
    /** Minutes after midnight. */
    var parentalWindowStart: Int by intPref("parental.windowStart", 7 * 60)
    var parentalWindowEnd: Int by intPref("parental.windowEnd", 21 * 60)
    var parentalKeywords: String by stringPref("parental.keywords", "")
    var parentalHideComments: Boolean by boolPref("parental.hideComments", false)
    var parentalHideShorts: Boolean by boolPref("parental.hideShorts", false)
    var parentalNoSearch: Boolean by boolPref("parental.noSearch", false)
    /** Watching is allowed until this moment (epoch ms) even past the limit or outside the window (unlocked with the PIN). */
    var parentalOverrideUntil: Long by Pref({ it.getLong("parental.overrideUntil", 0L) }, { e, v -> e.putLong("parental.overrideUntil", v) })

    /** Incognito: nothing is added to the watch or search history (until the app restarts). */
    var isIncognito by mutableStateOf(false)

    /** Mobile data with data saver on. */
    val savesData: Boolean get() = dataSaver && isMeteredNetwork

    /** Whether [timeMillis] falls in the bedtime window (which may cross midnight). */
    fun isBedtime(timeMillis: Long = System.currentTimeMillis()): Boolean {
        val calendar = java.util.Calendar.getInstance().apply { timeInMillis = timeMillis }
        val minute = calendar.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calendar.get(java.util.Calendar.MINUTE)
        if (bedtimeStart == bedtimeEnd) return false
        return if (bedtimeStart < bedtimeEnd) minute in bedtimeStart until bedtimeEnd
        else minute >= bedtimeStart || minute < bedtimeEnd
    }

    val regions = listOf(
        "VN" to "Việt Nam", "US" to "Hoa Kỳ", "JP" to "Nhật Bản", "KR" to "Hàn Quốc",
        "GB" to "Vương quốc Anh", "FR" to "Pháp", "DE" to "Đức", "TH" to "Thái Lan",
        "SG" to "Singapore", "AU" to "Úc", "CA" to "Canada", "IN" to "Ấn Độ",
    )

    val languages = listOf(
        "vi" to "Tiếng Việt", "en" to "English", "ja" to "日本語", "ko" to "한국어",
        "fr" to "Français", "de" to "Deutsch", "th" to "ไทย", "zh-Hans" to "中文",
    )

    val speeds = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 3f, 4f)
    val doubleTapOptions = listOf(5, 10, 15, 20, 30, 60)
    val breakReminderOptions = listOf(0, 15, 30, 45, 60, 90, 120, 180)
    val sleepTimerOptions = listOf(5, 10, 15, 20, 30, 45, 60, 90, 120)
}
