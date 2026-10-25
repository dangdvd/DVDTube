package com.dangdvd.dvdtube.core.sync

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.TvLogin
import com.dangdvd.dvdtube.core.net.LanServer
import com.dangdvd.dvdtube.tv.TvPairingServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Two-way library sync over the local network. The RECEIVING device shows a QR code of
 * `dvdtube://sync?h=<ip>:<port>&t=<token>&k=<key>&n=<name>` (16-byte token, 32-byte AES key,
 * base64url without padding, single use, 10 minutes). The sender POSTs `http://<h>/sync` with
 * `{"t","n","c"}` (AES-256-GCM, 12-byte nonce, AAD = raw token, ciphertext‖tag) whose plaintext is
 * its library JSON; the receiver merges, saves and replies with the merged library encrypted the
 * same way, which the sender merges too — both devices end up equal.
 */
object LanSync {
    const val PORT = 8768
    const val PATH = "/sync"
    const val MAX_BODY = 16 * 1024 * 1024
    const val LIFETIME_MS = 10 * 60_000L

    data class Invite(val host: String, val token: ByteArray, val key: ByteArray, val name: String) {
        val address: String get() = host.substringBeforeLast(':')
    }

    fun link(host: String, token: ByteArray, key: ByteArray, name: String): String =
        "dvdtube://sync?h=$host&t=${TvLogin.encode(token)}&k=${TvLogin.encode(key)}&n=" + URLEncoder.encode(name, "UTF-8").replace("+", "%20")

    /** Parses a scanned / opened sync link; only private LAN IPv4 hosts are accepted. */
    fun parse(text: String): Invite? {
        val uri = runCatching { Uri.parse(text.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "dvdtube" || uri.host != "sync") return null
        val host = uri.getQueryParameter("h") ?: return null
        val token = uri.getQueryParameter("t")?.let(TvLogin::decode) ?: return null
        val key = uri.getQueryParameter("k")?.let(TvLogin::decode) ?: return null
        if (token.size != 16 || key.size != 32 || !TvLogin.isLocalHost(host)) return null
        val name = uri.getQueryParameter("n")?.trim().orEmpty().ifEmpty { "thiết bị khác" }
        return Invite(host, token, key, name)
    }

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(90, TimeUnit.SECONDS)
            .callTimeout(150, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Sender side: sends this device's library and merges the reply. Returns what was added here;
     * throws with a Vietnamese message on failure.
     */
    suspend fun send(invite: Invite): LibrarySync.Summary {
        val mine = withContext(Dispatchers.Main) { LibrarySync.toJson(LibrarySync.local()) }
        val reply = withContext(Dispatchers.IO) {
            val (nonce, sealed) = TvLogin.encrypt(invite.key, invite.token, mine.toByteArray(Charsets.UTF_8))
            val body = JSONObject()
                .put("t", TvLogin.encode(invite.token))
                .put("n", TvLogin.encode(nonce))
                .put("c", TvLogin.encode(sealed))
                .toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            val call = client.newCall(Request.Builder().url("http://${invite.host}$PATH").post(body).build())
            val response = try {
                call.execute()
            } catch (error: java.io.IOException) {
                throw IllegalStateException("Không kết nối được tới ${invite.name}. Hai thiết bị phải cùng mạng Wi-Fi.")
            }
            response.use {
                val json = runCatching { JSONObject(it.body?.string().orEmpty()) }.getOrNull()
                if (!it.isSuccessful || json == null || !json.optBoolean("ok")) {
                    throw IllegalStateException(json?.optString("error")?.ifEmpty { null } ?: "Thiết bị kia từ chối đồng bộ (mã ${it.code}).")
                }
                val replyNonce = TvLogin.decode(json.optString("n")) ?: throw IllegalStateException("Phản hồi không hợp lệ.")
                val replySealed = TvLogin.decode(json.optString("c")) ?: throw IllegalStateException("Phản hồi không hợp lệ.")
                val plain = TvLogin.decrypt(invite.key, invite.token, replyNonce, replySealed)
                    ?: throw IllegalStateException("Không giải mã được dữ liệu trả về.")
                String(plain, Charsets.UTF_8)
            }
        }
        val merged = LibrarySync.parse(reply) ?: throw IllegalStateException("Dữ liệu thư viện trả về không hợp lệ.")
        val summary = withContext(Dispatchers.Main) { LibrarySync.mergeIntoLocal(merged) }
        Log.debug("library sync with ${invite.address}: ${summary.text}")
        return summary
    }
}

/** Receiver side: the one-time HTTP endpoint behind the QR code (TV, phone). */
class SyncReceiver(context: Context) {
    private val appContext = context.applicationContext
    private val token = TvLogin.randomBytes(16)
    private val key = TvLogin.randomBytes(32)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val expiresAt = System.currentTimeMillis() + LanSync.LIFETIME_MS
    private var server: LanServer? = null
    @Volatile private var used = false
    @Volatile private var failures = 0

    val deviceName: String = TvPairingServer.deviceName(appContext)

    var link by mutableStateOf<String?>(null)
        private set
    var address by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var isBusy by mutableStateOf(false)
        private set
    /** Set once a device synced (what it added here). */
    var result by mutableStateOf<LibrarySync.Summary?>(null)
        private set

    fun start() {
        scope.launch {
            val ip = TvPairingServer.localAddress(appContext)
            if (ip == null) {
                error = "Thiết bị chưa kết nối Wi-Fi hoặc mạng nội bộ."
                return@launch
            }
            val lan = LanServer("library sync", LanSync.PORT, LanSync.MAX_BODY) { request -> handle(request) }
            val port = lan.start()
            if (port == null) {
                error = "Không mở được cổng kết nối để đồng bộ."
                return@launch
            }
            server = lan
            address = "$ip:$port"
            link = LanSync.link("$ip:$port", token, key, deviceName)
        }
    }

    fun stop() {
        server?.stop()
        server = null
        scope.cancel()
    }

    private suspend fun handle(request: LanServer.Request): LanServer.Response {
        if (request.path != LanSync.PATH) return LanServer.Response.error(404, "Không có trang này.")
        if (request.method == "GET") return LanServer.Response.ok(JSONObject().put("name", deviceName))
        if (request.method != "POST") return LanServer.Response.error(405, "Phương thức không được hỗ trợ.")
        if (System.currentTimeMillis() > expiresAt) return LanServer.Response.error(410, "Mã QR đã hết hạn. Hãy tạo mã mới.")
        if (used || isBusy) return LanServer.Response.error(409, "Mã QR này đã được dùng. Hãy tạo mã mới.")
        val json = request.json ?: return LanServer.Response.error(400, "Dữ liệu không hợp lệ.")
        val sentToken = TvLogin.decode(json.optString("t"))
        val nonce = TvLogin.decode(json.optString("n"))
        val sealed = TvLogin.decode(json.optString("c"))
        if (sentToken == null || !MessageDigest.isEqual(sentToken, token)) return rejected("Mã QR đã cũ. Hãy quét lại mã đang hiển thị.")
        if (nonce == null || sealed == null) return rejected("Dữ liệu không hợp lệ.")
        val plain = TvLogin.decrypt(key, token, nonce, sealed) ?: return rejected("Không giải mã được dữ liệu.")
        val remote = LibrarySync.parse(String(plain, Charsets.UTF_8)) ?: return LanServer.Response.error(400, "Dữ liệu thư viện không hợp lệ.")
        used = true
        isBusy = true
        val mergedJson = try {
            withContext(Dispatchers.Main) {
                val summary = LibrarySync.mergeIntoLocal(remote)
                result = summary
                LibrarySync.toJson(LibrarySync.local())
            }
        } finally {
            isBusy = false
        }
        val (replyNonce, replySealed) = TvLogin.encrypt(key, token, mergedJson.toByteArray(Charsets.UTF_8))
        Log.debug("library sync: merged a library from ${remote.device ?: "another device"}")
        // Single use: stop listening once the reply is out.
        scope.launch {
            delay(1500)
            server?.stop()
        }
        return LanServer.Response.ok(JSONObject().put("n", TvLogin.encode(replyNonce)).put("c", TvLogin.encode(replySealed)))
    }

    private fun rejected(message: String): LanServer.Response {
        failures++
        if (failures >= 20) {
            error = "Đã dừng vì có quá nhiều lần gửi sai. Hãy tạo mã mới."
            scope.launch { server?.stop() }
        }
        return LanServer.Response.error(403, message)
    }
}
