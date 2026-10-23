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
