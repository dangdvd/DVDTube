import SwiftUI

/// Any page of the signed-in account (history, watch later, liked videos, playlists…).
struct AccountFeedView: View {
    let title: String
    let browseId: String

    @State private var model: FeedModel

    init(title: String, browseId: String) {
        self.title = title
        self.browseId = browseId
        _model = State(initialValue: FeedModel { try await YouTubeService.shared.accountFeed(browseId) })
    }

    var body: some View {
        ScrollView {
            if model.isLoading && model.items.isEmpty {
                LoadingStateView()
            } else if let error = model.error, model.items.isEmpty {
                ErrorStateView(message: error) { Task { await model.load(force: true) } }
            } else if model.items.isEmpty, model.hasLoaded {
                ContentUnavailableView("Chưa có nội dung", systemImage: "tray")
                    .padding(.top, 60)
            } else {
                if browseId.hasPrefix("VL"), !model.videos.isEmpty {
                    PlayAllButtons(videos: model.videos)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
                FeedList(items: model.items, isLoadingMore: model.isLoadingMore, compact: true) {
                    Task { await model.loadMore() }
                }
                .padding(.vertical, 8)
            }
        }
        .refreshable { await model.load(force: true) }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load() }
    }
}

/// Header of the "Bạn" tab: account card when signed in, sign-in prompt otherwise.
struct AccountHeader: View {
    @Environment(AccountStore.self) private var account
    @Environment(Router.self) private var router
    @State private var confirmSignOut = false

    var body: some View {
        if account.isSignedIn {
            HStack(spacing: 14) {
                AvatarView(url: account.profile?.avatar, size: 56, name: account.profile?.name ?? "")
                VStack(alignment: .leading, spacing: 3) {
                    Text(account.profile?.name ?? "Tài khoản YouTube")
                        .font(.title3.weight(.bold))
                    Text([account.profile?.handle, account.profile?.email].compactMap { $0 }.joined(separator: " • "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let error = account.lastError {
                        Text(error).font(.caption2).foregroundStyle(.orange).lineLimit(2)
                    }
                }
                Spacer()
                Menu {
                    Button {
                        Task { await account.refresh() }
                    } label: {
                        Label("Làm mới tài khoản", systemImage: "arrow.clockwise")
                    }
                    Button(role: .destructive) {
                        confirmSignOut = true
                    } label: {
                        Label("Đăng xuất", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3)
                }
            }
            .confirmationDialog("Đăng xuất khỏi tài khoản Google?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Đăng xuất", role: .destructive) {
                    Task { await account.signOut() }
                }
            } message: {
                Text("Dữ liệu trên thiết bị (tải xuống, danh sách phát riêng) vẫn được giữ lại.")
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 14) {
                    Image("Logo")
                        .resizable()
                        .frame(width: 56, height: 56)
                        .clipShape(Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Thư viện của bạn").font(.title3.weight(.bold))
                        Text("Không quảng cáo • Lưu trên thiết bị")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Button {
                    router.showSignIn = true
                } label: {
                    Label("Đăng nhập tài khoản Google", systemImage: "person.crop.circle.badge.plus")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                Text("Đăng nhập để xem đề xuất, kênh đăng ký, nhật ký xem, video đã thích và danh sách phát từ tài khoản YouTube của bạn.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The account's YouTube notifications (the bell in the official app).
struct NotificationsView: View {
    @Environment(AccountStore.self) private var account
    @Environment(PlayerManager.self) private var player
    @State private var items: [AccountNotification] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        List {
            ForEach(items) { item in
                Button {
                    if let videoId = item.videoId {
                        player.play(VideoItem(id: videoId, title: "", thumbnail: item.thumbnail))
                    }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Circle()
                            .fill(item.isRead ? Color.clear : Color.brand)
                            .frame(width: 6, height: 6)
                            .padding(.top, 18)
                        AvatarView(url: item.avatar, size: 40)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.message)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                                .lineLimit(3)
                            if let time = item.timeText {
                                Text(time).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                        if let thumbnail = item.thumbnail {
                            RemoteImage(url: thumbnail)
                                .frame(width: 96, height: 54)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .overlay {
            if isLoading && items.isEmpty {
                ProgressView()
            } else if let error, items.isEmpty {
                ErrorStateView(message: error) { Task { await load() } }
            } else if items.isEmpty {
                ContentUnavailableView("Chưa có thông báo", systemImage: "bell.slash")
            }
        }
        .refreshable { await load() }
        .navigationTitle("Thông báo")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await YouTubeService.shared.accountNotifications()
            error = nil
            account.markNotificationsSeen()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Bell button with the unseen-count badge.
struct NotificationBell: View {
    @Environment(AccountStore.self) private var account
    @Environment(Router.self) private var router

    var body: some View {
        Button {
            router.open(.notifications)
        } label: {
            Image(systemName: "bell")
                .overlay(alignment: .topTrailing) {
                    if account.unseenNotifications > 0 {
                        Text(account.unseenNotifications > 9 ? "9+" : "\(account.unseenNotifications)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.red))
                            .offset(x: 8, y: -6)
                    }
                }
        }
        .accessibilityLabel("Thông báo")
    }
}
