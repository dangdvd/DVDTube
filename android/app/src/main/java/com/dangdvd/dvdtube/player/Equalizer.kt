package com.dangdvd.dvdtube.player

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import com.dangdvd.dvdtube.core.AppSettings
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** A named set of band gains (dB, 31 Hz → 16 kHz). */
data class EqPreset(val id: String, val title: String, val gains: List<Float>)

/** The 10-band equalizer ("Bộ chỉnh âm") and its presets for popular genres. */
object Equalizer {
    val frequencies = intArrayOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)
    const val CUSTOM = "custom"
    const val MIN_GAIN = -12f
    const val MAX_GAIN = 12f

    private fun preset(id: String, title: String, vararg gains: Int) = EqPreset(id, title, gains.map { it.toFloat() })

    val presets = listOf(
        preset("flat", "Phẳng", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        preset("pop", "Pop", -1, 1, 3, 4, 3, 0, -1, -1, 1, 2),
        preset("rock", "Rock", 5, 4, 3, 1, -1, -1, 1, 3, 4, 5),
        preset("edm", "EDM", 6, 5, 3, 0, -1, 1, 2, 3, 4, 4),
        preset("dance", "Dance", 5, 6, 4, 0, -1, -1, 1, 3, 4, 3),
        preset("trap", "Trap", 7, 6, 4, 1, -1, -1, 0, 2, 3, 4),
        preset("hiphop", "Hip-hop", 5, 5, 3, 1, -1, -1, 1, 1, 2, 3),
        preset("rnb", "R&B", 3, 6, 5, 1, -2, -1, 2, 2, 3, 3),
        preset("classical", "Cổ điển", 4, 3, 2, 1, -1, -1, 0, 2, 3, 4),
        preset("jazz", "Jazz", 3, 2, 1, 2, -1, -1, 0, 1, 2, 3),
        preset("acoustic", "Acoustic", 3, 3, 2, 1, 1, 1, 2, 3, 2, 1),
        preset("bolero", "Bolero – Trữ tình", 2, 2, 1, 1, 2, 3, 3, 2, 1, 0),
        preset("kpop", "K-pop", 2, 3, 2, 0, -1, 1, 3, 3, 3, 3),
        preset("electronic", "Electronic", 4, 4, 1, 0, -2, 2, 1, 1, 4, 5),
        preset("metal", "Metal", 5, 4, 4, 2, 0, -1, 2, 4, 5, 5),
        preset("lofi", "Lofi", 3, 3, 2, 1, 0, -1, -2, -3, -4, -5),
        preset("latin", "Latin", 4, 3, 0, 0, -1, -1, -1, 0, 3, 4),
        preset("piano", "Piano", 2, 1, 0, 2, 3, 1, 3, 4, 3, 2),
        preset("vocal", "Giọng hát", -2, -2, -1, 1, 3, 4, 4, 3, 1, 0),
        preset("speech", "Lời nói – Podcast", -4, -3, -1, 1, 3, 4, 4, 2, 0, -2),
        preset("bass", "Tăng bass", 8, 7, 5, 2, 0, 0, 0, 0, 0, 0),
        preset("treble", "Tăng treble", 0, 0, 0, 0, 0, 1, 3, 5, 6, 7),
        preset("loudness", "Loudness", 6, 4, 1, 0, -1, 0, 0, 1, 3, 5),
        preset("phone", "Loa điện thoại", -6, -4, -1, 1, 2, 2, 3, 3, 2, 1),
    )

    private val flat = List(frequencies.size) { 0f }

    /** Applies to the main player's audio (every kind of stream). */
    val processor = EqualizerAudioProcessor()

    val isEnabled: Boolean get() = AppSettings.equalizerEnabled
    val presetId: String get() = AppSettings.equalizerPreset

    val customGains: List<Float>
        get() {
            val values = AppSettings.equalizerCustomGains.split(",").mapNotNull { it.trim().toFloatOrNull() }
            return if (values.size == frequencies.size) values else flat
        }

    val gains: List<Float>
        get() = if (presetId == CUSTOM) customGains else presets.firstOrNull { it.id == presetId }?.gains ?: flat

    val presetTitle: String
        get() = if (presetId == CUSTOM) "Tùy chỉnh" else presets.firstOrNull { it.id == presetId }?.title ?: "Phẳng"

    /** Keeps boosted bands from clipping: half of the largest boost, taken off the input. */
    fun autoPreamp(values: List<Float>): Float = -0.5f * maxOf(0f, values.maxOrNull() ?: 0f)

    val preamp: Float get() = if (AppSettings.equalizerAutoPreamp) autoPreamp(gains) else AppSettings.equalizerPreamp

    fun setEnabled(on: Boolean) {
        AppSettings.equalizerEnabled = on
        apply()
    }

    fun selectPreset(id: String) {
        AppSettings.equalizerPreset = id
        apply()
    }

    /** Editing a band switches to "Custom", starting from the gains in use. */
    fun setBand(index: Int, gain: Float) {
        if (index !in frequencies.indices) return
        val values = gains.toMutableList()
        values[index] = gain.coerceIn(MIN_GAIN, MAX_GAIN)
        AppSettings.equalizerCustomGains = values.joinToString(",") { String.format(Locale.ROOT, "%.1f", it) }
        AppSettings.equalizerPreset = CUSTOM
        apply()
    }

    fun setAutoPreamp(on: Boolean) {
        if (!on) AppSettings.equalizerPreamp = preamp
        AppSettings.equalizerAutoPreamp = on
        apply()
    }

    fun setPreamp(value: Float) {
        AppSettings.equalizerAutoPreamp = false
        AppSettings.equalizerPreamp = value.coerceIn(-12f, 6f)
        apply()
    }

    fun reset() {
        AppSettings.equalizerCustomGains = ""
        AppSettings.equalizerPreset = "flat"
        AppSettings.equalizerAutoPreamp = true
        AppSettings.equalizerPreamp = 0f
        apply()
    }

    /** Hands the current settings to the audio thread. */
    fun apply() {
        processor.update(if (isEnabled) gains else null, preamp)
    }

    fun frequencyLabel(hz: Int): String = if (hz >= 1000) "${hz / 1000}k" else "$hz"
}

/** Inserts the equalizer into ExoPlayer's audio chain. */
class EqualizerRenderersFactory(context: Context) : DefaultRenderersFactory(context) {
    override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink? =
        DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(enableFloatOutput)
            .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
            .setAudioProcessors(arrayOf<AudioProcessor>(Equalizer.processor))
            .build()
}

/**
 * 10 biquad filters in series (RBJ cookbook: low shelf, 8 peaking bands, high shelf) on 16-bit
 * or float PCM, with a preamp and a soft limiter. Passes the audio through untouched when off.
 */
class EqualizerAudioProcessor : BaseAudioProcessor() {
    private class Settings(val gains: FloatArray, val preampDb: Float)

    @Volatile private var settings: Settings? = null
    @Volatile private var version = 0
    private var appliedVersion = -1
    private var channels = 0
    private var sampleRate = 0
    private var inputGain = 1.0
    /** Per band: b0, b1, b2, a1, a2 (normalised by a0). */
    private var coefficients = Array(BANDS) { doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0) }
    /** Per channel and band: x1, x2, y1, y2. */
    private var history = Array(0) { DoubleArray(4) }

    /** [gains] `null` (or all flat without preamp) turns the equalizer off. */
    fun update(gains: List<Float>?, preampDb: Float) {
        settings = if (gains == null || (gains.all { it == 0f } && preampDb == 0f)) null else Settings(gains.toFloatArray(), preampDb)
        version++
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            return AudioProcessor.AudioFormat.NOT_SET
        }
        channels = inputAudioFormat.channelCount
        sampleRate = inputAudioFormat.sampleRate
        history = Array(channels * BANDS) { DoubleArray(4) }
        appliedVersion = -1
        return inputAudioFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val output = replaceOutputBuffer(size)
        val current = settings
        if (current == null || channels <= 0 || sampleRate <= 0) {
            output.put(inputBuffer)
            output.flip()
            return
        }
        if (appliedVersion != version) {
            rebuild(current)
            appliedVersion = version
        }
        inputBuffer.order(ByteOrder.nativeOrder())
        var channel = 0
        if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
            while (inputBuffer.remaining() >= 4) {
                output.putFloat(process(inputBuffer.float.toDouble(), channel).toFloat())
                channel = (channel + 1) % channels
            }
        } else {
            while (inputBuffer.remaining() >= 2) {
                val y = process(inputBuffer.short / 32768.0, channel)
                output.putShort((y * 32767.0).roundToInt().coerceIn(-32768, 32767).toShort())
                channel = (channel + 1) % channels
            }
        }
        output.flip()
    }

    override fun onFlush() {
        history.forEach { it.fill(0.0) }
    }

    override fun onReset() {
        history = Array(0) { DoubleArray(4) }
        channels = 0
        sampleRate = 0
        appliedVersion = -1
    }

    private fun process(sample: Double, channel: Int): Double {
        var y = sample * inputGain
        val bands = coefficients.size
        for (band in 0 until bands) {
            val c = coefficients[band]
            val h = history[channel * bands + band]
            val out = c[0] * y + c[1] * h[0] + c[2] * h[1] - c[3] * h[2] - c[4] * h[3]
            h[1] = h[0]
            h[0] = y
            h[3] = h[2]
            h[2] = out
            y = out
        }
        return softLimit(y)
    }

    /** Linear up to 0.8, then bends smoothly towards full scale. */
    private fun softLimit(x: Double): Double {
        val magnitude = abs(x)
        if (magnitude <= 0.8) return x
        val over = (magnitude - 0.8) / 0.2
        val limited = 0.8 + 0.2 * over / (1 + over)
        return if (x < 0) -limited else limited
    }

    private fun rebuild(current: Settings) {
        inputGain = 10.0.pow(current.preampDb / 20.0)
        val frequencies = Equalizer.frequencies
        coefficients = Array(frequencies.size) { index ->
            val gain = current.gains.getOrElse(index) { 0f }.toDouble()
            val frequency = frequencies[index].toDouble()
            when {
                gain == 0.0 || frequency >= sampleRate * 0.45 -> doubleArrayOf(1.0, 0.0, 0.0, 0.0, 0.0)
                index == 0 -> shelf(frequency, gain, low = true)
                index == frequencies.lastIndex -> shelf(frequency, gain, low = false)
                else -> peaking(frequency, gain)
            }
        }
    }

    private fun peaking(frequency: Double, gainDb: Double): DoubleArray {
        val a = 10.0.pow(gainDb / 40)
        val w0 = 2 * PI * frequency / sampleRate
        val alpha = sin(w0) / (2 * Q)
        val cosW = cos(w0)
        val a0 = 1 + alpha / a
        return doubleArrayOf((1 + alpha * a) / a0, -2 * cosW / a0, (1 - alpha * a) / a0, -2 * cosW / a0, (1 - alpha / a) / a0)
    }

    private fun shelf(frequency: Double, gainDb: Double, low: Boolean): DoubleArray {
        val a = 10.0.pow(gainDb / 40)
        val w0 = 2 * PI * frequency / sampleRate
        val cosW = cos(w0)
        val beta = 2 * sqrt(a) * sin(w0) / (2 * Q)
        val b0: Double
        val b1: Double
        val b2: Double
        val a0: Double
        val a1: Double
        val a2: Double
        if (low) {
            b0 = a * ((a + 1) - (a - 1) * cosW + beta)
            b1 = 2 * a * ((a - 1) - (a + 1) * cosW)
            b2 = a * ((a + 1) - (a - 1) * cosW - beta)
            a0 = (a + 1) + (a - 1) * cosW + beta
            a1 = -2 * ((a - 1) + (a + 1) * cosW)
            a2 = (a + 1) + (a - 1) * cosW - beta
        } else {
            b0 = a * ((a + 1) + (a - 1) * cosW + beta)
            b1 = -2 * a * ((a - 1) + (a + 1) * cosW)
            b2 = a * ((a + 1) + (a - 1) * cosW - beta)
            a0 = (a + 1) - (a - 1) * cosW + beta
            a1 = 2 * ((a - 1) - (a + 1) * cosW)
            a2 = (a + 1) - (a - 1) * cosW - beta
        }
        return doubleArrayOf(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
    }

    private companion object {
        const val Q = 1.41
        /** Same as [Equalizer.frequencies]. */
        const val BANDS = 10
    }
}
