import SwiftUI

/// "Bộ chỉnh âm (EQ)": presets for popular kinds of music and ten bands to adjust by hand.
struct EqualizerView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(PlayerManager.self) private var player

    var body: some View {
        @Bindable var settings = settings
        List {
            Section {
                Toggle("Bật bộ chỉnh âm", isOn: $settings.eqEnabled)
            } footer: {
                Text("Trên iPhone, khi bật EQ ứng dụng phát luồng MP4 thay cho HLS nên có thể mất thêm chút thời gian để bắt đầu; video trực tiếp không áp dụng EQ.")
            }

            Section("Cài đặt sẵn") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(EQPreset.all) { preset in
                            presetChip(preset.name, selected: settings.eqPresetID == preset.id) {
                                settings.eqPresetID = preset.id
                                if !settings.eqEnabled { settings.eqEnabled = true }
                            }
                        }
                        presetChip("Tùy chỉnh", selected: settings.eqPresetID == EQPreset.customID) {
                            settings.eqPresetID = EQPreset.customID
                            if !settings.eqEnabled { settings.eqEnabled = true }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            }

            Section {
                ResponseCurve(gains: settings.eqGains, preampDb: settings.eqPreampDb)
                    .stroke(Color.brand, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .background(
                        ResponseGrid().stroke(Color.secondary.opacity(0.25), lineWidth: 0.5)
                    )
                    .frame(height: 90)
                    .padding(.vertical, 6)
                    .opacity(settings.eqEnabled ? 1 : 0.4)
                bandSliders
                    .opacity(settings.eqEnabled ? 1 : 0.4)
                    .disabled(!settings.eqEnabled)
            } header: {
                Text("Dải tần (dB)")
            } footer: {
                Text("Kéo một thanh để tạo cài đặt Tùy chỉnh của riêng bạn.")
            }

            Section {
                Toggle("Tiền khuếch đại tự động", isOn: $settings.eqPreampAuto)
                if !settings.eqPreampAuto {
                    VStack(alignment: .leading) {
                        Text("Tiền khuếch đại: \(signed(settings.eqPreamp)) dB").font(.subheadline)
                        Slider(value: $settings.eqPreamp, in: -12...6, step: 0.5)
                    }
                }
            } header: {
                Text("Âm lượng")
            } footer: {
                Text("Tự động giảm âm lượng tổng khi tăng các dải tần để tránh vỡ tiếng.")
            }

            Section {
                Button("Đặt lại", role: .destructive) {
                    settings.eqPresetID = EQPreset.flat.id
                    settings.eqCustomGains = [Double](repeating: 0, count: EQBand.count)
                    settings.eqPreampAuto = true
                    settings.eqPreamp = 0
                }
            }
        }
        .navigationTitle("Bộ chỉnh âm (EQ)")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: settings.eqIsActive) { _, _ in
            player.equalizerSettingsChanged()
        }
    }

    private var bandSliders: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(0..<EQBand.count, id: \.self) { index in
                VStack(spacing: 6) {
                    Text(signed(settings.eqGains[index]))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Slider(value: gainBinding(index), in: EQBand.range, step: 0.5)
                        .frame(width: 150)
                        .rotationEffect(.degrees(-90))
                        .frame(width: 30, height: 150)
                    Text(EQBand.labels[index])
                        .font(.caption2.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 6)
    }

    /// Editing a band turns the current preset into the custom setting.
    private func gainBinding(_ index: Int) -> Binding<Double> {
        Binding(
            get: { settings.eqGains[index] },
            set: { value in
                var gains = settings.eqGains
                gains[index] = value
                settings.eqCustomGains = gains
                if settings.eqPresetID != EQPreset.customID { settings.eqPresetID = EQPreset.customID }
            }
        )
    }

    private func presetChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .foregroundStyle(selected ? Color(.systemBackground) : Color.primary)
                .background(RoundedRectangle(cornerRadius: 8).fill(selected ? Color.primary : Color(.secondarySystemFill)))
        }
        .buttonStyle(.plain)
    }

    private func signed(_ value: Double) -> String {
        let text = String(format: "%g", (value * 2).rounded() / 2)
        return value > 0 ? "+" + text : text
    }
}

/// The combined frequency response of the bands (−12…+12 dB), on a log frequency axis.
private struct ResponseCurve: Shape {
    let gains: [Double]
    let preampDb: Double

    func path(in rect: CGRect) -> Path {
        let sampleRate = 48_000.0
        let filters = Biquad.bands(gains: gains, sampleRate: sampleRate)
        var path = Path()
        let steps = 120
        for step in 0...steps {
            let fraction = Double(step) / Double(steps)
            let frequency = 20 * pow(1000, fraction)  // 20 Hz → 20 kHz
            let db = filters.reduce(preampDb) { $0 + $1.responseDb(at: frequency, sampleRate: sampleRate) }
            let clamped = min(max(db, -15), 15)
            let point = CGPoint(x: rect.minX + rect.width * CGFloat(fraction),
                                y: rect.midY - rect.height / 2 * CGFloat(clamped / 15))
            if step == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }
}

private struct ResponseGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for fraction in [0.0, 0.5, 1.0] {
            let y = rect.minY + rect.height * CGFloat(fraction)
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
        }
        return path
    }
}
