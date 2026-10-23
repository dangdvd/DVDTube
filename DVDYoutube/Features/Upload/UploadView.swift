import AVFoundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// A video picked from Photos, copied into the app's temporary folder.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            PickedMovie(url: try copyForUpload(received.file))
        }
    }
}

/// Keeps one picked file at a time in tmp/upload.
func copyForUpload(_ source: URL) throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("upload", isDirectory: true)
    try? FileManager.default.removeItem(at: folder)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let destination = folder.appendingPathComponent(source.lastPathComponent)
    try FileManager.default.copyItem(at: source, to: destination)
    return destination
}

struct UploadView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AccountStore.self) private var account
    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

    @State private var uploader = VideoUploader()
    @State private var pickerItem: PhotosPickerItem?
    @State private var file: URL?
    @State private var thumbnail: UIImage?
    @State private var durationText: String?
    @State private var title = ""
    @State private var details = ""
    @State private var privacy: VideoUploader.Privacy = .private
    @State private var isPicking = false
    @State private var showFiles = false
    @State private var showStudio = false
    @State private var pickError: String?
    @State private var confirmClose = false

    var body: some View {
        NavigationStack {
            Form {
                if !account.isSignedIn {
                    Section {
                        Button {
                            dismiss()
                            router.signIn()
                        } label: {
                            Label("Đăng nhập tài khoản Google để tải video lên", systemImage: "person.crop.circle.badge.plus")
                        }
                    }
                } else {
                    if let profile = account.profile {
                        Section {
                            HStack(spacing: 10) {
                                AvatarView(url: profile.avatar, size: 32, name: profile.name)
                                VStack(alignment: .leading) {
                                    Text("Tải lên kênh").font(.caption).foregroundStyle(.secondary)
                                    Text(profile.name).font(.subheadline.weight(.semibold))
                                }
                            }
                        }
                    }
                    pickSection
                    if file != nil {
                        detailsSection
                        uploadSection
                    }
                }
                Section {
                    Button {
                        showStudio = true
                    } label: {
                        Label("Tải lên bằng YouTube Studio (web)", systemImage: "globe")
                    }
                    .disabled(!account.isSignedIn)
                } footer: {
                    Text("Video được tải lên kênh của tài khoản (hoặc kênh thương hiệu) đang chọn. Giữ ứng dụng mở cho tới khi tải lên xong. Nếu tải lên trong ứng dụng không được, hãy dùng YouTube Studio bản web.")
                }
            }
            .navigationTitle("Tải video lên")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Đóng") {
                        if uploader.isBusy { confirmClose = true } else { dismiss() }
                    }
                }
            }
            .confirmationDialog("Hủy tải lên?", isPresented: $confirmClose, titleVisibility: .visible) {
                Button("Hủy tải lên", role: .destructive) {
                    uploader.cancel()
                    dismiss()
                }
                Button("Tiếp tục tải lên", role: .cancel) {}
            }
            .onChange(of: pickerItem) { _, item in
                guard let item else { return }
                Task { await loadFromPhotos(item) }
            }
            .fileImporter(isPresented: $showFiles, allowedContentTypes: [.movie, .video, .mpeg4Movie, .quickTimeMovie]) { result in
                Task { await loadFromFiles(result) }
            }
            .sheet(isPresented: $showStudio) {
                StudioWebSheet()
            }
            .interactiveDismissDisabled(uploader.isBusy)
        }
    }

    // MARK: Sections

    private var pickSection: some View {
        Section {
            if let file {
                HStack(spacing: 12) {
                    ZStack {
                        Color(.tertiarySystemFill)
                        if let thumbnail {
                            Image(uiImage: thumbnail).resizable().scaledToFill()
                        } else {
                            Image(systemName: "film").foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 112, height: 63)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(file.lastPathComponent).font(.footnote.weight(.semibold)).lineLimit(2)
                        Text([durationText, fileSizeText(file)].compactMap { $0 }.joined(separator: " • "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if isPicking {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Đang lấy video…").font(.footnote)
                }
            }
            if let pickError {
                Text(pickError).font(.footnote).foregroundStyle(.red)
            }
            PhotosPicker(selection: $pickerItem, matching: .videos) {
                Label(file == nil ? "Chọn video từ Ảnh" : "Chọn video khác", systemImage: "photo.on.rectangle")
            }
            .disabled(uploader.isBusy || isPicking)
            Button {
                showFiles = true
            } label: {
                Label("Chọn từ ứng dụng Tệp", systemImage: "folder")
            }
            .disabled(uploader.isBusy || isPicking)
        } header: {
            Text("Video")
        }
    }

    private var detailsSection: some View {
        Section {
            TextField("Tiêu đề (bắt buộc)", text: $title, axis: .vertical)
                .lineLimit(1...3)
                .onChange(of: title) { _, value in
                    if value.count > 100 { title = String(value.prefix(100)) }
                }
            TextField("Mô tả", text: $details, axis: .vertical)
                .lineLimit(3...8)
                .onChange(of: details) { _, value in
                    if value.count > 5000 { details = String(value.prefix(5000)) }
                }
            Picker("Chế độ hiển thị", selection: $privacy) {
                ForEach(VideoUploader.Privacy.allCases) { Text($0.title).tag($0) }
            }
        } header: {
            Text("Chi tiết")
        } footer: {
            Text("Video dọc dài tối đa 3 phút sẽ được YouTube đăng dưới dạng Shorts.")
        }
        .disabled(uploader.isBusy)
    }

    @ViewBuilder
    private var uploadSection: some View {
        Section {
            switch uploader.state {
            case .idle:
                uploadButton
            case .preparing:
                status("Đang chuẩn bị…")
            case .uploading(let fraction):
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: fraction)
                    Text("Đang tải lên \(Int(fraction * 100))%").font(.footnote).foregroundStyle(.secondary)
                }
                Button("Hủy tải lên", role: .destructive) { uploader.cancel() }
            case .creating:
                status("Đang tạo video trên kênh…")
            case .done(let videoId):
                Label("Đã tải lên. YouTube đang xử lý video, có thể mất vài phút trước khi xem được.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.footnote)
                Button {
                    player.play(VideoItem(id: videoId, title: title, channelName: account.profile?.name))
                    dismiss()
                } label: {
                    Label("Xem video", systemImage: "play.rectangle")
                }
                if let studio = URL(string: "https://studio.youtube.com/video/\(videoId)/edit") {
                    Link(destination: studio) {
                        Label("Chỉnh sửa trong YouTube Studio", systemImage: "slider.horizontal.3")
                    }
                }
                ShareLink(item: URL(string: "https://youtu.be/\(videoId)")!) {
                    Label("Chia sẻ liên kết", systemImage: "square.and.arrow.up")
                }
                Button("Tải lên video khác") {
                    uploader.reset()
                    file = nil
                    thumbnail = nil
                    title = ""
                    details = ""
                    pickerItem = nil
                }
            case .failed(let message):
                Text(message).font(.footnote).foregroundStyle(.red)
                uploadButton
            }
        }
    }

    private var uploadButton: some View {
        Button {
            guard let file else { return }
            uploader.start(
                file: file,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                description: details,
                privacy: privacy
            )
        } label: {
            Label("Tải lên", systemImage: "arrow.up.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity)
        }
        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func status(_ text: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
            Text(text).font(.footnote)
        }
    }

    // MARK: Picking

    private func loadFromPhotos(_ item: PhotosPickerItem) async {
        isPicking = true
        pickError = nil
        defer { isPicking = false }
        do {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else {
                pickError = "Không lấy được video từ thư viện Ảnh."
                return
            }
            await use(movie.url)
        } catch {
            pickError = error.localizedDescription
        }
    }

    private func loadFromFiles(_ result: Result<URL, Error>) async {
        pickError = nil
        switch result {
        case .success(let url):
            isPicking = true
            defer { isPicking = false }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let copy = try copyForUpload(url)
                await use(copy)
            } catch {
                pickError = error.localizedDescription
            }
        case .failure(let error):
            pickError = error.localizedDescription
        }
    }

    private func use(_ url: URL) async {
        uploader.reset()
        file = url
        if title.isEmpty { title = String(url.deletingPathExtension().lastPathComponent.prefix(100)) }
        thumbnail = nil
        durationText = nil
        let asset = AVURLAsset(url: url)
        if let duration = try? await asset.load(.duration), duration.seconds.isFinite {
            durationText = formatDuration(Int(duration.seconds))
        }
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 400, height: 400)
        if let frame = try? await generator.image(at: CMTime(seconds: 1, preferredTimescale: 600)) {
            thumbnail = UIImage(cgImage: frame.image)
        }
    }

    private func fileSizeText(_ url: URL) -> String? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }
}

/// YouTube Studio's own upload page (desktop site) with the signed-in session.
private struct StudioWebSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            StudioWebView()
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("YouTube Studio")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Xong") { dismiss() }
                    }
                }
        }
    }
}

private struct StudioWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.preferredContentMode = .desktop
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"
        webView.allowsBackForwardNavigationGestures = true
        let identity = AuthSession.shared.currentIdentity
        var components = URLComponents(string: "https://studio.youtube.com/")!
        components.queryItems = [URLQueryItem(name: "authuser", value: String(identity.authUser))]
        if let pageId = identity.pageId { components.queryItems?.append(URLQueryItem(name: "pageid", value: pageId)) }
        if let url = components.url { webView.load(URLRequest(url: url)) }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
