package com.dangdvd.dvdtube.core.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dangdvd.dvdtube.MainActivity
import com.dangdvd.dvdtube.R
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.innertube.AuthSession
import com.dangdvd.dvdtube.core.storage.LibraryStore
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import java.util.concurrent.TimeUnit

/**
 * Notifications for new uploads from subscribed channels. WorkManager runs this about once
 * an hour; each run compares the latest uploads with the ones already seen.
 */
class NewVideoWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!AppSettings.notifyNewVideos) return Result.success()
        runCatching { checkForNewVideos(applicationContext) }.onFailure { Log.debug("new video check failed: ${it.message}") }
        return Result.success()
    }

    companion object {
        const val CHANNEL_ID = "new_videos"
        const val EXTRA_VIDEO_ID = "dvdtube.videoId"
        const val EXTRA_TITLE = "dvdtube.title"
        private const val WORK_NAME = "new-video-check"
        private const val SEEN_KEY = "notify.seenVideoIds"

        fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val channel = NotificationChannel(CHANNEL_ID, "Video mới từ kênh đăng ký", NotificationManager.IMPORTANCE_DEFAULT)
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }

        /** Starts or stops the periodic check to match the setting. */
        fun sync(context: Context) {
            val manager = WorkManager.getInstance(context)
            if (!AppSettings.notifyNewVideos) {
                manager.cancelUniqueWork(WORK_NAME)
                return
            }
            val request = PeriodicWorkRequestBuilder<NewVideoWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            manager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** Fetches the latest uploads and notifies about unseen ones. Returns how many were new. */
        suspend fun checkForNewVideos(context: Context): Int {
            val videos = latestSubscriptionVideos()
            if (videos.isEmpty()) return 0
            val store = AppSettings.store
            val seen = store.getString(SEEN_KEY, null)?.split(',')?.filter { it.isNotEmpty() }.orEmpty()
            val seenSet = seen.toSet()
            val isFirstRun = seen.isEmpty()
            val fresh = videos.filter { it.id !in seenSet && !it.isShort }
            // Remember everything seen (bounded), so nothing is announced twice.
            val updated = (videos.map { it.id } + seen).distinct().take(600)
            store.edit().putString(SEEN_KEY, updated.joinToString(",")).apply()
            // The first run only records the current state instead of announcing old videos.
            if (isFirstRun || fresh.isEmpty()) return 0
            fresh.take(5).forEach { post(context, it) }
            Log.debug("new video check: ${fresh.size} new")
            return fresh.size
        }

        private suspend fun latestSubscriptionVideos(): List<VideoItem> {
            if (AuthSession.isAuthenticated) {
                runCatching { YouTubeService.accountFeed("FEsubscriptions") }.getOrNull()?.let { return it.videos.take(40) }
            }
            val channels = LibraryStore.subscriptions.take(25)
            val twoDaysAgo = System.currentTimeMillis() - 2 * 86_400_000L
            return coroutineScope {
                channels.map { channel ->
                    async { runCatching { RSSFeed.videos(channel.id).take(3) }.getOrDefault(emptyList()) }
                }.awaitAll().flatten().filter { (it.publishedDate ?: System.currentTimeMillis()) > twoDaysAgo }
            }
        }

        private fun post(context: Context, video: VideoItem) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return
            val intent = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_VIDEO_ID, video.id)
                .putExtra(EXTRA_TITLE, video.title)
            val pending = PendingIntent.getActivity(
                context, video.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(video.channelName ?: "Video mới")
                .setContentText(video.title)
                .setStyle(NotificationCompat.BigTextStyle().bigText(video.title))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setGroup(video.channelId ?: "new-videos")
                .build()
            runCatching { NotificationManagerCompat.from(context).notify(video.id.hashCode(), notification) }
        }
    }
}
