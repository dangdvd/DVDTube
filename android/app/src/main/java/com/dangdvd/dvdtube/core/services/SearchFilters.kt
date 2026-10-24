package com.dangdvd.dvdtube.core.services

import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

enum class UploadDateFilter(val title: String, val value: Int) {
    ANY("Bất kỳ lúc nào", 0), HOUR("Trong 1 giờ qua", 1), TODAY("Hôm nay", 2),
    WEEK("Tuần này", 3), MONTH("Tháng này", 4), YEAR("Năm nay", 5),
}

enum class TypeFilter(val title: String, val value: Int) {
    ALL("Tất cả", 0), VIDEO("Video", 1), SHORTS("Shorts", 9), CHANNEL("Kênh", 2), PLAYLIST("Danh sách phát", 3), MOVIE("Phim", 4),
}

enum class DurationFilter(val title: String, val value: Int) {
    ANY("Bất kỳ", 0), SHORT("Dưới 4 phút", 1), MEDIUM("4–20 phút", 3), LONG("Trên 20 phút", 2),
}

/** Boolean filters; [field] is the protobuf field number in YouTube's search params. */
enum class FeatureFilter(val title: String, val field: Int) {
    LIVE("Trực tiếp", 8), UHD("4K", 14), HD("HD", 4), SUBTITLES("Phụ đề", 5),
    CREATIVE_COMMONS("Creative Commons", 6), SPHERICAL("360°", 15), HDR("HDR", 25), VR180("VR180", 26),
}

enum class SortOrder(val title: String, val value: Int) {
    RELEVANCE("Mức độ liên quan", 0), UPLOAD_DATE("Ngày tải lên", 2), VIEW_COUNT("Lượt xem", 3), RATING("Xếp hạng", 1),
}

/** Everything in YouTube's search filter sheet, encoded into the `params` of a search request. */
data class SearchFilters(
    val uploadDate: UploadDateFilter = UploadDateFilter.ANY,
    val type: TypeFilter = TypeFilter.ALL,
    val duration: DurationFilter = DurationFilter.ANY,
    val features: Set<FeatureFilter> = emptySet(),
    val sort: SortOrder = SortOrder.RELEVANCE,
) {
    /** Filters chosen in the sheet (shown as a badge on the filter button). */
    val activeCount: Int
        get() = listOf(uploadDate != UploadDateFilter.ANY, type != TypeFilter.ALL, duration != DurationFilter.ANY,
            sort != SortOrder.RELEVANCE).count { it } + features.size

    /**
     * Protobuf `{1: sort, 2: {1: uploadDate, 2: type, 3: duration, <feature>: true…}}`, base64 and
     * URL-encoded like the params YouTube's own links carry (e.g. "EgIQAQ%3D%3D" = videos only).
     */
    fun params(): String? {
        val filters = ByteArrayOutputStream()
        if (uploadDate.value != 0) filters.field(1, uploadDate.value)
        if (type.value != 0) filters.field(2, type.value)
        if (duration.value != 0) filters.field(3, duration.value)
        features.sortedBy { it.field }.forEach { filters.field(it.field, 1) }

        val message = ByteArrayOutputStream()
        if (sort.value != 0) message.field(1, sort.value)
        val inner = filters.toByteArray()
        if (inner.isNotEmpty()) {
            message.varint(2L shl 3 or 2L)
            message.varint(inner.size.toLong())
            message.write(inner)
        }
        val bytes = message.toByteArray()
        if (bytes.isEmpty()) return null
        return Uri.encode(Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    private fun ByteArrayOutputStream.field(number: Int, value: Int) {
        varint(number.toLong() shl 3)
        varint(value.toLong())
    }

    private fun ByteArrayOutputStream.varint(value: Long) {
        var rest = value
        while (rest >= 0x80) {
            write(((rest and 0x7F) or 0x80).toInt())
            rest = rest ushr 7
        }
        write(rest.toInt())
    }
}

/** The quick filter chips above search results, as edits of [SearchFilters]. */
fun SearchFilter.isSelected(filters: SearchFilters): Boolean = when (this) {
    SearchFilter.ALL -> filters.type == TypeFilter.ALL && FeatureFilter.LIVE !in filters.features && filters.sort == SortOrder.RELEVANCE
    SearchFilter.VIDEOS -> filters.type == TypeFilter.VIDEO
    SearchFilter.SHORTS -> filters.type == TypeFilter.SHORTS
    SearchFilter.CHANNELS -> filters.type == TypeFilter.CHANNEL
    SearchFilter.PLAYLISTS -> filters.type == TypeFilter.PLAYLIST
    SearchFilter.LIVE -> FeatureFilter.LIVE in filters.features
    SearchFilter.RECENT -> filters.sort == SortOrder.UPLOAD_DATE
}

fun SearchFilter.toggle(filters: SearchFilters): SearchFilters {
    val selected = isSelected(filters)
    fun type(value: TypeFilter) = filters.copy(type = if (selected) TypeFilter.ALL else value)
    return when (this) {
        SearchFilter.ALL -> filters.copy(type = TypeFilter.ALL, features = filters.features - FeatureFilter.LIVE, sort = SortOrder.RELEVANCE)
        SearchFilter.VIDEOS -> type(TypeFilter.VIDEO)
        SearchFilter.SHORTS -> type(TypeFilter.SHORTS)
        SearchFilter.CHANNELS -> type(TypeFilter.CHANNEL)
        SearchFilter.PLAYLISTS -> type(TypeFilter.PLAYLIST)
        SearchFilter.LIVE -> filters.copy(features = if (selected) filters.features - FeatureFilter.LIVE else filters.features + FeatureFilter.LIVE)
        SearchFilter.RECENT -> filters.copy(sort = if (selected) SortOrder.RELEVANCE else SortOrder.UPLOAD_DATE)
    }
}
