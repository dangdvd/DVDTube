package com.dangdvd.dvdtube.cast

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.ModelJson
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.net.LanServer
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.tv.TvPairingServer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * "Truyền tới DVDTube" — the phone side: finds DVDTube TVs / PCs on the network (DNS-SD
 * `_dvdtube._tcp`, or an address typed by hand), sends them video ids and acts as their remote,
 * mirroring `/api/status` into [PlayerController] once a second.
 */
object DvdCastSender {
    data class Device(
        val id: String,
        val name: String,
        val kind: String,
        val host: String,
        val port: Int,
        val manual: Boolean = false,
        /** DNS-SD instance name (to notice when the service goes away). */
        val serviceName: String? = null,
    ) {
        val address: String get() = (if (host.contains(':')) "[$host]" else host) + ":$port"
        val baseUrl: String get() = "http://$address"
        val isDesktop: Boolean get() = kind == "desktop"
    }

    /** What the receiver reports (`/api/status`). */
    data class RemoteStatus(
        val state: String,
        val video: VideoItem?,
        val position: Double,
        val duration: Double,
        val volume: Float,
        val muted: Boolean,
        val queue: List<VideoItem>,
        val index: Int,
        val error: String?,
    )

    private lateinit var appContext: Context
    private var nsd: NsdManager? = null
    private var discovery: NsdManager.DiscoveryListener? = null
    private val resolveQueue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var pollJob: Job? = null
    private var failures = 0

    var discovered by mutableStateOf(listOf<Device>())
        private set
    var manualDevices by mutableStateOf(listOf<Device>())
        private set
    var isDiscovering by mutableStateOf(false)
        private set
    var connected by mutableStateOf<Device?>(null)
        private set
    var status by mutableStateOf<RemoteStatus?>(null)
        private set
    /** Connection problems etc. ("Mất kết nối…"), null while all is well. */
    var statusText by mutableStateOf<String?>(null)
        private set
    /** The remote-control sheet is shown. */
    var showRemote by mutableStateOf(false)
    /** The receiver serves `/api/queue/edit` (its `/api/info` features list "queue-edit"). */
    var supportsQueueEdit by mutableStateOf(false)
        private set
    private var lastQueueEditAt = 0L

    val isConnected: Boolean get() = connected != null

    /** A moment after a queue edit from here, when statuses may still show the old queue. */
    val queueEditPending: Boolean get() = System.currentTimeMillis() - lastQueueEditAt < 1500

    /** The receiver has a video loaded: picking another one asks whether to play it now or queue it. */
    val receiverBusy: Boolean
        get() = status?.let { it.video != null && it.state in setOf("playing", "paused", "buffering", "loading") } == true

    /** Discovered receivers first, then the ones added by address. */
    val devices: List<Device>
        get() = discovered + manualDevices.filter { manual -> discovered.none { it.id == manual.id || it.address == manual.address } }

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build()
    }
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun init(context: Context) {
        appContext = context.applicationContext
        manualDevices = runCatching {
            val array = JNode.parse(AppSettings.manualCastDevices.ifBlank { "[]" })
            array.array.mapNotNull { node ->
                val host = node["host"].string ?: return@mapNotNull null
                val port = node["port"].int ?: return@mapNotNull null
                Device(node["id"].string ?: "$host:$port", node["name"].string ?: host, node["kind"].string ?: "tv", host, port, manual = true)
            }
        }.getOrDefault(emptyList())
    }

    private val senderName: String get() = runCatching { TvPairingServer.deviceName(appContext) }.getOrDefault("Android")

    // MARK: Discovery

    fun startDiscovery() {
        if (discovery != null) return
        val manager = appContext.getSystemService(NsdManager::class.java) ?: return
        nsd = manager
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                AppScope.launch { isDiscovering = true }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                AppScope.launch { isDiscovering = false }
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.debug("cast: discovery failed ($errorCode)")
                AppScope.launch {
                    isDiscovering = false
                    discovery = null
                }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                AppScope.launch { enqueueResolve(serviceInfo) }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                AppScope.launch {
                    discovered = discovered.filter { it.serviceName != serviceInfo.serviceName }
                }
            }
        }
        discovery = listener
        runCatching { manager.discoverServices(DvdCastReceiver.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }
            .onFailure {
                Log.debug("cast: cannot discover (${it.message})")
                discovery = null
            }
    }

    fun stopDiscovery() {
        val listener = discovery ?: return
        discovery = null
        runCatching { nsd?.stopServiceDiscovery(listener) }
        isDiscovering = false
    }

    /** Resolves one service at a time (older Android refuses parallel resolves). */
    private fun enqueueResolve(info: NsdServiceInfo) {
        resolveQueue.addLast(info)
        resolveNext()
    }

    @Suppress("DEPRECATION")
    private fun resolveNext() {
        if (resolving) return
        val manager = nsd ?: return
        val next = resolveQueue.removeFirstOrNull() ?: return
        resolving = true
        val listener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                AppScope.launch {
                    resolving = false
                    resolveNext()
                }
            }

            override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                AppScope.launch {
                    resolving = false
                    deviceFrom(serviceInfo)?.let(::addDiscovered)
                    resolveNext()
                }
            }
        }
        runCatching { manager.resolveService(next, listener) }.onFailure {
            resolving = false
        }
    }

    @Suppress("DEPRECATION")
    private fun deviceFrom(info: NsdServiceInfo): Device? {
        val address: InetAddress? = if (Build.VERSION.SDK_INT >= 34) info.hostAddresses.firstOrNull { it is java.net.Inet4Address } ?: info.hostAddresses.firstOrNull() else info.host
        val host = address?.hostAddress?.substringBefore('%') ?: return null
        if (!LanServer.isPrivateAddress(address)) return null
        val attributes = runCatching { info.attributes }.getOrNull().orEmpty()
        fun text(key: String): String? = attributes[key]?.let { String(it, Charsets.UTF_8) }?.trim()?.ifEmpty { null }
        val id = text("id") ?: "$host:${info.port}"
        val name = text("name") ?: info.serviceName ?: host
        return Device(id, name, text("kind") ?: "tv", host, info.port, serviceName = info.serviceName)
    }

    private fun addDiscovered(device: Device) {
        discovered = discovered.filter { it.id != device.id } + device
    }

    // MARK: Manual devices

    /** Checks "ip:port" (port 8766 when left out) with `/api/info` and remembers the receiver. */
    suspend fun addManual(text: String): Device {
        val trimmed = text.trim().removePrefix("http://").trimEnd('/')
        val host = trimmed.substringBeforeLast(':', trimmed).trim().removePrefix("[").removeSuffix("]")
        val port = if (trimmed.contains(':') && !trimmed.endsWith("]")) trimmed.substringAfterLast(':').toIntOrNull() else DvdCastReceiver.PORT
        if (host.isEmpty() || port == null || port !in 1..65535) throw IllegalArgumentException("Địa chỉ không hợp lệ. Ví dụ: 192.168.1.20:8766")
        val inet = withContext(Dispatchers.IO) { runCatching { InetAddress.getByName(host) }.getOrNull() }
        if (!LanServer.isPrivateAddress(inet)) throw IllegalArgumentException("Chỉ dùng được địa chỉ trong mạng nội bộ (192.168.x.x, 10.x.x.x…).")
        val probe = Device("$host:$port", host, "tv", host, port, manual = true)
        val info = request(probe, "/api/info", null) ?: throw IllegalStateException("Không kết nối được tới $host:$port. Hãy mở DVDTube trên thiết bị đó.")
        if (info["app"].string != "DVDTube") throw IllegalStateException("Thiết bị này không phải DVDTube.")
        val device = probe.copy(
            id = info["id"].string ?: probe.id,
            name = info["name"].string ?: host,
            kind = info["kind"].string ?: "tv",
        )
        manualDevices = manualDevices.filter { it.id != device.id && it.address != device.address } + device
        saveManual()
        return device
    }

    fun removeManual(device: Device) {
        manualDevices = manualDevices.filter { it.id != device.id }
        saveManual()
    }

    private fun saveManual() {
        val array = JSONArray()
        manualDevices.forEach { device ->
            array.put(JSONObject().put("id", device.id).put("name", device.name).put("kind", device.kind).put("host", device.host).put("port", device.port))
        }
        AppSettings.manualCastDevices = array.toString()
    }

    // MARK: Connection

    /**
     * Starts casting to [device]: local playback stops and [video] (or what plays now, at its
     * position) continues on the receiver.
     */
    fun connect(device: Device, video: VideoItem? = null) {
        if (CastController.isConnected) CastController.disconnect()
        connected = device
        status = null
        statusText = "Đang kết nối…"
        failures = 0
        supportsQueueEdit = false
        AppScope.launch {
            val info = request(device, "/api/info", null)
            if (connected?.id == device.id) supportsQueueEdit = info != null && info["features"].array.any { it.string == "queue-edit" }
        }
        val current = PlayerController.currentVideo
        val position = PlayerController.currentTime
        PlayerController.castDidConnect()
        Log.debug("cast: connected to a DVDTube ${device.kind}")
        val target = video ?: current
        when {
            target == null -> statusText = null
            current != null && target.id == current.id ->
                playOnReceiver(current, position, PlayerController.queue, PlayerController.queueIndex)
            else -> PlayerController.play(target)
        }
        startPolling()
    }

    /** Stops casting; [resumeHere] continues on this phone at the receiver's position. */
    fun disconnect(resumeHere: Boolean = false, stopReceiver: Boolean = true) {
        val device = connected ?: return
        val position = status?.position ?: PlayerController.currentTime
        if (stopReceiver) send(device, "/api/control", JSONObject().put("action", "stop").put("value", JSONObject.NULL))
        pollJob?.cancel()
        pollJob = null
        connected = null
        status = null
        statusText = null
        showRemote = false
        supportsQueueEdit = false
        PlayerController.castDidEnd()
        if (resumeHere) PlayerController.resumeLocally(position)
        Log.debug("cast: disconnected from the DVDTube receiver")
    }

    // MARK: Commands

    fun playOnReceiver(video: VideoItem, startAt: Double?, queue: List<VideoItem>?, index: Int?) {
        val device = connected ?: return
        val body = JSONObject()
            .put("video", ModelJson.video(video))
            .put("startSeconds", startAt?.takeIf { it > 0 } ?: JSONObject.NULL)
            .put("queue", queue?.takeIf { it.size > 1 }?.let(ModelJson::videos) ?: JSONObject.NULL)
            .put("index", if (queue != null && queue.size > 1 && index != null) index else JSONObject.NULL)
            .put("playlistId", PlayerController.playlistId ?: JSONObject.NULL)
            .put("sender", senderName)
        statusText = "Đang gửi video tới ${device.name}…"
        send(device, "/api/play", body) { ok, error ->
            statusText = if (ok) null else error ?: "${device.name} không phát được video này."
        }
    }

    fun queueOnReceiver(video: VideoItem, next: Boolean) {
        val device = connected ?: return
        send(device, "/api/queue", JSONObject().put("video", ModelJson.video(video)).put("next", next)) { ok, error ->
            Toasts.show(if (ok) (if (next) "Sẽ phát tiếp theo trên ${device.name}" else "Đã thêm vào hàng đợi trên ${device.name}") else error ?: "Không gửi được tới ${device.name}")
        }
    }

    /** "Phát ngay" keeping the receiver's queue: the video goes next in line, then the receiver skips to it. */
    fun playNow(video: VideoItem) {
        val device = connected ?: return
        lastQueueEditAt = System.currentTimeMillis()
        send(device, "/api/queue", JSONObject().put("video", ModelJson.video(video)).put("next", true)) { ok, error ->
            if (ok) control("next") else Toasts.show(error ?: "Không gửi được tới ${device.name}")
        }
    }

    /** Edits the receiver's queue; false (with a message) when its DVDTube is too old for that. */
    fun editQueue(op: String, index: Int, videoId: String?, to: Int? = null): Boolean {
        val device = connected ?: return false
        if (!supportsQueueEdit) {
            Toasts.show("Hãy cập nhật DVDTube trên ${device.name} để sửa hàng đợi từ điện thoại")
            return false
        }
        lastQueueEditAt = System.currentTimeMillis()
        val body = JSONObject().put("op", op).put("index", index).put("videoId", videoId ?: JSONObject.NULL).put("to", to ?: JSONObject.NULL)
        send(device, "/api/queue/edit", body) { ok, error ->
            if (!ok) Toasts.show(error ?: "Không sửa được hàng đợi trên ${device.name}")
        }
        return true
    }

    fun control(action: String, value: Double? = null) {
        val device = connected ?: return
        send(device, "/api/control", JSONObject().put("action", action).put("value", value ?: JSONObject.NULL)) { ok, error ->
            if (!ok && error != null) Toasts.show(error)
        }
    }

    fun setVolume(level: Float) = control("volume", level.coerceIn(0f, 1f).toDouble())

    fun setMuted(muted: Boolean) = control("mute", if (muted) 1.0 else 0.0)

    /** POSTs in the background; [done] runs on the main thread with (success, error message). */
    private fun send(device: Device, path: String, body: JSONObject, done: ((Boolean, String?) -> Unit)? = null) {
        AppScope.launch {
            val reply = runCatching { request(device, path, body) }.getOrNull()
            val ok = reply?.get("ok")?.bool == true
            reply?.let { applyStatus(it) }
            done?.invoke(ok, reply?.get("error")?.string)
        }
    }

    /** One JSON request (GET without a body); null when the receiver can't be reached. */
    private suspend fun request(device: Device, path: String, body: JSONObject?): JNode? = withContext(Dispatchers.IO) {
        try {
            val builder = Request.Builder().url(device.baseUrl + path).header("Accept", "application/json")
            if (body != null) builder.post(body.toString().toRequestBody(jsonType))
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                runCatching { JNode.parse(text) }.getOrNull()?.takeIf { it.raw is JSONObject }
                    ?: JNode(JSONObject().put("ok", false).put("error", "Phản hồi không hợp lệ (HTTP ${response.code})."))
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            null
        }
    }

    // MARK: Status

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = AppScope.launch {
            while (isActive) {
                val device = connected ?: break
                val reply = request(device, "/api/status", null)
                if (connected?.id != device.id) break
                if (reply == null || reply["ok"].bool != true) {
                    failures++
                    if (failures >= 3) statusText = "Mất kết nối với ${device.name}…"
                    if (failures >= 20) {
                        Toasts.show("Đã ngắt kết nối với ${device.name}")
                        disconnect(stopReceiver = false)
                        break
                    }
                } else {
                    if (failures >= 3) statusText = null
                    failures = 0
                    applyStatus(reply)
                }
                val visible = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
                delay(if (visible) 1000L else 5000L)
            }
        }
    }

    private fun applyStatus(json: JNode) {
        if (connected == null || !json["state"].exists) return
        val remote = RemoteStatus(
            state = json["state"].string ?: "idle",
            video = ModelJson.parseVideo(json["video"]),
            position = json["position"].double ?: 0.0,
            duration = json["duration"].double ?: 0.0,
            volume = (json["volume"].double ?: 1.0).toFloat(),
            muted = json["muted"].bool ?: false,
            queue = ModelJson.parseVideos(json["queue"]),
            index = json["index"].int ?: 0,
            error = json["error"].string,
        )
        status = remote
        PlayerController.applyRemoteStatus(remote)
    }
}
