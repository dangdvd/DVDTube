package com.dangdvd.dvdtube.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.core.services.DeArrow

/**
 * [video] with DeArrow's title / thumbnail once they are known (the original shows first and is
 * swapped when ready; a thumbnail that fails to load keeps the original).
 */
@Composable
fun rememberDeArrow(video: VideoItem): VideoItem {
    if (video.isShort || !DeArrow.isEnabled) return video
    val context = LocalContext.current
    val branding by produceState(DeArrow.cached(video.id), video.id) {
        value = DeArrow.branding(video.id)
    }
    val candidate = branding?.thumbnailUrl?.takeIf { AppSettings.deArrowThumbnails }
    var verified by remember(video.id) { mutableStateOf<String?>(null) }
    LaunchedEffect(candidate) {
        verified = null
        if (candidate == null || DeArrow.isThumbnailBad(candidate)) return@LaunchedEffect
        val request = ImageRequest.Builder(context).data(candidate).size(480, 270).build()
        val result = runCatching { context.imageLoader.execute(request) }.getOrNull()
        if (result is SuccessResult) verified = candidate else DeArrow.markThumbnailBad(candidate)
    }
    val title = branding?.title?.takeIf { AppSettings.deArrowTitles && it.isNotBlank() }
    val thumbnail = verified
    if (title == null && thumbnail == null) return video
    return video.copy(title = title ?: video.title, thumbnail = thumbnail ?: video.thumbnail)
}
