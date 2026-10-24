package com.dangdvd.dvdtube.player

import java.net.URI

/**
 * Audio-only renditions of YouTube's HLS manifest (`#EXT-X-MEDIA:TYPE=AUDIO`): itag 233 ≈ 48 kbps,
 * 234 ≈ 128 kbps AAC in small segments, so audio-only playback starts right away.
 */
object HlsAudio {
    data class Rendition(
        val url: String,
        val itag: Int?,
        val isDefault: Boolean,
        /** `NAME` (e.g. "English (United States) original") and `LANGUAGE` of the rendition. */
        val name: String? = null,
        val language: String? = null,
    )

    fun renditions(text: String, base: String): List<Rendition> =
        text.lineSequence().map { it.trim() }.mapNotNull { line ->
            if (!line.startsWith("#EXT-X-MEDIA:") || !line.contains("TYPE=AUDIO")) return@mapNotNull null
            val uri = attribute("URI", line) ?: return@mapNotNull null
            val url = runCatching { URI(base).resolve(uri).toString() }.getOrNull() ?: return@mapNotNull null
            val itag = Regex("/itag/(\\d+)").find(url)?.groupValues?.get(1)?.toIntOrNull()
            Rendition(url, itag, attribute("DEFAULT", line) == "YES", attribute("NAME", line), attribute("LANGUAGE", line))
        }.toList()

    /**
     * The rendition in [matches] (an audio language the user picked) or else the original
     * language: the small one with data saver, otherwise the best one.
     */
    fun pick(text: String, base: String, preferSmall: Boolean, matches: ((Rendition) -> Boolean)? = null): Rendition? {
        val all = renditions(text, base)
        if (all.isEmpty()) return null
        val main = matches?.let { test -> all.filter(test) }?.ifEmpty { null } ?: all.filter { it.isDefault }.ifEmpty { all }
        main.firstOrNull { it.itag == if (preferSmall) 233 else 234 }?.let { return it }
        val sorted = main.sortedBy { it.itag ?: 0 }
        return if (preferSmall) sorted.first() else sorted.last()
    }

    private fun attribute(name: String, line: String): String? {
        val start = line.indexOf("$name=")
        if (start < 0) return null
        val rest = line.substring(start + name.length + 1)
        return if (rest.startsWith("\"")) rest.drop(1).substringBefore('"') else rest.substringBefore(',')
    }
}
