import Foundation

/// Where the watch page's chat starts ("Top chat" / "Live chat", or their replays).
struct LiveChatInfo: Hashable {
    struct Mode: Hashable {
        var title: String
        var continuation: String
    }

    var modes: [Mode]
    var isReplay: Bool
}

struct LiveChatMessage: Identifiable, Hashable {
    enum Kind: Hashable {
        case text
        /// Super Chat / Super Sticker: amount and the card colour YouTube uses (ARGB).
        case paid(amount: String, color: UInt32?)
        case membership(String)
        case system
    }

    var id: String
    var author: String
    var authorPhoto: URL?
    var text: String
    var kind: Kind = .text
    var isOwner = false
    var isModerator = false
    var isVerified = false
    var isMember = false
    /// Replays only: position in the video.
    var offsetMs: Int?
    var timestampText: String?
}

struct LiveChatChunk {
    var messages: [LiveChatMessage] = []
    var removedIds: [String] = []
    var continuation: String?
    var seekContinuation: String?
    var timeoutMs: Int?
    var sendParams: String?
    var restrictedMessage: String?
}

enum LiveChatParser {
    /// `conversationBar.liveChatRenderer` of the `next` response. Only its main reload
    /// token is usable: the per-mode tokens in that response's menu are a short form that
    /// the chat endpoints reject; the chat page itself lists usable ones (`modes(in:)`).
    static func info(_ watch: JNode) -> LiveChatInfo? {
        let renderer = watch.at("conversationBar", "liveChatRenderer")
        guard renderer.exists,
              let token = renderer["continuations"].array.lazy
                .compactMap({ $0.at("reloadContinuationData", "continuation").string }).first
        else { return nil }
        let items = renderer.findFirst("subMenuItems").array
        let title = (items.first { $0["selected"].bool == true } ?? items.first)?["title"].text ?? "Trò chuyện"
        return LiveChatInfo(modes: [LiveChatInfo.Mode(title: title, continuation: token)], isReplay: renderer["isReplay"].bool ?? false)
    }

    /// "Top chat" / "Live chat" (or their replays) from the chat page's header.
    static func modes(in json: JNode) -> [LiveChatInfo.Mode] {
        json.findFirst("subMenuItems").array.compactMap { item in
            guard let token = item.at("continuation", "reloadContinuationData", "continuation").string else { return nil }
            return LiveChatInfo.Mode(title: item["title"].text ?? "Trò chuyện", continuation: token)
        }
    }

    static func parse(_ json: JNode) -> LiveChatChunk {
        var chunk = LiveChatChunk()
        // API responses use continuationContents; the chat frame's ytInitialData uses contents.
        var content = json.at("continuationContents", "liveChatContinuation")
        if !content.exists { content = json.at("contents", "liveChatRenderer") }
        for action in content["actions"].array {
            collect(action, offset: nil, into: &chunk)
        }
        // The answer to send_message carries the posted message the same way.
        if !content.exists {
            for action in json["actions"].array { collect(action, offset: nil, into: &chunk) }
        }
        for entry in content["continuations"].array {
            for key in ["invalidationContinuationData", "timedContinuationData", "reloadContinuationData", "liveChatReplayContinuationData"] {
                if chunk.continuation == nil, let token = entry.at(key, "continuation").string {
                    chunk.continuation = token
                    chunk.timeoutMs = entry.at(key, "timeoutMs").int
                }
            }
            if let token = entry.at("playerSeekContinuationData", "continuation").string {
                chunk.seekContinuation = token
            }
        }
        chunk.sendParams = json.findFirst("sendLiveChatMessageEndpoint")["params"].string
        chunk.restrictedMessage = json.findFirst("liveChatRestrictedParticipationRenderer")["message"].text
        return chunk
    }

    private static func collect(_ action: JNode, offset: Int?, into chunk: inout LiveChatChunk) {
        let replay = action["replayChatItemAction"]
        if replay.exists {
            let replayOffset = replay["videoOffsetTimeMsec"].int
            for inner in replay["actions"].array { collect(inner, offset: replayOffset, into: &chunk) }
            return
        }
        if let removed = action.at("markChatItemAsDeletedAction", "targetItemId").string
            ?? action.at("removeChatItemAction", "targetItemId").string {
            chunk.removedIds.append(removed)
            return
        }
        let item = action.at("addChatItemAction", "item")
        guard item.exists, var message = message(from: item) else { return }
        message.offsetMs = offset
        chunk.messages.append(message)
    }

    private static func message(from item: JNode) -> LiveChatMessage? {
        let kinds = [
            "liveChatTextMessageRenderer", "liveChatPaidMessageRenderer", "liveChatPaidStickerRenderer",
            "liveChatMembershipItemRenderer", "liveChatViewerEngagementMessageRenderer",
            "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer", "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer",
        ]
        guard let key = kinds.first(where: { item[$0].exists }) else { return nil }
        let renderer = item[key]
        guard let id = renderer["id"].string else { return nil }

        var message = LiveChatMessage(
            id: id,
            author: renderer["authorName"].text ?? "",
            authorPhoto: renderer["authorPhoto"].bestImageURL,
            text: text(of: renderer["message"]),
            timestampText: renderer["timestampText"].text
        )
        for badge in renderer["authorBadges"].array {
            let badgeRenderer = badge["liveChatAuthorBadgeRenderer"]
            switch badgeRenderer.at("icon", "iconType").string {
            case "OWNER": message.isOwner = true
            case "MODERATOR": message.isModerator = true
            case "VERIFIED": message.isVerified = true
            default: if badgeRenderer["customThumbnail"].exists { message.isMember = true }
            }
        }

        switch key {
        case "liveChatPaidMessageRenderer", "liveChatPaidStickerRenderer":
            let color = renderer["bodyBackgroundColor"].int ?? renderer["backgroundColor"].int
            message.kind = .paid(
                amount: renderer["purchaseAmountText"].text ?? "",
                color: color.map { UInt32(truncatingIfNeeded: $0) }
            )
        case "liveChatMembershipItemRenderer":
            let header = renderer["headerPrimaryText"].text ?? renderer["headerSubtext"].text ?? "Hội viên mới"
            message.kind = .membership(header)
        case "liveChatViewerEngagementMessageRenderer":
            message.kind = .system
        case "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer", "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer":
            let header = renderer.findFirst("liveChatSponsorshipsHeaderRenderer")
            if message.author.isEmpty { message.author = header["authorName"].text ?? "" }
            if message.authorPhoto == nil { message.authorPhoto = header["authorPhoto"].bestImageURL }
            message.kind = .membership(header["primaryText"].text ?? message.text)
        default:
            break
        }
        if message.text.isEmpty, case .text = message.kind { return nil }
        return message
    }

    /// Message runs: text plus emoji (Unicode emoji as is, channel emotes as `:shortcut:`).
    static func text(of node: JNode) -> String {
        if let simple = node["simpleText"].string { return simple }
        return node["runs"].array.map { run in
            if let text = run["text"].string { return text }
            let emoji = run["emoji"]
            if emoji["isCustomEmoji"].bool == true {
                return emoji["shortcuts"][0].string ?? emoji.at("image", "accessibility", "accessibilityData", "label").string ?? ""
            }
            return emoji["emojiId"].string ?? emoji["shortcuts"][0].string ?? ""
        }.joined()
    }
}
