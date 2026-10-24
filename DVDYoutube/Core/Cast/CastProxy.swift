import AVFoundation
import Foundation
import Network

/// A small HTTP server on the phone that relays YouTube's HLS stream to the TV.
///
/// The TV cannot always fetch the stream itself: googlevideo URLs are bound to the IP
/// address that requested them (often the phone's IPv6 address) and the receiver's web
/// player needs CORS headers. Through this relay the phone downloads the playlists and
/// segments with its own address and hands them to the TV over the local network.
final class CastProxy: @unchecked Sendable {
    static let shared = CastProxy()

    struct Prepared {
        var url: URL
        /// The playlists use fragmented MP4 (`#EXT-X-MAP`) rather than MPEG-TS segments.
        var isFMP4: Bool
        /// What the audio segments really are, as the receiver names it (`hlsSegmentFormat`):
        /// "ts", "aac" (packed ADTS audio) or "fmp4". YouTube keeps the sound in its own playlist.
        var audioFormat: String
    }

    private enum Kind { case playlist, resource }
    private struct Route {
        let url: URL
        let kind: Kind
        /// Sent to the TV instead of a type sniffed from the data (DASH audio vs video).
        var contentType: String? = nil
        /// File size, when known: byte ranges then go to googlevideo as a bounded `range=`
        /// parameter, which it serves at full speed.
        var totalLength: Int64? = nil
    }

    private let queue = DispatchQueue(label: "com.dangdvd.dvdtube.castproxy")
    private let lock = NSLock()
    private var listener: NWListener?
    private var port: UInt16?
    private var host: String?
    private var routes: [Int: Route] = [:]
    private var ids: [URL: Int] = [:]
    /// Documents made on the phone (the DASH manifest), by id.
    private var documents: [Int: Data] = [:]
    private var nextId = 1
    private var served = 0
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.httpMaximumConnectionsPerHost = 8
        return URLSession(configuration: configuration)
    }()

    private init() {}

    // MARK: Lifecycle

    /// Starts the relay (once) and registers the master playlist. `host` is this phone's
    /// address on the network shared with the TV.
    func prepare(hls: URL, host: String, reset: Bool = true) async throws -> Prepared {
        let port = try await start()
        lock.lock()
        self.host = host
        if reset {
            routes = [:]
            ids = [:]
            documents = [:]
            served = 0
        }
        lock.unlock()

        let formats = await probeFormats(master: hls)
        let path = register(hls, kind: .playlist)
        guard let url = URL(string: "http://\(Self.urlHost(host)):\(port)\(path)") else { throw URLError(.badURL) }
        Log.debug("cast relay: ready on port \(port), fmp4=\(formats.videoFMP4), audio=\(formats.audio)")
        return Prepared(url: url, isFMP4: formats.videoFMP4, audioFormat: formats.audio)
    }

    /// A DASH manifest for the TV made from the MP4 streams (H.264 picture ≤ 1080p in several
    /// sizes + AAC sound), served by the relay. Receivers play separate picture and sound
    /// reliably in DASH, which is how YouTube itself casts. Nil when the streams don't allow it.
    func prepareDASH(info: PlayerInfo, audioLanguage: String?, host: String) async throws -> URL? {
        guard !info.isLive else { return nil }
        var byHeight: [Int: StreamFormat] = [:]
        for format in info.adaptiveFormats where format.isVideo && format.isH264 && format.mimeType.hasPrefix("video/mp4")
            && format.initRange != nil && format.indexRange != nil {
            let height = format.height ?? 0
            guard height > 0, height <= 1080 else { continue }
            if let existing = byHeight[height], existing.bitrate >= format.bitrate { continue }
            byHeight[height] = format
        }
        let videos = byHeight.values.sorted { ($0.height ?? 0) < ($1.height ?? 0) }
        guard !videos.isEmpty,
              let audio = info.preferredAudio(language: audioLanguage),
              audio.mimeType.hasPrefix("audio/mp4"), audio.initRange != nil, audio.indexRange != nil else { return nil }

        let port = try await start()
        lock.lock()
        self.host = host
        routes = [:]
        ids = [:]
        documents = [:]
        served = 0
        lock.unlock()

        let duration = Double(videos.last?.approxDurationMs ?? audio.approxDurationMs ?? Int64((info.lengthSeconds ?? 0) * 1000)) / 1000
        guard duration > 0 else { return nil }
        func codecs(_ format: StreamFormat) -> String {
            guard let range = format.mimeType.range(of: "codecs=\"") else { return "" }
            let rest = format.mimeType[range.upperBound...]
            return String(rest.prefix { $0 != "\"" })
        }
        func representation(_ format: StreamFormat, id: String, type: String, extra: String) -> String {
            let url = proxied(format.url, kind: .resource, contentType: type, totalLength: format.contentLength)
            let index = format.indexRange!, initialization = format.initRange!
            return """
                  <Representation id="\(id)" bandwidth="\(max(format.bitrate, 1))" codecs="\(codecs(format))"\(extra)>
                    <BaseURL>\(url)</BaseURL>
                    <SegmentBase indexRange="\(index.lowerBound)-\(index.upperBound)">
                      <Initialization range="\(initialization.lowerBound)-\(initialization.upperBound)"/>
                    </SegmentBase>
                  </Representation>
            """
        }
        let videoXML = videos.map { format in
            representation(format, id: "v\(format.itag)", type: "video/mp4",
                           extra: " width=\"\(format.width ?? 0)\" height=\"\(format.height ?? 0)\" frameRate=\"\(format.fps ?? 30)\"")
        }.joined(separator: "\n")
        let audioXML = representation(audio, id: "a\(audio.itag)", type: "audio/mp4",
                                      extra: " audioSamplingRate=\"\(audio.audioSampleRate ?? 44_100)\"")
        let mpd = """
        <?xml version="1.0" encoding="UTF-8"?>
        <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT\(String(format: "%.3f", duration))S" minBufferTime="PT2S">
          <Period>
            <AdaptationSet contentType="video" mimeType="video/mp4" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
        \(videoXML)
            </AdaptationSet>
            <AdaptationSet contentType="audio" mimeType="audio/mp4" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
        \(audioXML)
            </AdaptationSet>
          </Period>
        </MPD>
        """
        lock.lock()
        let id = nextId
        nextId += 1
        documents[id] = Data(mpd.utf8)
        lock.unlock()
        let heights = videos.compactMap(\.height).map(String.init).joined(separator: "/")
        Log.debug("cast relay: DASH ready on port \(port), video \(heights)p + audio itag \(audio.itag)")
        return URL(string: "http://\(Self.urlHost(host)):\(port)/d/\(id).mpd")
    }

    func stop() {
        lock.lock()
        let listener = listener
        self.listener = nil
        port = nil
        routes = [:]
        ids = [:]
        documents = [:]
        lock.unlock()
        listener?.cancel()
    }

    private func start() async throws -> UInt16 {
        lock.lock()
        if let port { lock.unlock(); return port }
        lock.unlock()

        let listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            connection.start(queue: self.queue)
            self.receiveRequest(on: connection, buffer: Data())
        }
        let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
            let once = ResumeOnce(continuation)
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if let port = listener.port?.rawValue { once.resume(.success(port)) }
                case .failed(let error):
                    once.resume(.failure(error))
                default:
                    break
                }
            }
            listener.start(queue: queue)
        }
        lock.lock()
        self.listener = listener
        self.port = port
        lock.unlock()
        return port
    }

    // MARK: Routes

    /// Path on the relay for an upstream URL (the same URL always gets the same path).
    private func register(_ url: URL, kind: Kind, contentType: String? = nil, totalLength: Int64? = nil) -> String {
        lock.lock()
        defer { lock.unlock() }
        let id: Int
        if let existing = ids[url] {
            id = existing
        } else {
            id = nextId
            nextId += 1
            ids[url] = id
            routes[id] = Route(url: url, kind: kind, contentType: contentType, totalLength: totalLength)
        }
        return kind == .playlist ? "/p/\(id).m3u8" : "/r/\(id)"
    }

    private func route(for path: String) -> Route? {
        let name = path.split(separator: "/").last.map(String.init) ?? ""
        let digits = name.prefix { $0.isNumber }
        guard let id = Int(digits) else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return routes[id]
    }

    // MARK: HTTP

    private func receiveRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<end.lowerBound], as: UTF8.self)
                self.respond(to: head, on: connection)
            } else if isComplete || error != nil || buffer.count > 32_768 {
                connection.cancel()
            } else {
                self.receiveRequest(on: connection, buffer: buffer)
            }
        }
    }

    private func respond(to head: String, on connection: NWConnection) {
        let lines = head.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        guard parts.count >= 2 else { return send(status: 400, headers: [:], body: Data(), on: connection) }
        let method = String(parts[0])
        let path = String(parts[1])
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }

        if method == "OPTIONS" {
            return send(status: 204, headers: [
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": headers["access-control-request-headers"] ?? "*",
                "Access-Control-Max-Age": "86400",
            ], body: Data(), on: connection)
        }
        if method == "GET" || method == "HEAD", path.hasPrefix("/d/") {
            return serveDocument(path, includeBody: method == "GET", on: connection)
        }
        guard method == "GET" || method == "HEAD", let route = route(for: path) else {
            return send(status: 404, headers: [:], body: Data(), on: connection)
        }
        let range = headers["range"]
        Task {
            await self.serve(route, range: range, includeBody: method == "GET", on: connection)
        }
    }

    private func serve(_ route: Route, range: String?, includeBody: Bool, on connection: NWConnection) async {
        let request = URLRequest(url: route.url)
        guard route.kind == .playlist else {
            await serveSegment(route.url, contentType: route.contentType, totalLength: route.totalLength, range: range,
                               includeBody: includeBody, on: connection)
            return
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            var body = data
            var headers = ["Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache"]
            if (200..<300).contains(http.statusCode) {
                body = Data(rewrite(String(decoding: data, as: UTF8.self), base: http.url ?? route.url).utf8)
            } else {
                headers["Content-Type"] = http.value(forHTTPHeaderField: "Content-Type") ?? "text/plain"
            }
            note(isPlaylist: true, status: http.statusCode, bytes: body.count)
            send(status: http.statusCode, headers: headers, body: includeBody ? body : Data(), contentLength: body.count, on: connection)
        } catch {
            Log.debug("cast relay: upstream failed: \(error.localizedDescription)")
            send(status: 502, headers: [:], body: Data(), on: connection)
        }
    }

    /// A segment, fetched whole (one retry if it fails or comes back empty) and sent with its
    /// real length and type: some receivers stall on bodies without a length.
    private func serveSegment(_ url: URL, contentType: String?, totalLength: Int64?, range: String?, includeBody: Bool,
                              on connection: NWConnection) async {
        // A byte range of a file of known size: ask googlevideo with `range=` and answer 206 here.
        var target = url
        var forwardedRange = range
        var bounded: ClosedRange<Int64>?
        if let range, let totalLength, let wanted = Self.byteRange(range, total: totalLength),
           let ranged = URL(string: url.absoluteString + (url.query == nil ? "?" : "&") + "range=\(wanted.lowerBound)-\(wanted.upperBound)") {
            target = ranged
            forwardedRange = nil
            bounded = wanted
        }
        var lastStatus = 502
        for attempt in 0..<2 {
            var request = URLRequest(url: target)
            if let forwardedRange { request.setValue(forwardedRange, forHTTPHeaderField: "Range") }
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                lastStatus = http.statusCode
                guard (200..<300).contains(http.statusCode), !data.isEmpty else {
                    Log.debug("cast relay: segment upstream -> \(http.statusCode), \(data.count) bytes\(attempt == 0 ? ", retrying" : "")")
                    continue
                }
                let type = contentType ?? Self.mediaType(of: data) ?? http.value(forHTTPHeaderField: "Content-Type")
                    ?? "application/octet-stream"
                var headers = ["Content-Type": type, "Accept-Ranges": "bytes"]
                var status = http.statusCode
                if let contentRange = http.value(forHTTPHeaderField: "Content-Range") { headers["Content-Range"] = contentRange }
                if let bounded, let totalLength, status == 200 {
                    status = 206
                    headers["Content-Range"] = "bytes \(bounded.lowerBound)-\(bounded.lowerBound + Int64(data.count) - 1)/\(totalLength)"
                }
                noteSegment(status: status, bytes: data.count, type: type)
                send(status: status, headers: headers, body: includeBody ? data : Data(), contentLength: data.count, on: connection)
                return
            } catch {
                Log.debug("cast relay: segment upstream failed: \(error.localizedDescription)")
            }
        }
        noteSegment(status: lastStatus == 200 ? 502 : lastStatus, bytes: 0, type: "-")
        send(status: lastStatus == 200 ? 502 : lastStatus, headers: [:], body: Data(), on: connection)
    }

    private func serveDocument(_ path: String, includeBody: Bool, on connection: NWConnection) {
        let name = path.split(separator: "/").last.map(String.init) ?? ""
        lock.lock()
        let document = Int(name.prefix { $0.isNumber }).flatMap { documents[$0] }
        lock.unlock()
        guard let document else { return send(status: 404, headers: [:], body: Data(), on: connection) }
        note(isPlaylist: true, status: 200, bytes: document.count)
        send(status: 200, headers: ["Content-Type": "application/dash+xml", "Cache-Control": "no-cache"],
             body: includeBody ? document : Data(), contentLength: document.count, on: connection)
    }

    /// `bytes=a-b` / `bytes=a-` within a file of `total` bytes.
    private static func byteRange(_ header: String, total: Int64) -> ClosedRange<Int64>? {
        guard header.hasPrefix("bytes="), !header.contains(",") else { return nil }
        let parts = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, let start = Int64(parts[0]), start < total else { return nil }
        let end = Int64(parts[1]).map { min($0, total - 1) } ?? total - 1
        return end >= start ? start...end : nil
    }

    /// The container of a segment from its first bytes.
    private static func mediaType(of data: Data) -> String? {
        guard data.count >= 8 else { return nil }
        let bytes = [UInt8](data.prefix(12))
        if bytes[0] == 0x47 { return "video/mp2t" }
        if bytes[0] == 0xFF, bytes[1] & 0xF0 == 0xF0 { return "audio/aac" }
        if bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 { return "audio/aac" }  // "ID3" + ADTS
        let box = String(decoding: bytes[4..<8], as: UTF8.self)
        if ["ftyp", "styp", "moof", "sidx", "moov"].contains(box) { return "video/mp4" }
        return nil
    }

    /// Logs the first segments (size and real type) and every failure.
    private func noteSegment(status: Int, bytes: Int, type: String) {
        lock.lock()
        served += 1
        let count = served
        lock.unlock()
        if count <= 10 || !(200..<300).contains(status) {
            Log.debug("cast relay: TV got segment -> \(status), \(bytes) bytes, \(type)")
        }
    }

    /// Logs the first requests and every failure (enough to see what the TV does).
    fileprivate func note(isPlaylist: Bool, status: Int, bytes: Int) {
        lock.lock()
        served += 1
        let count = served
        lock.unlock()
        if count <= 6 || !(200..<300).contains(status) {
            Log.debug("cast relay: TV got \(isPlaylist ? "playlist" : "segment") -> \(status), \(bytes) bytes")
        }
    }

    private func send(status: Int, headers: [String: String], body: Data, contentLength: Int? = nil, on connection: NWConnection) {
        var data = head(status: status, headers: headers, contentLength: contentLength ?? body.count)
        data.append(body)
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    /// Status line and headers (CORS for the receiver's web player). Without a length the
    /// body simply ends when the connection closes.
    fileprivate func head(status: Int, headers: [String: String], contentLength: Int?) -> Data {
        var lines = ["HTTP/1.1 \(status) \(Self.reason(status))"]
        var all = headers
        all["Access-Control-Allow-Origin"] = "*"
        all["Access-Control-Expose-Headers"] = "Content-Length, Content-Range"
        if let contentLength { all["Content-Length"] = String(contentLength) }
        all["Connection"] = "close"
        for (key, value) in all { lines.append("\(key): \(value)") }
        return Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    }

    private static func reason(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 204: return "No Content"
        case 206: return "Partial Content"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 416: return "Range Not Satisfiable"
        case 502: return "Bad Gateway"
        default: return "Status"
        }
    }

    // MARK: Playlists

    /// Points every URI of a playlist at the relay. In a master playlist only H.264 + AAC
    /// variants are kept (every Chromecast decodes them; VP9/AV1/HEVC may not be).
    private func rewrite(_ text: String, base: URL) -> String {
        let lines = text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let isMaster = lines.contains { $0.hasPrefix("#EXT-X-STREAM-INF") }
        let keepVariant = Self.variantFilter(lines)
        let childKind: Kind = isMaster ? .playlist : .resource

        var output: [String] = []
        var skipNextURI = false
        for line in lines {
            if line.hasPrefix("#") {
                if line.hasPrefix("#EXT-X-I-FRAME-STREAM-INF") { continue }
                if line.hasPrefix("#EXT-X-STREAM-INF"), !keepVariant(line) {
                    skipNextURI = true
                    continue
                }
                output.append(rewriteAttributes(line, base: base, kind: childKind))
            } else {
                if skipNextURI {
                    skipNextURI = false
                    continue
                }
                if let url = URL(string: line, relativeTo: base)?.absoluteURL {
                    output.append(proxied(url, kind: childKind))
                } else {
                    output.append(line)
                }
            }
        }
        return output.joined(separator: "\n") + "\n"
    }

    /// Prefers H.264 variants with AAC audio, falling back to whatever the playlist has.
    private static func variantFilter(_ lines: [String]) -> (String) -> Bool {
        let variants = lines.filter { $0.hasPrefix("#EXT-X-STREAM-INF") }
        let isAVC: (String) -> Bool = { line in
            let codecs = Self.attribute("CODECS", in: line) ?? ""
            return codecs.contains("avc1") && !["vp09", "vp9", "av01", "hvc1", "hev1", "dvh1"].contains { codecs.contains($0) }
        }
        let isAVCWithAAC: (String) -> Bool = { line in
            let codecs = Self.attribute("CODECS", in: line) ?? ""
            return isAVC(line) && (codecs.contains("mp4a") || !codecs.contains(","))
        }
        if variants.contains(where: isAVCWithAAC) { return isAVCWithAAC }
        if variants.contains(where: isAVC) { return isAVC }
        return { _ in true }
    }

    private func rewriteAttributes(_ line: String, base: URL, kind: Kind) -> String {
        guard let start = line.range(of: "URI=\""),
              let end = line[start.upperBound...].firstIndex(of: "\""),
              let url = URL(string: String(line[start.upperBound..<end]), relativeTo: base)?.absoluteURL
        else { return line }
        // In a master playlist EXT-X-MEDIA points at media playlists; elsewhere (EXT-X-MAP,
        // EXT-X-KEY) at plain resources.
        let attributeKind: Kind = line.hasPrefix("#EXT-X-MEDIA") ? kind : .resource
        return line.replacingCharacters(in: start.upperBound..<end, with: proxied(url, kind: attributeKind))
    }

    private func proxied(_ url: URL, kind: Kind, contentType: String? = nil, totalLength: Int64? = nil) -> String {
        let path = register(url, kind: kind, contentType: contentType, totalLength: totalLength)
        lock.lock()
        let host = host ?? "127.0.0.1"
        let port = port ?? 0
        lock.unlock()
        return "http://\(Self.urlHost(host)):\(port)\(path)"
    }

    private static func attribute(_ name: String, in line: String) -> String? {
        guard let range = line.range(of: "\(name)=") else { return nil }
        let rest = line[range.upperBound...]
        if rest.hasPrefix("\"") {
            let value = rest.dropFirst()
            return value.firstIndex(of: "\"").map { String(value[..<$0]) }
        }
        return String(rest.prefix { $0 != "," })
    }

    /// Looks at the playlists the TV will use: fMP4 segments come with `#EXT-X-MAP`; the
    /// separate audio playlist's segments are sniffed, since the receiver must be told their
    /// format and guessing wrong leaves it buffering forever.
    private func probeFormats(master: URL) async -> (videoFMP4: Bool, audio: String) {
        guard let playlist = try? await session.data(from: master) else { return (true, "fmp4") }
        let lines = Self.lines(of: playlist.0)
        guard lines.contains(where: { $0.hasPrefix("#EXT-X-STREAM-INF") }) else {
            let fmp4 = lines.contains { $0.hasPrefix("#EXT-X-MAP") }
            return (fmp4, fmp4 ? "fmp4" : "ts")
        }
        let keep = Self.variantFilter(lines)
        var variantURL: URL?
        var audioGroup: String?
        for (index, line) in lines.enumerated() where line.hasPrefix("#EXT-X-STREAM-INF") && keep(line) {
            if index + 1 < lines.count { variantURL = URL(string: lines[index + 1], relativeTo: master)?.absoluteURL }
            audioGroup = Self.attribute("AUDIO", in: line)
            break
        }
        var videoFMP4 = true
        if let variantURL, let media = try? await session.data(from: variantURL) {
            videoFMP4 = String(decoding: media.0, as: UTF8.self).contains("#EXT-X-MAP")
        }
        let renditions = lines.filter {
            $0.hasPrefix("#EXT-X-MEDIA") && $0.contains("TYPE=AUDIO") && (audioGroup == nil || Self.attribute("GROUP-ID", in: $0) == audioGroup)
        }
        guard let rendition = renditions.first(where: { $0.contains("DEFAULT=YES") }) ?? renditions.first,
              let uri = Self.attribute("URI", in: rendition),
              let audioURL = URL(string: uri, relativeTo: master)?.absoluteURL else {
            // The sound is inside the video segments.
            return (videoFMP4, videoFMP4 ? "fmp4" : "ts")
        }
        guard let audioPlaylist = try? await session.data(from: audioURL) else { return (videoFMP4, videoFMP4 ? "fmp4" : "ts") }
        let audioLines = Self.lines(of: audioPlaylist.0)
        if audioLines.contains(where: { $0.hasPrefix("#EXT-X-MAP") }) { return (videoFMP4, "fmp4") }
        guard let first = audioLines.first(where: { !$0.hasPrefix("#") }),
              let segmentURL = URL(string: first, relativeTo: audioURL)?.absoluteURL else { return (videoFMP4, "ts") }
        var request = URLRequest(url: segmentURL)
        request.setValue("bytes=0-1023", forHTTPHeaderField: "Range")
        guard let (head, _) = try? await session.data(for: request) else { return (videoFMP4, "ts") }
        switch Self.mediaType(of: head) ?? "" {
        case "audio/aac": return (videoFMP4, "aac")
        case "video/mp4": return (videoFMP4, "fmp4")
        default: return (videoFMP4, "ts")
        }
    }

    private static func lines(of data: Data) -> [String] {
        String(decoding: data, as: UTF8.self).components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private static func urlHost(_ host: String) -> String {
        host.contains(":") ? "[\(host)]" : host
    }

    // MARK: Network address

    /// This phone's IPv4 address on Wi-Fi (or another local interface).
    static func localIPv4() -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var fallback: String?
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let interface = pointer.pointee
            guard let address = interface.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
                  interface.ifa_flags & UInt32(IFF_UP) != 0, interface.ifa_flags & UInt32(IFF_LOOPBACK) == 0
            else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer, socklen_t(buffer.count),
                              nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: buffer)
            let name = String(cString: interface.ifa_name)
            if name == "en0" { return ip }
            if fallback == nil, name.hasPrefix("en"), !ip.hasPrefix("169.254.") { fallback = ip }
        }
        return fallback
    }
}

/// Resumes a continuation once even if the callback fires repeatedly.
private final class ResumeOnce<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?

    init(_ continuation: CheckedContinuation<T, Error>) {
        self.continuation = continuation
    }

    func resume(_ result: Result<T, Error>) {
        lock.lock()
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }
}

/// Keeps the app running in the background while it relays a stream to the TV
/// (iOS would otherwise suspend it within seconds): a silent, looping sound mixed with
/// any other audio.
@MainActor
enum CastKeepAlive {
    private static var player: AVAudioPlayer?

    static func start() {
        guard player == nil else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
        guard let silence = try? AVAudioPlayer(data: silentWAV()) else { return }
        silence.numberOfLoops = -1
        silence.volume = 0
        silence.play()
        player = silence
    }

    static func stop() {
        guard let silence = player else { return }
        silence.stop()
        player = nil
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo)
    }

    /// One second of 8 kHz, 16-bit mono silence.
    private static func silentWAV() -> Data {
        let sampleRate: UInt32 = 8000
        let samples = Data(count: Int(sampleRate) * 2)
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + samples.count))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))
        append(UInt16(1))
        append(sampleRate)
        append(sampleRate * 2)
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(samples.count))
        data.append(samples)
        return data
    }
}
