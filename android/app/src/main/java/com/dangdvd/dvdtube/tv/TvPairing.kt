package com.dangdvd.dvdtube.tv

import android.content.Context
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.TvLogin
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest

/**
 * TV side of "sign in from the phone": a one-time HTTP endpoint on the local network that accepts
 * the phone's encrypted YouTube session (see [TvLogin] for the format) and signs the TV in with it.
 */
class TvPairingServer(context: Context) {
    private val appContext = context.applicationContext
    private val token = TvLogin.randomBytes(16)
    private val key = TvLogin.randomBytes(32)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var socket: ServerSocket? = null
    private var failures = 0

    val tvName: String = deviceName(appContext)

    /** The QR code's link, once the server listens. */
    var link by mutableStateOf<String?>(null)
        private set
    var address by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** Set when a phone signed the TV in (account name, may be empty). */
    var signedInName by mutableStateOf<String?>(null)
        private set
    var isBusy by mutableStateOf(false)
        private set

    fun start() {
        scope.launch {
            val ip = localAddress(appContext)
            if (ip == null) {
                error = "TV chưa kết nối mạng Wi-Fi hoặc cáp mạng."
                return@launch
            }
            val server = runCatching { bind(PORT) }.recoverCatching { bind(0) }.getOrElse {
                error = "Không mở được cổng kết nối trên TV: ${it.message}"
                return@launch
            }
            socket = server
            address = "$ip:${server.localPort}"
            link = TvLogin.link("$ip:${server.localPort}", token, key, tvName)
            Log.debug("tv pairing: listening on port ${server.localPort}")
            while (isActive) {
                val client = try {
                    server.accept()
                } catch (_: IOException) {
                    break
                }
                launch { handle(client) }
            }
        }
    }

    fun stop() {
        runCatching { socket?.close() }
        socket = null
        scope.cancel()
    }

    private fun bind(port: Int): ServerSocket = ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(port))
    }

    private suspend fun handle(client: Socket) {
        client.use { socket ->
            socket.soTimeout = 10_000
            val input = BufferedInputStream(socket.getInputStream())
            val (status, body) = try {
                respondTo(input)
            } catch (_: IOException) {
                400 to failure("Yêu cầu không hợp lệ.")
            }
            val bytes = body.toByteArray(Charsets.UTF_8)
            val reason = when (status) {
                200 -> "OK"
                400 -> "Bad Request"
                403 -> "Forbidden"
                404 -> "Not Found"
                405 -> "Method Not Allowed"
                413 -> "Payload Too Large"
                else -> "Error"
            }
            runCatching {
                val output = socket.getOutputStream()
                output.write(
                    ("HTTP/1.1 $status $reason\r\nContent-Type: application/json; charset=utf-8\r\n" +
                        "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.ISO_8859_1),
                )
                output.write(bytes)
                output.flush()
            }
        }
    }

    private suspend fun respondTo(input: InputStream): Pair<Int, String> {
        val head = readHead(input) ?: return 400 to failure("Yêu cầu không hợp lệ.")
        val lines = head.split("\r\n")
        val parts = lines.first().split(" ")
        if (parts.size < 2) return 400 to failure("Yêu cầu không hợp lệ.")
        val method = parts[0]
        val path = parts[1].substringBefore('?')
        if (path != TvLogin.PATH) return 404 to failure("Không có trang này.")
        if (method == "GET") return 200 to JSONObject().put("ok", true).put("tv", tvName).toString()
        if (method != "POST") return 405 to failure("Phương thức không được hỗ trợ.")

        val headers = lines.drop(1).mapNotNull { line ->
            val index = line.indexOf(':')
            if (index <= 0) null else line.substring(0, index).trim().lowercase() to line.substring(index + 1).trim()
        }.toMap()
        val length = headers["content-length"]?.toIntOrNull() ?: return 400 to failure("Thiếu Content-Length.")
        if (length <= 0 || length > MAX_BODY) return 413 to failure("Dữ liệu quá lớn.")
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val count = input.read(body, read, length - read)
            if (count < 0) return 400 to failure("Dữ liệu bị cắt ngang.")
            read += count
        }

        if (isBusy || signedInName != null) return 403 to failure("TV đang xử lý một lần đăng nhập khác.")
        val json = runCatching { JSONObject(String(body, Charsets.UTF_8)) }.getOrNull() ?: return 400 to failure("Dữ liệu không hợp lệ.")
        val sentToken = TvLogin.decode(json.optString("t"))
        val nonce = TvLogin.decode(json.optString("n"))
        val sealed = TvLogin.decode(json.optString("c"))
        if (sentToken == null || !MessageDigest.isEqual(sentToken, token)) return rejected("Mã QR đã cũ. Hãy quét lại mã đang hiện trên TV.")
        if (nonce == null || sealed == null) return rejected("Dữ liệu không hợp lệ.")
        val plaintext = TvLogin.decrypt(key, token, nonce, sealed) ?: return rejected("Không giải mã được dữ liệu đăng nhập.")
        val cookies = TvLogin.cookiesFrom(plaintext) ?: return rejected("Dữ liệu đăng nhập không hợp lệ.")

        isBusy = true
        val problem = try {
            withContext(Dispatchers.Main) { AccountStore.completeSignIn(cookies, fromWebLogin = false, addingAccount = false) }
        } finally {
            isBusy = false
        }
        if (problem != null) return 400 to failure(problem)
        val name = AccountStore.profile?.name.orEmpty()
        signedInName = name
        Log.debug("tv pairing: signed in from the phone")
        // The code is single-use: stop listening once the reply is out.
        scope.launch {
            delay(1000)
            stop()
        }
        return 200 to JSONObject().put("ok", true).put("name", name).toString()
    }

    /** Too many bad attempts close the endpoint (someone else on the network guessing). */
    private fun rejected(message: String): Pair<Int, String> {
        failures++
        if (failures >= 20) {
            error = "Đã dừng vì có quá nhiều lần gửi sai. Hãy tạo mã mới."
            scope.launch { stop() }
        }
        return 403 to failure(message)
    }

    private fun failure(message: String): String = JSONObject().put("ok", false).put("error", message).toString()

    /** Request line and headers (up to the blank line), at most 8 KB. */
    private fun readHead(input: InputStream): String? {
        val buffer = StringBuilder()
        var matched = 0
        val end = "\r\n\r\n"
        while (buffer.length < 8192) {
            val byte = input.read()
            if (byte < 0) return null
            val char = byte.toChar()
            buffer.append(char)
            matched = if (char == end[matched]) matched + 1 else if (char == '\r') 1 else 0
            if (matched == end.length) return buffer.substring(0, buffer.length - end.length)
        }
        return null
    }

    companion object {
        const val PORT = 8765
        private const val MAX_BODY = 64 * 1024

        fun deviceName(context: Context): String =
            runCatching { Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) }.getOrNull()
                ?.trim()?.ifEmpty { null } ?: Build.MODEL ?: "Android TV"

        /** The TV's IPv4 address on the local network. */
        fun localAddress(context: Context): String? {
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            val active = runCatching { connectivity?.let { it.getLinkProperties(it.activeNetwork) } }.getOrNull()
            active?.linkAddresses?.map { it.address }
                ?.firstOrNull { it is Inet4Address && TvLogin.isLocalAddress(it) }
                ?.hostAddress?.let { return it }
            return runCatching {
                NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                    .filter { it.isUp && !it.isLoopback }
                    .flatMap { it.inetAddresses.toList() }
                    .firstOrNull { it is Inet4Address && TvLogin.isLocalAddress(it) }
                    ?.hostAddress
            }.getOrNull()
        }

        fun qrCode(text: String, size: Int = 480): ImageBitmap {
            val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
            val width = matrix.width
            val height = matrix.height
            val pixels = IntArray(width * height) { index ->
                if (matrix.get(index % width, index / width)) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            }
            return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888).asImageBitmap()
        }
    }
}
