import AVFoundation
import CoreMedia
import Foundation
import MediaToolbox

/// The ten bands of the equalizer.
enum EQBand {
    static let frequencies: [Double] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    static let labels = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"]
    static var count: Int { frequencies.count }
    static let range: ClosedRange<Double> = -12...12
}

/// Built-in equalizer settings for popular kinds of music (gains in dB, 31 Hz → 16 kHz).
struct EQPreset: Identifiable, Hashable {
    let id: String
    let name: String
    let gains: [Double]

    static let customID = "custom"

    static let flat = EQPreset(id: "flat", name: "Phẳng", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

    static let all: [EQPreset] = [
        flat,
        EQPreset(id: "pop", name: "Pop", gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2]),
        EQPreset(id: "rock", name: "Rock", gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5]),
        EQPreset(id: "edm", name: "EDM", gains: [6, 5, 3, 0, -1, 1, 2, 3, 4, 4]),
        EQPreset(id: "dance", name: "Dance", gains: [5, 6, 4, 0, -1, -1, 1, 3, 4, 3]),
        EQPreset(id: "trap", name: "Trap", gains: [7, 6, 4, 1, -1, -1, 0, 2, 3, 4]),
        EQPreset(id: "hiphop", name: "Hip-hop", gains: [5, 5, 3, 1, -1, -1, 1, 1, 2, 3]),
        EQPreset(id: "rnb", name: "R&B", gains: [3, 6, 5, 1, -2, -1, 2, 2, 3, 3]),
        EQPreset(id: "classical", name: "Cổ điển", gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4]),
        EQPreset(id: "jazz", name: "Jazz", gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3]),
        EQPreset(id: "acoustic", name: "Acoustic", gains: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1]),
        EQPreset(id: "bolero", name: "Bolero – Trữ tình", gains: [2, 2, 1, 1, 2, 3, 3, 2, 1, 0]),
        EQPreset(id: "kpop", name: "K-pop", gains: [2, 3, 2, 0, -1, 1, 3, 3, 3, 3]),
        EQPreset(id: "electronic", name: "Electronic", gains: [4, 4, 1, 0, -2, 2, 1, 1, 4, 5]),
        EQPreset(id: "metal", name: "Metal", gains: [5, 4, 4, 2, 0, -1, 2, 4, 5, 5]),
        EQPreset(id: "lofi", name: "Lofi", gains: [3, 3, 2, 1, 0, -1, -2, -3, -4, -5]),
        EQPreset(id: "latin", name: "Latin", gains: [4, 3, 0, 0, -1, -1, -1, 0, 3, 4]),
        EQPreset(id: "piano", name: "Piano", gains: [2, 1, 0, 2, 3, 1, 3, 4, 3, 2]),
        EQPreset(id: "vocal", name: "Giọng hát", gains: [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0]),
        EQPreset(id: "speech", name: "Lời nói – Podcast", gains: [-4, -3, -1, 1, 3, 4, 4, 2, 0, -2]),
        EQPreset(id: "bass", name: "Tăng bass", gains: [8, 7, 5, 2, 0, 0, 0, 0, 0, 0]),
        EQPreset(id: "treble", name: "Tăng treble", gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7]),
        EQPreset(id: "loudness", name: "Loudness", gains: [6, 4, 1, 0, -1, 0, 0, 1, 3, 5]),
        EQPreset(id: "phone", name: "Loa điện thoại", gains: [-6, -4, -1, 1, 2, 2, 3, 3, 2, 1]),
    ]

    static func preset(_ id: String) -> EQPreset? {
        all.first { $0.id == id }
    }
}

/// One second-order filter (RBJ "Audio EQ Cookbook"), normalised so a0 = 1.
struct Biquad {
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0

    enum Kind { case lowShelf, peaking, highShelf }

    init() {}

    init(kind: Kind, frequency: Double, gainDb: Double, q: Double, sampleRate: Double) {
        let f0 = min(frequency, sampleRate * 0.45)
        let a = pow(10, gainDb / 40)
        let w0 = 2 * Double.pi * f0 / sampleRate
        let cosW = cos(w0)
        let alpha = sin(w0) / (2 * q)
        var c: (b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double)
        switch kind {
        case .peaking:
            c = (1 + alpha * a, -2 * cosW, 1 - alpha * a, 1 + alpha / a, -2 * cosW, 1 - alpha / a)
        case .lowShelf:
            let s = 2 * sqrt(a) * alpha
            c = (a * ((a + 1) - (a - 1) * cosW + s),
                 2 * a * ((a - 1) - (a + 1) * cosW),
                 a * ((a + 1) - (a - 1) * cosW - s),
                 (a + 1) + (a - 1) * cosW + s,
                 -2 * ((a - 1) + (a + 1) * cosW),
                 (a + 1) + (a - 1) * cosW - s)
        case .highShelf:
            let s = 2 * sqrt(a) * alpha
            c = (a * ((a + 1) + (a - 1) * cosW + s),
                 -2 * a * ((a - 1) + (a + 1) * cosW),
                 a * ((a + 1) + (a - 1) * cosW - s),
                 (a + 1) - (a - 1) * cosW + s,
                 2 * ((a - 1) - (a + 1) * cosW),
                 (a + 1) - (a - 1) * cosW - s)
        }
        b0 = c.b0 / c.a0
        b1 = c.b1 / c.a0
        b2 = c.b2 / c.a0
        a1 = c.a1 / c.a0
        a2 = c.a2 / c.a0
    }

    /// The ten filters for a set of band gains (flat bands are skipped).
    static func bands(gains: [Double], sampleRate: Double) -> [Biquad] {
        EQBand.frequencies.indices.compactMap { index in
            let gain = index < gains.count ? gains[index] : 0
            guard abs(gain) > 0.01 else { return nil }
            let kind: Kind = index == 0 ? .lowShelf : (index == EQBand.count - 1 ? .highShelf : .peaking)
            return Biquad(kind: kind, frequency: EQBand.frequencies[index], gainDb: gain,
                          q: kind == .peaking ? 1.41 : 0.707, sampleRate: sampleRate)
        }
    }

    /// Gain (dB) of the filter at `frequency`, for drawing the response curve.
    func responseDb(at frequency: Double, sampleRate: Double) -> Double {
        let w = 2 * Double.pi * frequency / sampleRate
        let cos1 = cos(w), sin1 = sin(w), cos2 = cos(2 * w), sin2 = sin(2 * w)
        let numRe = b0 + b1 * cos1 + b2 * cos2, numIm = -(b1 * sin1 + b2 * sin2)
        let denRe = 1 + a1 * cos1 + a2 * cos2, denIm = -(a1 * sin1 + a2 * sin2)
        let magnitude = sqrt((numRe * numRe + numIm * numIm) / max(denRe * denRe + denIm * denIm, 1e-12))
        return 20 * log10(max(magnitude, 1e-6))
    }
}

/// The equalizer setting shared with the audio thread. Writers lock; the audio thread only
/// *tries* the lock, so it never waits on the main thread.
final class EqualizerEngine: @unchecked Sendable {
    static let shared = EqualizerEngine()

    struct Snapshot {
        var version: Int
        var enabled: Bool
        var gains: [Double]
        var preampDb: Double
    }

    private let lock = NSLock()
    private var current = Snapshot(version: 0, enabled: false, gains: [Double](repeating: 0, count: EQBand.count), preampDb: 0)

    func update(enabled: Bool, gains: [Double], preampDb: Double) {
        lock.lock()
        current = Snapshot(version: current.version + 1, enabled: enabled, gains: gains, preampDb: preampDb)
        lock.unlock()
    }

    /// The setting if it changed since `version` (nil when unchanged or the lock is busy).
    func snapshot(newerThan version: Int) -> Snapshot? {
        guard lock.try() else { return nil }
        defer { lock.unlock() }
        return current.version != version ? current : nil
    }
}

/// Per-item processing state for the audio tap (used on the audio render thread only).
final class EqualizerProcessor {
    private var version = -1
    private var enabled = false
    private var preamp: Float = 1
    private var filters: [Biquad] = []
    /// Two delay values per filter per channel.
    private var state: [Double] = []
    private var sampleRate = 44_100.0
    private var channels = 2
    private var isFloat = true
    private var isInterleaved = false

    func prepare(format: AudioStreamBasicDescription) {
        sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 44_100
        channels = max(Int(format.mChannelsPerFrame), 1)
        isFloat = format.mFormatFlags & kAudioFormatFlagIsFloat != 0 && format.mBitsPerChannel == 32
        isInterleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        version = -1
    }

    func unprepare() {
        state = []
    }

    private func refresh() {
        guard let snapshot = EqualizerEngine.shared.snapshot(newerThan: version) else { return }
        version = snapshot.version
        enabled = snapshot.enabled
        preamp = Float(pow(10, snapshot.preampDb / 20))
        let fresh = Biquad.bands(gains: snapshot.gains, sampleRate: sampleRate)
        if fresh.count != filters.count { state = [Double](repeating: 0, count: fresh.count * 2 * channels) }
        filters = fresh
    }

    func process(_ bufferList: UnsafeMutablePointer<AudioBufferList>, frames: Int) {
        refresh()
        guard enabled, isFloat, frames > 0 else { return }
        if state.count != filters.count * 2 * channels {
            state = [Double](repeating: 0, count: filters.count * 2 * channels)
        }
        let buffers = UnsafeMutableAudioBufferListPointer(bufferList)
        if isInterleaved {
            guard let buffer = buffers.first, let data = buffer.mData else { return }
            let samples = data.assumingMemoryBound(to: Float.self)
            let stride = max(Int(buffer.mNumberChannels), 1)
            let count = min(frames, Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * stride))
            for channel in 0..<min(stride, channels) {
                run(samples + channel, count: count, stride: stride, channel: channel)
            }
        } else {
            for (channel, buffer) in buffers.enumerated() where channel < channels {
                guard let data = buffer.mData else { continue }
                let count = min(frames, Int(buffer.mDataByteSize) / MemoryLayout<Float>.size)
                run(data.assumingMemoryBound(to: Float.self), count: count, stride: 1, channel: channel)
            }
        }
    }

    private func run(_ samples: UnsafeMutablePointer<Float>, count: Int, stride: Int, channel: Int) {
        let base = channel * filters.count * 2
        let gain = preamp
        filters.withUnsafeBufferPointer { filters in
            state.withUnsafeMutableBufferPointer { state in
                for frame in 0..<count {
                    let index = frame * stride
                    var x = Double(samples[index] * gain)
                    for n in 0..<filters.count {
                        let f = filters[n]
                        let z = base + n * 2
                        let y = f.b0 * x + state[z]
                        state[z] = f.b1 * x - f.a1 * y + state[z + 1]
                        state[z + 1] = f.b2 * x - f.a2 * y
                        x = y
                    }
                    samples[index] = Float(Self.limit(x))
                }
            }
        }
    }

    /// Soft limiter: leaves normal levels alone and rounds off peaks instead of clipping.
    private static func limit(_ x: Double) -> Double {
        let magnitude = abs(x)
        guard magnitude > 0.8 else { return x }
        let shaped = 0.8 + 0.2 * tanh((magnitude - 0.8) / 0.2)
        return x < 0 ? -shaped : shaped
    }
}

/// Builds the `MTAudioProcessingTap` that runs the equalizer on an item's audio track.
enum EqualizerTap {
    static func audioMix(for track: AVAssetTrack) -> AVAudioMix? {
        let processor = EqualizerProcessor()
        var callbacks = MTAudioProcessingTapCallbacks(
            version: Int32(kMTAudioProcessingTapCallbacksVersion_0),
            clientInfo: UnsafeMutableRawPointer(Unmanaged.passRetained(processor).toOpaque()),
            init: tapInit,
            finalize: tapFinalize,
            prepare: tapPrepare,
            unprepare: tapUnprepare,
            process: tapProcess
        )
        var created: Unmanaged<MTAudioProcessingTap>?
        let status = MTAudioProcessingTapCreate(
            kCFAllocatorDefault, &callbacks, MTAudioProcessingTapCreationFlags(kMTAudioProcessingTapCreationFlag_PostEffects), &created
        )
        guard status == noErr, let tap = created?.takeRetainedValue() else {
            Unmanaged.passUnretained(processor).release()
            Log.debug("equalizer: tap creation failed (\(status))")
            return nil
        }
        let parameters = AVMutableAudioMixInputParameters(track: track)
        parameters.audioTapProcessor = tap
        let mix = AVMutableAudioMix()
        mix.inputParameters = [parameters]
        return mix
    }

    private static let tapInit: MTAudioProcessingTapInitCallback = { _, clientInfo, storage in
        storage.pointee = clientInfo
    }

    private static let tapFinalize: MTAudioProcessingTapFinalizeCallback = { tap in
        Unmanaged<EqualizerProcessor>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
    }

    private static let tapPrepare: MTAudioProcessingTapPrepareCallback = { tap, _, format in
        Unmanaged<EqualizerProcessor>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
            .prepare(format: format.pointee)
    }

    private static let tapUnprepare: MTAudioProcessingTapUnprepareCallback = { tap in
        Unmanaged<EqualizerProcessor>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().unprepare()
    }

    private static let tapProcess: MTAudioProcessingTapProcessCallback = { tap, frames, _, bufferList, framesOut, flagsOut in
        let status = MTAudioProcessingTapGetSourceAudio(tap, frames, bufferList, flagsOut, nil, framesOut)
        guard status == noErr else { return }
        Unmanaged<EqualizerProcessor>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
            .process(bufferList, frames: Int(framesOut.pointee))
    }
}
