import SwiftUI

/// Shown instead of the picture in audio-only mode: the thumbnail as artwork.
struct AudioOnlyBackdrop: View {
    let compact: Bool

    @Environment(PlayerManager.self) private var player

    var body: some View {
        ZStack {
            RemoteImage(url: player.currentVideo?.displayThumbnail)
                .blur(radius: 24)
                .overlay(Color.black.opacity(0.55))
            if compact {
                Image(systemName: "headphones")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
            } else {
                VStack(spacing: 10) {
                    RemoteImage(url: player.currentVideo?.displayThumbnail)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .frame(maxHeight: 110)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Label("Chỉ phát âm thanh", systemImage: "headphones")
                        .font(.footnote.weight(.semibold))
                    Button {
                        player.setAudioOnly(false)
                    } label: {
                        Label("Bật hình", systemImage: "play.rectangle")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .tint(.white)
                    .controlSize(.small)
                }
                .foregroundStyle(.white)
            }
        }
        .clipped()
    }
}

/// "Stats for nerds": what is playing and how.
struct StatsOverlay: View {
    @Environment(PlayerManager.self) private var player

    var body: some View {
        VStack {
            HStack {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    let lines = player.statsLines
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(lines.indices, id: \.self) { index in
                            HStack(alignment: .top, spacing: 6) {
                                Text(lines[index].0).foregroundStyle(.white.opacity(0.7))
                                Text(lines[index].1)
                            }
                        }
                    }
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.white)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.7)))
                .overlay(alignment: .topTrailing) {
                    Button {
                        player.showsStats = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.white)
                            .padding(4)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            Spacer()
        }
    }
}

func sleepDurationTitle(_ minutes: Int) -> String {
    if minutes < 60 { return "\(minutes) phút" }
    let hours = minutes / 60
    let rest = minutes % 60
    return rest == 0 ? "\(hours) giờ" : "\(hours) giờ \(rest) phút"
}

/// Sleep timer: preset durations, end of video, a custom duration and extending a running timer.
struct SleepTimerView: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var customHours = 0
    @State private var customMinutes = 25

    var body: some View {
        List {
            if let label = player.sleepTimerLabel {
                Section {
                    HStack {
                        Image(systemName: "moon.zzz.fill").foregroundStyle(Color.brand)
                        Text(player.sleepAtEndOfVideo ? "Dừng khi hết video này" : "Dừng phát sau \(label)")
                            .monospacedDigit()
                    }
                    if !player.sleepAtEndOfVideo {
                        HStack {
                            ForEach([5, 15, 30], id: \.self) { minutes in
                                Button("+\(minutes) phút") { player.extendSleepTimer(minutes: minutes) }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                    Button("Tắt hẹn giờ", role: .destructive) {
                        player.setSleepTimer(minutes: nil)
                    }
                }
            }
            Section {
                ForEach(AppSettings.sleepTimerOptions, id: \.self) { minutes in
                    Button(sleepDurationTitle(minutes)) {
                        player.setSleepTimer(minutes: minutes)
                        dismiss()
                    }
                }
                Button("Khi hết video này") {
                    player.setSleepTimer(minutes: 0)
                    dismiss()
                }
            } header: {
                Text("Dừng phát sau")
            } footer: {
                Text("Âm thanh nhỏ dần trong 10 giây cuối rồi video tạm dừng — kể cả khi đang phát trong nền hoặc khóa màn hình.")
            }
            Section("Tùy chỉnh") {
                HStack(spacing: 0) {
                    Picker("Giờ", selection: $customHours) {
                        ForEach(0..<9) { Text("\($0) giờ").tag($0) }
                    }
                    .pickerStyle(.wheel)
                    Picker("Phút", selection: $customMinutes) {
                        ForEach(0..<60) { Text("\($0) phút").tag($0) }
                    }
                    .pickerStyle(.wheel)
                }
                .frame(height: 130)
                Button("Bắt đầu hẹn giờ \(sleepDurationTitle(max(customHours * 60 + customMinutes, 1)))") {
                    player.setSleepTimer(minutes: max(customHours * 60 + customMinutes, 1))
                    dismiss()
                }
            }
        }
        .navigationTitle("Hẹn giờ tắt")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// "Take a break" and bedtime reminders, shown over the whole app.
struct WellbeingReminderModifier: ViewModifier {
    @Environment(PlayerManager.self) private var player

    func body(content: Content) -> some View {
        content.alert(
            title,
            isPresented: Binding(get: { player.reminder != nil }, set: { if !$0 { player.reminder = nil } }),
            presenting: player.reminder
        ) { kind in
            switch kind {
            case .takeBreak:
                Button("Tiếp tục xem") {
                    player.dismissReminder(.takeBreak)
                    player.resume()
                }
                Button("Đóng", role: .cancel) { player.dismissReminder(.takeBreak) }
            case .bedtime:
                Button("Nhắc lại sau 10 phút") { player.dismissReminder(.bedtime, snoozeMinutes: 10) }
                Button("Bỏ qua đêm nay") { player.dismissReminder(.bedtime) }
                Button("Đóng", role: .cancel) { player.dismissReminder(.bedtime, snoozeMinutes: 30) }
            }
        } message: { kind in
            switch kind {
            case .takeBreak:
                Text("Bạn đã xem liên tục \(sleepDurationTitle(AppSettings.shared.breakReminderMinutes)). Hãy đứng dậy, uống nước và cho mắt nghỉ một chút. Đổi thời gian nhắc trong Cài đặt › Sức khỏe số.")
            case .bedtime:
                Text("Đã đến giờ đi ngủ bạn đặt. Video đã tạm dừng.")
            }
        }
    }

    private var title: String {
        switch player.reminder {
        case .bedtime: return "Đến giờ đi ngủ rồi"
        default: return "Đã đến lúc nghỉ giải lao"
        }
    }
}

extension View {
    func wellbeingReminders() -> some View {
        modifier(WellbeingReminderModifier())
    }
}
