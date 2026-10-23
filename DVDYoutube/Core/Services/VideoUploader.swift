import Foundation
import Observation
import UIKit

/// Uploads a video to the signed-in channel the way YouTube Studio does:
/// 1. open a resumable upload on upload.youtube.com,
/// 2. send the file,
/// 3. create the video on the channel (`upload/createvideo`) with title, description, privacy.
@MainActor
@Observable
final class VideoUploader {
    enum Privacy: String, CaseIterable, Identifiable {
        case `private` = "PRIVATE"
        case unlisted = "UNLISTED"
        case `public` = "PUBLIC"

        var id: String { rawValue }

        var title: String {
            switch self {
            case .private: return "Riêng tư"
            case .unlisted: return "Không công khai"
            case .public: return "Công khai"
            }
        }
    }

    enum State: Equatable {
        case idle
        case preparing
        case uploading(Double)
        case creating
        case done(videoId: String)
        case failed(String)
    }

    private(set) var state: State = .idle

    var isBusy: Bool {
        switch state {
        case .preparing, .uploading, .creating: return true
        default: return false
        }
    }

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private static let studioOrigin = "https://studio.youtube.com"
    private static let fallbackClientVersion = "1.20261020.01.00"

    func start(file: URL, title: String, description: String, privacy: Privacy) {
        task?.cancel()
        state = .preparing
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "upload") { [weak self] in
            Task { @MainActor in self?.endBackgroundTask() }
        }
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let videoId = try await self.upload(file: file, title: title, description: description, privacy: privacy)
                self.state = .done(videoId: videoId)
                Log.debug("upload finished: \(videoId)")
            } catch is CancellationError {
                self.state = .idle
            } catch {
                Log.debug("upload failed: \(error.localizedDescription)")
                self.state = .failed(error.localizedDescription)
            }
            self.endBackgroundTask()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        state = .idle
        endBackgroundTask()
    }

    func reset() {
        guard !isBusy else { return }
        state = .idle
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: Steps

    private struct StudioConfig {
        var channelId: String?
        var apiKey: String?
        var clientVersion: String
    }

    private func upload(file: URL, title: String, description: String, privacy: Privacy) async throws -> String {
        guard AuthSession.shared.isAuthenticated else { throw UploadError.message("Cần đăng nhập tài khoản Google để tải video lên.") }
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0 else { throw UploadError.message("Không đọc được tệp video.") }

        let config = await studioConfig()
        let identity = AuthSession.shared.currentIdentity
        let profileChannel = AccountStore.shared.profile?.channelId
        // A brand account's channel comes from the account menu (requests run as that channel).
        guard let channelId = identity.pageId != nil ? (profileChannel ?? config.channelId) : (config.channelId ?? profileChannel) else {
            throw UploadError.message("Tài khoản này chưa có kênh YouTube. Hãy tạo kênh trên YouTube trước khi tải video lên.")
        }
        try Task.checkCancellation()

        let frontendUploadId = "innertube_studio:\(UUID().uuidString.lowercased()):0"
        let uploadURL = try await openUpload(frontendUploadId: frontendUploadId, size: size)
        state = .uploading(0)
        let resourceId = try await sendFile(file, to: uploadURL)
        try Task.checkCancellation()
        state = .creating
        return try await createVideo(
            channelId: channelId, resourceId: resourceId, frontendUploadId: frontendUploadId,
            title: title, description: description, privacy: privacy, config: config
        )
    }

    /// Reads Studio's page config (channel, API key, client version). Best effort.
    private func studioConfig() async -> StudioConfig {
        var config = StudioConfig(clientVersion: Self.fallbackClientVersion)
        let identity = AuthSession.shared.currentIdentity
        var components = URLComponents(string: "https://studio.youtube.com/")!
        components.queryItems = [URLQueryItem(name: "authuser", value: String(identity.authUser))]
        guard let url = components.url else { return config }
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        request.setValue(APIConfig.webProfile.resolvedUserAgent(gl: APIConfig.gl), forHTTPHeaderField: "User-Agent")
        for (key, value) in AuthSession.shared.headers(for: url, origin: Self.studioOrigin) ?? [:] where key == "Cookie" {
            request.setValue(value, forHTTPHeaderField: key)
        }
        guard let result = try? await InnerTube.shared.session.data(for: request) else { return config }
        let html = String(decoding: result.0, as: UTF8.self)
        config.channelId = Self.match(#""CHANNEL_ID":"(UC[\w-]{22})""#, in: html)
        config.apiKey = Self.match(#""INNERTUBE_API_KEY":"([\w-]+)""#, in: html)
        if let version = Self.match(#""INNERTUBE_CLIENT_VERSION":"([\d.]+)""#, in: html) { config.clientVersion = version }
        Log.debug("studio config: channel=\(config.channelId != nil) key=\(config.apiKey != nil) version=\(config.clientVersion)")
        return config
    }

    private func openUpload(frontendUploadId: String, size: Int) async throws -> URL {
        let url = URL(string: "https://upload.youtube.com/upload/studio")!
        var request = authorizedRequest(url)
        request.httpMethod = "POST"
        request.setValue("start", forHTTPHeaderField: "X-Goog-Upload-Command")
        request.setValue("resumable", forHTTPHeaderField: "X-Goog-Upload-Protocol")
        request.setValue("file-\(Int(Date().timeIntervalSince1970 * 1000))", forHTTPHeaderField: "X-Goog-Upload-File-Name")
        request.setValue(String(size), forHTTPHeaderField: "X-Goog-Upload-Header-Content-Length")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["frontendUploadId": frontendUploadId])
        let (_, response) = try await InnerTube.shared.session.data(for: request)
        let http = response as? HTTPURLResponse
        Log.debug("upload start -> HTTP \(http?.statusCode ?? 0)")
        guard let http, (200..<300).contains(http.statusCode) else {
            throw UploadError.message("YouTube từ chối mở phiên tải lên (HTTP \(http?.statusCode ?? 0)).")
        }
        guard let location = http.value(forHTTPHeaderField: "X-Goog-Upload-URL"), let uploadURL = URL(string: location) else {
            throw UploadError.message("YouTube không trả về địa chỉ tải lên.")
        }
        return uploadURL
    }

    private func sendFile(_ file: URL, to uploadURL: URL) async throws -> String {
        var request = authorizedRequest(uploadURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("upload, finalize", forHTTPHeaderField: "X-Goog-Upload-Command")
        request.setValue("0", forHTTPHeaderField: "X-Goog-Upload-Offset")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")

        let delegate = ProgressDelegate { [weak self] fraction in
            Task { @MainActor in
                guard let self, case .uploading = self.state else { return }
                self.state = .uploading(fraction)
            }
        }
        let (data, response) = try await InnerTube.shared.session.upload(for: request, fromFile: file, delegate: delegate)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        Log.debug("upload send -> HTTP \(status)")
        guard (200..<300).contains(status) else { throw UploadError.message("Tải tệp lên thất bại (HTTP \(status)).") }
        let json = try JNode(data: data)
        guard let resourceId = json["scottyResourceId"].string ?? json.findFirst("scottyResourceId").string else {
            throw UploadError.message("YouTube không xác nhận tệp đã tải lên.")
        }
        return resourceId
    }

    private func createVideo(
        channelId: String, resourceId: String, frontendUploadId: String,
        title: String, description: String, privacy: Privacy, config: StudioConfig
    ) async throws -> String {
        var components = URLComponents(string: "https://studio.youtube.com/youtubei/v1/upload/createvideo")!
        components.queryItems = [URLQueryItem(name: "alt", value: "json")]
            + (config.apiKey.map { [URLQueryItem(name: "key", value: $0)] } ?? [])
        guard let url = components.url else { throw InnerTubeError.invalidResponse }

        func body(withDelegation: Bool) throws -> Data {
            var user: [String: Any] = [:]
            if withDelegation {
                user["delegationContext"] = [
                    "externalChannelId": channelId,
                    "roleType": ["channelRoleType": "CREATOR_CHANNEL_ROLE_TYPE_OWNER"],
                ]
            }
            let payload: [String: Any] = [
                "channelId": channelId,
                "resourceId": ["scottyResourceId": ["id": resourceId]],
                "frontendUploadId": frontendUploadId,
                "initialMetadata": [
                    "title": ["newTitle": title],
                    "description": ["newDescription": description],
                    "privacy": ["newPrivacy": privacy.rawValue],
                ],
                "context": [
                    "client": ["clientName": 62, "clientVersion": config.clientVersion, "hl": APIConfig.hl, "gl": APIConfig.gl],
                    "request": ["returnLogEntry": true, "internalExperimentFlags": [Any]()],
                    "user": user,
                ],
            ]
            return try JSONSerialization.data(withJSONObject: payload)
        }

        var lastStatus = 0
        for withDelegation in [true, false] {
            var request = authorizedRequest(url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(Self.studioOrigin, forHTTPHeaderField: "Origin")
            request.setValue("62", forHTTPHeaderField: "X-YouTube-Client-Name")
            request.setValue(config.clientVersion, forHTTPHeaderField: "X-YouTube-Client-Version")
            request.httpBody = try body(withDelegation: withDelegation)
            let (data, response) = try await InnerTube.shared.session.data(for: request)
            lastStatus = (response as? HTTPURLResponse)?.statusCode ?? 0
            Log.debug("createvideo (delegation \(withDelegation)) -> HTTP \(lastStatus)")
            if (200..<300).contains(lastStatus), let videoId = try? JNode(data: data).findFirst("videoId").string {
                return videoId
            }
            // Only a rejected request shape is worth a second try.
            guard lastStatus == 400 else { break }
        }
        throw UploadError.message("Tệp đã tải lên nhưng YouTube không tạo được video (HTTP \(lastStatus)). Hãy thử “Tải lên bằng YouTube Studio”.")
    }

    private func authorizedRequest(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        request.setValue(APIConfig.webProfile.resolvedUserAgent(gl: APIConfig.gl), forHTTPHeaderField: "User-Agent")
        for (key, value) in AuthSession.shared.headers(for: url, origin: Self.studioOrigin) ?? [:] {
            request.setValue(value, forHTTPHeaderField: key)
        }
        return request
    }

    private static func match(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let result = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              result.numberOfRanges > 1,
              let range = Range(result.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    enum UploadError: LocalizedError {
        case message(String)
        var errorDescription: String? {
            switch self {
            case .message(let text): return text
            }
        }
    }
}

private final class ProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        onProgress(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}
