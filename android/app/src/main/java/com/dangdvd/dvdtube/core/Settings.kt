package com.dangdvd.dvdtube.core

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.MutableState
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

private fun qualityPref(key: String, default: VideoQuality) =
    Pref({ VideoQuality.fromHeight(it.getInt(key, default.height)) }, { e, v -> e.putInt(key, v.height) })

/** User preferences. */
object AppSettings {
    lateinit var store: SharedPreferences
        private set

    fun init(context: Context) {
        store = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    }

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

    val regions = listOf(
        "VN" to "Việt Nam", "US" to "Hoa Kỳ", "JP" to "Nhật Bản", "KR" to "Hàn Quốc",
        "GB" to "Vương quốc Anh", "FR" to "Pháp", "DE" to "Đức", "TH" to "Thái Lan",
        "SG" to "Singapore", "AU" to "Úc", "CA" to "Canada", "IN" to "Ấn Độ",
    )

    val languages = listOf(
        "vi" to "Tiếng Việt", "en" to "English", "ja" to "日本語", "ko" to "한국어",
        "fr" to "Français", "de" to "Deutsch", "th" to "ไทย", "zh-Hans" to "中文",
    )

    val speeds = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
}
