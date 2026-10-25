package com.dangdvd.dvdtube.core.services

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.LibraryStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * "Tự động tải video mới": every 2 hours (on Wi-Fi when asked, battery not low) downloads the
 * newest videos of the picked channels — no Shorts, live or upcoming streams — keeping at most N
 * automatic downloads per channel (manual downloads are never removed).
 */
class AutoDownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!AppSettings.autoDownloadEnabled || AppSettings.autoDownloadChannels.isEmpty()) return Result.success()
        if (AppSettings.autoDownloadWifiOnly && AppSettings.isMeteredNetwork) return Result.retry()
        runCatching { runOnce() }.onFailure { Log.error("auto download failed: ${it.message}") }
        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "auto-download"
        private const val NOW_NAME = "auto-download-now"

        /** Every channel that can be picked: local subscriptions and the account's. */
        fun channels(): List<ChannelItem> =
            (LibraryStore.subscriptions + if (AccountStore.isSignedIn) AccountStore.subscribedChannels else emptyList()).distinctBy { it.id }

        private fun constraints(): Constraints = Constraints.Builder()
            .setRequiredNetworkType(if (AppSettings.autoDownloadWifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()

        /** Starts, updates or stops the periodic work to match the settings. */
        fun sync(context: Context) {
            val manager = WorkManager.getInstance(context)
            if (!AppSettings.autoDownloadEnabled || AppSettings.autoDownloadChannels.isEmpty()) {
                manager.cancelUniqueWork(WORK_NAME)
                return
            }
            val request = PeriodicWorkRequestBuilder<AutoDownloadWorker>(2, TimeUnit.HOURS)
                .setConstraints(constraints())
                .build()
            manager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        /** "Kiểm tra ngay". */
        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<AutoDownloadWorker>().setConstraints(constraints()).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW_NAME, ExistingWorkPolicy.REPLACE, request)
        }

        suspend fun runOnce() {
            val keep = AppSettings.autoDownloadKeep.coerceIn(1, 20)
            val audioOnly = AppSettings.autoDownloadAudioOnly
            val known = channels().associateBy { it.id }
            for (channelId in AppSettings.autoDownloadChannels) {
                val channel = known[channelId] ?: ChannelItem(id = channelId)
                val latest = runCatching { YouTubeService.latestVideos(channel) }.getOrDefault(emptyList())
                val now = System.currentTimeMillis()
                val candidates = latest
                    .filter { !it.isShort && !it.isLive }
                    // Upcoming premieres / streams have a date in the future.
                    .filter { (it.publishedDate ?: 0L) <= now }
                    .sortedByDescending { it.publishedDate ?: 0L }
                    .take(keep)
                for (video in candidates) {
                    if (DownloadManager.isDownloaded(video.id)) continue
                    val item = video.copy(channelId = video.channelId ?: channelId, channelName = video.channelName ?: channel.name.ifEmpty { null })
                    val ok = withContext(Dispatchers.Main) { DownloadManager.downloadAndWait(item, audioOnly, auto = true) }
                    Log.debug("auto download ${video.id}: ${if (ok) "done" else "skipped"}")
                }
                prune(channelId, keep, candidates)
            }
        }

        /** Removes this channel's older automatic downloads beyond [keep] (never manual ones). */
        private suspend fun prune(channelId: String, keep: Int, newest: List<VideoItem>) = withContext(Dispatchers.Main) {
            val order = newest.mapIndexed { index, video -> video.id to index }.toMap()
            val automatic = DownloadManager.downloads.filter { it.isAuto && it.video.channelId == channelId }
                .sortedWith(compareBy({ order[it.video.id] ?: Int.MAX_VALUE }, { -(it.video.publishedDate ?: it.downloadedAt) }))
            automatic.drop(keep).forEach { DownloadManager.delete(it.video.id) }
        }
    }
}
