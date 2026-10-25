import SwiftUI

/// Settings › "Hẹn giờ phát": list, edit and delete alarms.
struct AlarmsView: View {
    @State private var editing: PlaybackAlarm?
    private var scheduler: AlarmScheduler { AlarmScheduler.shared }

    var body: some View {
        List {
            Section {
                if scheduler.alarms.isEmpty {
                    Text("Chưa có hẹn giờ nào.").foregroundStyle(.secondary)
                }
                ForEach(scheduler.alarms) { alarm in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(alarm.timeText)
                                .font(.title2.weight(.semibold).monospacedDigit())
                                .foregroundStyle(alarm.isEnabled ? Color.primary : Color.secondary)
                            Text("\(alarm.repeatMode.title) • \(scheduler.contentTitle(alarm.content))\(alarm.audioOnly ? " • chỉ âm thanh" : "")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        Spacer()
                        Toggle("", isOn: Binding(get: { alarm.isEnabled }, set: { scheduler.setEnabled(alarm, $0) }))
                            .labelsHidden()
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { editing = alarm }
                    .swipeActions {
                        Button("Xóa", role: .destructive) { scheduler.delete(alarm) }
                    }
                }
            } footer: {
                Text("Đến giờ, iPhone hiện thông báo; nhấn vào để bắt đầu phát. Nếu DVDTube đang mở hoặc đang phát trong nền, video tự phát với âm lượng tăng dần trong 30 giây.")
            }
        }
        .navigationTitle("Hẹn giờ phát")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    let next = Calendar.current.dateComponents([.hour, .minute], from: Date().addingTimeInterval(3600))
                    editing = PlaybackAlarm(hour: next.hour ?? 7, minute: 0)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Thêm hẹn giờ")
            }
        }
        .sheet(item: $editing) { alarm in
            AlarmEditor(alarm: alarm, isNew: !scheduler.alarms.contains { $0.id == alarm.id })
        }
    }
}

private struct AlarmEditor: View {
    @State var alarm: PlaybackAlarm
    let isNew: Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library
    @State private var link = ""

    private enum Choice: Hashable {
        case playlist(UUID), watchLater, liked, radio, link
    }

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Giờ", selection: time, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel)
                Picker("Lặp lại", selection: $alarm.repeatMode) {
                    ForEach(PlaybackAlarm.Repeat.allCases) { Text($0.title).tag($0) }
                }
                Section("Nội dung") {
                    Picker("Phát", selection: choice) {
                        Text("Xem sau").tag(Choice.watchLater)
                        Text("Video đã thích").tag(Choice.liked)
                        Text("Radio từ bài nghe gần nhất").tag(Choice.radio)
                        ForEach(library.playlists) { playlist in
                            Text("Danh sách: \(playlist.name)").tag(Choice.playlist(playlist.id))
                        }
                        Text("Liên kết YouTube").tag(Choice.link)
                    }
                    if case .link = alarm.content {
                        TextField("Dán liên kết video hoặc danh sách phát", text: $link)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                    }
                }
                Section {
                    Toggle("Tăng dần âm lượng (30 giây)", isOn: $alarm.fadeIn)
                    Toggle("Chỉ âm thanh", isOn: $alarm.audioOnly)
                }
            }
            .navigationTitle(isNew ? "Hẹn giờ mới" : "Sửa hẹn giờ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lưu") {
                        if case .link = alarm.content { alarm.content = .link(link.trimmingCharacters(in: .whitespacesAndNewlines)) }
                        alarm.isEnabled = true
                        AlarmScheduler.shared.save(alarm)
                        dismiss()
                    }
                    .disabled(isLinkMissing)
                }
            }
        }
        .onAppear {
            if case .link(let text) = alarm.content { link = text }
        }
    }

    private var isLinkMissing: Bool {
        if case .link = alarm.content {
            return link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return false
    }

    private var time: Binding<Date> {
        Binding(
            get: { Calendar.current.date(bySettingHour: alarm.hour, minute: alarm.minute, second: 0, of: Date()) ?? Date() },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                alarm.hour = parts.hour ?? 0
                alarm.minute = parts.minute ?? 0
            }
        )
    }

    private var choice: Binding<Choice> {
        Binding(
            get: {
                switch alarm.content {
                case .localPlaylist(let id): return .playlist(id)
                case .watchLater: return .watchLater
                case .liked: return .liked
                case .radioFromRecent: return .radio
                case .link: return .link
                }
            },
            set: { value in
                switch value {
                case .playlist(let id): alarm.content = .localPlaylist(id)
                case .watchLater: alarm.content = .watchLater
                case .liked: alarm.content = .liked
                case .radio: alarm.content = .radioFromRecent
                case .link: alarm.content = .link(link)
                }
            }
        )
    }
}
