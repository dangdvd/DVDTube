package com.dangdvd.dvdtube.cast

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.innertube.InnerTube
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import java.io.BufferedInputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * A small HTTP server on the phone that relays YouTube's HLS stream to the TV.
 *
 * The TV cannot always fetch the stream itself: googlevideo URLs are bound to the IP address
 * that requested them (often the phone's IPv6 address) and the receiver's web player needs
 * CORS headers. Through this relay the phone downloads playlists and segments with its own
 * address and hands them to the TV over the local network.
 */
object CastRelay {
    data class Prepared(val url: String, val isFmp4: Boolean)

    private enum class Kind { PLAYLIST, RESOURCE }
    private data class Route(val url: String, val kind: Kind)

    private val routes = ConcurrentHashMap<Int, Route>()
    private val ids = ConcurrentHashMap<String, Int>()
    private val nextId = AtomicInteger(1)
    private val served = AtomicInteger(0)
    private val pool = Executors.newCachedThreadPool()
    private var server: ServerSocket? = null
    @Volatile private var host = "127.0.0.1"
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val upstream by lazy { InnerTube.client.newBuilder().cookieJar(okhttp3.CookieJar.NO_COOKIES).build() }

    /** Starts the relay (once) and registers the master playlist. Blocking: call off the main thread. */
    fun prepare(context: Context, hls: String): Prepared {
        val port = start(context)
        host = localIPv4() ?: throw IllegalStateException("no Wi-Fi address")
        routes.clear()
        ids.clear()
        served.set(0)
        val isFmp4 = detectFmp4(hls)
        val path = register(hls, Kind.PLAYLIST)
        Log.debug("cast relay: ready on port $port, fmp4=$isFmp4")
        return Prepared("http://$host:$port$path", isFmp4)
    }

    @Synchronized
    private fun start(context: Context): Int {
        server?.let { if (!it.isClosed) return it.localPort }
        val socket = ServerSocket(0)
        server = socket
        val app = context.applicationContext
        wifiLock = (app.getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "dvdtube:cast").apply { acquire() }
        wakeLock = (app.getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dvdtube:cast").apply { acquire(6 * 60 * 60 * 1000L) }
        pool.execute {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (error: SocketException) { break }
                pool.execute { handle(client) }
            }
        }
        return socket.localPort
    }

    @Synchronized
    fun stop() {
        runCatching { server?.close() }
        server = null
        routes.clear()
        ids.clear()
        wifiLock?.let { if (it.isHeld) it.release() }
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        wakeLock = null
    }

    private fun register(url: String, kind: Kind): String {
        val id = ids.getOrPut(url) {
            nextId.getAndIncrement().also { routes[it] = Route(url, kind) }
        }
        return if (kind == Kind.PLAYLIST) "/p/$id.m3u8" else "/r/$id"
    }

    private fun proxied(url: String, kind: Kind): String = "http://$host:${server?.localPort ?: 0}${register(url, kind)}"

    // MARK: HTTP

    private fun handle(socket: Socket) {
        socket.use { client ->
            runCatching {
                client.soTimeout = 30_000
                val input = BufferedInputStream(client.getInputStream())
                val head = readHead(input) ?: return
                val lines = head.split("\r\n")
                val parts = lines.first().split(" ")
                if (parts.size < 2) return respond(client.getOutputStream(), 400, emptyMap(), ByteArray(0))
                val method = parts[0]
                val path = parts[1]
                val headers = lines.drop(1).mapNotNull { line ->
                    val colon = line.indexOf(':')
                    if (colon <= 0) null else line.substring(0, colon).lowercase() to line.substring(colon + 1).trim()
                }.toMap()
                val out = client.getOutputStream()
                if (method == "OPTIONS") {
                    return respond(out, 204, mapOf(
                        "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                        "Access-Control-Allow-Headers" to (headers["access-control-request-headers"] ?: "*"),
                        "Access-Control-Max-Age" to "86400",
                    ), ByteArray(0))
                }
                val id = path.substringAfterLast('/').takeWhile { it.isDigit() }.toIntOrNull()
                val route = id?.let { routes[it] }
                if ((method != "GET" && method != "HEAD") || route == null) return respond(out, 404, emptyMap(), ByteArray(0))
                serve(route, headers["range"], method == "GET", out)
            }
        }
    }

    private fun readHead(input: BufferedInputStream): String? {
        val buffer = StringBuilder()
        while (buffer.length < 32_768) {
            val byte = input.read()
            if (byte < 0) return null
            buffer.append(byte.toChar())
            if (buffer.endsWith("\r\n\r\n")) return buffer.substring(0, buffer.length - 4)
        }
        return null
    }

    private fun serve(route: Route, range: String?, includeBody: Boolean, out: OutputStream) {
        val request = Request.Builder().url(route.url)
        if (route.kind == Kind.RESOURCE) {
            range?.let { request.header("Range", it) }
            request.header("Accept-Encoding", "identity")
        }
        try {
            upstream.newCall(request.build()).execute().use { response ->
                val status = response.code
                if (route.kind == Kind.PLAYLIST) {
                    val text = response.body?.string() ?: ""
                    val body = if (status in 200..299) rewrite(text, response.request.url.toString()).toByteArray() else text.toByteArray()
                    note(true, status, body.size)
                    respond(out, status, mapOf("Content-Type" to "application/vnd.apple.mpegurl", "Cache-Control" to "no-cache"),
                        if (includeBody) body else ByteArray(0), body.size.toLong())
                } else {
                    val length = response.body?.contentLength() ?: -1
                    val headers = mutableMapOf(
                        "Content-Type" to (response.header("Content-Type") ?: "application/octet-stream"),
                        "Accept-Ranges" to "bytes",
                    )
                    response.header("Content-Range")?.let { headers["Content-Range"] = it }
                    note(false, status, length.coerceAtLeast(0).toInt())
                    writeHead(out, status, headers, if (length >= 0) length else null)
                    // Segments are streamed to the TV as they arrive instead of being held in memory.
                    if (includeBody) response.body?.byteStream()?.copyTo(out, 64 * 1024)
                    out.flush()
                }
            }
        } catch (error: Exception) {
            Log.debug("cast relay: upstream failed: ${error.message}")
            runCatching { respond(out, 502, emptyMap(), ByteArray(0)) }
        }
    }

    /** Logs the first requests and every failure (enough to see what the TV does). */
    private fun note(isPlaylist: Boolean, status: Int, bytes: Int) {
        val count = served.incrementAndGet()
        if (count <= 6 || status !in 200..299) {
            Log.debug("cast relay: TV got ${if (isPlaylist) "playlist" else "segment"} -> $status, $bytes bytes")
        }
    }

    private fun respond(out: OutputStream, status: Int, headers: Map<String, String>, body: ByteArray, length: Long = body.size.toLong()) {
        writeHead(out, status, headers, length)
        out.write(body)
        out.flush()
    }

    private fun writeHead(out: OutputStream, status: Int, headers: Map<String, String>, contentLength: Long?) {
        val all = headers.toMutableMap()
        all["Access-Control-Allow-Origin"] = "*"
        all["Access-Control-Expose-Headers"] = "Content-Length, Content-Range"
        contentLength?.let { all["Content-Length"] = it.toString() }
        all["Connection"] = "close"
        val head = buildString {
            append("HTTP/1.1 $status ${reason(status)}\r\n")
            for ((key, value) in all) append("$key: $value\r\n")
            append("\r\n")
        }
        out.write(head.toByteArray())
    }

    private fun reason(status: Int): String = when (status) {
        200 -> "OK"
        204 -> "No Content"
        206 -> "Partial Content"
        400 -> "Bad Request"
        403 -> "Forbidden"
        404 -> "Not Found"
        502 -> "Bad Gateway"
        else -> "Status"
    }

    // MARK: Playlists

    /**
     * Points every URI of a playlist at the relay. In a master playlist only H.264 + AAC
     * variants are kept (every Chromecast decodes them; VP9/AV1/HEVC may not be).
     */
    private fun rewrite(text: String, base: String): String {
        val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val isMaster = lines.any { it.startsWith("#EXT-X-STREAM-INF") }
        val keep = variantFilter(lines)
        val childKind = if (isMaster) Kind.PLAYLIST else Kind.RESOURCE
        val output = ArrayList<String>()
        var skipNextUri = false
        for (line in lines) {
            if (line.startsWith("#")) {
                if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) continue
                if (line.startsWith("#EXT-X-STREAM-INF") && !keep(line)) {
                    skipNextUri = true
                    continue
                }
                output.add(rewriteAttributes(line, base, childKind))
            } else {
                if (skipNextUri) {
                    skipNextUri = false
                    continue
                }
                output.add(resolve(base, line)?.let { proxied(it, childKind) } ?: line)
            }
        }
        return output.joinToString("\n") + "\n"
    }

    private fun resolve(base: String, uri: String): String? = base.toHttpUrlOrNull()?.resolve(uri)?.toString()

    /** Prefers H.264 variants with AAC audio, falling back to whatever the playlist has. */
    private fun variantFilter(lines: List<String>): (String) -> Boolean {
        val variants = lines.filter { it.startsWith("#EXT-X-STREAM-INF") }
        val isAvc: (String) -> Boolean = { line ->
            val codecs = attribute("CODECS", line) ?: ""
            codecs.contains("avc1") && listOf("vp09", "vp9", "av01", "hvc1", "hev1", "dvh1").none { codecs.contains(it) }
        }
        val isAvcWithAac: (String) -> Boolean = { line ->
            val codecs = attribute("CODECS", line) ?: ""
            isAvc(line) && (codecs.contains("mp4a") || !codecs.contains(","))
        }
        return when {
            variants.any(isAvcWithAac) -> isAvcWithAac
            variants.any(isAvc) -> isAvc
            else -> { _ -> true }
        }
    }

    private fun rewriteAttributes(line: String, base: String, kind: Kind): String {
        val start = line.indexOf("URI=\"")
        if (start < 0) return line
        val valueStart = start + 5
        val end = line.indexOf('"', valueStart)
        if (end < 0) return line
        val url = resolve(base, line.substring(valueStart, end)) ?: return line
        // In a master playlist EXT-X-MEDIA points at media playlists; EXT-X-MAP / KEY at resources.
        val attributeKind = if (line.startsWith("#EXT-X-MEDIA")) kind else Kind.RESOURCE
        return line.substring(0, valueStart) + proxied(url, attributeKind) + line.substring(end)
    }

    private fun attribute(name: String, line: String): String? {
        val index = line.indexOf("$name=")
        if (index < 0) return null
        val rest = line.substring(index + name.length + 1)
        return if (rest.startsWith("\"")) rest.drop(1).substringBefore('"') else rest.substringBefore(',')
    }

    /** Looks at the first usable media playlist: fMP4 segments come with `#EXT-X-MAP`. */
    private fun detectFmp4(master: String): Boolean {
        return try {
            val text = upstream.newCall(Request.Builder().url(master).build()).execute().use { it.body?.string() ?: "" }
            val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
            if (lines.none { it.startsWith("#EXT-X-STREAM-INF") }) return lines.any { it.startsWith("#EXT-X-MAP") }
            val keep = variantFilter(lines)
            val index = lines.indexOfFirst { it.startsWith("#EXT-X-STREAM-INF") && keep(it) }
            val variant = lines.getOrNull(index + 1)?.let { resolve(master, it) } ?: return true
            upstream.newCall(Request.Builder().url(variant).build()).execute().use { it.body?.string() ?: "" }.contains("#EXT-X-MAP")
        } catch (error: Exception) {
            true
        }
    }

    /** This phone's IPv4 address on Wi-Fi (or another local interface). */
    fun localIPv4(): String? {
        var fallback: String? = null
        for (network in NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()) {
            if (!network.isUp || network.isLoopback) continue
            for (address in network.inetAddresses.toList()) {
                if (address !is Inet4Address || address.isLinkLocalAddress) continue
                val ip = address.hostAddress ?: continue
                if (network.name.startsWith("wlan")) return ip
                if (fallback == null && !network.name.startsWith("rmnet") && !network.name.startsWith("tun")) fallback = ip
            }
        }
        return fallback
    }
}
