import SwiftUI

/// The Cast button in the player's top bar. The device list is presented from the root
/// view: the player's controls hide after a few seconds while a video plays, and a sheet
/// attached to them would close with them.
struct CastButton: View {
    @Environment(Router.self) private var router
    private var cast: CastManager { CastManager.shared }
    private var dvd: DVDCast { DVDCast.shared }

    var body: some View {
        Button {
            if dvd.isConnected {
                router.showDVDRemote = true
            } else {
                router.castVideo = nil
                router.showCastPicker = true
            }
        } label: {
            Image(systemName: cast.isActive || dvd.isActive ? "tv.fill" : "tv")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(cast.isConnected || dvd.isConnected ? Color.brand : Color.white)
                .frame(width: 38, height: 38)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Truyền tới TV")
        // Look for TVs early so the list is ready when the button is tapped.
        .onAppear {
            cast.startDiscovery()
            dvd.startDiscovery()
        }
    }
}

/// DVDTube receivers (TV / computer) first, then Chromecast devices, plus adding a
/// receiver by its address.
struct CastDevicesSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    private var cast: CastManager { CastManager.shared }
    private var dvd: DVDCast { DVDCast.shared }

    @State private var showAddAddress = false
    @State private var address = ""
    @State private var addingAddress = false
    @State private var addError: String?

    var body: some View {
        NavigationStack {
            List {
                if let video = router.castVideo {
                    Section {
                        HStack(spacing: 10) {
                            RemoteImage(url: video.displayThumbnail)
                                .frame(width: 80, height: 45)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            Text(video.title).font(.subheadline).lineLimit(2)
                        }
                    } header: {
                        Text("Video sẽ truyền")
                    }
                }

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

                dvdSection

                Section {
                    ForEach(cast.devices.filter { $0.id != cast.device?.id }) { device in
                        Button {
                            if let video = router.castVideo, video.id != player.currentVideo?.id {
                                player.play(video)
                            }
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
                    Text("Chromecast / Google TV")
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
            .alert("Thêm thiết bị bằng địa chỉ IP", isPresented: $showAddAddress) {
                TextField("192.168.1.20:8766", text: $address)
                    .keyboardType(.numbersAndPunctuation)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Hủy", role: .cancel) {}
                Button("Thêm") { addAddress() }
            } message: {
                Text("Mở DVDTube trên TV hoặc máy tính để xem địa chỉ (Cài đặt › Truyền video). Dùng khi mạng chặn tìm thiết bị tự động.")
            }
        }
        .onAppear {
            cast.startDiscovery()
            dvd.startDiscovery()
        }
        .onChange(of: cast.isConnected) { _, connected in
            if connected {
                router.castVideo = nil
                dismiss()
            }
        }
        .onChange(of: dvd.isConnected) { _, connected in
            if connected {
                router.castVideo = nil
                dismiss()
                // The remote opens once this sheet has gone.
                Task {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    router.showDVDRemote = true
                }
            }
        }
    }

    @ViewBuilder
    private var dvdSection: some View {
        Section {
            if let receiver = dvd.receiver, dvd.isActive {
                HStack(spacing: 12) {
                    Image(systemName: receiver.kind == "desktop" ? "desktopcomputer" : "tv.fill").foregroundStyle(Color.brand).font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(receiver.name).font(.subheadline.weight(.semibold))
                        Text(dvd.isConnected ? "Đang truyền" : "Đang kết nối…").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if dvd.state == .connecting { ProgressView() }
                }
                if dvd.isConnected {
                    Button("Mở điều khiển") {
                        dismiss()
                        Task {
                            try? await Task.sleep(nanoseconds: 600_000_000)
                            router.showDVDRemote = true
                        }
                    }
                }
                Button("Ngắt kết nối", role: .destructive) { dvd.disconnect() }
            }
            ForEach(dvd.receivers.filter { $0.id != dvd.receiver?.id || !dvd.isActive }) { receiver in
                Button {
                    player.cast(to: receiver, video: router.castVideo)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: receiver.icon).font(.title3).foregroundStyle(.secondary).frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(receiver.name).font(.subheadline.weight(.semibold))
                            Text(receiver.isManual ? "\(receiver.kindTitle) • \(receiver.address ?? "")" : receiver.kindTitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions {
                    if receiver.isManual {
                        Button("Xóa", role: .destructive) { dvd.removeManual(receiver) }
                    }
                }
            }
            Button {
                address = ""
                addError = nil
                showAddAddress = true
            } label: {
                HStack {
                    Label("Thêm thiết bị bằng địa chỉ IP", systemImage: "plus.circle")
                    if addingAddress {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(addingAddress)
        } header: {
            Text("DVDTube trên TV / máy tính")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if case .failed(let message) = dvd.state {
                    Text(message).foregroundStyle(.red)
                }
                if let addError {
                    Text(addError).foregroundStyle(.red)
                }
                Text("TV (Android TV) hoặc máy tính đang mở DVDTube tự tải video ở chất lượng cao nhất; iPhone chỉ gửi mã video và điều khiển, không gửi tài khoản hay cookie.")
            }
        }
    }

    private func addAddress() {
        let text = address
        addingAddress = true
        addError = nil
        Task {
            defer { addingAddress = false }
            do {
                let receiver = try await dvd.addManual(text)
                player.cast(to: receiver, video: router.castVideo)
            } catch {
                addError = error.localizedDescription
            }
        }
    }
}

/// "Đang phát trên <tên>": remote control for DVDTube on a TV / computer.
struct DVDRemoteSheet: View {
    @Environment(PlayerManager.self) private var player
    @Environment(\.dismiss) private var dismiss
    private var dvd: DVDCast { DVDCast.shared }

    @State private var scrub: Double?
    @State private var volume: Double?

    var body: some View {
        NavigationStack {
            let status = dvd.status
            let video = status.video ?? player.currentVideo
            ScrollView {
                VStack(spacing: 18) {
                    Text("Đang phát trên \(dvd.receiver?.name ?? "TV")")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    RemoteImage(url: video?.displayThumbnail)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay {
                            if status.state == "loading" || status.state == "buffering" {
                                ProgressView().tint(.white).controlSize(.large)
                            }
                        }
                    VStack(spacing: 4) {
                        Text(video?.title ?? "")
                            .font(.headline)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                        if let channel = video?.channelName {
                            Text(channel).font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let error = status.error, !error.isEmpty {
                            Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                        }
                    }

                    VStack(spacing: 2) {
                        Slider(
                            value: Binding(get: { scrub ?? status.position },
                                           set: { scrub = $0 }),
                            in: 0...max(status.duration, max(status.position, 1)),
                            onEditingChanged: { editing in
                                if !editing, let target = scrub {
                                    dvd.control("seek", value: target)
                                    scrub = nil
                                }
                            }
                        )
                        HStack {
                            Text(formatTime(scrub ?? status.position))
                            Spacer()
                            Text(formatTime(status.duration))
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 28) {
                        Button { dvd.control("previous") } label: {
                            Image(systemName: "backward.end.fill").font(.title2)
                        }
                        Button { dvd.control("skip", value: -10) } label: {
                            Image(systemName: "gobackward.10").font(.title2)
                        }
                        Button { dvd.control(status.isPlaying ? "pause" : "play") } label: {
                            Image(systemName: status.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                .font(.system(size: 60))
                        }
                        Button { dvd.control("skip", value: 10) } label: {
                            Image(systemName: "goforward.10").font(.title2)
                        }
                        Button { dvd.control("next") } label: {
                            Image(systemName: "forward.end.fill").font(.title2)
                        }
                    }
                    .buttonStyle(.plain)

                    HStack(spacing: 12) {
                        Button {
                            dvd.control("mute", value: status.muted ? 0 : 1)
                        } label: {
                            Image(systemName: status.muted ? "speaker.slash.fill" : "speaker.fill")
                                .foregroundStyle(.secondary)
                                .frame(width: 28)
                        }
                        .buttonStyle(.plain)
                        Slider(
                            value: Binding(get: { volume ?? status.volume }, set: { volume = $0 }),
                            in: 0...1,
                            onEditingChanged: { editing in
                                if !editing, let level = volume {
                                    dvd.control("volume", value: level)
                                    volume = nil
                                }
                            }
                        )
                        Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                    }

                    if status.queue.count > 1 {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Hàng đợi trên TV (\(min(max(status.index + 1, 1), status.queue.count))/\(status.queue.count))")
                                .font(.subheadline.weight(.semibold))
                            ForEach(Array(status.queue.enumerated().dropFirst(max(status.index + 1, 0)).prefix(5)), id: \.offset) { _, item in
                                HStack(spacing: 10) {
                                    RemoteImage(url: item.displayThumbnail)
                                        .frame(width: 72, height: 40)
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                    Text(item.title).font(.caption).lineLimit(2)
                                    Spacer(minLength: 0)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(spacing: 10) {
                        Button {
                            dvd.continueHere()
                            dismiss()
                        } label: {
                            Label("Tiếp tục trên thiết bị này", systemImage: "iphone")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        Button(role: .destructive) {
                            dvd.disconnect()
                            dismiss()
                        } label: {
                            Label("Ngắt kết nối", systemImage: "xmark.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                    .controlSize(.large)
                }
                .padding(20)
            }
            .navigationTitle("Điều khiển")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                }
            }
        }
        .onAppear { dvd.remoteVisible = true }
        .onDisappear { dvd.remoteVisible = false }
        .onChange(of: dvd.isConnected) { _, connected in
            if !connected { dismiss() }
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
                Image(systemName: DVDCast.shared.isConnected && DVDCast.shared.receiver?.kind == "desktop" ? "desktopcomputer" : "tv.fill")
                    .font(compact ? .body : .title)
                if !compact {
                    Text("Đang phát trên \(player.castDeviceName ?? "TV")")
                        .font(.subheadline.weight(.semibold))
                    if let status = cast.statusText {
                        Text(status)
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white.opacity(0.8))
                    } else if DVDCast.shared.isConnected {
                        Text("Nhấn nút TV phía trên để mở điều khiển")
                            .font(.caption)
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
