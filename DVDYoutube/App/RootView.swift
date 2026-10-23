import SwiftUI

struct RootView: View {
    @Environment(PlayerManager.self) private var player
    @Environment(Router.self) private var router

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

                NavigationStack(path: $router.shortsPath) {
                    ShortsView().appDestinations()
                }
                .tabItem { Label("Shorts", systemImage: "play.rectangle.on.rectangle.fill") }
                .tag(AppTab.shorts)

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
        }
        .animation(.spring(response: 0.38, dampingFraction: 0.88), value: player.currentVideo == nil)
        .task { DebugHooks.apply() }
        .sheet(item: $router.playlistSheetVideo) { video in
            SaveToPlaylistSheet(video: video)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $router.showSignIn) {
            GoogleSignInView(addsAccount: router.signInAddsAccount)
        }
        .sheet(isPresented: $router.showAccountSwitcher) {
            AccountSwitcherSheet()
                .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $router.showUpload) {
            UploadView()
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
                Text(message)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(Color.black.opacity(0.85)))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.bottom, 120)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .allowsHitTesting(false)
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
