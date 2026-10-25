import SwiftUI

struct RootView: View {
    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router
    private var parental: ParentalControls { ParentalControls.shared }
    private var updates: UpdateChecker { UpdateChecker.shared }

    var body: some View {
        @Bindable var router = router
        ZStack(alignment: .bottom) {
            TabView(selection: tabSelection) {
                NavigationStack(path: $router.homePath) {
                    HomeView().appDestinations()
                }
                .miniPlayerInset()
                .tabItem { Label("Trang chủ", systemImage: "house.fill") }
                .tag(AppTab.home)

                if !parental.shortsHidden {
                    NavigationStack(path: $router.shortsPath) {
                        ShortsView().appDestinations()
                    }
                    .tabItem { Label("Shorts", systemImage: "play.rectangle.on.rectangle.fill") }
                    .tag(AppTab.shorts)
                }

                NavigationStack(path: $router.subscriptionsPath) {
                    SubscriptionsView().appDestinations()
                }
                .miniPlayerInset()
                .tabItem { Label("Kênh đăng ký", systemImage: "play.square.stack.fill") }
                .tag(AppTab.subscriptions)

                NavigationStack(path: $router.libraryPath) {
                    LibraryView().appDestinations()
                }
                .miniPlayerInset()
                .tabItem { Label("Bạn", systemImage: "person.crop.circle.fill") }
                .tag(AppTab.library)
            }

            if player.currentVideo != nil, !(router.selectedTab == .shorts && !player.isExpanded) {
                PlayerContainerView()
                    .transition(.move(edge: .bottom))
            }

            ToastOverlay()

            if let reason = parental.lockReason {
                ParentalLockView(reason: reason)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .animation(.spring(response: 0.38, dampingFraction: 0.88), value: player.currentVideo == nil)
        .animation(.easeInOut(duration: 0.25), value: parental.lockReason)
        .onChange(of: parental.shortsHidden) { _, hidden in
            if hidden, router.selectedTab == .shorts { router.selectedTab = .home }
        }
        .wellbeingReminders()
        .task { DebugHooks.apply() }
        .sheet(item: $router.playlistSheetVideo) { video in
            SaveToPlaylistSheet(video: video)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $router.showSignIn) {
            // Signing in needs the parental PIN when parental controls are on.
            ParentalGate(title: "Nhập mã PIN để đăng nhập") {
                GoogleSignInView(addsAccount: router.signInAddsAccount)
            }
        }
        .sheet(isPresented: $router.showCastPicker, onDismiss: { router.castVideo = nil }) {
            CastDevicesSheet()
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $router.showDVDRemote) {
            DVDRemoteSheet()
                .presentationDetents([.large])
        }
        .sheet(isPresented: $router.showMusicPlayer) {
            MusicPlayerView()
        }
        .alert(
            "Có bản mới v\(updates.available?.version ?? "")",
            isPresented: Binding(get: { updates.available != nil }, set: { if !$0 { updates.available = nil } }),
            presenting: updates.available
        ) { release in
            Button("Mở trang tải") { UIApplication.shared.open(release.page) }
            Button("Để sau", role: .cancel) {}
        } message: { release in
            Text((release.notes.isEmpty ? "" : release.notes + "\n\n") + "Cài lại bằng SideStore/AltStore để cập nhật, dữ liệu được giữ nguyên.")
        }
        .sheet(isPresented: $router.showAccountSwitcher) {
            AccountSwitcherSheet()
                .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $router.showUpload) {
            UploadView()
        }
        // A video picked while the DVDTube TV / PC plays something: queue it instead of replacing (karaoke).
        .confirmationDialog(
            "Phát trên \(DVDCast.shared.receiver?.name ?? "TV")",
            isPresented: Binding(get: { player.castChoice != nil }, set: { if !$0 { player.castChoice = nil } }),
            titleVisibility: .visible,
            presenting: player.castChoice
        ) { video in
            Button("Phát ngay") { player.castPlayNow(video) }
            Button("Phát tiếp theo") { player.castQueue(video, next: true) }
            Button("Thêm vào cuối hàng đợi") { player.castQueue(video, next: false) }
            Button("Hủy", role: .cancel) {}
        } message: { video in
            Text("\(video.title)\n\(DVDCast.shared.receiver?.name ?? "TV") đang phát video khác.")
        }
    }

    /// Detects taps on the already-selected tab (pop to root / scroll to top).
    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { router.selectedTab },
            set: { tab in
                if tab == router.selectedTab { router.reselect(tab) }
                router.selectedTab = tab
            }
        )
    }
}

struct ToastOverlay: View {
    @Environment(PlayerManager.self) private var player

    var body: some View {
        VStack {
            if let message = player.toastMessage {
                HStack(spacing: 12) {
                    Text(message)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    if let action = player.toastAction {
                        Button(action.title) { player.runToastAction() }
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(Color.brand)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Capsule().fill(Color.black.opacity(0.85)))
                .padding(.horizontal, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .padding(.bottom, 120)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        // Only the toast's button takes touches; the rest of the screen stays usable.
        .allowsHitTesting(player.toastAction != nil)
        .animation(.easeInOut(duration: 0.25), value: player.toastMessage)
    }
}

private struct MiniPlayerInset: ViewModifier {
    @Environment(PlayerManager.self) private var player

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            // Leave room so the last rows are not hidden behind the mini player.
            if player.currentVideo != nil {
                Color.clear.frame(height: PlayerContainerView.miniHeight)
            }
        }
    }
}

extension View {
    func miniPlayerInset() -> some View {
        modifier(MiniPlayerInset())
    }
}
