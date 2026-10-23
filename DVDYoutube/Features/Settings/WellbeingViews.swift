import SwiftUI

private func watchTimeText(_ seconds: Double) -> String {
    let minutes = Int(seconds / 60)
    if minutes < 1 { return seconds > 0 ? "< 1 phút" : "0 phút" }
    if minutes < 60 { return "\(minutes) phút" }
    return "\(minutes / 60) giờ \(minutes % 60) phút"
}

/// "Time watched": today, yesterday, the last 7 days and the daily average (on this device).
struct WatchTimeView: View {
    @Environment(AppSettings.self) private var settings
    @State private var confirmReset = false

    private let store = WatchTimeStore.shared

    var body: some View {
        @Bindable var settings = settings
        let week = store.lastWeek
        let maxSeconds = max(week.map(\.seconds).max() ?? 0, 60)
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Trung bình mỗi ngày").font(.subheadline).foregroundStyle(.secondary)
                    Text(watchTimeText(store.dailyAverage)).font(.largeTitle.weight(.bold))
                    Text("7 ngày qua").font(.caption).foregroundStyle(.secondary)
                    HStack(alignment: .bottom, spacing: 10) {
                        ForEach(week.indices, id: \.self) { index in
                            let day = week[index]
                            VStack(spacing: 4) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(index == week.count - 1 ? Color.brand : Color.brand.opacity(0.45))
                                    .frame(height: max(4, 120 * day.seconds / maxSeconds))
                                Text(day.date, format: .dateTime.weekday(.narrow))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(height: 150, alignment: .bottom)
                    .padding(.top, 8)
                }
                .padding(.vertical, 6)
            }
            Section {
                LabeledContent("Hôm nay", value: watchTimeText(store.seconds(daysAgo: 0)))
                LabeledContent("Hôm qua", value: watchTimeText(store.seconds(daysAgo: 1)))
                LabeledContent("7 ngày qua", value: watchTimeText(week.map(\.seconds).reduce(0, +)))
            } footer: {
                Text("Thời gian xem được tính trên thiết bị này, gồm cả phát trong nền và trên TV.")
            }
            Section("Công cụ quản lý thời gian") {
                Picker("Nhắc tôi nghỉ giải lao", selection: $settings.breakReminderMinutes) {
                    ForEach(AppSettings.breakReminderOptions, id: \.self) { minutes in
                        Text(minutes == 0 ? "Tắt" : "Sau mỗi \(sleepDurationTitle(minutes))").tag(minutes)
                    }
                }
                Toggle("Nhắc tôi khi đến giờ đi ngủ", isOn: $settings.bedtimeReminder)
            }
            Section {
                Button("Xóa thống kê thời gian xem", role: .destructive) { confirmReset = true }
            }
        }
        .navigationTitle("Thời gian xem")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Xóa thống kê thời gian xem?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Xóa", role: .destructive) { store.reset() }
        }
    }
}

/// Videos marked "Not interested" and channels not to recommend, with undo.
struct HiddenContentView: View {
    private let store = HiddenContentStore.shared
    @State private var confirmClear = false

    var body: some View {
        List {
            if store.isEmpty {
                ContentUnavailableView(
                    "Chưa ẩn nội dung nào",
                    systemImage: "eye.slash",
                    description: Text("Chọn \"Không quan tâm\" hoặc \"Không đề xuất kênh này\" trong menu ⋮ của video.")
                )
            }
            if !store.channels.isEmpty {
                Section("Kênh không đề xuất") {
                    ForEach(store.channels) { channel in
                        HStack(spacing: 12) {
                            AvatarView(url: channel.avatar, size: 36, name: channel.name)
                            Text(channel.name).lineLimit(1)
                            Spacer()
                            Button("Bỏ ẩn") { store.unhide(channelId: channel.id) }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }
            if !store.videos.isEmpty {
                Section("Video không quan tâm") {
                    ForEach(store.videos) { video in
                        HStack(spacing: 12) {
                            RemoteImage(url: video.displayThumbnail)
                                .frame(width: 96, height: 54)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(video.title).font(.subheadline).lineLimit(2)
                                Text(video.channelName ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Button("Bỏ ẩn") { store.unhide(videoId: video.id) }
                                .buttonStyle(.bordered)
                        }
                    }
                }
            }
            if !store.isEmpty {
                Section {
                    Button("Bỏ ẩn tất cả", role: .destructive) { confirmClear = true }
                }
            }
        }
        .navigationTitle("Nội dung đã ẩn")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Bỏ ẩn tất cả video và kênh?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Bỏ ẩn tất cả", role: .destructive) { store.clear() }
        }
    }
}

/// Banner shown on the home screen while incognito is on.
struct IncognitoBanner: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        if settings.isIncognito {
            HStack(spacing: 10) {
                Image(systemName: "eyeglasses")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Bạn đang ẩn danh").font(.subheadline.weight(.semibold))
                    Text("Video đã xem và nội dung tìm kiếm không được lưu.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.8))
                }
                Spacer()
                Button("Tắt") { settings.isIncognito = false }
                    .buttonStyle(.bordered)
                    .tint(.white)
                    .controlSize(.small)
            }
            .foregroundStyle(.white)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(white: 0.2)))
            .padding(.horizontal, 12)
        }
    }
}
