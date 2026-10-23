import AVFoundation
import Observation
import UIKit

struct DownloadedVideo: Codable, Identifiable, Hashable {
    var video: VideoItem
    var fileName: String
    var fileSize: Int64
    var qualityLabel: String?
    var downloadedAt: Date

    var id: String { video.id }
}

enum DownloadState: Equatable {
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

    func download(_ video: VideoItem) {
        guard tasks[video.id] == nil, !isDownloaded(video.id) else { return }
        if AppSettings.shared.downloadOnWifiOnly, NetworkMonitor.shared.isExpensive {
            PlayerManager.shared.showToast("Chỉ tải xuống khi có Wi-Fi (đổi trong Cài đặt › Tải xuống)")
            return
        }
        states[video.id] = .preparing
        tasks[video.id] = Task { [weak self] in
            await self?.run(video)
        }
        PlayerManager.shared.showToast("Đang tải xuống…")
    }

    func cancel(_ videoId: String) {
        tasks[videoId]?.cancel()
        tasks[videoId] = nil
        states[videoId] = nil
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

    private func run(_ video: VideoItem) async {
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

            let fileName = Self.fileName(for: item)
            let output = folder.appendingPathComponent(fileName)
            try? FileManager.default.removeItem(at: output)
            let maxHeight = AppSettings.shared.downloadQuality.maxHeight ?? 1080
            var qualityLabel: String?

            if let videoFormat = info.bestVideo(maxHeight: maxHeight), let audioFormat = info.bestAudio {
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
                qualityLabel: qualityLabel, downloadedAt: Date()
            ), at: 0)
            save()
            states[video.id] = nil
            PlayerManager.shared.showToast("Đã tải xong: \(item.title)")
        } catch is CancellationError {
            states[video.id] = nil
        } catch {
            states[video.id] = .failed(error.localizedDescription)
        }
        tasks[video.id] = nil
    }

    private func report(_ id: String, _ progress: Double) {
        guard tasks[id] != nil else { return }
        states[id] = .downloading(min(max(progress, 0), 1))
    }

    private static func fileName(for video: VideoItem) -> String {
        let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        let title = video.title.components(separatedBy: invalid).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let short = String(title.prefix(80))
        return (short.isEmpty ? video.id : "\(short) [\(video.id)]") + ".mp4"
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
