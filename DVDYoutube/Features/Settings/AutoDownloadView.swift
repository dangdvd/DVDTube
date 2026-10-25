import SwiftUI

/// Settings › Tải xuống › "Tự động tải video mới".
struct AutoDownloadView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(AccountStore.self) private var account
    @Environment(PlayerManager.self) private var player
    @State private var checking = false
    @State private var query = ""

    private var settings: AutoDownloadSettings { AutoDownloadSettings.shared }

    /// Local subscriptions and the account's, without duplicates (chosen ones first).
    private var channels: [ChannelItem] {
        var seen = Set<String>()
        let all = settings.channels + library.subscriptions + account.subscribedChannels
        let unique = all.filter { seen.insert($0.id).inserted }
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return unique }
        return unique.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section {
                Toggle("Tự động tải video mới", isOn: Binding(
                    get: { settings.isEnabled },
                    set: { enabled in
                        settings.isEnabled = enabled
                        if enabled {
                            NewVideoNotifier.schedule()
                            Task { await AutoDownloader.run(force: true) }
                        }
                    }
                ))
                Stepper("Giữ tối đa \(settings.maxPerChannel) video mỗi kênh", value: $settings.maxPerChannel, in: 1...20)
                Toggle("Chỉ khi dùng Wi-Fi", isOn: $settings.wifiOnly)
                Toggle("Chỉ âm thanh", isOn: $settings.audioOnly)
                if settings.isEnabled {
                    Button {
                        Task {
                            checking = true
                            await AutoDownloader.run(force: true)
                            checking = false
                            player.showToast("Đã kiểm tra video mới")
                        }
                    } label: {
                        HStack {
                            Text("Kiểm tra ngay")
                            Spacer()
                            if checking { ProgressView() }
                        }
                    }
                    .disabled(checking || settings.channels.isEmpty)
                }
            } footer: {
                Text("Video mới (không gồm Shorts, trực tiếp và sắp công chiếu) của các kênh đã chọn được tải ở chất lượng tải xuống trong Cài đặt. Khi quá số lượng, video tự động tải cũ nhất của kênh bị xóa; video bạn tự tải không bao giờ bị xóa. iPhone kiểm tra khi bạn mở ứng dụng và thỉnh thoảng trong nền (do iOS quyết định).")
            }

            Section {
                if channels.isEmpty {
                    Text("Chưa có kênh đăng ký nào.").foregroundStyle(.secondary)
                }
                ForEach(channels) { channel in
                    Button {
                        settings.toggle(channel)
                    } label: {
                        HStack(spacing: 12) {
                            AvatarView(url: channel.avatar, size: 32, name: channel.name)
                            Text(channel.name).lineLimit(1)
                            Spacer()
                            Image(systemName: settings.contains(channel.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(settings.contains(channel.id) ? Color.brand : Color.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("Kênh (\(settings.channels.count) đã chọn)")
            }
        }
        .searchable(text: $query, prompt: "Tìm kênh")
        .navigationTitle("Tự động tải")
        .navigationBarTitleDisplayMode(.inline)
    }
}
