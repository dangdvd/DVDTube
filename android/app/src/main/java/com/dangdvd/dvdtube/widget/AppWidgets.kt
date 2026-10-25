package com.dangdvd.dvdtube.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.drawable.toBitmap
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.dangdvd.dvdtube.MainActivity
import com.dangdvd.dvdtube.R
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.HistoryEntry
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.ParentalControls
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.DeArrow
import com.dangdvd.dvdtube.core.services.RSSFeed
import com.dangdvd.dvdtube.core.services.YouTubeService
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.core.innertube.AuthSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.io.File

/** "Tiếp tục xem": the last unfinished video with Tiếp tục / Tìm kiếm / Shorts buttons. */
class ContinueWatchingWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        AppWidgets.requestRefresh(context, network = false)
    }
}

/** "Video mới từ kênh đăng ký" (4×2): the newest uploads of the subscribed channels. */
class NewVideosWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        AppWidgets.requestRefresh(context, network = true)
    }
}

/** Refreshes the widgets in the background (thumbnails and the subscriptions feed need the network). */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val network = inputData.getBoolean(AppWidgets.KEY_NETWORK, false)
        runCatching { AppWidgets.refresh(applicationContext, network) }.onFailure { Log.debug("widget refresh failed: ${it.message}") }
        return Result.success()
    }
}

object AppWidgets {
    const val KEY_NETWORK = "network"
    private const val ROWS = 4
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun ids(context: Context, provider: Class<*>): IntArray =
        runCatching { AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, provider)) }.getOrDefault(IntArray(0))

    fun hasAny(context: Context): Boolean =
        ids(context, ContinueWatchingWidget::class.java).isNotEmpty() || ids(context, NewVideosWidget::class.java).isNotEmpty()

    /** Queues a refresh; [network] also reloads the subscriptions feed. */
    fun requestRefresh(context: Context, network: Boolean) {
        if (!hasAny(context)) return
        val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
            .setInputData(androidx.work.Data.Builder().putBoolean(KEY_NETWORK, network).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.NOT_REQUIRED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            if (network) "widget-refresh-feed" else "widget-refresh", ExistingWorkPolicy.REPLACE, request,
        )
    }

    suspend fun refresh(context: Context, network: Boolean) {
        val app = context.applicationContext
        if (ids(app, ContinueWatchingWidget::class.java).isNotEmpty()) updateContinue(app)
        val feedIds = ids(app, NewVideosWidget::class.java)
        if (feedIds.isNotEmpty()) {
            val cached = readFeed(app)
            if (network || cached == null) {
                val fresh = runCatching { loadFeed() }.getOrNull()
                if (fresh != null) writeFeed(app, fresh)
                updateFeed(app, fresh ?: cached.orEmpty())
            } else {
                updateFeed(app, cached)
            }
        }
    }

    // MARK: Intents

    private fun link(context: Context, uri: String, code: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private suspend fun thumbnail(context: Context, url: String?, width: Int, height: Int): Bitmap? {
        url ?: return null
        val request = ImageRequest.Builder(context).data(url).size(width, height).allowHardware(false).build()
        val result = runCatching { context.imageLoader.execute(request) }.getOrNull() as? SuccessResult ?: return null
        return runCatching { result.drawable.toBitmap(width, height, Bitmap.Config.RGB_565) }.getOrNull()
    }

    /** DeArrow title / thumbnail for a widget (best effort, with a short wait). */
    private suspend fun branded(video: VideoItem): VideoItem {
        if (!DeArrow.isEnabled || video.isShort) return video
        val branding = runCatching { DeArrow.branding(video.id) }.getOrNull() ?: return video
        return video.copy(
            title = branding.title?.takeIf { AppSettings.deArrowTitles } ?: video.title,
            thumbnail = branding.thumbnailUrl?.takeIf { AppSettings.deArrowThumbnails } ?: video.thumbnail,
        )
    }

    // MARK: Continue watching

    private fun lastUnfinished(): HistoryEntry? =
        LibraryStore.history.firstOrNull { !it.video.isShort && !it.video.isLive && it.progress in 0.02..0.95 }

    private suspend fun updateContinue(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val views = RemoteViews(context.packageName, R.layout.widget_continue)
        val entry = lastUnfinished()
        if (entry != null) {
            val video = branded(entry.video)
            views.setTextViewText(R.id.widget_title, video.title.ifEmpty { "Video" })
            views.setTextViewText(R.id.widget_subtitle, listOfNotNull(video.channelName, "Còn ${remaining(entry)}").joinToString(" • "))
            views.setProgressBar(R.id.widget_progress, 1000, (entry.progress * 1000).toInt(), false)
            views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
            var bitmap = thumbnail(context, video.displayThumbnail, 320, 180)
            if (bitmap == null && video.thumbnail != entry.video.thumbnail) bitmap = thumbnail(context, entry.video.displayThumbnail, 320, 180)
            if (bitmap != null) views.setImageViewBitmap(R.id.widget_thumbnail, bitmap)
            val open = link(context, "dvdtube://watch?v=${entry.video.id}&t=${entry.position.toInt()}", 9100)
            views.setOnClickPendingIntent(R.id.widget_video, open)
            views.setOnClickPendingIntent(R.id.widget_resume, open)
        } else {
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty))
            views.setTextViewText(R.id.widget_subtitle, "")
            views.setViewVisibility(R.id.widget_progress, View.GONE)
            views.setOnClickPendingIntent(R.id.widget_video, link(context, "dvdtube://home", 9100))
            views.setOnClickPendingIntent(R.id.widget_resume, link(context, "dvdtube://home", 9101))
        }
        views.setOnClickPendingIntent(R.id.widget_search, link(context, "dvdtube://search", 9102))
        views.setOnClickPendingIntent(R.id.widget_shorts, link(context, "dvdtube://shorts", 9103))
        manager.updateAppWidget(ComponentName(context, ContinueWatchingWidget::class.java), views)
    }

    private fun remaining(entry: HistoryEntry): String {
        val seconds = (entry.duration - entry.position).coerceAtLeast(0.0).toInt()
        val minutes = (seconds + 59) / 60
        return if (minutes >= 60) "${minutes / 60} giờ ${minutes % 60} phút" else "$minutes phút"
    }

    // MARK: New videos

    private suspend fun loadFeed(): List<VideoItem> {
        val videos = if (AuthSession.isAuthenticated) {
            YouTubeService.accountFeed("FEsubscriptions").videos
        } else {
            val limit = Semaphore(4)
            coroutineScope {
                LibraryStore.subscriptions.take(15).map { channel ->
                    async { limit.withPermit { runCatching { RSSFeed.videos(channel.id).take(4) }.getOrDefault(emptyList()) } }
                }.awaitAll().flatten()
            }.sortedByDescending { it.publishedDate ?: 0L }
        }
        return ParentalControls.filterVideos(videos.filter { !it.isShort }).distinctBy { it.id }.take(ROWS)
    }

    private fun feedFile(context: Context) = File(context.filesDir, "widget-feed.json")

    private suspend fun readFeed(context: Context): List<VideoItem>? = withContext(Dispatchers.IO) {
        runCatching { json.decodeFromString(ListSerializer(VideoItem.serializer()), feedFile(context).readText()) }.getOrNull()
    }

    private suspend fun writeFeed(context: Context, videos: List<VideoItem>) = withContext(Dispatchers.IO) {
        runCatching { feedFile(context).writeText(json.encodeToString(ListSerializer(VideoItem.serializer()), videos)) }
        Unit
    }

    private suspend fun updateFeed(context: Context, videos: List<VideoItem>) {
        val manager = AppWidgetManager.getInstance(context)
        val views = RemoteViews(context.packageName, R.layout.widget_new_videos)
        views.removeAllViews(R.id.widget_list)
        views.setViewVisibility(R.id.widget_empty, if (videos.isEmpty()) View.VISIBLE else View.GONE)
        views.setOnClickPendingIntent(R.id.widget_header, link(context, "dvdtube://subscriptions", 9200))
        views.setOnClickPendingIntent(R.id.widget_empty, link(context, "dvdtube://subscriptions", 9201))
        videos.take(ROWS).forEachIndexed { index, original ->
            val video = branded(original)
            val row = RemoteViews(context.packageName, R.layout.widget_video_row)
            row.setTextViewText(R.id.row_title, video.title.ifEmpty { "Video" })
            row.setTextViewText(R.id.row_subtitle, listOfNotNull(video.channelName, video.publishedText).joinToString(" • "))
            val bitmap = thumbnail(context, video.displayThumbnail, 160, 90)
                ?: if (video.thumbnail != original.thumbnail) thumbnail(context, original.displayThumbnail, 160, 90) else null
            if (bitmap != null) row.setImageViewBitmap(R.id.row_thumbnail, bitmap)
            row.setOnClickPendingIntent(R.id.row_root, link(context, "dvdtube://watch?v=${original.id}", 9300 + index))
            views.addView(R.id.widget_list, row)
        }
        manager.updateAppWidget(ComponentName(context, NewVideosWidget::class.java), views)
    }
}
