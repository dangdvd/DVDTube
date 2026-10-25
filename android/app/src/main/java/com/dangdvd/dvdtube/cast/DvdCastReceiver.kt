package com.dangdvd.dvdtube.cast

import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.dangdvd.dvdtube.BuildConfig
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.ModelJson
import com.dangdvd.dvdtube.core.ParentalControls
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.net.LanServer
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import com.dangdvd.dvdtube.tv.TvActivity
import com.dangdvd.dvdtube.tv.TvNav
import com.dangdvd.dvdtube.tv.TvPairingServer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * "Truyền tới DVDTube" — the Android TV side. While DVDTube runs on the TV it advertises
 * `_dvdtube._tcp` (TXT `id`, `v=1`, `kind=tv`, `name`) and serves the cast JSON API on port 8766
 * (or a free port): `/api/info`, `/api/play`, `/api/queue`, `/api/queue/edit`, `/api/control`,
 * `/api/status`.
 * The TV fetches the streams itself; senders only send video ids and remote-control commands.
 */
object DvdCastReceiver {
    const val SERVICE_TYPE = "_dvdtube._tcp"
    const val PORT = 8766
    const val PROTOCOL = 1
    private const val MAX_BODY = 256 * 1024
    private const val ID_KEY = "cast.deviceId"
    private val VIDEO_ID = Regex("^[A-Za-z0-9_-]{6,20}$")

    private var appContext: Context? = null
    private var server: LanServer? = null
    private var nsd: NsdManager? = null
    private var registration: NsdManager.RegistrationListener? = null

    var isRunning by mutableStateOf(false)
        private set
    /** "ip:port" while listening (shown in the TV settings). */
    var address by mutableStateOf<String?>(null)
        private set

    /** The receiver's stable random id (TXT `id`, `/api/info`). */
    fun deviceId(): String {
        val store = AppSettings.store
        store.getString(ID_KEY, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        store.edit().putString(ID_KEY, id).apply()
        return id
    }

    fun deviceName(context: Context): String = TvPairingServer.deviceName(context)

    /** Starts listening and advertising (no-op when off in the settings or already running). */
    fun start(context: Context) {
        val app = context.applicationContext
        appContext = app
        if (!AppSettings.castReceiverEnabled || server != null) return
        val lan = LanServer("cast receiver", PORT, MAX_BODY) { request -> handle(request) }
        val port = lan.start() ?: return
        server = lan
        isRunning = true
        address = TvPairingServer.localAddress(app)?.let { "$it:$port" }
        register(app, port)
    }

    fun stop() {
        unregister()
        server?.stop()
        server = null
        isRunning = false
        address = null
    }

    /** Follows the "accept casts" setting. */
    fun refresh(context: Context) {
        if (AppSettings.castReceiverEnabled) start(context) else stop()
    }

    // MARK: DNS-SD

    private fun register(context: Context, listenPort: Int) {
        val manager = context.getSystemService(NsdManager::class.java) ?: return
        nsd = manager
        val name = deviceName(context)
        val info = NsdServiceInfo().apply {
            serviceName = name
            serviceType = SERVICE_TYPE
            setPort(listenPort)
            runCatching {
                setAttribute("id", deviceId())
                setAttribute("v", PROTOCOL.toString())
                setAttribute("kind", "tv")
                setAttribute("name", name.take(60))
            }.onFailure { Log.debug("cast receiver: TXT record rejected (${it.message})") }
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
                Log.debug("cast receiver: advertised as \"${serviceInfo.serviceName}\" on port $listenPort")
            }

            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.error("cast receiver: DNS-SD registration failed ($errorCode)")
            }

            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
        }
        registration = listener
        runCatching { manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener) }
            .onFailure { Log.error("cast receiver: cannot advertise (${it.message})") }
    }

    private fun unregister() {
        val listener = registration ?: return
        registration = null
        runCatching { nsd?.unregisterService(listener) }
    }

    // MARK: API

    private suspend fun handle(request: LanServer.Request): LanServer.Response {
        val path = request.path.trimEnd('/')
        return when (path) {
            "/api/info" -> info()
            "/api/status" -> withContext(Dispatchers.Main) { LanServer.Response.ok(status()) }
            "/api/play" -> post(request) { play(it) }
            "/api/queue" -> post(request) { queue(it) }
            "/api/queue/edit" -> post(request) { editQueue(it) }
            "/api/control" -> post(request) { control(it) }
            else -> LanServer.Response.error(404, "Không có trang này.")
        }
    }

    private suspend fun post(request: LanServer.Request, action: suspend (JNode) -> LanServer.Response): LanServer.Response {
        if (request.method != "POST") return LanServer.Response.error(405, "Phương thức không được hỗ trợ.")
        val json = request.json ?: return LanServer.Response.error(400, "Dữ liệu không hợp lệ.")
        return action(JNode(json))
    }

    private fun info(): LanServer.Response {
        val context = appContext
        return LanServer.Response.ok(
            JSONObject()
                .put("app", "DVDTube")
                .put("protocol", PROTOCOL)
                .put("id", deviceId())
                .put("name", context?.let(::deviceName) ?: "Android TV")
                .put("kind", "tv")
                .put("version", BuildConfig.VERSION_NAME)
                .put("features", JSONArray().put("queue-edit")),
        )
    }

    private suspend fun play(body: JNode): LanServer.Response {
        val video = ModelJson.parseVideo(body["video"]) ?: return LanServer.Response.error(400, "Thiếu video cần phát.")
        val start = body["startSeconds"].double?.takeIf { it.isFinite() && it >= 0 }
        val queue = ModelJson.parseVideos(body["queue"]).takeIf { list -> list.any { it.id == video.id } }
        val sender = body["sender"].string?.trim()?.ifEmpty { null } ?: "thiết bị khác"
        return withContext(Dispatchers.Main) {
            if (!ParentalControls.allows(video)) {
                return@withContext LanServer.Response.error(403, "Video này bị chặn bởi Kiểm soát của phụ huynh trên TV.")
            }
            if (!ParentalControls.canPlay()) {
                return@withContext LanServer.Response.error(403, "Đã hết thời gian xem cho phép trên TV.")
            }
            Log.debug("cast receiver: play ${video.id} from a sender")
            if (PlayerController.currentVideo?.id == video.id && queue == null) {
                start?.let { PlayerController.seek(it) }
                PlayerController.resume()
                TvNav.play(video)
            } else {
                TvNav.play(video, queue, start)
            }
            bringToFront()
            Toasts.show("Đang phát từ $sender")
            LanServer.Response.ok(status())
        }
    }

    private suspend fun queue(body: JNode): LanServer.Response {
        val video = ModelJson.parseVideo(body["video"]) ?: return LanServer.Response.error(400, "Thiếu video.")
        val next = body["next"].bool ?: false
        return withContext(Dispatchers.Main) {
            if (!ParentalControls.allows(video)) {
                return@withContext LanServer.Response.error(403, "Video này bị chặn bởi Kiểm soát của phụ huynh trên TV.")
            }
            when {
                PlayerController.currentVideo == null -> {
                    TvNav.play(video)
                    bringToFront()
                }
                next -> PlayerController.playAfterCurrent(video)
                else -> PlayerController.addToQueue(video)
            }
            LanServer.Response.ok(status())
        }
    }

    /** A phone removes / moves / plays a queue item, or clears what comes next. */
    private suspend fun editQueue(body: JNode): LanServer.Response {
        val op = body["op"].string ?: return LanServer.Response.error(400, "Thiếu lệnh sửa hàng đợi.")
        if (op !in setOf("remove", "move", "play", "clear")) return LanServer.Response.error(400, "Lệnh sửa hàng đợi không hợp lệ.")
        val index = body["index"].int ?: 0
        val videoId = body["videoId"].string?.takeIf { VIDEO_ID.matches(it) }
        val to = body["to"].int
        if (op != "clear" && (videoId == null || index < 0)) return LanServer.Response.error(400, "Thiếu video trong hàng đợi.")
        if (op == "move" && (to == null || to < 0)) return LanServer.Response.error(400, "Thiếu vị trí mới.")
        return withContext(Dispatchers.Main) {
            if (op == "play" && !ParentalControls.canPlay()) {
                return@withContext LanServer.Response.error(403, "Đã hết thời gian xem cho phép trên TV.")
            }
            if (!PlayerController.applyRemoteQueueEdit(op, index, videoId, to)) {
                return@withContext LanServer.Response.error(409, "Hàng đợi trên TV đã thay đổi. Hãy thử lại.")
            }
            LanServer.Response.ok(status())
        }
    }

    private suspend fun control(body: JNode): LanServer.Response {
        val action = body["action"].string?.lowercase() ?: return LanServer.Response.error(400, "Thiếu lệnh.")
        val value = body["value"].double?.takeIf { it.isFinite() }
        return withContext(Dispatchers.Main) {
            when (action) {
                "play" -> if (ParentalControls.canPlay()) PlayerController.resume()
                "pause" -> PlayerController.pause()
                "toggle" -> if (PlayerController.isPlaying) PlayerController.pause() else if (ParentalControls.canPlay()) PlayerController.resume()
                "seek" -> value?.let { PlayerController.seek(it) } ?: return@withContext LanServer.Response.error(400, "Thiếu vị trí cần tua.")
                "skip" -> value?.let { PlayerController.skip(it) } ?: return@withContext LanServer.Response.error(400, "Thiếu số giây cần tua.")
                "next" -> PlayerController.playNext()
                "previous" -> PlayerController.playPrevious()
                "stop" -> TvNav.closePlayer()
                "volume" -> value?.let { PlayerController.changeRemoteVolume(it.toFloat()) }
                    ?: return@withContext LanServer.Response.error(400, "Thiếu mức âm lượng.")
                "mute" -> PlayerController.changeRemoteMuted((value ?: 1.0) != 0.0)
                else -> return@withContext LanServer.Response.error(400, "Lệnh không hợp lệ.")
            }
            LanServer.Response.ok(status())
        }
    }

    /** `/api/status` fields (main thread). */
    private fun status(): JSONObject {
        val video = PlayerController.currentVideo
        val duration = PlayerController.duration
        val ended = video != null && !PlayerController.isPlaying && duration > 0 && PlayerController.currentTime >= duration - 0.5
        val state = when {
            video == null -> "idle"
            PlayerController.playbackError != null -> "error"
            PlayerController.isBuffering && PlayerController.isPlaying -> "buffering"
            PlayerController.isPlaying -> "playing"
            PlayerController.isLoading || PlayerController.adWaitRemaining > 0 -> "loading"
            ended -> "ended"
            else -> "paused"
        }
        return JSONObject()
            .put("state", state)
            .put("video", video?.let(ModelJson::video) ?: JSONObject.NULL)
            .put("position", PlayerController.currentTime)
            .put("duration", duration)
            .put("volume", PlayerController.remoteVolume.toDouble())
            .put("muted", PlayerController.remoteMuted)
            .put("queue", ModelJson.videos(PlayerController.queue))
            .put("index", PlayerController.queueIndex)
            .put("error", PlayerController.playbackError ?: JSONObject.NULL)
    }

    /** The TV interface comes to the front for a cast (best effort: Android may refuse from the background). */
    private fun bringToFront() {
        val context = appContext ?: return
        val visible = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        if (visible) return
        runCatching {
            context.startActivity(
                Intent(context, TvActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            )
        }.onFailure { Log.debug("cast receiver: cannot open the TV app (${it.message})") }
    }
}
