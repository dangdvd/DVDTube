package com.dangdvd.dvdtube.core

import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.InetAddress
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * "Sign in on TV": the TV shows a QR code with a one-time token and an AES-256 key; the phone
 * that scans it sends its YouTube session (cookies) to the TV over the local network, encrypted
 * with that key. Format (shared with the iPhone app):
 * `dvdtube://tv-login?h=<ip>:<port>&t=<token>&k=<key>&n=<TV name>` (base64url without padding),
 * then `POST http://<h>/pair` with `{"t":token,"n":nonce,"c":ciphertext+tag}`, AES/GCM with the
 * token as associated data, plaintext `{"cookies":{…}}`.
 */
object TvLogin {
    const val PATH = "/pair"
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128

    /** What the TV's QR code holds. */
    data class Invite(val host: String, val token: ByteArray, val key: ByteArray, val tvName: String) {
        /** The address without the port, as shown to the user. */
        val address: String get() = host.substringBeforeLast(':')
    }

    private val random = SecureRandom()

    fun randomBytes(count: Int): ByteArray = ByteArray(count).also { random.nextBytes(it) }

    fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** base64url with or without padding (standard base64 is accepted too). */
    fun decode(text: String): ByteArray? =
        runCatching { Base64.getUrlDecoder().decode(text.trim().replace('+', '-').replace('/', '_')) }.getOrNull()

    fun link(host: String, token: ByteArray, key: ByteArray, tvName: String): String =
        "dvdtube://tv-login?h=$host&t=${encode(token)}&k=${encode(key)}&n=" + URLEncoder.encode(tvName, "UTF-8")

    /** Parses the QR code's link; only addresses of the local network are accepted. */
    fun parse(text: String): Invite? {
        val uri = runCatching { Uri.parse(text.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "dvdtube" || uri.host != "tv-login") return null
        val host = uri.getQueryParameter("h") ?: return null
        val token = uri.getQueryParameter("t")?.let(::decode) ?: return null
        val key = uri.getQueryParameter("k")?.let(::decode) ?: return null
        if (token.size != 16 || key.size != 32 || !isLocalHost(host)) return null
        val name = uri.getQueryParameter("n")?.trim().orEmpty().ifEmpty { "TV" }
        return Invite(host, token, key, name)
    }

    /**
     * `a.b.c.d:port` in a private range (10/8, 172.16/12, 192.168/16, 169.254/16): a QR code
     * from elsewhere must not be able to send the session to a server on the internet.
     */
    fun isLocalHost(host: String): Boolean {
        val match = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3}):(\\d{1,5})$").matchEntire(host) ?: return false
        val parts = match.groupValues.drop(1).map { it.toInt() }
        if (parts.take(4).any { it > 255 } || parts[4] !in 1..65535) return false
        val (a, b) = parts
        return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
    }

    fun isLocalAddress(address: InetAddress): Boolean = address.isSiteLocalAddress || address.isLinkLocalAddress

    fun encrypt(key: ByteArray, token: ByteArray, plaintext: ByteArray): Pair<ByteArray, ByteArray> {
        val nonce = randomBytes(NONCE_BYTES)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(token)
        return nonce to cipher.doFinal(plaintext)
    }

    /** Null when the data was not encrypted with [key] for [token] (or was changed). */
    fun decrypt(key: ByteArray, token: ByteArray, nonce: ByteArray, ciphertext: ByteArray): ByteArray? = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(token)
        cipher.doFinal(ciphertext)
    }.getOrNull()

    fun cookiesJson(cookies: Map<String, String>): String =
        JSONObject().put("cookies", JSONObject(cookies)).toString()

    fun cookiesFrom(plaintext: ByteArray): Map<String, String>? = runCatching {
        val cookies = JSONObject(String(plaintext, Charsets.UTF_8)).getJSONObject("cookies")
        cookies.keys().asSequence().associateWith { cookies.getString(it) }
    }.getOrNull()

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Phone side: sends [cookies] to the TV. Returns the account name the TV reports on success,
     * or throws with a message for the user.
     */
    suspend fun send(invite: Invite, cookies: Map<String, String>): String = withContext(Dispatchers.IO) {
        val (nonce, sealed) = encrypt(invite.key, invite.token, cookiesJson(cookies).toByteArray(Charsets.UTF_8))
        val body = JSONObject()
            .put("t", encode(invite.token))
            .put("n", encode(nonce))
            .put("c", encode(sealed))
            .toString()
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val call = client.newCall(Request.Builder().url("http://${invite.host}$PATH").post(body).build())
        val response = try {
            call.execute()
        } catch (error: java.io.IOException) {
            throw IllegalStateException("Không kết nối được tới TV. Điện thoại và TV phải cùng mạng Wi-Fi.")
        }
        response.use {
            val reply = runCatching { JSONObject(it.body?.string().orEmpty()) }.getOrNull()
            if (it.isSuccessful && reply != null && reply.optBoolean("ok")) return@use reply.optString("name")
            throw IllegalStateException(reply?.optString("error")?.ifEmpty { null } ?: "TV từ chối đăng nhập (mã ${it.code}).")
        }
    }
}
