import Foundation
import Observation
import WebKit

/// Signed-in Google/YouTube account: profile, subscriptions and the actions that are
/// written back to YouTube (subscribe, like, watch later, watch history).
@MainActor
@Observable
final class AccountStore {
    static let shared = AccountStore()

    private(set) var isSignedIn: Bool
    private(set) var profile: AccountProfile?
    private(set) var subscribedChannels: [ChannelItem] = []
    private(set) var isRefreshing = false
    private(set) var lastError: String?
    private(set) var unseenNotifications = 0
    /// Google accounts and brand channels available in this session.
    private(set) var identities: [AccountIdentity] = []
    /// Changes whenever requests start running as a different account or channel;
    /// feeds observe it to reload.
    private(set) var sessionKey: String

    var syncWatchHistory: Bool {
        didSet { UserDefaults.standard.set(syncWatchHistory, forKey: Self.syncHistoryKey) }
    }

    /// Changes made in this session (or learned from watch pages) that win over the
    /// possibly stale subscription list.
    private var subscriptionState: [String: Bool] = [:]
    /// "LIKE", "DISLIKE" or "INDIFFERENT" per video, set in this session.
    private var ratingState: [String: String] = [:]
    private var watchLaterState: [String: Bool] = [:]
    @ObservationIgnored private var reportedWatched: Set<String> = []

    private static let profileKey = "account.profile"
    private static let syncHistoryKey = "account.syncHistory"

    private init() {
        UserDefaults.standard.register(defaults: [Self.syncHistoryKey: true])
        syncWatchHistory = UserDefaults.standard.bool(forKey: Self.syncHistoryKey)
        isSignedIn = AuthSession.shared.isAuthenticated
        sessionKey = Self.makeSessionKey(signedIn: AuthSession.shared.isAuthenticated)
        if isSignedIn, let data = UserDefaults.standard.data(forKey: Self.profileKey) {
            profile = try? JSONDecoder().decode(AccountProfile.self, from: data)
        }
        if isSignedIn {
            Task { await self.refresh() }
        }
    }

    // MARK: Sign in / out

    /// Validates the cookies with YouTube and stores them. Returns an error message on failure.
    /// `addingAccount`: the cookies now also hold another Google account; switch to it.
    func completeSignIn(cookies: [String: String], fromWebLogin: Bool, addingAccount: Bool = false) async -> String? {
        guard AuthSession.hasAuthCookies(cookies) else {
            return "Không tìm thấy cookie đăng nhập YouTube (cần LOGIN_INFO và SAPISID)."
        }
        let previousCookies = AuthSession.shared.cookieList
        let previousIdentity = AuthSession.shared.currentIdentity
        AuthSession.shared.replace(with: cookies)
        if !addingAccount { AuthSession.shared.setIdentity(.init()) }
        do {
            guard let profile = try await YouTubeService.shared.accountProfile() else {
                throw SignInRejected()
            }
            self.profile = profile
            saveProfile()
            isSignedIn = true
            lastError = nil
            if !fromWebLogin { await Self.installInWebKit(cookies) }
            if addingAccount {
                await loadIdentities()
                // The account added last gets the highest index.
                if let added = identities.filter({ !$0.isBrandAccount }).max(by: { $0.authUser < $1.authUser }),
                   added.authUser != AuthSession.shared.currentIdentity.authUser {
                    await switchTo(added)
                    return nil
                }
            }
            resetAccountState()
            Task { await refreshSubscriptions() }
            Task { await loadIdentities() }
            return nil
        } catch {
            if addingAccount, AuthSession.hasAuthCookies(previousCookies) {
                // Keep the account that was already signed in.
                AuthSession.shared.replace(with: previousCookies)
                AuthSession.shared.setIdentity(previousIdentity)
            } else {
                AuthSession.shared.clear()
            }
            if error is SignInRejected {
                return "YouTube không chấp nhận phiên đăng nhập này. Hãy thử đăng nhập lại."
            }
            return error.localizedDescription
        }
    }

    // MARK: Accounts & brand channels

    func loadIdentities() async {
        guard isSignedIn else { return }
        do {
            var list = try await YouTubeService.shared.accountIdentities()
            // Mark the identity requests actually run as (YouTube's own flag follows authuser 0).
            let current = AuthSession.shared.currentIdentity
            if list.contains(where: { $0.authUser == current.authUser && $0.pageId == current.pageId }) {
                for index in list.indices {
                    list[index].isSelected = list[index].authUser == current.authUser && list[index].pageId == current.pageId
                }
            }
            identities = list
        } catch {
            Log.debug("account identities failed: \(error.localizedDescription)")
        }
    }

    var currentIdentity: AccountIdentity? {
        let current = AuthSession.shared.currentIdentity
        return identities.first { $0.authUser == current.authUser && $0.pageId == current.pageId }
    }

    /// Runs every following request as another Google account or brand channel.
    func switchTo(_ identity: AccountIdentity) async {
        AuthSession.shared.setIdentity(.init(authUser: identity.authUser, pageId: identity.pageId))
        resetAccountState()
        for index in identities.indices {
            identities[index].isSelected = identities[index].id == identity.id
        }
        profile = AccountProfile(name: identity.name, handle: identity.byline, email: identity.email, avatar: identity.avatar)
        sessionKey = Self.makeSessionKey(signedIn: true)
        PlayerManager.shared.showToast("Đã chuyển sang \(identity.name)")
        await refresh()
        PlayerManager.shared.refreshWatchInfo()
    }

    private func resetAccountState() {
        subscribedChannels = []
        subscriptionState = [:]
        ratingState = [:]
        watchLaterState = [:]
        reportedWatched = []
        unseenNotifications = 0
        sessionKey = Self.makeSessionKey(signedIn: AuthSession.shared.isAuthenticated)
    }

    private struct SignInRejected: Error {}

    private static func makeSessionKey(signedIn: Bool) -> String {
        guard signedIn else { return "signed-out" }
        let identity = AuthSession.shared.currentIdentity
        return "u\(identity.authUser)-\(identity.pageId ?? "main")"
    }

    func signOut() async {
        AuthSession.shared.clear()
        isSignedIn = false
        profile = nil
        identities = []
        resetAccountState()
        UserDefaults.standard.removeObject(forKey: Self.profileKey)
        await Self.clearWebKitSession()
    }

    func refresh() async {
        guard isSignedIn, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            if let profile = try await YouTubeService.shared.accountProfile() {
                self.profile = profile
                saveProfile()
                lastError = nil
            } else {
                lastError = "Phiên đăng nhập có thể đã hết hạn. Hãy đăng nhập lại nếu nội dung tài khoản không hiện."
            }
        } catch {
            lastError = error.localizedDescription
        }
        await refreshSubscriptions()
        await refreshNotificationCount()
        if identities.isEmpty { await loadIdentities() }
    }

    func refreshNotificationCount() async {
        guard isSignedIn, let count = try? await InnerTube.shared.unseenNotificationCount() else { return }
        unseenNotifications = count
    }

    func markNotificationsSeen() {
        unseenNotifications = 0
    }

    func refreshSubscriptions() async {
        guard isSignedIn, let channels = try? await YouTubeService.shared.accountSubscriptions() else { return }
        subscribedChannels = channels
    }

    private func saveProfile() {
        if let data = try? JSONEncoder().encode(profile) {
            UserDefaults.standard.set(data, forKey: Self.profileKey)
        }
    }

    // MARK: Subscriptions

    func isSubscribed(_ channelId: String) -> Bool {
        subscriptionState[channelId] ?? subscribedChannels.contains { $0.id == channelId }
    }

    /// Records what the watch page reported, without calling YouTube.
    func noteSubscription(channelId: String, subscribed: Bool) {
        if subscriptionState[channelId] == nil { subscriptionState[channelId] = subscribed }
    }

    func setSubscribed(_ channel: ChannelItem, _ subscribed: Bool) async {
        let previous = isSubscribed(channel.id)
        subscriptionState[channel.id] = subscribed
        do {
            try await InnerTube.shared.subscription(channelId: channel.id, subscribe: subscribed)
            if subscribed {
                if !subscribedChannels.contains(where: { $0.id == channel.id }) { subscribedChannels.insert(channel, at: 0) }
            } else {
                subscribedChannels.removeAll { $0.id == channel.id }
            }
            PlayerManager.shared.showToast(subscribed ? "Đã đăng ký \(channel.name)" : "Đã hủy đăng ký")
        } catch {
            subscriptionState[channel.id] = previous
            PlayerManager.shared.showToast("Không cập nhật được đăng ký: \(error.localizedDescription)")
        }
    }

    // MARK: Likes

    func rating(_ videoId: String, reported: String?) -> String {
        ratingState[videoId] ?? reported ?? "INDIFFERENT"
    }

    func isLiked(_ videoId: String, reported: String?) -> Bool {
        rating(videoId, reported: reported) == "LIKE"
    }

    func isDisliked(_ videoId: String, reported: String?) -> Bool {
        rating(videoId, reported: reported) == "DISLIKE"
    }

    func setRating(_ videoId: String, _ rating: String) async {
        let previous = ratingState[videoId]
        ratingState[videoId] = rating
        let action = rating == "LIKE" ? "like" : (rating == "DISLIKE" ? "dislike" : "removelike")
        do {
            try await InnerTube.shared.like(videoId: videoId, action: action)
        } catch {
            ratingState[videoId] = previous
            PlayerManager.shared.showToast("Không cập nhật được lượt thích")
        }
    }

    // MARK: Watch later

    func isInWatchLater(_ videoId: String) -> Bool {
        watchLaterState[videoId] ?? false
    }

    func setWatchLater(_ video: VideoItem, _ add: Bool) async {
        watchLaterState[video.id] = add
        do {
            if add {
                try await InnerTube.shared.editPlaylist("WL", add: video.id)
            } else {
                try await InnerTube.shared.editPlaylist("WL", remove: video.id)
            }
            PlayerManager.shared.showToast(add ? "Đã lưu vào Xem sau" : "Đã xóa khỏi Xem sau")
        } catch {
            watchLaterState[video.id] = !add
            PlayerManager.shared.showToast("Không cập nhật được Xem sau")
        }
    }

    // MARK: Watch history

    /// Called once playback has really started; adds the video to the YouTube history.
    func reportWatched(_ videoId: String, duration: Double) {
        guard isSignedIn, syncWatchHistory, !AppSettings.shared.isIncognito,
              reportedWatched.insert(videoId).inserted else { return }
        Task.detached(priority: .utility) {
            await InnerTube.shared.markWatched(videoId: videoId, duration: duration)
        }
    }

    // MARK: WebKit session (used by the web player fallback)

    private static func installInWebKit(_ cookies: [String: String]) async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        for (name, value) in cookies {
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: name, .value: value, .path: "/", .secure: "TRUE",
                .expires: Date().addingTimeInterval(365 * 86_400),
            ]
            if name.hasPrefix("__Host-") {
                properties[.originURL] = URL(string: "https://www.youtube.com")!
            } else {
                properties[.domain] = ".youtube.com"
            }
            if let cookie = HTTPCookie(properties: properties) {
                await store.setCookie(cookie)
            }
        }
    }

    private static func clearWebKitSession() async {
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let records = await store.dataRecords(ofTypes: types)
        let matching = records.filter { record in
            let name = record.displayName.lowercased()
            return name.contains("google") || name.contains("youtube")
        }
        await store.removeData(ofTypes: types, for: matching)
    }
}
