import AVFoundation
import Observation
import UIKit

struct DownloadedVideo: Codable, Identifiable, Hashable {
    var video: VideoItem
    var fileName: String
    var fileSize: Int64
    var qualityLabel: String?
    var downloadedAt: Date
    /// Only the sound (an .m4a file); nil in downloads made before audio downloads existed.
    var isAudio: Bool?

    var id: String { video.id }
}

enum DownloadState: Equatable {
    /// Waiting for an earlier download to finish (e.g. a whole playlist).
    case queued
    case preparing
    case downloading(Double)
    case merging
    case failed(String)
}

/// Offline downloads: fetches the H.264 video + AAC audio streams in chunks and
/// merges them into a regular `.mp4` (visible in the Files app as well).
@MainActor
@Observable
final class DownloadManager {
    static let shared = DownloadManager()

    private(set) var downloads: [DownloadedVideo] = []
    private(set) var states: [String: DownloadState] = [:]

    @ObservationIgnored private var tasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var pending: [Request] = []
    private static let maxConcurrent = 2

    private struct Request {
        var video: VideoItem
        var audioOnly: Bool
        var maxHeight: Int
    }
    @ObservationIgnored private let folder: URL
    @ObservationIgnored private let indexURL: URL

    private init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        folder = documents.appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        indexURL = support.appendingPathComponent("downloads.json")
        if let data = try? Data(contentsOf: indexURL),
           let stored = try? JSONDecoder().decode([DownloadedVideo].self, from: data) {
            downloads = stored.filter { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0.fileName).path) }
        }
    }

    var activeCount: Int { states.values.filter { if case .failed = $0 { return false } else { return true } }.count }

    var totalSize: Int64 { downloads.reduce(0) { $0 + $1.fileSize } }

    func localFileURL(for videoId: String) -> URL? {
        guard let entry = downloads.first(where: { $0.id == videoId }) else { return nil }
        let url = folder.appendingPathComponent(entry.fileName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func isDownloaded(_ videoId: String) -> Bool { localFileURL(for: videoId) != nil }

    func isAudioDownload(_ videoId: String) -> Bool {
        downloads.first { $0.id == videoId }?.isAudio ?? false
    }

    /// Downloads a video (at `quality`, else the download quality setting) or only its sound.
    func download(_ video: VideoItem, audioOnly: Bool = false, quality: VideoQuality? = nil) {
        guard canDownloadNow() else { return }
        if enqueue(video, audioOnly: audioOnly, quality: quality) {
            PlayerManager.shared.showToast(audioOnly ? "Đang tải âm thanh…" : "Đang tải xuống…")
        }
    }

    /// Queues every video (e.g. a whole playlist); they download a couple at a time.
    func downloadAll(_ videos: [VideoItem], audioOnly: Bool) {
        guard canDownloadNow() else { return }
        let added = videos.filter { !$0.isLive }.reduce(0) { count, video in
            count + (enqueue(video, audioOnly: audioOnly, quality: nil) ? 1 : 0)
        }
        PlayerManager.shared.showToast(added > 0 ? "Đã thêm \(added) video vào hàng chờ tải" : "Các video này đã được tải xuống")
    }

    private func canDownloadNow() -> Bool {
        if AppSettings.shared.downloadOnWifiOnly, NetworkMonitor.shared.isExpensive {
            PlayerManager.shared.showToast("Chỉ tải xuống khi có Wi-Fi (đổi trong Cài đặt › Tải xuống)")
            return false
        }
        return true
    }

    @discardableResult
    private func enqueue(_ video: VideoItem, audioOnly: Bool, quality: VideoQuality?) -> Bool {
        guard tasks[video.id] == nil, !pending.contains(where: { $0.video.id == video.id }), !isDownloaded(video.id) else {
            return false
        }
        let maxHeight = (quality ?? AppSettings.shared.downloadQuality).maxHeight ?? 1080
        pending.append(Request(video: video, audioOnly: audioOnly, maxHeight: maxHeight))
        states[video.id] = .queued
        startNext()
        return true
    }

    private func startNext() {
        while tasks.count < Self.maxConcurrent, !pending.isEmpty {
            let request = pending.removeFirst()
            states[request.video.id] = .preparing
            tasks[request.video.id] = Task { [weak self] in
                await self?.run(request)
            }
        }
    }

    func cancel(_ videoId: String) {
        tasks[videoId]?.cancel()
        tasks[videoId] = nil
        pending.removeAll { $0.video.id == videoId }
        states[videoId] = nil
        startNext()
    }

    func delete(_ videoId: String) {
        cancel(videoId)
        if let entry = downloads.first(where: { $0.id == videoId }) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(entry.fileName))
        }
        downloads.removeAll { $0.id == videoId }
        save()
    }

    func deleteAll() {
        for entry in downloads { delete(entry.id) }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(downloads) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private func run(_ request: Request) async {
        let video = request.video
        let backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "download-\(video.id)", expirationHandler: nil)
        defer { UIApplication.shared.endBackgroundTask(backgroundTask) }
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("dl-\(video.id)", isDirectory: true)
        try? FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }

        do {
            let info = try await YouTubeService.shared.player(video.id)
            if info.isLive { throw InnerTubeError.unplayable("Không thể tải xuống video trực tiếp.") }
            let wait = info.availableAt.timeIntervalSinceNow
            if wait > 0 { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }

            var item = video
            if item.title.isEmpty { item.title = info.title }
            item.channelName = item.channelName ?? info.author
            item.channelId = item.channelId ?? info.channelId
            if item.durationSeconds == nil, let length = info.lengthSeconds {
                item.durationSeconds = length
                item.durationText = formatDuration(length)
            }

            let fileName = Self.fileName(for: item, audio: request.audioOnly)
            let output = folder.appendingPathComponent(fileName)
            try? FileManager.default.removeItem(at: output)
            let maxHeight = request.maxHeight
            var qualityLabel: String?

            if request.audioOnly {
                // itag 140 (AAC 128 kbps) when there is one: plays everywhere, also in the Files app.
                let aac = info.adaptiveFormats.filter { $0.isAudio && $0.isAAC && $0.isDefaultAudio }
                guard let audioFormat = aac.first(where: { $0.itag == 140 }) ?? info.bestAudio else {
                    throw InnerTubeError.noStreams
                }
                let audioFile = temp.appendingPathComponent("audio.m4a")
                let id = video.id
                let total = Double(max(audioFormat.contentLength ?? 1, 1))
                try await Self.fetch(audioFormat, to: audioFile) { done in
                    Task { @MainActor in self.report(id, Double(done) / total) }
                }
                states[video.id] = .merging
                try await Self.remuxAudio(audioFile, to: output)
                qualityLabel = "Âm thanh \(audioFormat.bitrate / 1000) kbps"
            } else if let videoFormat = info.bestVideo(maxHeight: maxHeight), let audioFormat = info.bestAudio {
                let videoFile = temp.appendingPathComponent("video.mp4")
                let audioFile = temp.appendingPathComponent("audio.m4a")
                let videoLength = videoFormat.contentLength ?? 0
                let total = Double(max(videoLength + (audioFormat.contentLength ?? 0), 1))
                let id = video.id
                try await Self.fetch(videoFormat, to: videoFile) { done in
                    Task { @MainActor in self.report(id, Double(done) / total) }
                }
                try await Self.fetch(audioFormat, to: audioFile) { done in
                    Task { @MainActor in self.report(id, Double(videoLength + done) / total) }
                }
                states[video.id] = .merging
                try await Self.merge(video: videoFile, audio: audioFile, to: output)
                qualityLabel = videoFormat.qualityLabel
            } else if let muxed = info.muxedFormats.max(by: { ($0.height ?? 0) < ($1.height ?? 0) }) {
                let id = video.id
                let total = Double(max(muxed.contentLength ?? 1, 1))
                try await Self.fetch(muxed, to: output) { done in
                    Task { @MainActor in self.report(id, Double(done) / total) }
                }
                qualityLabel = muxed.qualityLabel
            } else {
                throw InnerTubeError.noStreams
            }

            let size = (try? FileManager.default.attributesOfItem(atPath: output.path)[.size] as? Int64) ?? 0
            downloads.removeAll { $0.id == video.id }
            downloads.insert(DownloadedVideo(
                video: item, fileName: fileName, fileSize: size,
                qualityLabel: qualityLabel, downloadedAt: Date(), isAudio: request.audioOnly
            ), at: 0)
            save()
            states[video.id] = nil
            PlayerManager.shared.showToast("Đã tải xong: \(item.title)")
        } catch is CancellationError {
            states[video.id] = nil
        } catch {
            if tasks[video.id] != nil { states[video.id] = .failed(error.localizedDescription) }
        }
        tasks[video.id] = nil
        startNext()
    }

    private func report(_ id: String, _ progress: Double) {
        guard tasks[id] != nil else { return }
        states[id] = .downloading(min(max(progress, 0), 1))
    }

    private static func fileName(for video: VideoItem, audio: Bool) -> String {
        let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        let title = video.title.components(separatedBy: invalid).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let short = String(title.prefix(80))
        return (short.isEmpty ? video.id : "\(short) [\(video.id)]") + (audio ? ".m4a" : ".mp4")
    }

    /// YouTube's audio stream is a fragmented MP4: rewrite it as a regular .m4a file.
    private nonisolated static func remuxAudio(_ input: URL, to output: URL) async throws {
        let asset = AVURLAsset(url: input)
        if let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) {
            export.outputURL = output
            export.outputFileType = .m4a
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                export.exportAsynchronously { continuation.resume() }
            }
            if export.status == .completed { return }
            Log.debug("audio remux failed: \(export.error.map { String(describing: $0) } ?? "unknown"), keeping the original file")
        }
        try? FileManager.default.removeItem(at: output)
        try FileManager.default.copyItem(at: input, to: output)
    }

    /// Downloads in 10 MB `range=` chunks; googlevideo throttles single large requests.
    private nonisolated static func fetch(
        _ format: StreamFormat, to destination: URL, progress: @escaping @Sendable (Int64) -> Void
    ) async throws {
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        let session = InnerTube.shared.session

        guard let length = format.contentLength, length > 0 else {
            let (temp, _) = try await session.download(from: format.url)
            try? handle.close()
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: temp, to: destination)
            return
        }

        let chunk: Int64 = 10 << 20
        var offset: Int64 = 0
        var failures = 0
        while offset < length {
            try Task.checkCancellation()
            let end = min(offset + chunk, length) - 1
            guard var components = URLComponents(url: format.url, resolvingAgainstBaseURL: false) else {
                throw InnerTubeError.invalidResponse
            }
            components.queryItems = (components.queryItems ?? []).filter { $0.name != "range" }
                + [URLQueryItem(name: "range", value: "\(offset)-\(end)")]
            guard let url = components.url else { throw InnerTubeError.invalidResponse }
            do {
                let (data, response) = try await session.data(from: url)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status), !data.isEmpty else { throw InnerTubeError.http(status) }
                try handle.write(contentsOf: data)
                offset += Int64(data.count)
                failures = 0
                progress(offset)
            } catch {
                if error is CancellationError { throw error }
                failures += 1
                if failures > 3 { throw error }
                try await Task.sleep(nanoseconds: UInt64(failures) * 1_000_000_000)
            }
        }
    }

    private nonisolated static func merge(video: URL, audio: URL, to output: URL) async throws {
        let videoAsset = AVURLAsset(url: video)
        let audioAsset = AVURLAsset(url: audio)
        let videoTrack = try await videoAsset.loadTracks(withMediaType: .video).first
        let audioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first
        guard let videoTrack, let audioTrack else { throw InnerTubeError.noStreams }
        let videoDuration = try await videoAsset.load(.duration)
        let audioDuration = try await audioAsset.load(.duration)

        let composition = AVMutableComposition()
        let range = CMTimeRange(start: .zero, duration: CMTimeMinimum(videoDuration, audioDuration))
        try composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)?
            .insertTimeRange(range, of: videoTrack, at: .zero)
        try composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)?
            .insertTimeRange(range, of: audioTrack, at: .zero)

        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
            throw InnerTubeError.invalidResponse
        }
        export.outputURL = output
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            export.exportAsynchronously { continuation.resume() }
        }
        guard export.status == .completed else {
            throw export.error ?? InnerTubeError.unplayable("Không ghép được video.")
        }
    }
}
