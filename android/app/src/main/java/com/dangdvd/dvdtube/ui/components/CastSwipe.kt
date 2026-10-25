package com.dangdvd.dvdtube.ui.components

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.filled.QueuePlayNext
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.cast.DvdCastSender
import com.dangdvd.dvdtube.core.VideoItem
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.Toasts
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign

/**
 * While a DVDTube TV / PC is connected: swipe the video right for "Phát tiếp theo", left for
 * "Thêm vào cuối hàng đợi" (like Apple Music), the action showing under the card.
 */
@Composable
fun CastSwipe(video: VideoItem, content: @Composable () -> Unit) {
    if (!DvdCastSender.isConnected || video.isShort) {
        content()
        return
    }
    val density = LocalDensity.current
    // About a third of a phone's width.
    val threshold = with(density) { 110.dp.toPx() }
    val haptics = LocalHapticFeedback.current
    var raw by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    // Past the threshold the card follows the finger more slowly.
    val target = if (abs(raw) <= threshold) raw else sign(raw) * (threshold + (abs(raw) - threshold) * 0.35f)
    val spec: AnimationSpec<Float> = if (dragging) snap() else spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow)
    val shown by animateFloatAsState(target, spec, label = "castSwipe")
    val armed = dragging && abs(raw) >= threshold
    LaunchedEffect(armed) { if (armed) haptics.performHapticFeedback(HapticFeedbackType.LongPress) }

    // The first time a TV is connected, one card nudges right and left with a tip.
    LaunchedEffect(Unit) {
        delay(700)
        if (!DvdCastSender.claimSwipeHint()) return@LaunchedEffect
        val step = with(density) { 44.dp.toPx() }
        for (x in listOf(step, -step, 0f)) {
            raw = x
            delay(420)
        }
        Toasts.show("Mẹo: vuốt video sang phải để phát tiếp theo, sang trái để thêm vào cuối hàng đợi trên TV")
    }

    Box(Modifier.fillMaxWidth()) {
        if (shown != 0f) {
            val next = shown > 0
            Row(
                Modifier.matchParentSize()
                    .background((if (next) Color(0xFF1E88E5) else Color(0xFF43A047)).copy(alpha = if (armed) 1f else 0.6f))
                    .padding(horizontal = 20.dp),
                horizontalArrangement = if (next) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (next) Icons.Default.QueuePlayNext else Icons.AutoMirrored.Filled.PlaylistAdd, null, tint = Color.White)
                Spacer(Modifier.width(8.dp))
                Text(if (next) "Phát tiếp theo" else "Thêm vào cuối hàng đợi", color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        }
        Box(
            Modifier
                .offset { IntOffset(shown.roundToInt(), 0) }
                .background(MaterialTheme.colorScheme.background)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { delta -> raw += delta },
                    onDragStarted = { dragging = true },
                    onDragStopped = {
                        val act = abs(raw) >= threshold
                        val next = raw > 0
                        dragging = false
                        raw = 0f
                        if (act) PlayerController.castQueue(video, next)
                    },
                ),
        ) { content() }
    }
}
