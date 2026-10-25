import AVFoundation
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Settings › "Đồng bộ & sao lưu": export / import the library file and the two-way LAN sync.
struct SyncSettingsView: View {
    @Environment(PlayerManager.self) private var player
    @Environment(LibraryStore.self) private var library

    @State private var exportURL: URL?
    @State private var showImporter = false
    @State private var importResult: String?
    @State private var showScanner = false
    @State private var scannedURL: URL?
    @State private var showReceiver = false

    var body: some View {
        Form {
            Section {
                Button {
                    do {
                        exportURL = try LibrarySync.exportFile()
                    } catch {
                        player.showToast("Không tạo được tệp: \(error.localizedDescription)")
                    }
                } label: {
                    Label("Xuất thư viện", systemImage: "square.and.arrow.up")
                }
                Button {
                    showImporter = true
                } label: {
                    Label("Nhập thư viện", systemImage: "square.and.arrow.down")
                }
            } header: {
                Text("Tệp thư viện")
            } footer: {
                Text("Tệp DVDTube-thu-vien-…json gồm \(library.subscriptions.count) kênh, \(library.history.count) video đã xem, Xem sau, video đã thích, \(library.playlists.count) danh sách phát và nội dung đã tìm. Nhập trên DVDTube cho iPhone, Android, Android TV hoặc máy tính: dữ liệu được gộp lại, không xóa gì.")
            }

            Section {
                Button {
                    showReceiver = true
                } label: {
                    Label("Hiện mã QR để đồng bộ", systemImage: "qrcode")
                }
                Button {
                    showScanner = true
                } label: {
                    Label("Quét mã QR của thiết bị khác", systemImage: "qrcode.viewfinder")
                }
            } header: {
                Text("Đồng bộ qua Wi-Fi")
            } footer: {
                Text("Hai thiết bị cùng mạng Wi-Fi: một thiết bị hiện mã QR (Cài đặt › Đồng bộ & sao lưu), thiết bị kia quét mã (trên iPhone có thể dùng ứng dụng Camera). Thư viện của hai bên được gộp và mã hóa bằng khóa trong mã QR; mã chỉ dùng được một lần trong 10 phút. Không gửi tài khoản hay cookie.")
            }
        }
        .navigationTitle("Đồng bộ & sao lưu")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: Binding(get: { exportURL.map(ShareItem.init) }, set: { if $0 == nil { exportURL = nil } })) { item in
            ActivityShareSheet(items: [item.url])
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json, .data, .plainText]) { result in
            switch result {
            case .success(let url):
                importLibrary(from: url)
            case .failure(let error):
                importResult = error.localizedDescription
            }
        }
        .sheet(isPresented: $showScanner, onDismiss: {
            if let url = scannedURL {
                scannedURL = nil
                DeepLinks.shared.open(url)
            }
        }) {
            QRScannerSheet { code in
                if let url = URL(string: code), url.scheme == "dvdtube" {
                    scannedURL = url
                    showScanner = false
                    return true
                }
                return false
            }
        }
        .sheet(isPresented: $showReceiver, onDismiss: { SyncReceiver.shared.reset() }) {
            SyncReceiverSheet()
        }
        .alert("Nhập thư viện", isPresented: Binding(get: { importResult != nil }, set: { if !$0 { importResult = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(importResult ?? "")
        }
    }

    private func importLibrary(from url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            let parsed = try LibrarySync.parse(data)
            let summary = LibrarySync.apply(parsed.library)
            importResult = summary.text + (parsed.device.map { " (từ \($0))" } ?? "")
            player.showToast(summary.text)
        } catch {
            importResult = error.localizedDescription
        }
    }

    private struct ShareItem: Identifiable {
        let url: URL
        var id: String { url.absoluteString }
    }
}

/// The QR code another device scans to sync with this iPhone.
struct SyncReceiverSheet: View {
    @Environment(\.dismiss) private var dismiss
    private var receiver: SyncReceiver { SyncReceiver.shared }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                switch receiver.phase {
                case .idle, .starting:
                    ProgressView("Đang chuẩn bị…")
                        .frame(maxHeight: .infinity)
                case .waiting(let url):
                    Text("Quét mã này bằng DVDTube trên thiết bị kia")
                        .font(.headline)
                        .multilineTextAlignment(.center)
                    QRCodeView(text: url)
                        .frame(maxWidth: 280, maxHeight: 280)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                    if let expires = receiver.expiresAt {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let left = max(Int(expires.timeIntervalSince(context.date)), 0)
                            Text("Hết hạn sau \(left / 60):\(String(format: "%02d", left % 60))")
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text("Giữ DVDTube mở trên iPhone cho tới khi đồng bộ xong.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                case .done(let message):
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(.green)
                    Text(message)
                        .multilineTextAlignment(.center)
                case .failed(let message):
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.orange)
                    Text(message)
                        .multilineTextAlignment(.center)
                    Button("Tạo mã mới") { receiver.start() }
                        .buttonStyle(.borderedProminent)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Đồng bộ thư viện")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Xong") { dismiss() }
                }
            }
        }
        .onAppear { receiver.start() }
    }
}

/// A QR code image (Core Image generator, scaled without smoothing).
struct QRCodeView: View {
    let text: String

    var body: some View {
        if let image = Self.image(for: text) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .accessibilityLabel("Mã QR")
        } else {
            Image(systemName: "qrcode").font(.largeTitle)
        }
    }

    static func image(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

/// UIKit share sheet (for files made on demand).
struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - QR scanner

/// In-app scanner for DVDTube codes (library sync, TV sign-in). `onCode` returns true when the
/// code was used (scanning then stops).
struct QRScannerSheet: View {
    var onCode: (String) -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var access = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                switch access {
                case .authorized:
                    QRScannerView { code in
                        if onCode(code) { return true }
                        message = "Đây không phải mã QR của DVDTube."
                        return false
                    }
                    .ignoresSafeArea()
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(0.9), lineWidth: 3)
                        .frame(width: 240, height: 240)
                        .allowsHitTesting(false)
                case .notDetermined:
                    ProgressView().tint(.white)
                default:
                    VStack(spacing: 12) {
                        Image(systemName: "camera.fill").font(.largeTitle)
                        Text("DVDTube cần quyền dùng Camera để quét mã. Bật trong Cài đặt › DVDTube › Camera, hoặc quét bằng ứng dụng Camera của iPhone.")
                            .multilineTextAlignment(.center)
                        Button("Mở Cài đặt") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .foregroundStyle(.white)
                    .padding(24)
                }
                if let message {
                    VStack {
                        Spacer()
                        Text(message)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color.black.opacity(0.7)))
                            .padding(.bottom, 40)
                    }
                }
            }
            .navigationTitle("Quét mã QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Đóng") { dismiss() }
                }
            }
        }
        .task {
            if access == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                access = granted ? .authorized : .denied
            }
        }
    }
}

private struct QRScannerView: UIViewControllerRepresentable {
    /// Returns true to stop scanning.
    var onCode: (String) -> Bool

    func makeUIViewController(context: Context) -> QRScannerController {
        let controller = QRScannerController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ controller: QRScannerController, context: Context) {
        controller.onCode = onCode
    }
}

/// Receives the codes found by the camera (on the main queue).
private final class QRMetadataDelegate: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        onCode?(code)
    }
}

private final class QRScannerController: UIViewController {
    var onCode: ((String) -> Bool)?

    private let session = AVCaptureSession()
    private let metadataDelegate = QRMetadataDelegate()
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    private var lastCode: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        metadataDelegate.onCode = { [weak self] code in
            self?.found(code)
        }
        output.setMetadataObjectsDelegate(metadataDelegate, queue: .main)
        output.metadataObjectTypes = [.qr]
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = session
        DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
    }

    private func found(_ code: String) {
        guard !finished, code != lastCode else { return }
        lastCode = code
        if onCode?(code) == true {
            finished = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }
}
