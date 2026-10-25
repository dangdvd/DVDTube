package com.dangdvd.dvdtube.core.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.dangdvd.dvdtube.BuildConfig
import com.dangdvd.dvdtube.R
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.Log
import com.dangdvd.dvdtube.core.innertube.InnerTube
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.player.Toasts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import kotlin.coroutines.coroutineContext

/**
 * "Cập nhật": checks the latest GitHub release (`v1.0.N`), offers it once a day at most, downloads
 * `DVDTube.apk` into app storage (progress notification) and hands it to the system installer.
 * Releases are signed with the same key, so the update installs over this version keeping data.
 */
object AppUpdater {
    private const val LATEST_URL = "https://api.github.com/repos/dangdvd/DVDTube/releases/latest"
    private const val CHANNEL_ID = "updates"
    private const val NOTIFICATION_ID = 7301
    private const val LAST_CHECK_KEY = "update.lastCheck"
    private const val LAST_PROMPT_KEY = "update.lastPrompt"

    data class Release(val version: String, val tag: String, val notes: String, val apkUrl: String?, val pageUrl: String)

    /** A newer release to offer (the dialog shows while set). */
    var available by mutableStateOf<Release?>(null)
    var isChecking by mutableStateOf(false)
        private set
    /** Download progress 0…1 while the APK downloads. */
    var progress by mutableStateOf<Float?>(null)
        private set
    private var downloadJob: Job? = null
    /** Waiting for "install unknown apps" to be allowed. */
    private var pendingInstall: File? = null

    val currentVersion: String get() = BuildConfig.VERSION_NAME

    // MARK: Version comparison

    private fun parts(version: String): List<Int> =
        version.trim().removePrefix("v").removePrefix("V").split('.', '-', ' ').mapNotNull { it.toIntOrNull() }

    /** Numeric comparison; a development build ("1.0", "1.0.0") is older than any release. */
    fun isNewer(remote: String, local: String = currentVersion): Boolean {
        val a = parts(remote)
        val b = parts(local)
        if (a.isEmpty()) return false
        for (index in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(index) { 0 }
            val y = b.getOrElse(index) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    // MARK: Checking

    /** At launch: at most once every 24 hours, when "Tự kiểm tra cập nhật" is on. */
    suspend fun checkAtLaunch() {
        if (!AppSettings.autoUpdateCheck) return
        val now = System.currentTimeMillis()
        if (now - AppSettings.store.getLong(LAST_CHECK_KEY, 0L) < 24 * 3_600_000L) return
        AppSettings.store.edit().putLong(LAST_CHECK_KEY, now).apply()
        val release = runCatching { latest() }.onFailure { Log.debug("update check failed: ${it.message}") }.getOrNull() ?: return
        if (!isNewer(release.version)) return
        // Never nag more than once a day.
        if (now - AppSettings.store.getLong(LAST_PROMPT_KEY, 0L) < 24 * 3_600_000L) return
        AppSettings.store.edit().putLong(LAST_PROMPT_KEY, now).apply()
        available = release
    }

    /** "Kiểm tra cập nhật" in the settings. */
    suspend fun checkNow() {
        if (isChecking) return
        isChecking = true
        try {
            val release = latest()
            AppSettings.store.edit().putLong(LAST_CHECK_KEY, System.currentTimeMillis()).apply()
            if (isNewer(release.version)) available = release else Toasts.show("Bạn đang dùng bản mới nhất (v$currentVersion)")
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.debug("update check failed: ${error.message}")
            Toasts.show("Không kiểm tra được bản cập nhật. Hãy thử lại sau.")
        } finally {
            isChecking = false
        }
    }

    private suspend fun latest(): Release = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(LATEST_URL)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "DVDTube-Android/$currentVersion")
            .build()
        InnerTube.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}")
            val json = JNode.parse(response.body?.string().orEmpty())
            val tag = json["tag_name"].string ?: throw IllegalStateException("no tag")
            val apk = json["assets"].array.firstOrNull { it["name"].string == "DVDTube.apk" }?.get("browser_download_url")?.string
            Release(
                version = tag.removePrefix("v").removePrefix("V"),
                tag = tag,
                notes = (json["body"].string ?: "").replace("\r\n", "\n").trim().take(1500),
                apkUrl = apk,
                pageUrl = json["html_url"].string ?: "https://github.com/dangdvd/DVDTube/releases/latest",
            )
        }
    }

    // MARK: Download and install

    val isDownloading: Boolean get() = downloadJob?.isActive == true

    /** "Cập nhật": downloads the APK, then opens the system installer. */
    fun downloadAndInstall(context: Context, release: Release) {
        val app = context.applicationContext
        val url = release.apkUrl
        if (url == null) {
            openPage(app, release.pageUrl)
            return
        }
        if (isDownloading) return
        createChannel(app)
        downloadJob = AppScope.launch {
            progress = 0f
            notifyProgress(app, release, 0)
            try {
                val file = download(app, url) { fraction ->
                    progress = fraction
                    notifyProgress(app, release, (fraction * 100).toInt())
                }
                cancelNotification(app)
                progress = null
                install(app, file)
            } catch (error: CancellationException) {
                cancelNotification(app)
                progress = null
                throw error
            } catch (error: Exception) {
                Log.error("update download failed: ${error.message}")
                cancelNotification(app)
                progress = null
                Toasts.show("Không tải được bản cập nhật: ${error.message ?: "lỗi mạng"}")
            }
        }
    }

    fun cancelDownload() {
        downloadJob?.cancel()
    }

    private suspend fun download(context: Context, url: String, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val folder = File(context.filesDir, "updates").apply { mkdirs() }
        val target = File(folder, "DVDTube.apk")
        val temp = File(folder, "DVDTube.apk.part")
        val request = Request.Builder().url(url).header("User-Agent", "DVDTube-Android/$currentVersion").build()
        InnerTube.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}")
            val body = response.body ?: throw IllegalStateException("không có dữ liệu")
            val total = body.contentLength()
            var done = 0L
            var lastReport = 0L
            body.byteStream().use { input ->
                temp.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        coroutineContext.ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        done += count
                        val now = System.currentTimeMillis()
                        if (total > 0 && now - lastReport > 400) {
                            lastReport = now
                            val fraction = (done.toFloat() / total).coerceIn(0f, 1f)
                            withContext(Dispatchers.Main) { onProgress(fraction) }
                        }
                    }
                }
            }
            if (done < 1_000_000L) throw IllegalStateException("tệp tải về không hợp lệ")
        }
        target.delete()
        if (!temp.renameTo(target)) throw IllegalStateException("không lưu được tệp")
        target
    }

    /** Opens the installer, or first the "install unknown apps" permission screen. */
    fun install(context: Context, file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            pendingInstall = file
            Toasts.show("Hãy cho phép DVDTube cài ứng dụng, rồi quay lại để cài bản cập nhật")
            runCatching {
                context.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }.onFailure { Toasts.show("Mở Cài đặt › Ứng dụng › DVDTube › Cài ứng dụng không rõ nguồn") }
            return
        }
        pendingInstall = null
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (error: ActivityNotFoundException) {
            Toasts.show("Thiết bị không có trình cài đặt ứng dụng")
        }
    }

    /** Back from the permission screen: continue the installation if it is allowed now. */
    fun resumePendingInstall(context: Context) {
        val file = pendingInstall ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) return
        if (file.exists()) install(context, file) else pendingInstall = null
    }

    fun openPage(context: Context, url: String) {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { Toasts.show("Không mở được trang tải về") }
    }

    // MARK: Notification

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "Cập nhật ứng dụng", NotificationManager.IMPORTANCE_LOW)
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun notifyProgress(context: Context, release: Release, percent: Int) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Đang tải DVDTube v${release.version}")
            .setContentText("$percent%")
            .setProgress(100, percent, percent <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) }
    }

    private fun cancelNotification(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID) }
    }
}
