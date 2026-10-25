package com.dangdvd.dvdtube.core.net

import com.dangdvd.dvdtube.core.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * A tiny HTTP/1.1 JSON server for the local network (the cast receiver and the library sync
 * receiver). One request per connection, `Content-Length` bodies only, and only clients with a
 * private / loopback / link-local address are served — anything else gets 403.
 */
class LanServer(
    private val label: String,
    private val preferredPort: Int,
    private val maxBody: Int,
    private val handler: suspend (Request) -> Response,
) {
    class Request(
        val method: String,
        val path: String,
        val query: Map<String, String>,
        val headers: Map<String, String>,
        val body: ByteArray,
        val remote: InetAddress?,
    ) {
        val bodyText: String get() = String(body, Charsets.UTF_8)
        val json: JSONObject? get() = runCatching { JSONObject(bodyText) }.getOrNull()
    }

    class Response(val status: Int, val body: String) {
        companion object {
            fun ok(json: JSONObject = JSONObject()): Response = Response(200, json.put("ok", true).toString())
            fun error(status: Int, message: String): Response =
                Response(status, JSONObject().put("ok", false).put("error", message).toString())
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var socket: ServerSocket? = null

    /** The port actually listened on, once started. */
    @Volatile var port: Int = 0
        private set

    val isRunning: Boolean get() = socket?.isClosed == false

    /** Binds (the preferred port, else any free one) and serves in the background. Returns the port or null. */
    fun start(): Int? {
        if (isRunning) return port
        val server = runCatching { bind(preferredPort) }.recoverCatching { bind(0) }.getOrElse {
            Log.error("$label: cannot listen (${it.message})")
            return null
        }
        socket = server
        port = server.localPort
        Log.debug("$label: listening on port $port")
        scope.launch {
            while (isActive) {
                val client = try {
                    server.accept()
                } catch (_: IOException) {
                    break
                }
                launch { handle(client) }
            }
        }
        return port
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
        client.use { connection ->
            connection.soTimeout = 15_000
            val response = try {
                if (!isPrivateAddress(connection.inetAddress)) {
                    Response.error(403, "Chỉ nhận kết nối từ mạng nội bộ.")
                } else {
                    val request = read(BufferedInputStream(connection.getInputStream()), connection.inetAddress)
                    if (request == null) Response.error(400, "Yêu cầu không hợp lệ.") else handler(request)
                }
            } catch (error: PayloadTooLarge) {
                Response.error(413, "Dữ liệu quá lớn.")
            } catch (error: LengthRequired) {
                Response.error(411, "Thiếu Content-Length.")
            } catch (error: IOException) {
                Response.error(400, "Yêu cầu không hợp lệ.")
            } catch (error: Exception) {
                Log.error("$label: request failed (${error.javaClass.simpleName}: ${error.message})")
                Response.error(500, "Lỗi máy nhận: ${error.message ?: "không rõ"}")
            }
            write(connection, response)
        }
    }

    private class PayloadTooLarge : IOException()
    private class LengthRequired : IOException()

    private fun read(input: InputStream, remote: InetAddress?): Request? {
        val head = readHead(input) ?: return null
        val lines = head.split("\r\n")
        val parts = lines.first().split(" ")
        if (parts.size < 2) return null
        val method = parts[0].uppercase()
        val target = parts[1]
        val path = target.substringBefore('?')
        val query = if ('?' in target) {
            target.substringAfter('?').split('&').filter { it.isNotEmpty() }.associate { pair ->
                val key = java.net.URLDecoder.decode(pair.substringBefore('='), "UTF-8")
                val value = java.net.URLDecoder.decode(pair.substringAfter('=', ""), "UTF-8")
                key to value
            }
        } else {
            emptyMap()
        }
        val headers = lines.drop(1).mapNotNull { line ->
            val index = line.indexOf(':')
            if (index <= 0) null else line.substring(0, index).trim().lowercase() to line.substring(index + 1).trim()
        }.toMap()
        val length = headers["content-length"]?.toIntOrNull()
        val body = if (method == "POST" || method == "PUT") {
            if (length == null) throw LengthRequired()
            if (length < 0 || length > maxBody) throw PayloadTooLarge()
            val bytes = ByteArray(length)
            var read = 0
            while (read < length) {
                val count = input.read(bytes, read, length - read)
                if (count < 0) throw IOException("truncated")
                read += count
            }
            bytes
        } else {
            ByteArray(0)
        }
        return Request(method, path, query, headers, body, remote)
    }

    private fun write(connection: Socket, response: Response) {
        val bytes = response.body.toByteArray(Charsets.UTF_8)
        val reason = when (response.status) {
            200 -> "OK"
            400 -> "Bad Request"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            409 -> "Conflict"
            410 -> "Gone"
            411 -> "Length Required"
            413 -> "Payload Too Large"
            else -> "Error"
        }
        runCatching {
            val output = connection.getOutputStream()
            output.write(
                ("HTTP/1.1 ${response.status} $reason\r\nContent-Type: application/json; charset=utf-8\r\n" +
                    "Content-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray(Charsets.ISO_8859_1),
            )
            output.write(bytes)
            output.flush()
        }
    }

    /** Request line and headers (up to the blank line), at most 16 KB. */
    private fun readHead(input: InputStream): String? {
        val buffer = StringBuilder()
        var matched = 0
        val end = "\r\n\r\n"
        while (buffer.length < 16_384) {
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
        /**
         * 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, ::1, fc00::/7 and fe80::/10.
         */
        fun isPrivateAddress(address: InetAddress?): Boolean {
            address ?: return false
            if (address.isLoopbackAddress || address.isLinkLocalAddress) return true
            if (address is Inet4Address) return address.isSiteLocalAddress
            if (address is Inet6Address) {
                val first = address.address[0].toInt() and 0xff
                if ((first and 0xfe) == 0xfc) return true
                // IPv4-mapped (::ffff:a.b.c.d).
                val bytes = address.address
                val mapped = (0 until 10).all { bytes[it].toInt() == 0 } && bytes[10].toInt() == -1 && bytes[11].toInt() == -1
                if (mapped) {
                    val v4 = runCatching { InetAddress.getByAddress(bytes.copyOfRange(12, 16)) }.getOrNull()
                    return v4 != null && (v4.isLoopbackAddress || v4.isLinkLocalAddress || v4.isSiteLocalAddress)
                }
            }
            return false
        }
    }
}
