import SwiftUI

/// Four-digit PIN entry (auto-submits on the fourth digit).
struct PINEntryView: View {
    let title: String
    var message: String?
    var showsForgot = true
    /// Returns false when the PIN is wrong (the field clears and shakes).
    var onSubmit: (String) -> Bool
    var onForgot: (() -> Void)?

    @State private var pin = ""
    @State private var wrong = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.brand)
            Text(title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            if let message {
                Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            HStack(spacing: 14) {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .fill(index < pin.count ? Color.primary : Color.clear)
                        .overlay(Circle().stroke(Color.secondary, lineWidth: 1.5))
                        .frame(width: 16, height: 16)
                }
            }
            .offset(x: wrong ? 8 : 0)
            .animation(wrong ? Animation.default.repeatCount(3, autoreverses: true).speed(4) : Animation.default, value: wrong)
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
            if wrong {
                Text("Mã PIN không đúng").font(.footnote).foregroundStyle(.red)
            }
            // The real input: a hidden number field.
            SecureField("", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focused)
                .frame(width: 1, height: 1)
                .opacity(0.02)
                .onChange(of: pin) { _, value in
                    let digits = String(value.filter(\.isNumber).prefix(4))
                    if digits != value { pin = digits; return }
                    if digits.count == 4 {
                        if onSubmit(digits) {
                            wrong = false
                        } else {
                            wrong = true
                            pin = ""
                        }
                    } else if !digits.isEmpty {
                        wrong = false
                    }
                }
            if showsForgot, let onForgot {
                Button("Quên mã PIN") { onForgot() }
                    .font(.footnote)
            }
        }
        .padding(24)
        .onAppear { focused = true }
    }
}

/// Shows `content` only after the parental PIN (when parental controls are on).
struct ParentalGate<Content: View>: View {
    var title = "Nhập mã PIN của phụ huynh"
    @ViewBuilder var content: () -> Content

    @State private var unlocked = false
    @State private var confirmReset = false
    private var parental: ParentalControls { ParentalControls.shared }

    var body: some View {
        if !parental.isEnabled || unlocked {
            content()
        } else {
            PINEntryView(title: title, onSubmit: { pin in
                guard parental.verify(pin) else { return false }
                unlocked = true
                return true
            }, onForgot: { confirmReset = true })
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemBackground))
            .confirmationDialog("Đặt lại kiểm soát của phụ huynh?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Đặt lại và tắt", role: .destructive) {
                    parental.resetAll()
                    unlocked = true
                }
            } message: {
                Text("Không có cách khôi phục mã PIN. Mọi cài đặt kiểm soát của phụ huynh sẽ bị xóa và tắt.")
            }
        }
    }
}

/// A sheet asking for the PIN before an action (signing out…); runs it when correct.
struct PINPromptSheet: View {
    let title: String
    let action: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PINEntryView(title: title, showsForgot: false, onSubmit: { pin in
                guard ParentalControls.shared.verify(pin) else { return false }
                dismiss()
                action()
                return true
            })
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() } }
            }
        }
        .presentationDetents([.medium])
    }
}

/// Settings › "Kiểm soát của phụ huynh".
struct ParentalControlsView: View {
    @State private var newPIN = ""
    @State private var confirmStep = false
    @State private var firstPIN = ""
    @State private var setupError: String?
    @State private var changingPIN = false
    @State private var confirmDisable = false

    private var parental: ParentalControls { ParentalControls.shared }

    var body: some View {
        Group {
            if parental.isEnabled {
                ParentalGate {
                    options
                }
            } else {
                setup
            }
        }
        .navigationTitle("Kiểm soát của phụ huynh")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var setup: some View {
        ScrollView {
            VStack(spacing: 16) {
                PINEntryView(
                    title: confirmStep ? "Nhập lại mã PIN" : "Đặt mã PIN 4 chữ số",
                    message: confirmStep ? nil : "Mã PIN dùng để mở khóa khi hết giờ xem, đổi cài đặt trong mục này, đăng nhập/đăng xuất hoặc tắt kiểm soát của phụ huynh. Hãy ghi nhớ: không có cách khôi phục mã.",
                    showsForgot: false,
                    onSubmit: { pin in
                        if !confirmStep {
                            firstPIN = pin
                            confirmStep = true
                            setupError = nil
                            return true
                        }
                        guard pin == firstPIN else {
                            confirmStep = false
                            firstPIN = ""
                            setupError = "Hai lần nhập không khớp. Hãy đặt lại."
                            return false
                        }
                        parental.enable(pin: pin)
                        return true
                    }
                )
                .id(confirmStep)
                if let setupError {
                    Text(setupError).font(.footnote).foregroundStyle(.red)
                }
            }
        }
    }

    private var options: some View {
        @Bindable var parental = parental
        return Form {
            Section {
                Toggle("Chế độ hạn chế", isOn: $parental.restrictedMode)
            } footer: {
                Text("YouTube ẩn video có thể không phù hợp với trẻ em; video giới hạn độ tuổi bị chặn khi phát.")
            }

            Section {
                Picker("Giới hạn thời gian xem mỗi ngày", selection: $parental.dailyLimitMinutes) {
                    ForEach(ParentalControls.limitOptions, id: \.self) { minutes in
                        Text(minutes == 0 ? "Tắt" : sleepDurationTitle(minutes)).tag(minutes)
                    }
                }
                if parental.dailyLimitMinutes > 0 {
                    LabeledContent("Đã xem hôm nay", value: sleepDurationTitle(Int(parental.secondsToday / 60)))
                    if let left = parental.minutesLeftToday {
                        LabeledContent("Còn lại", value: sleepDurationTitle(left))
                    }
                }
                Toggle("Khung giờ được xem", isOn: $parental.hoursEnabled)
                if parental.hoursEnabled {
                    DatePicker("Từ", selection: minutes($parental.hoursStart), displayedComponents: .hourAndMinute)
                    DatePicker("Đến", selection: minutes($parental.hoursEnd), displayedComponents: .hourAndMinute)
                }
            } header: {
                Text("Thời gian xem")
            } footer: {
                Text("Tính thời gian phát thực tế (video, Shorts, nghe nhạc) theo từng ngày. Khi hết giờ hoặc ngoài khung giờ, video dừng và màn hình khóa hiện ra; nhập mã PIN để thêm 15 phút, 30 phút hoặc bỏ giới hạn hết hôm nay.")
            }

            Section {
                TextEditor(text: $parental.blockedKeywords)
                    .frame(minHeight: 90)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            } header: {
                Text("Chặn từ khóa")
            } footer: {
                Text("Mỗi từ cách nhau bằng dấu phẩy hoặc xuống dòng. Video có tiêu đề hoặc tên kênh chứa từ này (không phân biệt hoa thường và dấu) bị ẩn khỏi trang chủ, tìm kiếm, video liên quan và Shorts.")
            }

            Section {
                NavigationLink {
                    HiddenContentView()
                } label: {
                    LabeledContent("Chặn kênh", value: "\(HiddenContentStore.shared.channels.count)")
                }
                Toggle("Ẩn bình luận", isOn: $parental.hideComments)
                Toggle("Ẩn Shorts", isOn: $parental.hideShorts)
                Toggle("Tắt tìm kiếm", isOn: $parental.disableSearch)
            } header: {
                Text("Nội dung")
            }

            Section {
                Button("Đổi mã PIN") { changingPIN = true }
                Button("Tắt kiểm soát của phụ huynh", role: .destructive) { confirmDisable = true }
            } footer: {
                Text("Mã PIN được lưu dạng băm (SHA-256 có muối) chỉ trên thiết bị này.")
            }
        }
        .sheet(isPresented: $changingPIN) {
            NavigationStack {
                ChangePINView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Hủy") { changingPIN = false } }
                    }
            }
        }
        .confirmationDialog("Tắt kiểm soát của phụ huynh?", isPresented: $confirmDisable, titleVisibility: .visible) {
            Button("Tắt", role: .destructive) { parental.disable() }
        }
    }

    private func minutes(_ value: Binding<Int>) -> Binding<Date> {
        Binding(
            get: {
                Calendar.current.date(bySettingHour: value.wrappedValue / 60, minute: value.wrappedValue % 60, second: 0, of: Date()) ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                value.wrappedValue = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
            }
        )
    }
}

private struct ChangePINView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var first: String?

    var body: some View {
        PINEntryView(title: first == nil ? "Mã PIN mới" : "Nhập lại mã PIN mới", showsForgot: false, onSubmit: { pin in
            guard let first else {
                self.first = pin
                return true
            }
            guard pin == first else {
                self.first = nil
                return false
            }
            ParentalControls.shared.setPIN(pin)
            PlayerManager.shared.showToast("Đã đổi mã PIN")
            dismiss()
            return true
        })
        .id(first == nil)
        .navigationTitle("Đổi mã PIN")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Full-screen lock: "Đã hết thời gian xem hôm nay" / outside the allowed hours.
struct ParentalLockView: View {
    let reason: ParentalControls.LockReason

    @State private var unlocking = false
    @State private var unlocked = false
    @State private var confirmReset = false
    private var parental: ParentalControls { ParentalControls.shared }

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            if unlocked {
                VStack(spacing: 14) {
                    Text("Cho phép xem thêm").font(.title3.weight(.semibold))
                    Button("+15 phút") { grant(15) }.buttonStyle(.borderedProminent)
                    Button("+30 phút") { grant(30) }.buttonStyle(.bordered)
                    Button("Hết hôm nay") { grant(nil) }.buttonStyle(.bordered)
                    Button("Hủy") { unlocked = false; unlocking = false }.font(.footnote)
                }
                .controlSize(.large)
            } else if unlocking {
                PINEntryView(title: "Nhập mã PIN của phụ huynh", onSubmit: { pin in
                    guard parental.verify(pin) else { return false }
                    unlocked = true
                    return true
                }, onForgot: { confirmReset = true })
            } else {
                VStack(spacing: 16) {
                    Image(systemName: reason == .dailyLimit ? "hourglass.bottomhalf.filled" : "moon.stars.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(Color.brand)
                    Text(reason == .dailyLimit ? "Đã hết thời gian xem hôm nay" : "Ngoài khung giờ được xem")
                        .font(.title2.weight(.bold))
                        .multilineTextAlignment(.center)
                    Text(reason == .dailyLimit
                        ? "Hãy nghỉ ngơi và quay lại vào ngày mai nhé."
                        : "Có thể xem từ \(timeText(parental.hoursStart)) đến \(timeText(parental.hoursEnd)).")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Phụ huynh mở khóa") { unlocking = true }
                        .buttonStyle(.bordered)
                        .padding(.top, 8)
                }
                .padding(32)
            }
        }
        .confirmationDialog("Đặt lại kiểm soát của phụ huynh?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Đặt lại và tắt", role: .destructive) { parental.resetAll() }
        } message: {
            Text("Không có cách khôi phục mã PIN. Mọi cài đặt kiểm soát của phụ huynh sẽ bị xóa và tắt.")
        }
    }

    private func grant(_ minutes: Int?) {
        parental.grant(minutes: minutes)
        unlocked = false
        unlocking = false
    }

    private func timeText(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }
}

/// Shown instead of search when parental controls turned it off.
struct SearchDisabledView: View {
    var body: some View {
        ContentUnavailableView(
            "Tìm kiếm đã bị tắt",
            systemImage: "magnifyingglass",
            description: Text("Phụ huynh đã tắt tìm kiếm trong Kiểm soát của phụ huynh.")
        )
        .navigationBarTitleDisplayMode(.inline)
    }
}
