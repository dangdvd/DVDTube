package com.dangdvd.dvdtube.core.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.dangdvd.dvdtube.MainActivity
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.YouTubeMusic
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.PlaybackService
import com.dangdvd.dvdtube.player.PlayerController
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.Calendar
import java.util.UUID

/** How often a playback alarm repeats. */
enum class AlarmRepeat(val title: String) {
    ONCE("Một lần"), DAILY("Hằng ngày"), WEEKDAYS("Ngày thường"), WEEKENDS("Cuối tuần");

    fun allows(dayOfWeek: Int): Boolean = when (this) {
        ONCE, DAILY -> true
        WEEKDAYS -> dayOfWeek != Calendar.SATURDAY && dayOfWeek != Calendar.SUNDAY
        WEEKENDS -> dayOfWeek == Calendar.SATURDAY || dayOfWeek == Calendar.SUNDAY
    }
}

/** What a playback alarm plays. */
enum class AlarmSource(val title: String) {
    LOCAL_PLAYLIST("Danh sách phát trên máy"),
    WATCH_LATER("Xem sau"),
    LIKED("Video đã thích"),
    RADIO_RECENT("Radio từ bài nghe gần nhất"),
    LINK("Một đường liên kết"),
}

/** "Hẹn giờ phát": starts playback at a time of day. */
@Serializable
data class PlaybackAlarm(
    val id: String = UUID.randomUUID().toString(),
    val hour: Int = 7,
    val minute: Int = 0,
    val repeat: AlarmRepeat = AlarmRepeat.ONCE,
    val source: AlarmSource = AlarmSource.WATCH_LATER,
    /** Local playlist id ([AlarmSource.LOCAL_PLAYLIST]). */
    val playlistId: String? = null,
    /** A pasted YouTube link ([AlarmSource.LINK]). */
    val link: String? = null,
    /** Raise the volume over 30 seconds. */
    val fadeIn: Boolean = true,
    val audioOnly: Boolean = false,
    val enabled: Boolean = true,
) {
    val timeText: String get() = String.format(java.util.Locale.ROOT, "%02d:%02d", hour, minute)

    fun sourceText(): String = when (source) {
        AlarmSource.LOCAL_PLAYLIST -> LibraryStore.playlist(playlistId ?: "")?.name?.let { "Danh sách: $it" } ?: source.title
        AlarmSource.LINK -> link?.takeIf { it.isNotBlank() } ?: source.title
        else -> source.title
    }

    /** The next moment this alarm rings after [now]. */
    fun nextTrigger(now: Long = System.currentTimeMillis()): Long? {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (calendar.timeInMillis <= now) calendar.add(Calendar.DAY_OF_YEAR, 1)
        for (day in 0 until 8) {
            if (this.repeat.allows(calendar.get(Calendar.DAY_OF_WEEK))) return calendar.timeInMillis
            calendar.add(Calendar.DAY_OF_YEAR, 1)
        }
        return null
    }
}

/** The saved alarms and their AlarmManager registrations. */
object PlaybackAlarms {
    private const val KEY = "alarms.list"
    const val ACTION_FIRE = "com.dangdvd.dvdtube.action.PLAYBACK_ALARM"
    const val EXTRA_ID = "alarmId"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val serializer = ListSerializer(PlaybackAlarm.serializer())
    private var loaded = false
    /** Keeps the media session service bound while an alarm starts playback. */
    private var controller: ListenableFuture<MediaController>? = null

    var alarms by mutableStateOf(listOf<PlaybackAlarm>())
        private set

    private fun ensureLoaded() {
        if (loaded) return
        loaded = true
        alarms = AppSettings.store.getString(KEY, null)?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()
    }

    val list: List<PlaybackAlarm> get() = ensureLoaded().let { alarms }

    fun alarm(id: String): PlaybackAlarm? = list.firstOrNull { it.id == id }

    private fun save() {
        AppSettings.store.edit().putString(KEY, json.encodeToString(serializer, alarms)).apply()
    }

    fun upsert(context: Context, alarm: PlaybackAlarm) {
        ensureLoaded()
        alarms = if (alarms.any { it.id == alarm.id }) alarms.map { if (it.id == alarm.id) alarm else it } else alarms + alarm
        save()
        schedule(context, alarm)
    }

    fun delete(context: Context, id: String) {
        ensureLoaded()
        alarm(id)?.let { cancel(context, it) }
        alarms = alarms.filter { it.id != id }
        save()
    }

    fun setEnabled(context: Context, id: String, enabled: Boolean) {
        val alarm = alarm(id) ?: return
        upsert(context, alarm.copy(enabled = enabled))
    }

    /** At start-up and after a reboot / time zone change: registers every enabled alarm again. */
    fun rescheduleAll(context: Context) {
        list.forEach { schedule(context, it) }
    }

    private fun pendingIntent(context: Context, alarm: PlaybackAlarm): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).setAction(ACTION_FIRE).putExtra(EXTRA_ID, alarm.id)
        return PendingIntent.getBroadcast(
            context, alarm.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun cancel(context: Context, alarm: PlaybackAlarm) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        runCatching { manager.cancel(pendingIntent(context, alarm)) }
    }

    fun schedule(context: Context, alarm: PlaybackAlarm) {
        val app = context.applicationContext
        cancel(app, alarm)
        if (!alarm.enabled) return
        val manager = app.getSystemService(AlarmManager::class.java) ?: return
        val trigger = alarm.nextTrigger() ?: return
        val operation = pendingIntent(app, alarm)
        val show = PendingIntent.getActivity(
            app, 7401, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        try {
            val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
            if (exact) {
                manager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, show), operation)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, operation)
            }
        } catch (error: SecurityException) {
            Log.debug("alarm: exact alarm not allowed (${error.message})")
            runCatching { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, operation) }
        }
    }

    /** True when alarms ring at the exact minute (Android 12+ may need the permission). */
    fun canRingExactly(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return context.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true
    }

    // MARK: Ringing

    /** The alarm rang: register the next time, then play its content through the media service. */
    fun fire(context: Context, id: String, finished: () -> Unit) {
        val app = context.applicationContext
        val alarm = alarm(id)
        if (alarm == null || !alarm.enabled) {
            finished()
            return
        }
        if (alarm.repeat == AlarmRepeat.ONCE) {
            alarms = alarms.map { if (it.id == alarm.id) it.copy(enabled = false) else it }
            save()
        } else {
            schedule(app, alarm)
        }
        Log.debug("alarm: ${alarm.timeText} ${alarm.source.name}")
        // Binding a controller starts the media session service (playback may begin in the background).
        controller?.let { MediaController.releaseFuture(it) }
        controller = runCatching {
            MediaController.Builder(app, SessionToken(app, ComponentName(app, PlaybackService::class.java))).buildAsync()
        }.getOrNull()
        AppScope.launch {
            try {
                val videos = withTimeoutOrNull(20_000L) { content(alarm) }.orEmpty()
                if (videos.isEmpty()) {
                    Log.debug("alarm: nothing to play")
                } else {
                    PlayerController.playScheduled(videos, alarm.audioOnly, alarm.fadeIn, radio = alarm.source == AlarmSource.RADIO_RECENT)
                    delay(3000)
                }
            } finally {
                finished()
            }
        }
    }

    private suspend fun content(alarm: PlaybackAlarm): List<VideoItem> = when (alarm.source) {
        AlarmSource.LOCAL_PLAYLIST -> LibraryStore.playlist(alarm.playlistId ?: "")?.videos.orEmpty()
        AlarmSource.WATCH_LATER -> if (AccountStore.isSignedIn) {
            runCatching { YouTubeService.accountFeed("VLWL").videos }.getOrNull()?.ifEmpty { null } ?: LibraryStore.watchLater
        } else {
            LibraryStore.watchLater
        }
        AlarmSource.LIKED -> if (AccountStore.isSignedIn) {
            runCatching { YouTubeService.accountFeed("VLLL").videos }.getOrNull()?.ifEmpty { null } ?: LibraryStore.liked
        } else {
            LibraryStore.liked
        }
        AlarmSource.RADIO_RECENT -> {
            val seed = com.dangdvd.dvdtube.core.services.MusicRecents.list.firstOrNull()
                ?: LibraryStore.history.firstOrNull { !it.video.isShort }?.video
            if (seed == null) emptyList() else runCatching { YouTubeMusic.radio(seed) }.getOrDefault(listOf(seed))
        }
        AlarmSource.LINK -> {
            val link = alarm.link?.trim().orEmpty()
            val videoId = YouTubeService.videoId(link)
            val list = Regex("[?&]list=([A-Za-z0-9_-]+)").find(link)?.groupValues?.get(1)
            when {
                list != null -> runCatching { YouTubeService.playlistVideos(list, limit = 100) }.getOrDefault(emptyList())
                    .let { videos -> if (videoId != null && videos.none { it.id == videoId }) listOf(VideoItem(id = videoId)) + videos else videos }
                videoId != null -> listOf(VideoItem(id = videoId))
                else -> emptyList()
            }
        }
    }.filter { !it.isShort && !it.isLive }.let { videos ->
        // A playlist with a pasted video starts at that video.
        val videoId = if (alarm.source == AlarmSource.LINK) YouTubeService.videoId(alarm.link.orEmpty()) else null
        val start = videos.indexOfFirst { it.id == videoId }
        if (start > 0) videos.drop(start) + videos.take(start) else videos
    }
}

/** Fires playback alarms (allowed to start the media service: it is an exact alarm). */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != PlaybackAlarms.ACTION_FIRE) return
        val id = intent.getStringExtra(PlaybackAlarms.EXTRA_ID) ?: return
        val pending = goAsync()
        PlaybackAlarms.fire(context, id) { runCatching { pending.finish() } }
    }
}

/** Registers the alarms again after a reboot, an app update or a clock change. */
class AlarmBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED,
            "android.intent.action.LOCKED_BOOT_COMPLETED", "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
            -> PlaybackAlarms.rescheduleAll(context)
        }
    }
}
