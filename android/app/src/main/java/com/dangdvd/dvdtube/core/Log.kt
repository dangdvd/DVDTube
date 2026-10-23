package com.dangdvd.dvdtube.core

import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Diagnostics. Every line goes to an in-memory log the user can copy from Settings
 * (endpoints, HTTP status codes and errors only — never cookies or account data).
 */
object Log {
    private val lines = ArrayDeque<String>()
    private val formatter = SimpleDateFormat("HH:mm:ss", Locale.ROOT)

    fun debug(message: String) {
        android.util.Log.d("DVDTube", message)
        synchronized(lines) {
            lines.addLast(formatter.format(Date()) + " " + message)
            while (lines.size > 500) lines.removeFirst()
        }
    }

    fun text(version: String): String {
        val header = "DVDTube $version • Android ${Build.VERSION.RELEASE} (${Build.MANUFACTURER} ${Build.MODEL})"
        return synchronized(lines) { (listOf(header) + lines).joinToString("\n") }
    }

    fun clear() = synchronized(lines) { lines.clear() }
}
