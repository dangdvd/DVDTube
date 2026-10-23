package com.dangdvd.dvdtube.core.services

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.innertube.AuthSession
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.AppScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Uploads a video to the signed-in channel the way YouTube Studio does:
 * 1. open a resumable upload on upload.youtube.com,
 * 2. send the file,
 * 3. create the video on the channel (`upload/createvideo`) with title, description, privacy.
 */
object VideoUploader {
    enum class Privacy(val value: String, val title: String) {
        PRIVATE("PRIVATE", "Riêng tư"), UNLISTED("UNLISTED", "Không công khai"), PUBLIC("PUBLIC", "Công khai")
    }

    sealed class State {
        data object Idle : State()
        data object Preparing : State()
        data class Uploading(val progress: Double) : State()
        data object Creating : State()
        data class Done(val videoId: String) : State()
        data class Failed(val message: String) : State()
    }

    var state by mutableStateOf<State>(State.Idle)
        private set
    val isBusy: Boolean get() = state is State.Preparing || state is State.Uploading || state is State.Creating

    private var job: Job? = null
    private const val STUDIO_ORIGIN = "https://studio.youtube.com"
    private const val FALLBACK_CLIENT_VERSION = "1.20261020.01.00"
    private val uploadClient by lazy {
        InnerTube.authClient.newBuilder().writeTimeout(10, TimeUnit.MINUTES).readTimeout(5, TimeUnit.MINUTES).build()
    }

    private class UploadError(message: String) : Exception(message)

    private data class StudioConfig(val channelId: String?, val apiKey: String?, val clientVersion: String)

    fun start(context: Context, file: Uri, title: String, description: String, privacy: Privacy) {
        job?.cancel()
        state = State.Preparing
        val appContext = context.applicationContext
        job = AppScope.launch {
            state = try {
                val videoId = upload(appContext, file, title, description, privacy)
                Log.debug("upload finished: $videoId")
                State.Done(videoId)
            } catch (cancel: CancellationException) {
                State.Idle
            } catch (failure: Exception) {
                Log.debug("upload failed: ${failure.message}")
                State.Failed(failure.message ?: "Tải lên thất bại.")
            }
        }
    }

    fun cancel() {
        job?.cancel()
        job = null
        state = State.Idle
    }

    fun reset() {
        if (!isBusy) state = State.Idle
    }

    private suspend fun upload(context: Context, file: Uri, title: String, description: String, privacy: Privacy): String {
        if (!AuthSession.isAuthenticated) throw UploadError("Cần đăng nhập tài khoản Google để tải video lên.")
        val size = fileSize(context, file)
        if (size <= 0) throw UploadError("Không đọc được tệp video.")
        val config = studioConfig()
        val profileChannel = AccountStore.profile?.channelId
        // A brand account's channel comes from the account menu (requests run as that channel).
        val channelId = (if (AuthSession.currentIdentity.pageId != null) profileChannel ?: config.channelId else config.channelId ?: profileChannel)
            ?: throw UploadError("Tài khoản này chưa có kênh YouTube. Hãy tạo kênh trên YouTube trước khi tải video lên.")
        val frontendUploadId = "innertube_studio:${UUID.randomUUID().toString().lowercase()}:0"
        val uploadUrl = openUpload(frontendUploadId, size)
        state = State.Uploading(0.0)
        val resourceId = sendFile(context, file, size, uploadUrl)
        state = State.Creating
        return createVideo(channelId, resourceId, frontendUploadId, title, description, privacy, config)
    }

    private fun fileSize(context: Context, uri: Uri): Long {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0)
        }
        return context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1
    }

    private fun authorized(url: String): Request.Builder {
        val builder = Request.Builder().url(url)
        APIConfig.webProfile.resolvedUserAgent(APIConfig.gl)?.let { builder.header("User-Agent", it) }
        AuthSession.headers(url.toHttpUrl(), STUDIO_ORIGIN)?.forEach { (key, value) -> builder.header(key, value) }
        return builder
    }

    /** Reads Studio's page config (channel, API key, client version). Best effort. */
    private suspend fun studioConfig(): StudioConfig = withContext(Dispatchers.IO) {
        var config = StudioConfig(null, null, FALLBACK_CLIENT_VERSION)
        runCatching {
            val url = "https://studio.youtube.com/?authuser=${AuthSession.currentIdentity.authUser}"
            val request = Request.Builder().url(url)
            APIConfig.webProfile.resolvedUserAgent(APIConfig.gl)?.let { request.header("User-Agent", it) }
            AuthSession.headers(url.toHttpUrl(), STUDIO_ORIGIN)?.get("Cookie")?.let { request.header("Cookie", it) }
            InnerTube.authClient.newCall(request.build()).execute().use { response ->
                val html = response.body?.string().orEmpty()
                fun match(pattern: String) = Regex(pattern).find(html)?.groupValues?.getOrNull(1)
                config = StudioConfig(
                    channelId = match("\"CHANNEL_ID\":\"(UC[\\w-]{22})\""),
                    apiKey = match("\"INNERTUBE_API_KEY\":\"([\\w-]+)\""),
                    clientVersion = match("\"INNERTUBE_CLIENT_VERSION\":\"([\\d.]+)\"") ?: FALLBACK_CLIENT_VERSION,
                )
            }
        }
        Log.debug("studio config: channel=${config.channelId != null} key=${config.apiKey != null} version=${config.clientVersion}")
        config
    }

    private suspend fun openUpload(frontendUploadId: String, size: Long): String = withContext(Dispatchers.IO) {
        val request = authorized("https://upload.youtube.com/upload/studio")
            .header("X-Goog-Upload-Command", "start")
            .header("X-Goog-Upload-Protocol", "resumable")
            .header("X-Goog-Upload-File-Name", "file-${System.currentTimeMillis()}")
            .header("X-Goog-Upload-Header-Content-Length", size.toString())
            .post(JSONObject().put("frontendUploadId", frontendUploadId).toString().toRequestBody("application/json".toMediaType()))
            .build()
        uploadClient.newCall(request).execute().use { response ->
            Log.debug("upload start -> HTTP ${response.code}")
            if (!response.isSuccessful) throw UploadError("YouTube từ chối mở phiên tải lên (HTTP ${response.code}).")
            response.header("X-Goog-Upload-URL") ?: throw UploadError("YouTube không trả về địa chỉ tải lên.")
        }
    }

    private suspend fun sendFile(context: Context, file: Uri, size: Long, uploadUrl: String): String = withContext(Dispatchers.IO) {
        val body = object : RequestBody() {
            override fun contentType(): MediaType = "application/octet-stream".toMediaType()
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                val input = context.contentResolver.openInputStream(file) ?: throw UploadError("Không đọc được tệp video.")
                input.source().use { source ->
                    var sent = 0L
                    var lastReport = 0L
                    while (true) {
                        val read = source.read(sink.buffer, 256 * 1024L)
                        if (read == -1L) break
                        sink.emitCompleteSegments()
                        sent += read
                        val now = System.currentTimeMillis()
                        if (now - lastReport > 250) {
                            lastReport = now
                            val fraction = sent.toDouble() / size
                            AppScope.launch { if (state is State.Uploading) state = State.Uploading(fraction) }
                        }
                    }
                }
            }
        }
        val request = authorized(uploadUrl)
            .header("X-Goog-Upload-Command", "upload, finalize")
            .header("X-Goog-Upload-Offset", "0")
            .post(body)
            .build()
        val call = uploadClient.newCall(request)
        coroutineContext.ensureActive()
        call.execute().use { response ->
            Log.debug("upload send -> HTTP ${response.code}")
            if (!response.isSuccessful) throw UploadError("Tải tệp lên thất bại (HTTP ${response.code}).")
            val json = JNode.parse(response.body?.string().orEmpty())
            json["scottyResourceId"].string ?: json.findFirst("scottyResourceId").string
                ?: throw UploadError("YouTube không xác nhận tệp đã tải lên.")
        }
    }

    private suspend fun createVideo(
        channelId: String, resourceId: String, frontendUploadId: String,
        title: String, description: String, privacy: Privacy, config: StudioConfig,
    ): String = withContext(Dispatchers.IO) {
        val url = "https://studio.youtube.com/youtubei/v1/upload/createvideo?alt=json" + (config.apiKey?.let { "&key=$it" } ?: "")
        fun body(withDelegation: Boolean): String {
            val user = JSONObject()
            if (withDelegation) {
                user.put("delegationContext", JSONObject()
                    .put("externalChannelId", channelId)
                    .put("roleType", JSONObject().put("channelRoleType", "CREATOR_CHANNEL_ROLE_TYPE_OWNER")))
            }
            return JSONObject()
                .put("channelId", channelId)
                .put("resourceId", JSONObject().put("scottyResourceId", JSONObject().put("id", resourceId)))
                .put("frontendUploadId", frontendUploadId)
                .put("initialMetadata", JSONObject()
                    .put("title", JSONObject().put("newTitle", title))
                    .put("description", JSONObject().put("newDescription", description))
                    .put("privacy", JSONObject().put("newPrivacy", privacy.value)))
                .put("context", JSONObject()
                    .put("client", JSONObject().put("clientName", 62).put("clientVersion", config.clientVersion)
                        .put("hl", APIConfig.hl).put("gl", APIConfig.gl))
                    .put("request", JSONObject().put("returnLogEntry", true).put("internalExperimentFlags", JSONArray()))
                    .put("user", user))
                .toString()
        }
        var lastStatus = 0
        for (withDelegation in listOf(true, false)) {
            val request = authorized(url)
                .header("Origin", STUDIO_ORIGIN)
                .header("X-YouTube-Client-Name", "62")
                .header("X-YouTube-Client-Version", config.clientVersion)
                .post(body(withDelegation).toRequestBody("application/json".toMediaType()))
                .build()
            val videoId = uploadClient.newCall(request).execute().use { response ->
                lastStatus = response.code
                Log.debug("createvideo (delegation $withDelegation) -> HTTP $lastStatus")
                if (response.isSuccessful) runCatching { JNode.parse(response.body?.string().orEmpty()).findFirst("videoId").string }.getOrNull()
                else null
            }
            if (videoId != null) return@withContext videoId
            // Only a rejected request shape is worth a second try.
            if (lastStatus != 400) break
        }
        throw UploadError("Tệp đã tải lên nhưng YouTube không tạo được video (HTTP $lastStatus). Hãy thử “Mở YouTube Studio”.")
    }
}
