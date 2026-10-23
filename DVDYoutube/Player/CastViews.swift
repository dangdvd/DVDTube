import SwiftUI

/// The Cast button in the player's top bar. The device list is presented from the root
/// view: the player's controls hide after a few seconds while a video plays, and a sheet
/// attached to them would close with them.
struct CastButton: View {
    @Environment(Router.self) private var router
    private var cast: CastManager { CastManager.shared }

    var body: some View {
        Button {
            router.showCastPicker = true
        } label: {
            Image(systemName: cast.isActive ? "tv.fill" : "tv")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(cast.isConnected ? Color.brand : Color.white)
                .frame(width: 38, height: 38)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Truyền tới TV (Chromecast)")
        // Look for TVs early so the list is ready when the button is tapped.
        .onAppear { cast.startDiscovery() }
    }
}

struct CastDevicesSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss
    private var cast: CastManager { CastManager.shared }

    var body: some View {
        NavigationStack {
            List {
                if let device = cast.device, cast.isActive {
                    Section("Đang kết nối") {
                        HStack(spacing: 12) {
                            Image(systemName: "tv.fill").foregroundStyle(Color.brand).font(.title3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(device.name).font(.subheadline.weight(.semibold))
                                Text(cast.statusText ?? (cast.isConnected ? "Đang truyền" : "Đang kết nối…"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if cast.state == .connecting { ProgressView() }
                        }
                        if cast.isConnected {
                            HStack {
                                Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                                Slider(value: Binding(get: { cast.volume }, set: { cast.setVolume($0) }), in: 0...1)
                                Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                            }
                        }
                        Button("Ngừng truyền", role: .destructive) {
                            cast.disconnect()
                            dismiss()
                        }
                    }
                }

                Section {
                    ForEach(cast.devices.filter { $0.id != cast.device?.id }) { device in
                        Button {
                            player.cast(to: device)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "tv").font(.title3).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(device.name).font(.subheadline.weight(.semibold))
                                    if let model = device.model {
                                        Text(model).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    if cast.devices.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Đang tìm Chromecast / Google TV…").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Thiết bị trong mạng Wi-Fi")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        if case .failed(let message) = cast.state {
                            Text(message).foregroundStyle(.red)
                        }
                        if let error = cast.discoveryError {
                            Text(error).foregroundStyle(.orange)
                        }
                        Text("Video được phát trực tiếp trên TV, không quảng cáo. iPhone và TV cần dùng chung mạng Wi-Fi. Với TV hỗ trợ AirPlay, dùng nút AirPlay bên cạnh.")
                    }
                }
            }
            .navigationTitle("Truyền tới TV")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                }
            }
        }
        .onAppear { cast.startDiscovery() }
        .onChange(of: cast.isConnected) { _, connected in
            if connected { dismiss() }
        }
    }
}

/// Shown in place of the picture while the video plays on a TV.
struct CastingBackdrop: View {
    @Environment(PlayerManager.self) private var player
    let compact: Bool
    private var cast: CastManager { CastManager.shared }

    var body: some View {
        ZStack {
            RemoteImage(url: player.currentVideo?.displayThumbnail, contentMode: .fill)
                .blur(radius: 2)
                .overlay(Color.black.opacity(0.6))
                .clipped()
            VStack(spacing: compact ? 2 : 6) {
                Image(systemName: "tv.fill")
                    .font(compact ? .body : .title)
                if !compact {
                    Text("Đang phát trên \(cast.device?.name ?? "TV")")
                        .font(.subheadline.weight(.semibold))
                    if let status = cast.statusText {
                        Text(status)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal)
            // Under the top bar, clear of the play button in the middle.
            .frame(maxHeight: .infinity, alignment: compact ? .center : .top)
            .padding(.top, compact ? 0 : 48)
        }
        .allowsHitTesting(false)
    }
}
