package com.dangdvd.dvdtube.core.innertube

import com.dangdvd.dvdtube.core.AppSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Request

/**
 * One InnerTube client identity (the app YouTube thinks is talking to it). All values can be
 * overridden by the remote config, so the app keeps working when YouTube changes something.
 */
@Serializable
data class ClientProfile(
    val name: String,
    val id: Int,
    val version: String,
    val host: String = "www.youtube.com",
    val userAgent: String? = null,
    val deviceMake: String? = null,
    val deviceModel: String? = null,
    val osName: String? = null,
    val osVersion: String? = null,
    val platform: String? = null,
    val clientScreen: String? = null,
    /** Send `X-YouTube-Client-Name/Version` + `Origin` headers. */
    val sendClientHeaders: Boolean = true,
    val extraHeaders: Map<String, String>? = null,
) {
    /** `{gl}` in the user agent is replaced by the content country. */
    fun resolvedUserAgent(gl: String): String? = userAgent?.replace("{gl}", gl.uppercase())

    companion object {
        val WEB = ClientProfile(
            name = "WEB",
            id = 1,
            version = "2.20261019.01.00",
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
            platform = "DESKTOP",
        )

        /**
         * The visionOS app's client gets HLS + direct stream URLs without PO tokens or
         * JavaScript signature deciphering.
         */
        val VISIONOS = ClientProfile(
            name = "VISIONOS",
            id = 101,
            version = "1.04",
            host = "youtubei.googleapis.com",
            userAgent = "com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; {gl})",
            deviceMake = "Apple",
            deviceModel = "RealityDevice17,1",
            osName = "visionOS",
            osVersion = "26.6.0.23O770",
            platform = "MOBILE",
            clientScreen = "WATCH",
            sendClientHeaders = false,
            extraHeaders = mapOf("X-Goog-Api-Format-Version" to "2"),
        )

        val CHARTS = ClientProfile(
            name = "WEB_MUSIC_ANALYTICS",
            id = 31,
            version = "2.0",
            host = "charts.youtube.com",
            sendClientHeaders = true,
            extraHeaders = mapOf("Origin" to "https://charts.youtube.com", "Referer" to "https://charts.youtube.com"),
        )
    }
}

/** Optional JSON hosted in the GitHub repo (see `Config/remote-config.json`). */
@Serializable
data class RemoteConfig(
    val web: ClientProfile? = null,
    val playerClients: List<ClientProfile>? = null,
    val charts: ClientProfile? = null,
    val message: String? = null,
)

/** Region and config values used by the networking layer. */
object APIConfig {
    private const val CONFIG_KEY = "remoteConfig.cached"
    private val json = Json { ignoreUnknownKeys = true }

    val hl: String get() = AppSettings.language
    val gl: String get() = AppSettings.region

    @Volatile private var cached: RemoteConfig? = null
    @Volatile private var loaded = false

    val remote: RemoteConfig?
        get() {
            if (!loaded) {
                cached = AppSettings.store.getString(CONFIG_KEY, null)?.let { runCatching { json.decodeFromString(RemoteConfig.serializer(), it) }.getOrNull() }
                loaded = true
            }
            return cached
        }

    val webProfile: ClientProfile get() = remote?.web ?: ClientProfile.WEB
    val chartsProfile: ClientProfile get() = remote?.charts ?: ClientProfile.CHARTS
    val playerProfiles: List<ClientProfile>
        get() = remote?.playerClients?.takeIf { it.isNotEmpty() } ?: listOf(ClientProfile.VISIONOS)

    const val DEFAULT_REMOTE_CONFIG_URL = "https://raw.githubusercontent.com/dangdvd/DVDYoutube/main/Config/remote-config.json"

    val remoteConfigUrl: String get() = AppSettings.remoteConfigUrl.ifBlank { DEFAULT_REMOTE_CONFIG_URL }

    /** Downloads the remote config; failures keep the previous (or built-in) values. */
    suspend fun refreshRemoteConfig() = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder().url(remoteConfigUrl).header("Accept", "application/json")
                .header("Cache-Control", "no-cache").build()
            InnerTube.client.newCall(request).execute().use { response ->
                if (response.code != 200) return@use
                val text = response.body?.string() ?: return@use
                val config = json.decodeFromString(RemoteConfig.serializer(), text)
                AppSettings.store.edit().putString(CONFIG_KEY, text).apply()
                cached = config
                loaded = true
            }
        }
    }

    fun clearRemoteConfig() {
        AppSettings.store.edit().remove(CONFIG_KEY).apply()
        cached = null
        loaded = true
    }
}
