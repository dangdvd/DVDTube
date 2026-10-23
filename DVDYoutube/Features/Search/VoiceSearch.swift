import AVFoundation
import Observation
import Speech
import SwiftUI

/// Live speech-to-text for the search box (on-device or Apple's recognizer).
@MainActor
@Observable
final class SpeechRecognizer {
    private(set) var transcript = ""
    private(set) var isListening = false
    private(set) var error: String?

    @ObservationIgnored var onFinish: ((String) -> Void)?
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var silenceTask: Task<Void, Never>?

    func start(locale: Locale) async {
        error = nil
        transcript = ""
        let status = await withCheckedContinuation { (continuation: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard status == .authorized else {
            error = "Chưa cho phép nhận dạng giọng nói. Bật trong Cài đặt › DVDTube."
            return
        }
        guard await AVAudioApplication.requestRecordPermission() else {
            error = "Chưa cho phép dùng micro. Bật trong Cài đặt › DVDTube."
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            error = "Nhận dạng giọng nói hiện không khả dụng."
            return
        }

        PlayerManager.shared.pause()
        ShortsPlayer.shared.pause()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request
            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
            isListening = true

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let isFinal = result?.isFinal ?? false
                Task { @MainActor in
                    guard let self else { return }
                    if let text {
                        self.transcript = text
                        self.armSilenceTimer(seconds: 1.5)
                    }
                    if isFinal || error != nil { self.finish() }
                }
            }
            armSilenceTimer(seconds: 6)
        } catch {
            self.error = error.localizedDescription
            stop()
        }
    }

    /// Stops after a short pause in speech, like the official app.
    private func armSilenceTimer(seconds: Double) {
        silenceTask?.cancel()
        silenceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.finish()
        }
    }

    func finish() {
        guard isListening else { return }
        stop()
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { onFinish?(text) }
    }

    func stop() {
        silenceTask?.cancel()
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isListening = false
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }
}

struct VoiceSearchSheet: View {
    var onResult: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var recognizer = SpeechRecognizer()
    @State private var pulse = false

    private var locale: Locale {
        switch APIConfig.hl {
        case "vi": return Locale(identifier: "vi-VN")
        case "en": return Locale(identifier: "en-US")
        default: return Locale(identifier: APIConfig.hl)
        }
    }

    var body: some View {
        VStack(spacing: 28) {
            Text(statusText)
                .font(.title3.weight(recognizer.transcript.isEmpty ? .regular : .semibold))
                .foregroundStyle(recognizer.error == nil ? Color.primary : Color.red)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
                .frame(minHeight: 80)

            Button {
                if recognizer.isListening {
                    recognizer.finish()
                } else {
                    Task { await recognizer.start(locale: locale) }
                }
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(.white)
                    .frame(width: 84, height: 84)
                    .background(Circle().fill(recognizer.isListening ? Color.red : Color.brand))
                    .background(
                        Circle()
                            .fill(Color.red.opacity(0.25))
                            .scaleEffect(recognizer.isListening && pulse ? 1.5 : 1)
                    )
            }
            .buttonStyle(.plain)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true }
            }

            Text(recognizer.isListening ? "Nhấn để dừng" : "Nhấn micro để nói lại")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
        .task {
            recognizer.onFinish = { text in
                onResult(text)
                dismiss()
            }
            await recognizer.start(locale: locale)
        }
        .onDisappear { recognizer.stop() }
    }

    private var statusText: String {
        if let error = recognizer.error { return error }
        if !recognizer.transcript.isEmpty { return recognizer.transcript }
        return recognizer.isListening ? "Đang nghe…" : "Tìm kiếm bằng giọng nói"
    }
}
