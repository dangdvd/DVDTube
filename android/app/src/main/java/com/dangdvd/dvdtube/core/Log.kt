package com.dangdvd.dvdtube.core

import android.content.Context
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Diagnostics. Every line goes to an in-memory log the user can copy from Settings
 * (endpoints, HTTP status codes and errors only — never cookies or account data).
 * Errors are also kept in a separate short list, and crashes are written to a file so the next
 * launch can include them in "Gửi nhật ký lỗi".
 */
object Log {
    private const val MAX_LINES = 2000
    private const val MAX_ERRORS = 150
    private val lines = ArrayDeque<String>()
    private val errors = ArrayDeque<String>()
    private val formatter = SimpleDateFormat("HH:mm:ss", Locale.ROOT)
    @Volatile private var crashFolder: File? = null

    fun debug(message: String) {
        android.util.Log.d("DVDTube", message)
        synchronized(lines) {
            lines.addLast(formatter.format(Date()) + " " + message)
            while (lines.size > MAX_LINES) lines.removeFirst()
        }
    }

    /** A failure worth listing under "recent errors" (player errors, HTTP errors…). */
    fun error(message: String) {
        debug("ERROR $message")
        synchronized(errors) {
            errors.addLast(SimpleDateFormat("dd/MM HH:mm:ss", Locale.ROOT).format(Date()) + " " + message)
            while (errors.size > MAX_ERRORS) errors.removeFirst()
        }
    }

    fun text(version: String): String {
        val header = "DVDTube $version • Android ${Build.VERSION.RELEASE} (${Build.MANUFACTURER} ${Build.MODEL})"
        return synchronized(lines) { (listOf(header) + lines).joinToString("\n") }
    }

    fun recentLines(count: Int = MAX_LINES): List<String> = synchronized(lines) { lines.toList().takeLast(count) }

    fun recentErrors(): List<String> = synchronized(errors) { errors.toList() }

    fun clear() {
        synchronized(lines) { lines.clear() }
        synchronized(errors) { errors.clear() }
    }

    // MARK: Crash reports

    /** Writes uncaught exceptions to `files/crashes/` before the app dies. */
    fun installCrashHandler(context: Context) {
        val folder = File(context.filesDir, "crashes").apply { mkdirs() }
        crashFolder = folder
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val trace = StringWriter().also { throwable.printStackTrace(PrintWriter(it)) }.toString()
                val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
                val tail = recentLines(60).joinToString("\n")
                File(folder, "crash-$stamp.txt").writeText(
                    "Thread: ${thread.name}\n$trace\n--- Nhật ký ngay trước lỗi ---\n$tail\n",
                )
                // Keep the last few only.
                folder.listFiles()?.sortedByDescending { it.name }?.drop(5)?.forEach { it.delete() }
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    /** Crash reports of earlier runs (newest first). */
    fun crashReports(): List<Pair<String, String>> {
        val folder = crashFolder ?: return emptyList()
        return runCatching {
            folder.listFiles()?.filter { it.isFile }?.sortedByDescending { it.name }?.take(3)
                ?.map { it.name to it.readText().take(20_000) }.orEmpty()
        }.getOrDefault(emptyList())
    }

    fun clearCrashReports() {
        runCatching { crashFolder?.listFiles()?.forEach { it.delete() } }
    }
}
