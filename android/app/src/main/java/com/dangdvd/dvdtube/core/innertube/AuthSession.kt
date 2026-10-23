package com.dangdvd.dvdtube.core.innertube

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.dangdvd.dvdtube.core.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.Response
import java.security.MessageDigest

/**
 * The signed-in YouTube session: the account's youtube.com cookies, kept encrypted
 * (Android Keystore). Requests authenticate exactly like the website does: the cookies plus
 * a `SAPISIDHASH` header derived from them. The cookies are only ever sent to
 * `*.youtube.com`; the Google password is typed into Google's own page.
 */
object AuthSession {
    const val ORIGIN = "https://www.youtube.com"

    /**
     * Which signed-in Google account (`authUser`, 0-based like `/u/1/`) and, for a brand
     * account, which channel (`pageId`) requests run as.
     */
    @Serializable
    data class Identity(val authUser: Int = 0, val pageId: String? = null)

    private val json = Json { ignoreUnknownKeys = true }
    private val cookieSerializer = MapSerializer(String.serializer(), String.serializer())
    private lateinit var secure: SharedPreferences
    private lateinit var plain: SharedPreferences
    private val lock = Any()
    private var cookies: Map<String, String> = emptyMap()
    private var identity = Identity()

    fun init(context: Context) {
        plain = context.getSharedPreferences("auth", Context.MODE_PRIVATE)
        secure = runCatching {
            val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(
                context, "session", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }.getOrElse {
            Log.debug("encrypted storage unavailable: ${it.message}")
            context.getSharedPreferences("session-fallback", Context.MODE_PRIVATE)
        }
        cookies = secure.getString("cookies", null)
            ?.let { runCatching { json.decodeFromString(cookieSerializer, it) }.getOrNull() } ?: emptyMap()
        identity = plain.getString("identity", null)
            ?.let { runCatching { json.decodeFromString(Identity.serializer(), it) }.getOrNull() } ?: Identity()
    }

    val isAuthenticated: Boolean get() = synchronized(lock) { hasAuthCookies(cookies) }

    fun hasAuthCookies(cookies: Map<String, String>): Boolean =
        cookies["LOGIN_INFO"] != null &&
            (cookies["SAPISID"] ?: cookies["__Secure-3PAPISID"] ?: cookies["__Secure-1PAPISID"]) != null

    val cookieList: Map<String, String> get() = synchronized(lock) { cookies }

    var currentIdentity: Identity
        get() = synchronized(lock) { identity }
        set(value) {
            synchronized(lock) { identity = value }
            plain.edit().putString("identity", json.encodeToString(Identity.serializer(), value)).apply()
        }

    fun replace(newCookies: Map<String, String>) {
        synchronized(lock) { cookies = newCookies }
        save(newCookies)
    }

    fun clear() {
        synchronized(lock) {
            cookies = emptyMap()
            identity = Identity()
        }
        secure.edit().clear().apply()
        plain.edit().remove("identity").apply()
    }

    private fun save(values: Map<String, String>) {
        secure.edit().putString("cookies", json.encodeToString(cookieSerializer, values)).apply()
    }

    /** YouTube rotates some cookies (e.g. `__Secure-3PSIDTS`); keep the newest values. */
    fun absorb(response: Response) {
        val setCookies = response.headers("Set-Cookie")
        if (setCookies.isEmpty()) return
        val snapshot: Map<String, String>
        var changed = false
        synchronized(lock) {
            val updated = cookies.toMutableMap()
            for (header in setCookies) {
                val pair = header.substringBefore(";")
                val name = pair.substringBefore("=").trim()
                val value = pair.substringAfter("=", "").trim()
                if (name.isNotEmpty() && updated.containsKey(name) && updated[name] != value && value.isNotEmpty()) {
                    updated[name] = value
                    changed = true
                }
            }
            if (changed) cookies = updated
            snapshot = cookies
        }
        if (changed) save(snapshot)
    }

    /**
     * Headers that make a request run as the signed-in account (null if signed out).
     * [origin] must match the site the request claims to come from (e.g. YouTube Studio).
     */
    fun headers(url: HttpUrl, origin: String = ORIGIN): Map<String, String>? {
        val host = url.host.lowercase()
        if (host != "youtube.com" && !host.endsWith(".youtube.com")) return null
        val (cookies, identity) = synchronized(lock) { cookies to identity }
        if (!hasAuthCookies(cookies)) return null

        val headers = mutableMapOf(
            "Cookie" to cookies.entries.map { "${it.key}=${it.value}" }.sorted().joinToString("; "),
            "X-Origin" to origin,
            "X-Goog-AuthUser" to identity.authUser.toString(),
            "X-Youtube-Bootstrap-Logged-In" to "true",
        )
        identity.pageId?.let { headers["X-Goog-PageId"] = it }
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val schemes = listOf(
            "SAPISIDHASH" to (cookies["SAPISID"] ?: cookies["__Secure-3PAPISID"]),
            "SAPISID1PHASH" to cookies["__Secure-1PAPISID"],
            "SAPISID3PHASH" to cookies["__Secure-3PAPISID"],
        )
        val authorization = schemes.mapNotNull { (scheme, sid) ->
            sid ?: return@mapNotNull null
            "$scheme ${timestamp}_${sha1("$timestamp $sid $origin")}"
        }.joinToString(" ")
        if (authorization.isNotEmpty()) headers["Authorization"] = authorization
        return headers
    }

    private fun sha1(text: String): String =
        MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    // MARK: Importing cookies

    /** Accepts a Netscape `cookies.txt` export or a raw `Cookie:` header ("a=b; c=d"). */
    fun parseCookieText(text: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val lines = text.lines()
        val looksLikeNetscape = lines.any { it.split("\t").size >= 7 }
        if (looksLikeNetscape) {
            for (raw in lines) {
                var line = raw.trim()
                if (line.startsWith("#HttpOnly_")) line = line.removePrefix("#HttpOnly_")
                if (line.isEmpty() || line.startsWith("#")) continue
                val columns = line.split("\t")
                if (columns.size < 7 || !columns[0].lowercase().endsWith("youtube.com")) continue
                result[columns[5]] = columns.drop(6).joinToString("\t")
            }
        } else {
            var header = text.trim()
            if (header.lowercase().startsWith("cookie:")) header = header.drop(7)
            for (pair in header.split(";")) {
                val parts = pair.split("=", limit = 2).map { it.trim() }
                if (parts.size == 2 && parts[0].isNotEmpty()) result[parts[0]] = parts[1]
            }
        }
        return result
    }

    /** Parses the "a=b; c=d" string returned by the WebView cookie manager. */
    fun parseCookieHeader(header: String?): Map<String, String> {
        if (header.isNullOrBlank()) return emptyMap()
        return header.split(";").mapNotNull { pair ->
            val parts = pair.split("=", limit = 2).map { it.trim() }
            if (parts.size == 2 && parts[0].isNotEmpty()) parts[0] to parts[1] else null
        }.toMap()
    }
}
