import Foundation
import MetricKit
import SwiftUI
import UIKit

/// "Gửi nhật ký lỗi": one text file with the app version, the device, a settings summary,
/// the network type, the last log lines, recent errors and crash reports — scrubbed of
/// cookies, auth headers, account emails, pairing keys and signed URL parameters.
enum LogExport {
    @MainActor
    static func build() -> String {
        let settings = AppSettings.shared
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss ZZZZZ"
        let snapshot = DiagnosticsLog.shared.snapshot

        var out: [String] = []
        out.append("DVDTube \(version) (\(build)) — iOS")
        out.append("Thời điểm: \(formatter.string(from: Date()))")
        out.append("Thiết bị: \(modelIdentifier()) • \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)")
        out.append("Mạng: \(NetworkMonitor.shared.isExpensive ? "Dữ liệu di động / mạng giới hạn" : "Wi-Fi / không giới hạn")")
        out.append("Ngôn ngữ / khu vực nội dung: \(settings.language) / \(settings.region)")
        out.append("")
        out.append("== Cài đặt ==")
        let summary: [(String, String)] = [
            ("Đăng nhập", AccountStore.shared.isSignedIn ? "có" : "không"),
            ("Chất lượng Wi-Fi / di động", "\(settings.wifiQuality.title) / \(settings.cellularQuality.title)"),
            ("Chất lượng tải xuống", settings.downloadQuality.title),
            ("Tự động phát", yes(settings.autoplay)),
            ("Phát trong nền", yes(settings.backgroundPlayback)),
            ("Chỉ âm thanh", yes(settings.audioOnlyMode)),
            ("Nghe nhạc chỉ âm thanh", yes(settings.musicAudioOnly)),
            ("Tiết kiệm dữ liệu", yes(settings.dataSaver)),
            ("Trình phát web dự phòng", yes(settings.webPlayerFallback)),
            ("SponsorBlock", settings.sponsorBlockEnabled ? settings.sponsorBlockCategories.joined(separator: ",") : "tắt"),
            ("DeArrow", settings.deArrowEnabled ? "tiêu đề \(yes(settings.deArrowTitles)), ảnh \(yes(settings.deArrowThumbnails))" : "tắt"),
            ("EQ", settings.eqPresetName),
            ("Âm lượng ổn định", yes(settings.stableVolume)),
            ("Ẩn danh", yes(settings.isIncognito)),
            ("Kiểm soát của phụ huynh", yes(ParentalControls.shared.isEnabled)),
            ("Tự động tải", AutoDownloadSettings.shared.isEnabled ? "\(AutoDownloadSettings.shared.channels.count) kênh" : "tắt"),
            ("Client phát video", APIConfig.playerProfiles.map { "\($0.name) \($0.version)" }.joined(separator: ", ")),
            ("Cấu hình từ xa", APIConfig.remote == nil ? "tích hợp" : "đã tải"),
            ("Truyền", PlayerManager.shared.isCasting ? PlayerManager.shared.playbackMethod : "không"),
        ]
        out.append(contentsOf: summary.map { "\($0.0): \($0.1)" })
        out.append("")
        out.append("== Lỗi gần đây (\(snapshot.errors.count)) ==")
        out.append(contentsOf: snapshot.errors.suffix(200))
        let crashes = CrashReports.shared.summaries
        if !crashes.isEmpty {
            out.append("")
            out.append("== Báo cáo sự cố (MetricKit) ==")
            out.append(contentsOf: crashes)
        }
        out.append("")
        out.append("== Nhật ký (\(snapshot.lines.count) dòng gần nhất) ==")
        out.append(contentsOf: snapshot.lines)
        return scrub(out.joined(separator: "\n"))
    }

    private static func yes(_ value: Bool) -> String { value ? "bật" : "tắt" }

    /// e.g. "iPhone15,2".
    private static func modelIdentifier() -> String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafeBytes(of: &info.machine) { raw -> String in
            let bytes = raw.prefix { $0 != 0 }
            return String(decoding: bytes, as: UTF8.self)
        }
        return machine.isEmpty ? "iPhone" : machine
    }

    // MARK: Scrubbing

    private static let rules: [(pattern: String, template: String)] = [
        // Header lines: "Cookie: …", "Authorization: …"
        (#"(?i)\b(cookie|set-cookie|authorization|x-goog-authuser|x-goog-pageid)\s*[:=]\s*[^\n]*"#, "$1: [đã ẩn]"),
        (#"(?i)\bSAPISID(1P|3P)?HASH\s+[0-9]+_[0-9a-f]+"#, "SAPISIDHASH [đã ẩn]"),
        (#"\b(SAPISID|SID|HSID|SSID|APISID|LOGIN_INFO|__Secure-[^=\s;]+)=[^;\s&"']+"#, "$1=[đã ẩn]"),
        (#"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#, "[email]"),
        // Pairing codes (library sync, TV sign-in).
        (#"(?i)dvdtube://(sync|tv-login)\S*"#, "dvdtube://$1?[đã ẩn]"),
        (#"(?i)([?&](?:key|sig|signature|lsig|token|t|k)=)[^&\s"']+"#, "$1[đã ẩn]"),
    ]

    static func scrub(_ text: String) -> String {
        var result = text
        for rule in rules {
            guard let regex = try? NSRegularExpression(pattern: rule.pattern) else { continue }
            let range = NSRange(result.startIndex..., in: result)
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: rule.template)
        }
        return result
    }

    /// `DVDTube-log-ios-<yyyyMMdd-HHmm>.txt` in the temporary folder.
    @MainActor
    static func file() throws -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmm"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("DVDTube-log-\(CrossJSON.platform)-\(formatter.string(from: Date())).txt")
        try build().write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}

/// Crash diagnostics iOS delivers through MetricKit (at most once a day, after a crash).
final class CrashReports: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = CrashReports()

    private let lock = NSLock()
    private static let key = "diagnostics.crashes"

    func start() {
        MXMetricManager.shared.add(self)
    }

    var summaries: [String] {
        lock.lock()
        defer { lock.unlock() }
        return UserDefaults.standard.stringArray(forKey: Self.key) ?? []
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        var lines: [String] = []
        for payload in payloads {
            for crash in payload.crashDiagnostics ?? [] {
                var parts = ["\(payload.timeStampEnd)"]
                if let type = crash.exceptionType { parts.append("exception \(type)") }
                if let code = crash.exceptionCode { parts.append("code \(code)") }
                if let signal = crash.signal { parts.append("signal \(signal)") }
                if let reason = crash.terminationReason { parts.append(reason) }
                parts.append("app \(crash.metaData.applicationBuildVersion)")
                lines.append(parts.joined(separator: " • "))
            }
        }
        guard !lines.isEmpty else { return }
        lock.lock()
        let stored = UserDefaults.standard.stringArray(forKey: Self.key) ?? []
        UserDefaults.standard.set(Array((lines + stored).prefix(20)), forKey: Self.key)
        lock.unlock()
        Log.debug("metrickit: \(lines.count) crash report(s)")
    }
}

/// Settings › Giới thiệu › "Gửi nhật ký lỗi".
struct LogExportView: View {
    @State private var text = ""
    @State private var fileURL: URL?
    @State private var copied = false
    @State private var showShare = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Tệp nhật ký gồm phiên bản ứng dụng, kiểu máy, tóm tắt cài đặt, loại mạng, các lỗi gần đây và tối đa \(DiagnosticsLog.maxLines) dòng nhật ký. Cookie, mã đăng nhập, email, mã ghép nối và chữ ký trong địa chỉ đã được xóa; không có nhật ký xem hay tìm kiếm.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                Text(text)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding()
        }
        .navigationTitle("Gửi nhật ký lỗi")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(copied ? "Đã chép" : "Sao chép") {
                    UIPasteboard.general.string = text
                    copied = true
                }
                Button {
                    do {
                        fileURL = try LogExport.file()
                        showShare = true
                    } catch {
                        self.error = error.localizedDescription
                    }
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Chia sẻ tệp nhật ký")
            }
        }
        .sheet(isPresented: $showShare) {
            if let fileURL { ActivityShareSheet(items: [fileURL]) }
        }
        .onAppear { text = LogExport.build() }
    }
}
