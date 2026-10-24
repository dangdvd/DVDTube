package com.dangdvd.dvdtube.core.innertube

import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.PlayerInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit

sealed class InnerTubeException(message: String) : IOException(message) {
    class Http(val code: Int) : InnerTubeException(
        if (code == 429) "YouTube tạm thời giới hạn yêu cầu (429). Vui lòng thử lại sau."
        else "Lỗi kết nối tới YouTube (HTTP $code).",
    )
    class Unplayable(reason: String) : InnerTubeException(reason)
    /** YouTube's "Sign in to confirm you're not a bot" (or age gate) on the player endpoint. */
    class LoginRequired(reason: String) : InnerTubeException(reason)
    class NoStreams : InnerTubeException("Không tìm thấy luồng phát cho video này.")
    class InvalidResponse : InnerTubeException("Phản hồi từ YouTube không hợp lệ.")
}

/** Remembers cookies YouTube sets for anonymous requests (visitor id etc.), in memory. */
private class MemoryCookieJar : CookieJar {
    private val store = mutableMapOf<String, Cookie>()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) store[cookie.domain + "|" + cookie.name] = cookie
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        store.values.removeAll { it.expiresAt < now }
        return store.values.filter { it.matches(url) }
    }
}

/** Low level access to YouTube's internal "InnerTube" API. */
object InnerTube {
    /** Anonymous requests (keeps YouTube's visitor cookies in memory). */
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .cookieJar(MemoryCookieJar())
        .build()

    /** Signed-in requests send exactly the account cookies (no cookie jar). */
    val authClient: OkHttpClient = client.newBuilder().cookieJar(CookieJar.NO_COOKIES).build()

    private val jsonType = "application/json".toMediaType()
    private val visitorMutex = Mutex()
    private val visitors = mutableMapOf<String, Pair<String, Long>>()

    // MARK: Request building

    private fun context(profile: ClientProfile, visitorData: String?): JSONObject {
        val client = JSONObject()
            .put("clientName", profile.name)
            .put("clientVersion", profile.version)
            .put("hl", APIConfig.hl)
            .put("gl", APIConfig.gl)
            .put("utcOffsetMinutes", TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000)
        profile.clientScreen?.let { client.put("clientScreen", it) }
        profile.platform?.let { client.put("platform", it) }
        profile.deviceMake?.let { client.put("deviceMake", it) }
        profile.deviceModel?.let { client.put("deviceModel", it) }
        profile.osName?.let { client.put("osName", it) }
        profile.osVersion?.let { client.put("osVersion", it) }
        if (profile.name == "WEB") client.put("originalUrl", "https://www.youtube.com")
        visitorData?.let { client.put("visitorData", it) }
        return JSONObject()
            .put("client", client)
            .put("request", JSONObject().put("internalExperimentFlags", JSONArray()).put("useSsl", true))
            .put("user", JSONObject().put("lockedSafetyMode", false))
    }

    suspend fun post(
        endpoint: String,
        profile: ClientProfile,
        body: JSONObject,
        query: Map<String, String> = emptyMap(),
        host: String? = null,
        visitorData: String? = null,
        authenticated: Boolean = false,
    ): JNode = withContext(Dispatchers.IO) {
        val urlBuilder = HttpUrl.Builder().scheme("https").host(host ?: profile.host)
            .addPathSegments("youtubei/v1/$endpoint")
            .addQueryParameter("prettyPrint", "false")
        query.toSortedMap().forEach { (key, value) -> urlBuilder.addQueryParameter(key, value) }
        val url = urlBuilder.build()

        body.put("context", context(profile, visitorData))
        val request = Request.Builder().url(url).post(body.toString().toRequestBody(jsonType))
            .header("Accept-Language", "${APIConfig.hl},en;q=0.9")
        profile.resolvedUserAgent(APIConfig.gl)?.let { request.header("User-Agent", it) }
        if (profile.sendClientHeaders) {
            request.header("X-YouTube-Client-Name", profile.id.toString())
            request.header("X-YouTube-Client-Version", profile.version)
            if (profile.extraHeaders?.containsKey("Origin") != true) request.header("Origin", "https://www.youtube.com")
        }
        visitorData?.let { request.header("X-Goog-Visitor-Id", it) }
        profile.extraHeaders?.forEach { (key, value) -> request.header(key, value) }
        val authHeaders = if (authenticated) AuthSession.headers(url) else null
        authHeaders?.forEach { (key, value) -> request.header(key, value) }

        val httpClient = if (authHeaders != null) authClient else client
        httpClient.newCall(request.build()).execute().use { response ->
            val bytes = response.body?.bytes() ?: ByteArray(0)
            Log.debug("${profile.name} $endpoint -> HTTP ${response.code}, ${bytes.size} bytes${if (authHeaders != null) " (signed in)" else ""}")
            if (authHeaders != null) AuthSession.absorb(response)
            val text = String(bytes)
            if (response.code !in 200..299) {
                runCatching { JNode.parse(text).at("error", "message").string }.getOrNull()?.let {
                    Log.debug("$endpoint error: $it")
                }
                throw InnerTubeException.Http(response.code)
            }
            runCatching { JNode.parse(text) }.getOrElse { throw InnerTubeException.InvalidResponse() }
        }
    }

    /**
     * WEB client request used for search, browse and the watch page. Runs as the signed-in
     * account when there is one (personalised results, account pages).
     */
    suspend fun web(endpoint: String, body: JSONObject): JNode {
        val profile = APIConfig.webProfile
        val visitor = cachedVisitor(profile.name)
        val json = post(endpoint, profile, body, visitorData = visitor, authenticated = true)
        if (visitor == null) json.at("responseContext", "visitorData").string?.let { storeVisitor(profile.name, it) }
        return json
    }

    // MARK: Visitor data

    private suspend fun cachedVisitor(client: String): String? = visitorMutex.withLock {
        val entry = visitors[client] ?: return@withLock null
        if (System.currentTimeMillis() - entry.second < 3_600_000) entry.first else null
    }

    private suspend fun storeVisitor(client: String, value: String) = visitorMutex.withLock {
        visitors[client] = value to System.currentTimeMillis()
    }

    /** Player requests from the visionOS client must carry a visitor id that YouTube issued. */
    suspend fun visitorData(profile: ClientProfile, forceRefresh: Boolean = false): String {
        if (!forceRefresh) cachedVisitor(profile.name)?.let { return it }
        val json = post("visitor_id", profile, JSONObject(), host = "www.youtube.com")
        val visitor = json.at("responseContext", "visitorData").string ?: throw InnerTubeException.InvalidResponse()
        storeVisitor(profile.name, visitor)
        return visitor
    }

    // MARK: Endpoints

    suspend fun player(videoId: String): PlayerInfo {
        var lastError: Exception = InnerTubeException.NoStreams()
        for (profile in APIConfig.playerProfiles) {
            for (attempt in 0..1) {
                try {
                    val visitor = visitorData(profile, forceRefresh = attempt > 0)
                    val json = post(
                        "player", profile,
                        JSONObject()
                            .put("videoId", videoId)
                            .put("cpn", randomToken(16))
                            .put("contentCheckOk", true)
                            .put("racyCheckOk", true),
                        query = mapOf("t" to randomToken(12), "id" to videoId),
                        visitorData = visitor,
                    )
                    return PlayerParser.parse(json, videoId)
                } catch (error: InnerTubeException) {
                    Log.debug("player($videoId) via ${profile.name} failed: ${error.message}")
                    lastError = error
                    // A bad visitor id shows up as an unplayable response; retry once with a
                    // fresh one. Never retry a bot check: hammering the endpoint makes it stick.
                    if (error is InnerTubeException.Unplayable && attempt == 0) continue
                    break
                } catch (error: Exception) {
                    lastError = error
                    break
                }
            }
        }
        throw lastError
    }

    suspend fun search(query: String, params: String?): JNode =
        web("search", JSONObject().put("query", query).also { if (params != null) it.put("params", params) })

    suspend fun browse(browseId: String, params: String? = null): JNode =
        web("browse", JSONObject().put("browseId", browseId).also { if (params != null) it.put("params", params) })

    suspend fun browseContinuation(token: String): JNode = web("browse", JSONObject().put("continuation", token))

    /** A channel's own search (browse with the search tab's params and a query). */
    suspend fun browseSearch(browseId: String, params: String, query: String): JNode =
        web("browse", JSONObject().put("browseId", browseId).put("params", params).put("query", query))

    suspend fun searchContinuation(token: String): JNode = web("search", JSONObject().put("continuation", token))

    suspend fun next(videoId: String): JNode =
        web("next", JSONObject().put("videoId", videoId).put("contentCheckOk", true).put("racyCheckOk", true))

    /**
     * A watch page inside a playlist; for mixes ("Danh sách kết hợp") this is the only way to get
     * their videos (they have no playlist page).
     */
    suspend fun next(videoId: String?, playlistId: String): JNode {
        val body = JSONObject().put("playlistId", playlistId).put("contentCheckOk", true).put("racyCheckOk", true)
        if (videoId != null) body.put("videoId", videoId)
        return web("next", body)
    }

    suspend fun nextContinuation(token: String): JNode = web("next", JSONObject().put("continuation", token))

    suspend fun resolveUrl(url: String): JNode = web("navigation/resolve_url", JSONObject().put("url", url))

    suspend fun charts(type: String): JNode = post(
        "browse", APIConfig.chartsProfile,
        JSONObject()
            .put("browseId", "FEmusic_analytics_charts_home")
            .put("query", "perspective=CHART_DETAILS&chart_params_country_code=${APIConfig.gl}&chart_params_chart_type=$type"),
        query = mapOf("alt" to "json"),
    )

    /** Search-as-you-type suggestions. */
    suspend fun suggestions(query: String): List<String> = withContext(Dispatchers.IO) {
        runCatching {
            val url = "https://suggestqueries-clients6.youtube.com/complete/search".toHttpUrl().newBuilder()
                .addQueryParameter("client", "youtube")
                .addQueryParameter("ds", "yt")
                .addQueryParameter("hl", APIConfig.hl)
                .addQueryParameter("gl", APIConfig.gl.lowercase())
                .addQueryParameter("oe", "utf-8")
                .addQueryParameter("q", query)
                .build()
            client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                var text = response.body?.string() ?: return@use emptyList()
                // The response is JSONP: window.google.ac.h([...])
                val start = text.indexOf('(')
                val end = text.lastIndexOf(')')
                if (start in 0 until end) text = text.substring(start + 1, end)
                JNode.parse(text)[1].array.mapNotNull { it.string ?: it[0].string }
            }
        }.getOrDefault(emptyList())
    }

    // MARK: Account (signed in only)

    suspend fun accountMenu(): JNode = web("account/account_menu", JSONObject())

    /** The website's "Switch account" list (all signed-in Google accounts and channels). */
    suspend fun accountSwitcher(): JNode = withContext(Dispatchers.IO) {
        val url = "https://www.youtube.com/getAccountSwitcherEndpoint".toHttpUrl()
        val request = Request.Builder().url(url)
        APIConfig.webProfile.resolvedUserAgent(APIConfig.gl)?.let { request.header("User-Agent", it) }
        AuthSession.headers(url)?.forEach { (key, value) -> request.header(key, value) }
        authClient.newCall(request.build()).execute().use { response ->
            val text = response.body?.string() ?: ""
            Log.debug("account switcher -> HTTP ${response.code}, ${text.length} bytes")
            if (response.code !in 200..299) throw InnerTubeException.Http(response.code)
            // The body starts with an anti-JSON-hijacking prefix: )]}'
            val start = text.indexOf('{')
            if (start < 0) throw InnerTubeException.InvalidResponse()
            JNode.parse(text.substring(start))
        }
    }

    suspend fun accountsList(): JNode = web("account/accounts_list", JSONObject())

    suspend fun like(videoId: String, action: String) {
        web("like/$action", JSONObject().put("target", JSONObject().put("videoId", videoId)))
    }

    suspend fun subscription(channelId: String, subscribe: Boolean) {
        web(
            if (subscribe) "subscription/subscribe" else "subscription/unsubscribe",
            JSONObject().put("channelIds", JSONArray().put(channelId)).put("params", if (subscribe) "EgIIAhgA" else "CgIIAhgA"),
        )
    }

    suspend fun addToPlaylistOptions(videoId: String): JNode =
        web("playlist/get_add_to_playlist", JSONObject().put("videoIds", JSONArray().put(videoId)))

    suspend fun createPlaylist(title: String, videoId: String?): JNode {
        val body = JSONObject().put("title", title).put("privacyStatus", "PRIVATE")
        if (videoId != null) body.put("videoIds", JSONArray().put(videoId))
        return web("playlist/create", body)
    }

    suspend fun editPlaylist(playlistId: String, add: String? = null, remove: String? = null) {
        val actions = JSONArray()
        if (add != null) actions.put(JSONObject().put("action", "ACTION_ADD_VIDEO").put("addedVideoId", add))
        if (remove != null) actions.put(JSONObject().put("action", "ACTION_REMOVE_VIDEO_BY_VIDEO_ID").put("removedVideoId", remove))
        web("browse/edit_playlist", JSONObject().put("playlistId", playlistId).put("actions", actions))
    }

    suspend fun notificationMenu(): JNode =
        web("notification/get_notification_menu", JSONObject().put("notificationsMenuRequestType", "NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX"))

    suspend fun unseenNotificationCount(): Int {
        val json = web("notification/get_unseen_count", JSONObject())
        return json["unseenCount"].int ?: json.findFirst("unseenCount").int ?: 0
    }

    suspend fun createComment(text: String, params: String): JNode =
        web("comment/create_comment", JSONObject().put("commentText", text).put("createCommentParams", params))

    /** Like / unlike / dislike a comment with the token from its toolbar. */
    suspend fun performCommentAction(action: String): JNode =
        web("comment/perform_comment_action", JSONObject().put("actions", JSONArray().put(action)))

    suspend fun createReply(text: String, params: String): JNode =
        web("comment/create_comment_reply", JSONObject().put("commentText", text).put("createReplyParams", params))

    /**
     * Adds a video to the account's YouTube watch history: fetch the signed-in web player
     * response just for its tracking URLs and ping them, the way the website does.
     */
    suspend fun markWatched(videoId: String, duration: Double) {
        if (!AuthSession.isAuthenticated) return
        val json = runCatching {
            web("player", JSONObject().put("videoId", videoId).put("contentCheckOk", true).put("racyCheckOk", true))
        }.getOrNull() ?: return
        val cpn = randomToken(16)
        val length = maxOf((json.at("videoDetails", "lengthSeconds").double ?: duration) - 1, 1.0).toString()
        withContext(Dispatchers.IO) {
            listOf("videostatsPlaybackUrl", "videostatsWatchtimeUrl").forEachIndexed { index, key ->
                val base = json.at("playbackTracking", key, "baseUrl").string ?: return@forEachIndexed
                val builder = runCatching { base.toHttpUrl().newBuilder() }.getOrNull() ?: return@forEachIndexed
                listOf("ver", "cpn", "cmt", "el", "st", "et").forEach { builder.removeAllQueryParameters(it) }
                builder.addQueryParameter("ver", "2").addQueryParameter("cpn", cpn)
                    .addQueryParameter("cmt", length).addQueryParameter("el", "detailpage")
                if (index == 1) builder.addQueryParameter("st", "0").addQueryParameter("et", length)
                val url = builder.build()
                val request = Request.Builder().url(url)
                AuthSession.headers(url)?.forEach { (k, v) -> request.header(k, v) }
                val status = runCatching { authClient.newCall(request.build()).execute().use { it.code } }.getOrDefault(0)
                Log.debug("mark watched $videoId $key -> HTTP $status")
            }
        }
    }

    // MARK: Live chat

    suspend fun liveChat(continuation: String): JNode = web("live_chat/get_live_chat", JSONObject().put("continuation", continuation))

    suspend fun liveChatReplay(continuation: String, offsetMs: Long): JNode = web(
        "live_chat/get_live_chat_replay",
        JSONObject().put("continuation", continuation)
            .put("currentPlayerState", JSONObject().put("playerOffsetMs", maxOf(offsetMs, 0).toString())),
    )

    suspend fun sendLiveChatMessage(text: String, params: String): JNode = web(
        "live_chat/send_message",
        JSONObject().put("params", params).put("clientMessageId", UUID.randomUUID().toString())
            .put("richMessage", JSONObject().put("textSegments", JSONArray().put(JSONObject().put("text", text)))),
    )

    /**
     * The first page of a chat is YouTube's own chat frame (`/live_chat?continuation=`): its
     * `ytInitialData` holds the first messages and the token to keep polling with.
     */
    suspend fun liveChatPage(continuation: String, replay: Boolean): JNode = withContext(Dispatchers.IO) {
        // Tokens are already URL-encoded ("…%3D"); youtube.com puts them into the URL as is.
        val path = if (replay) "live_chat_replay" else "live_chat"
        val url = "https://www.youtube.com/$path?continuation=$continuation&hl=${APIConfig.hl}&gl=${APIConfig.gl}".toHttpUrl()
        val request = Request.Builder().url(url).header("Accept-Language", "${APIConfig.hl},en;q=0.9")
        APIConfig.webProfile.resolvedUserAgent(APIConfig.gl)?.let { request.header("User-Agent", it) }
        val headers = AuthSession.headers(url)
        headers?.forEach { (k, v) -> request.header(k, v) }
        (if (headers != null) authClient else client).newCall(request.build()).execute().use { response ->
            val html = response.body?.string() ?: ""
            Log.debug("$path page -> HTTP ${response.code}, ${html.length} chars")
            if (response.code !in 200..299) throw InnerTubeException.Http(response.code)
            initialData(html) ?: throw InnerTubeException.InvalidResponse()
        }
    }

    /** Cuts the `ytInitialData = {...}` object out of a YouTube HTML page. */
    fun initialData(html: String): JNode? {
        var searchFrom = 0
        while (true) {
            val found = html.indexOf("ytInitialData", searchFrom)
            if (found < 0) return null
            searchFrom = found + "ytInitialData".length
            val window = html.substring(searchFrom, minOf(searchFrom + 24, html.length))
            val open = window.indexOf('{')
            if (open < 0) continue
            val start = searchFrom + open
            val end = matchingBrace(html, start) ?: continue
            runCatching { JNode.parse(html.substring(start, end + 1)) }.getOrNull()?.let { return it }
        }
    }

    private fun matchingBrace(text: String, start: Int): Int? {
        var depth = 0
        var inString = false
        var escaped = false
        for (index in start until text.length) {
            val c = text[index]
            if (inString) {
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> inString = false
                }
            } else when (c) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return index
                }
            }
        }
        return null
    }

    fun randomToken(length: Int): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        return (1..length).map { alphabet.random() }.joinToString("")
    }
}
