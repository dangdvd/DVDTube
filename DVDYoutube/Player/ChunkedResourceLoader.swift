import AVFoundation
import Foundation

/// Serves AVPlayer's byte-range requests for a single googlevideo file in bounded chunks.
///
/// YouTube sends progressive (non-HLS) files at about playback speed when AVPlayer asks for
/// "the rest of the file", which makes them slow to start; bounded `range=` requests come at
/// full speed. Used when the equalizer needs a non-HLS stream (audio taps don't work on HLS).
final class ChunkedResourceLoader: NSObject, AVAssetResourceLoaderDelegate, @unchecked Sendable {
    static let scheme = "dvdchunk"

    let remoteURL: URL
    private let contentType: String
    private var contentLength: Int64?
    private let session: URLSession
    private let queue = DispatchQueue(label: "chunked.resource.loader")
    private let lock = NSLock()
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]
    private static let firstChunkSize: Int64 = 256 << 10
    private static let chunkSize: Int64 = 2 << 20

    private init(remoteURL: URL, contentLength: Int64?, isAudio: Bool) {
        self.remoteURL = remoteURL
        self.contentLength = contentLength
        contentType = isAudio ? AVFileType.m4a.rawValue : AVFileType.mp4.rawValue
        session = InnerTube.shared.session
    }

    /// An asset for `format` whose data goes through a new loader (keep the loader alive
    /// as long as the asset plays: AVFoundation holds its delegate weakly).
    static func asset(for format: StreamFormat) -> (asset: AVURLAsset, loader: ChunkedResourceLoader)? {
        guard let url = URL(string: "\(scheme)://googlevideo/\(format.itag).\(format.isAudio ? "m4a" : "mp4")") else { return nil }
        let loader = ChunkedResourceLoader(remoteURL: format.url, contentLength: format.contentLength, isAudio: format.isAudio)
        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(loader, queue: loader.queue)
        return (asset, loader)
    }

    func cancelAll() {
        lock.lock()
        let running = tasks.values
        tasks.removeAll()
        lock.unlock()
        running.forEach { $0.cancel() }
    }

    deinit {
        cancelAll()
    }

    // MARK: AVAssetResourceLoaderDelegate

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        let key = ObjectIdentifier(loadingRequest)
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.serve(loadingRequest)
                if !Task.isCancelled { loadingRequest.finishLoading() }
            } catch {
                if !Task.isCancelled, !(error is CancellationError) {
                    Log.debug("chunked loader: \(error.localizedDescription)")
                    loadingRequest.finishLoading(with: error)
                }
            }
            self.lock.lock()
            self.tasks[key] = nil
            self.lock.unlock()
        }
        lock.lock()
        tasks[key] = task
        lock.unlock()
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        let key = ObjectIdentifier(loadingRequest)
        lock.lock()
        let task = tasks.removeValue(forKey: key)
        lock.unlock()
        task?.cancel()
    }

    // MARK: Fetching

    private func serve(_ request: AVAssetResourceLoadingRequest) async throws {
        let length = try await resolvedLength()
        if let info = request.contentInformationRequest {
            info.contentType = contentType
            info.contentLength = length
            info.isByteRangeAccessSupported = true
        }
        guard let dataRequest = request.dataRequest else { return }
        let start = dataRequest.currentOffset != 0 ? dataRequest.currentOffset : dataRequest.requestedOffset
        let end: Int64 = dataRequest.requestsAllDataToEndOfResource
            ? length
            : min(dataRequest.requestedOffset + Int64(dataRequest.requestedLength), length)
        guard start < end else { return }
        // A small first chunk so playback can start quickly, then bigger ones; the next chunk
        // downloads while the current one is handed to the player.
        var chunkStart = start
        var current = try await fetch(from: chunkStart, to: min(chunkStart + Self.firstChunkSize, end) - 1)
        while !current.isEmpty {
            try Task.checkCancellation()
            let nextStart = chunkStart + Int64(current.count)
            guard nextStart < end else {
                dataRequest.respond(with: current)
                break
            }
            async let next = fetch(from: nextStart, to: min(nextStart + Self.chunkSize, end) - 1)
            dataRequest.respond(with: current)
            current = try await next
            chunkStart = nextStart
        }
    }

    /// The file size from the stream info, else from a one-byte request's Content-Range.
    private func resolvedLength() async throws -> Int64 {
        lock.lock()
        let known = contentLength
        lock.unlock()
        if let known, known > 0 { return known }
        var request = URLRequest(url: remoteURL)
        request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              let range = http.value(forHTTPHeaderField: "Content-Range"),
              let total = range.split(separator: "/").last.flatMap({ Int64($0) }), total > 0 else {
            throw InnerTubeError.invalidResponse
        }
        lock.lock()
        contentLength = total
        lock.unlock()
        return total
    }

    private func fetch(from start: Int64, to end: Int64) async throws -> Data {
        // Appended as text: rebuilding the query could re-encode the signed parameters.
        let separator = remoteURL.query == nil ? "?" : "&"
        guard let url = URL(string: remoteURL.absoluteString + "\(separator)range=\(start)-\(end)") else {
            throw InnerTubeError.invalidResponse
        }
        var failures = 0
        while true {
            do {
                let (data, response) = try await session.data(from: url)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status) else { throw InnerTubeError.http(status) }
                return data
            } catch {
                if error is CancellationError || Task.isCancelled { throw CancellationError() }
                failures += 1
                if failures > 2 { throw error }
                try await Task.sleep(nanoseconds: UInt64(failures) * 500_000_000)
            }
        }
    }
}
