package com.dangdvd.dvdtube.core

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * A thin, read-only wrapper around the tree produced by `org.json`. InnerTube responses
 * are huge and their shape changes often, so instead of strict models we navigate them
 * defensively: every lookup returns a node and a missing key simply yields an empty node.
 */
class JNode(val raw: Any?) {

    operator fun get(key: String): JNode = JNode((raw as? JSONObject)?.opt(key))

    operator fun get(index: Int): JNode {
        val array = raw as? JSONArray ?: return EMPTY
        return if (index in 0 until array.length()) JNode(array.opt(index)) else EMPTY
    }

    /** Follows a path of keys, e.g. `node.at("a", "b", "c")`. */
    fun at(vararg keys: String): JNode {
        var node = this
        for (key in keys) {
            node = node[key]
            if (!node.exists) return EMPTY
        }
        return node
    }

    val exists: Boolean get() = raw != null && raw != JSONObject.NULL

    val keys: List<String> get() = (raw as? JSONObject)?.keys()?.asSequence()?.toList() ?: emptyList()

    val array: List<JNode>
        get() {
            val array = raw as? JSONArray ?: return emptyList()
            return List(array.length()) { JNode(array.opt(it)) }
        }

    val first: JNode get() = this[0]

    val string: String?
        get() = when (val value = raw) {
            is String -> value
            is Number -> if (value is Double && value % 1.0 == 0.0) value.toLong().toString() else value.toString()
            is Boolean -> value.toString()
            else -> null
        }

    val int: Int?
        get() = when (val value = raw) {
            is Number -> value.toInt()
            is String -> value.trim().toIntOrNull()
            else -> null
        }

    val long: Long?
        get() = when (val value = raw) {
            is Number -> value.toLong()
            is String -> value.trim().toLongOrNull()
            else -> null
        }

    val double: Double?
        get() = when (val value = raw) {
            is Number -> value.toDouble()
            is String -> value.trim().toDoubleOrNull()
            else -> null
        }

    val bool: Boolean?
        get() = when (val value = raw) {
            is Boolean -> value
            is String -> value == "true"
            is Number -> value.toInt() != 0
            else -> null
        }

    /**
     * Human readable text from the many shapes InnerTube uses: plain strings, `{simpleText}`,
     * `{runs: [{text}]}` and `{content}`.
     */
    val text: String?
        get() {
            (raw as? String)?.let { return it }
            this["simpleText"].string?.let { return it }
            val runs = this["runs"]
            if (runs.raw is JSONArray) {
                val joined = runs.array.mapNotNull { it["text"].raw as? String }.joinToString("")
                return joined.ifEmpty { null }
            }
            this["content"].string?.let { return it }
            val text = this["text"]
            if (text.raw is String) return text.raw
            if (text.exists) return text.text
            return null
        }

    /** Depth-first search for every value stored under [key]. */
    fun findAll(key: String, limit: Int = Int.MAX_VALUE): List<JNode> {
        val results = ArrayList<JNode>()
        collect(raw, key, results, limit)
        return results
    }

    fun findFirst(key: String): JNode = findAll(key, 1).firstOrNull() ?: EMPTY

    /** URL of the widest image in `{thumbnails: [...]}` or `{sources: [...]}` lists. */
    val bestImageUrl: String?
        get() {
            var candidates = this["thumbnails"].array
            if (candidates.isEmpty()) candidates = this["sources"].array
            if (candidates.isEmpty()) candidates = array
            val best = candidates.maxByOrNull { it["width"].int ?: 0 } ?: return null
            return best["url"].string?.let(::youtubeImage)
        }

    override fun toString(): String = raw?.toString() ?: "null"

    companion object {
        val EMPTY = JNode(null)

        fun parse(text: String): JNode = JNode(JSONTokener(text).nextValue())

        private fun collect(value: Any?, key: String, results: MutableList<JNode>, limit: Int) {
            if (results.size >= limit) return
            when (value) {
                is JSONObject -> {
                    val iterator = value.keys()
                    while (iterator.hasNext()) {
                        val k = iterator.next()
                        val v = value.opt(k)
                        if (k == key) {
                            results.add(JNode(v))
                            if (results.size >= limit) return
                        } else {
                            collect(v, key, results, limit)
                        }
                        if (results.size >= limit) return
                    }
                }
                is JSONArray -> {
                    for (i in 0 until value.length()) {
                        collect(value.opt(i), key, results, limit)
                        if (results.size >= limit) return
                    }
                }
            }
        }
    }
}

/** Image URLs from InnerTube are sometimes protocol-relative (`//yt3.ggpht.com/...`). */
fun youtubeImage(url: String): String = if (url.startsWith("//")) "https:$url" else url
