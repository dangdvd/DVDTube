import Foundation

/// Likes and Watch Later go to the YouTube account when signed in, otherwise to the
/// on-device library. Views call these instead of either store directly.
@MainActor
enum LibraryActions {
    private static var account: AccountStore { AccountStore.shared }
    private static var library: LibraryStore { LibraryStore.shared }

    static func isLiked(_ videoId: String, reported: String? = nil) -> Bool {
        account.isSignedIn ? account.isLiked(videoId, reported: reported) : library.isLiked(videoId)
    }

    static func toggleLike(_ video: VideoItem, reported: String? = nil) {
        if account.isSignedIn {
            let liked = account.isLiked(video.id, reported: reported)
            Task { await account.setLiked(video.id, !liked) }
        } else {
            library.toggleLike(video)
        }
    }

    static func isInWatchLater(_ videoId: String) -> Bool {
        account.isSignedIn ? account.isInWatchLater(videoId) : library.isInWatchLater(videoId)
    }

    static func toggleWatchLater(_ video: VideoItem) {
        if account.isSignedIn {
            let saved = account.isInWatchLater(video.id)
            Task { await account.setWatchLater(video, !saved) }
        } else {
            library.toggleWatchLater(video)
            PlayerManager.shared.showToast(library.isInWatchLater(video.id) ? "Đã lưu vào Xem sau" : "Đã xóa khỏi Xem sau")
        }
    }
}
