package com.dangdvd.dvdtube.ui.player

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.player.Equalizer
import com.dangdvd.dvdtube.ui.Brand
import com.dangdvd.dvdtube.ui.components.ScreenScaffold
import java.util.Locale
import kotlin.math.roundToInt

private fun gainText(gain: Float): String = when {
    gain == 0f -> "0"
    gain % 1f == 0f -> String.format(Locale.ROOT, "%+d", gain.toInt())
    else -> String.format(Locale.ROOT, "%+.1f", gain)
}

/** Enable switch, genre presets, 10 band sliders and the preamp; changes apply while playing. */
@Composable
fun EqualizerContent(modifier: Modifier = Modifier) {
    val enabled = Equalizer.isEnabled
    Column(modifier.fillMaxWidth()) {
        ToggleRow(Icons.Default.GraphicEq, "Bật bộ chỉnh âm", enabled, "Áp dụng cho mọi video, kể cả khi phát trong nền") {
            Equalizer.setEnabled(it)
        }
        Text("Kiểu nhạc", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(Equalizer.presets, key = { it.id }) { preset ->
                FilterChip(
                    selected = Equalizer.presetId == preset.id,
                    onClick = {
                        Equalizer.selectPreset(preset.id)
                        if (!Equalizer.isEnabled) Equalizer.setEnabled(true)
                    },
                    label = { Text(preset.title) },
                )
            }
            item(key = Equalizer.CUSTOM) {
                FilterChip(
                    selected = Equalizer.presetId == Equalizer.CUSTOM,
                    onClick = {
                        Equalizer.selectPreset(Equalizer.CUSTOM)
                        if (!Equalizer.isEnabled) Equalizer.setEnabled(true)
                    },
                    label = { Text("Tùy chỉnh") },
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        val gains = Equalizer.gains
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp).alpha(if (enabled) 1f else 0.5f),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            Equalizer.frequencies.forEachIndexed { index, hz ->
                BandSlider(Equalizer.frequencyLabel(hz), gains.getOrElse(index) { 0f }, Modifier.weight(1f)) { value ->
                    Equalizer.setBand(index, value)
                    if (!Equalizer.isEnabled) Equalizer.setEnabled(true)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Tiền khuếch đại: ${gainText((Equalizer.preamp * 2).roundToInt() / 2f)} dB", style = MaterialTheme.typography.bodyLarge)
                Text("Tự động giảm đầu vào khi tăng nhiều để tránh rè tiếng", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("Tự động", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(end = 6.dp))
            Switch(checked = AppSettings.equalizerAutoPreamp, onCheckedChange = { Equalizer.setAutoPreamp(it) })
        }
        Slider(
            value = Equalizer.preamp,
            onValueChange = { Equalizer.setPreamp((it * 2).roundToInt() / 2f) },
            valueRange = -12f..6f,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp)) {
            OutlinedButton(onClick = { Equalizer.reset() }) { Text("Đặt lại") }
        }
        Text(
            "Kéo từng cột để chỉnh âm trầm (bên trái) đến âm cao (bên phải); chỉnh tay sẽ chuyển sang \"Tùy chỉnh\" và được lưu lại.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
        )
    }
}

/** A vertical −12…+12 dB slider: drag or tap; filled from 0 dB to the value. */
@Composable
private fun BandSlider(label: String, gain: Float, modifier: Modifier, onChange: (Float) -> Unit) {
    val change by rememberUpdatedState(onChange)
    val track = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
    fun valueAt(y: Float, height: Int): Float {
        val fraction = 1f - (y / height.coerceAtLeast(1)).coerceIn(0f, 1f)
        val value = fraction * (Equalizer.MAX_GAIN - Equalizer.MIN_GAIN) + Equalizer.MIN_GAIN
        return (value * 2).roundToInt() / 2f
    }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(gainText(gain), style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 1)
        Canvas(
            Modifier
                .width(30.dp)
                .height(170.dp)
                .padding(vertical = 8.dp)
                .pointerInput(Unit) {
                    detectTapGestures { offset -> change(valueAt(offset.y, size.height)) }
                }
                .pointerInput(Unit) {
                    detectVerticalDragGestures(onDragStart = { offset -> change(valueAt(offset.y, size.height)) }) { pointer, _ ->
                        pointer.consume()
                        change(valueAt(pointer.position.y, size.height))
                    }
                },
        ) {
            val x = size.width / 2
            val range = Equalizer.MAX_GAIN - Equalizer.MIN_GAIN
            fun yOf(value: Float) = size.height * (1f - (value - Equalizer.MIN_GAIN) / range)
            drawLine(track, Offset(x, 0f), Offset(x, size.height), strokeWidth = 4.dp.toPx(), cap = StrokeCap.Round)
            drawLine(track, Offset(x - 8.dp.toPx(), yOf(0f)), Offset(x + 8.dp.toPx(), yOf(0f)), strokeWidth = 1.dp.toPx())
            drawLine(Brand, Offset(x, yOf(0f)), Offset(x, yOf(gain)), strokeWidth = 4.dp.toPx(), cap = StrokeCap.Round)
            drawCircle(Brand, radius = 8.dp.toPx(), center = Offset(x, yOf(gain)))
        }
        Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}

@Composable
fun EqualizerScreen() {
    ScreenScaffold("Bộ chỉnh âm (EQ)") { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            EqualizerContent()
            Spacer(Modifier.height(24.dp))
        }
    }
}
