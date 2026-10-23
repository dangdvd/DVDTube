import SwiftUI

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(LibraryStore.self) private var library
    @Environment(DownloadManager.self) private var downloads
    @Environment(PlayerManager.self) private var player
    @Environment(AccountStore.self) private var account
    @Environment(Router.self) private var router

    @State private var confirmClearHistory = false
    @State private var notifyNewVideos = NewVideoNotifier.isEnabled
    @State private var checkingNewVideos = false
    @State private var notificationsDenied = false
    @State private var refreshingConfig = false
    @State private var configStatus: String?

    var body: some View {
        @Bindable var settings = settings
        @Bindable var account = account
        Form {
            Section {
                if account.isSignedIn {
                    HStack(spacing: 12) {
                        AvatarView(url: account.profile?.avatar, size: 40, name: account.profile?.name ?? "")
                        VStack(alignment: .leading) {
                            Text(account.profile?.name ?? "Tài khoản YouTube").font(.subheadline.weight(.semibold))
                            if let handle = account.profile?.handle {
                                Text(handle).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Button {
                        router.showAccountSwitcher = true
                    } label: {
                        Label("Chuyển đổi tài khoản / kênh", systemImage: "person.2.circle")
                    }
                    Button {
                        router.signIn(addingAccount: true)
                    } label: {
                        Label("Thêm tài khoản Google", systemImage: "person.badge.plus")
                    }
                    Toggle("Ghi video đã xem vào nhật ký YouTube", isOn: $account.syncWatchHistory)
                    Button("Đăng xuất (mọi tài khoản)", role: .destructive) {
                        Task { await account.signOut() }
                    }
                } else {
                    Button {
                        router.signIn()
                    } label: {
                        Label("Đăng nhập tài khoản Google", systemImage: "person.crop.circle.badge.plus")
                    }
                }
            } header: {
                Text("Tài khoản Google")
            } footer: {
                Text("Khi đăng nhập, trang chủ, kênh đăng ký, nhật ký xem, video đã thích, Xem sau và danh sách phát lấy từ tài khoản YouTube của bạn; Đăng ký/Thích được ghi lên tài khoản. Phiên đăng nhập (cookie) chỉ lưu trong Keychain của máy và chỉ gửi tới youtube.com. Video vẫn phát qua trình phát không quảng cáo.")
            }

            Section("Chung") {
                Picker("Ngôn ngữ nội dung", selection: $settings.language) {
                    ForEach(AppSettings.languages, id: \.code) { Text($0.name).tag($0.code) }
                }
                Picker("Khu vực", selection: $settings.region) {
                    ForEach(AppSettings.regions, id: \.code) { Text($0.name).tag($0.code) }
                }
                Picker("Giao diện", selection: $settings.theme) {
                    ForEach(AppTheme.allCases) { Text($0.title).tag($0) }
                }
            }

            Section {
                Picker("Chất lượng khi dùng Wi-Fi", selection: $settings.wifiQuality) {
                    ForEach(VideoQuality.allCases) { Text($0.title).tag($0) }
                }
                Picker("Chất lượng khi dùng dữ liệu di động", selection: $settings.cellularQuality) {
                    ForEach(VideoQuality.allCases) { Text($0.title).tag($0) }
                }
                Picker("Tốc độ phát mặc định", selection: $settings.playbackSpeed) {
                    ForEach(AppSettings.speeds, id: \.self) { speed in
                        Text(speed == 1 ? "Bình thường" : String(format: "%gx", speed)).tag(speed)
                    }
                }
                Toggle("Tự động phát video tiếp theo", isOn: $settings.autoplay)
                Toggle("Phát trong nền", isOn: $settings.backgroundPlayback)
                Toggle("Tự động bật hình trong hình (PiP)", isOn: $settings.autoPictureInPicture)
                    .onChange(of: settings.autoPictureInPicture) { _, _ in player.updateAutoPiP() }
                Toggle("Tiếp tục từ vị trí đã xem", isOn: $settings.resumePlayback)
                Toggle("Dự phòng bằng trình phát web khi YouTube chặn", isOn: $settings.webPlayerFallback)
            } header: {
                Text("Phát video")
            } footer: {
                Text("Phát trong nền và PiP là các tính năng của YouTube Premium, ở đây được bật miễn phí.")
            }

            Section {
                Toggle("Báo khi kênh đăng ký có video mới", isOn: Binding(
                    get: { notifyNewVideos },
                    set: { enabled in Task { await setNewVideoNotifications(enabled) } }
                ))
                if notifyNewVideos {
                    Button {
                        Task {
                            checkingNewVideos = true
                            let count = await NewVideoNotifier.checkForNewVideos()
                            checkingNewVideos = false
                            player.showToast(count > 0 ? "Có \(count) video mới" : "Chưa có video mới")
                        }
                    } label: {
                        HStack {
                            Text("Kiểm tra ngay")
                            Spacer()
                            if checkingNewVideos { ProgressView() }
                        }
                    }
                }
            } header: {
                Text("Thông báo")
            } footer: {
                Text("iOS tự quyết định thời điểm kiểm tra trong nền (thường vài lần mỗi ngày, khi máy đang sạc hoặc dùng Wi-Fi). Cần bật Làm mới ứng dụng trong nền cho DVDTube.")
            }

            Section("Phụ đề") {
                Toggle("Tự động bật phụ đề", isOn: $settings.captionsEnabled)
                Picker("Ngôn ngữ phụ đề", selection: $settings.captionLanguage) {
                    ForEach(AppSettings.languages, id: \.code) { Text($0.name).tag($0.code) }
                }
            }

            Section {
                Toggle("Bỏ qua đoạn tài trợ (SponsorBlock)", isOn: $settings.sponsorBlockEnabled)
                if settings.sponsorBlockEnabled {
                    ForEach(SponsorBlock.allCategories, id: \.id) { category in
                        Toggle(category.title, isOn: Binding(
                            get: { settings.sponsorBlockCategories.contains(category.id) },
                            set: { enabled in
                                var categories = settings.sponsorBlockCategories.filter { $0 != category.id }
                                if enabled { categories.append(category.id) }
                                settings.sponsorBlockCategories = categories
                            }
                        ))
                        .padding(.leading, 12)
                    }
                }
            } header: {
                Text("Chặn quảng cáo trong video")
            } footer: {
                Text("Quảng cáo của YouTube luôn bị chặn. SponsorBlock bỏ qua thêm các đoạn quảng cáo do người làm video tự lồng vào, dựa trên dữ liệu cộng đồng (sponsor.ajay.app).")
            }

            Section("Tải xuống") {
                Picker("Chất lượng tải xuống", selection: $settings.downloadQuality) {
                    ForEach(VideoQuality.allCases.filter { $0 != .auto }) { Text($0.title).tag($0) }
                }
                LabeledContent("Dung lượng đã dùng",
                               value: ByteCountFormatter.string(fromByteCount: downloads.totalSize, countStyle: .file))
            }

            Section("Quyền riêng tư") {
                Toggle("Lưu nhật ký xem", isOn: $settings.saveHistory)
                Button("Xóa nhật ký xem", role: .destructive) { confirmClearHistory = true }
                Button("Xóa lịch sử tìm kiếm", role: .destructive) { library.clearSearchHistory() }
            }

            Section {
                TextField("URL cấu hình từ xa", text: $settings.remoteConfigURL, prompt: Text(APIConfig.defaultRemoteConfigURL))
                    .font(.footnote)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                Button {
                    Task {
                        refreshingConfig = true
                        await APIConfig.refreshRemoteConfig()
                        configStatus = APIConfig.remote == nil ? "Đang dùng cấu hình tích hợp" : "Đã tải cấu hình từ xa"
                        refreshingConfig = false
                    }
                } label: {
                    HStack {
                        Text("Cập nhật cấu hình ngay")
                        Spacer()
                        if refreshingConfig { ProgressView() }
                    }
                }
                Button("Dùng lại cấu hình tích hợp") {
                    APIConfig.clearRemoteConfig()
                    configStatus = "Đang dùng cấu hình tích hợp"
                }
                LabeledContent("Client phát video", value: APIConfig.playerProfiles.map { "\($0.name) \($0.version)" }.joined(separator: ", "))
                    .font(.footnote)
                if let message = APIConfig.remote?.message {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                if let configStatus {
                    Text(configStatus).font(.footnote).foregroundStyle(.secondary)
                }
            } header: {
                Text("Nâng cao")
            } footer: {
                Text("Khi YouTube thay đổi cách cung cấp video, chỉ cần sửa tệp Config/remote-config.json trong kho GitHub là ứng dụng tự cập nhật, không cần cài lại.")
            }

            Section {
                NavigationLink {
                    DiagnosticsView()
                } label: {
                    Label("Nhật ký chẩn đoán", systemImage: "stethoscope")
                }
            } header: {
                Text("Hỗ trợ")
            } footer: {
                Text("Khi gặp lỗi, mở mục này, bấm Sao chép rồi gửi cho người phát triển. Nhật ký chỉ gồm tên API, mã lỗi và thông báo lỗi, không có cookie hay thông tin tài khoản.")
            }

            Section("Giới thiệu") {
                LabeledContent("Phiên bản", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                Link(destination: URL(string: "https://github.com/dangdvd/DVDYoutube")!) {
                    Label("Mã nguồn trên GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                }
                Text("DVDTube là ứng dụng không chính thức, không liên kết với Google hay YouTube. Mọi dữ liệu (đăng ký, nhật ký, danh sách phát) chỉ được lưu trên thiết bị này.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Cài đặt")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Chưa được phép gửi thông báo", isPresented: $notificationsDenied) {
            Button("Mở Cài đặt") {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            }
            Button("Đóng", role: .cancel) {}
        } message: {
            Text("Hãy bật Thông báo cho DVDTube trong Cài đặt của iOS.")
        }
        .confirmationDialog("Xóa toàn bộ nhật ký xem?", isPresented: $confirmClearHistory, titleVisibility: .visible) {
            Button("Xóa", role: .destructive) { library.clearHistory() }
        }
    }
}

extension SettingsView {
    func setNewVideoNotifications(_ enabled: Bool) async {
        guard enabled else {
            UserDefaults.standard.set(false, forKey: NewVideoNotifier.enabledKey)
            notifyNewVideos = false
            return
        }
        let granted = await NewVideoNotifier.requestPermission()
        UserDefaults.standard.set(granted, forKey: NewVideoNotifier.enabledKey)
        notifyNewVideos = granted
        if granted {
            NewVideoNotifier.schedule()
            // Record what exists now so only later uploads are announced.
            await NewVideoNotifier.checkForNewVideos()
        } else {
            notificationsDenied = true
        }
    }
}

struct DiagnosticsView: View {
    @State private var text = DiagnosticsLog.shared.text
    @State private var copied = false

    var body: some View {
        ScrollView {
            Text(text)
                .font(.system(.caption2, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle("Nhật ký chẩn đoán")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(copied ? "Đã chép" : "Sao chép") {
                    UIPasteboard.general.string = text
                    copied = true
                }
                Menu {
                    ShareLink(item: text) { Label("Chia sẻ", systemImage: "square.and.arrow.up") }
                    Button {
                        text = DiagnosticsLog.shared.text
                    } label: {
                        Label("Làm mới", systemImage: "arrow.clockwise")
                    }
                    Button(role: .destructive) {
                        DiagnosticsLog.shared.clear()
                        text = DiagnosticsLog.shared.text
                    } label: {
                        Label("Xóa nhật ký", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }
}
