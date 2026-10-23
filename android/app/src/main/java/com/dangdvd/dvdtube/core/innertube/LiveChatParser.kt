package com.dangdvd.dvdtube.core.innertube

import com.dangdvd.dvdtube.core.JNode
import com.dangdvd.dvdtube.core.LiveChatInfo

data class LiveChatMessage(
    val id: String,
    val author: String,
    val authorPhoto: String?,
    val text: String,
    val kind: Kind = Kind.Text,
    val isOwner: Boolean = false,
    val isModerator: Boolean = false,
    val isVerified: Boolean = false,
    val isMember: Boolean = false,
    /** Replays only: position in the video. */
    val offsetMs: Long? = null,
    val timestampText: String? = null,
) {
    sealed class Kind {
        data object Text : Kind()
        /** Super Chat / Super Sticker: amount and the card colour YouTube uses (ARGB). */
        data class Paid(val amount: String, val color: Long?) : Kind()
        data class Membership(val header: String) : Kind()
        data object System : Kind()
    }
}

data class LiveChatChunk(
    val messages: List<LiveChatMessage> = emptyList(),
    val removedIds: List<String> = emptyList(),
    val continuation: String? = null,
    val seekContinuation: String? = null,
    val timeoutMs: Int? = null,
    val sendParams: String? = null,
    val restrictedMessage: String? = null,
)

object LiveChatParser {
    /**
     * `conversationBar.liveChatRenderer` of the `next` response. Only its main reload token is
     * usable: the per-view tokens in that response's menu are a short form the chat endpoints
     * reject; the chat page itself lists usable ones ([modes]).
     */
    fun info(watch: JNode): LiveChatInfo? {
        val renderer = watch.at("conversationBar", "liveChatRenderer")
        if (!renderer.exists) return null
        val token = renderer["continuations"].array.firstNotNullOfOrNull { it.at("reloadContinuationData", "continuation").string }
            ?: return null
        val items = renderer.findFirst("subMenuItems").array
        val title = (items.firstOrNull { it["selected"].bool == true } ?: items.firstOrNull())?.get("title")?.text ?: "Trò chuyện"
        return LiveChatInfo(listOf(LiveChatInfo.Mode(title, token)), renderer["isReplay"].bool ?: false)
    }

    /** "Top chat" / "Live chat" (or their replays) from the chat page's header. */
    fun modes(json: JNode): List<LiveChatInfo.Mode> =
        json.findFirst("subMenuItems").array.mapNotNull { item ->
            val token = item.at("continuation", "reloadContinuationData", "continuation").string ?: return@mapNotNull null
            LiveChatInfo.Mode(item["title"].text ?: "Trò chuyện", token)
        }

    fun parse(json: JNode): LiveChatChunk {
        // API responses use continuationContents; the chat frame's ytInitialData uses contents.
        var content = json.at("continuationContents", "liveChatContinuation")
        if (!content.exists) content = json.at("contents", "liveChatRenderer")
        val messages = ArrayList<LiveChatMessage>()
        val removed = ArrayList<String>()
        for (action in content["actions"].array) collect(action, null, messages, removed)
        // The answer to send_message carries the posted message the same way.
        if (!content.exists) for (action in json["actions"].array) collect(action, null, messages, removed)

        var continuation: String? = null
        var timeout: Int? = null
        var seek: String? = null
        for (entry in content["continuations"].array) {
            for (key in listOf("invalidationContinuationData", "timedContinuationData", "reloadContinuationData", "liveChatReplayContinuationData")) {
                if (continuation == null) {
                    entry.at(key, "continuation").string?.let {
                        continuation = it
                        timeout = entry.at(key, "timeoutMs").int
                    }
                }
            }
            entry.at("playerSeekContinuationData", "continuation").string?.let { seek = it }
        }
        return LiveChatChunk(
            messages = messages,
            removedIds = removed,
            continuation = continuation,
            seekContinuation = seek,
            timeoutMs = timeout,
            sendParams = json.findFirst("sendLiveChatMessageEndpoint")["params"].string,
            restrictedMessage = json.findFirst("liveChatRestrictedParticipationRenderer")["message"].text,
        )
    }

    private fun collect(action: JNode, offset: Long?, messages: MutableList<LiveChatMessage>, removed: MutableList<String>) {
        val replay = action["replayChatItemAction"]
        if (replay.exists) {
            val replayOffset = replay["videoOffsetTimeMsec"].long
            for (inner in replay["actions"].array) collect(inner, replayOffset, messages, removed)
            return
        }
        val removedId = action.at("markChatItemAsDeletedAction", "targetItemId").string
            ?: action.at("removeChatItemAction", "targetItemId").string
        if (removedId != null) {
            removed.add(removedId)
            return
        }
        val item = action.at("addChatItemAction", "item")
        if (!item.exists) return
        message(item)?.let { messages.add(it.copy(offsetMs = offset)) }
    }

    private val kinds = listOf(
        "liveChatTextMessageRenderer", "liveChatPaidMessageRenderer", "liveChatPaidStickerRenderer",
        "liveChatMembershipItemRenderer", "liveChatViewerEngagementMessageRenderer",
        "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer", "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer",
    )

    private fun message(item: JNode): LiveChatMessage? {
        val key = kinds.firstOrNull { item[it].exists } ?: return null
        val renderer = item[key]
        val id = renderer["id"].string ?: return null
        var isOwner = false
        var isModerator = false
        var isVerified = false
        var isMember = false
        for (badge in renderer["authorBadges"].array) {
            val badgeRenderer = badge["liveChatAuthorBadgeRenderer"]
            when (badgeRenderer.at("icon", "iconType").string) {
                "OWNER" -> isOwner = true
                "MODERATOR" -> isModerator = true
                "VERIFIED" -> isVerified = true
                else -> if (badgeRenderer["customThumbnail"].exists) isMember = true
            }
        }
        var author = renderer["authorName"].text ?: ""
        var photo = renderer["authorPhoto"].bestImageUrl
        val text = text(renderer["message"])
        val kind: LiveChatMessage.Kind = when (key) {
            "liveChatPaidMessageRenderer", "liveChatPaidStickerRenderer" -> LiveChatMessage.Kind.Paid(
                renderer["purchaseAmountText"].text ?: "",
                (renderer["bodyBackgroundColor"].long ?: renderer["backgroundColor"].long)?.and(0xFFFFFFFFL),
            )
            "liveChatMembershipItemRenderer" ->
                LiveChatMessage.Kind.Membership(renderer["headerPrimaryText"].text ?: renderer["headerSubtext"].text ?: "Hội viên mới")
            "liveChatViewerEngagementMessageRenderer" -> LiveChatMessage.Kind.System
            "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer", "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer" -> {
                val header = renderer.findFirst("liveChatSponsorshipsHeaderRenderer")
                if (author.isEmpty()) author = header["authorName"].text ?: ""
                if (photo == null) photo = header["authorPhoto"].bestImageUrl
                LiveChatMessage.Kind.Membership(header["primaryText"].text ?: text)
            }
            else -> LiveChatMessage.Kind.Text
        }
        if (text.isEmpty() && kind == LiveChatMessage.Kind.Text) return null
        return LiveChatMessage(
            id = id, author = author, authorPhoto = photo, text = text, kind = kind,
            isOwner = isOwner, isModerator = isModerator, isVerified = isVerified, isMember = isMember,
            timestampText = renderer["timestampText"].text,
        )
    }

    /** Message runs: text plus emoji (Unicode emoji as is, channel emotes as `:shortcut:`). */
    fun text(node: JNode): String {
        node["simpleText"].string?.let { return it }
        return node["runs"].array.joinToString("") { run ->
            run["text"].string ?: run["emoji"].let { emoji ->
                if (emoji["isCustomEmoji"].bool == true) {
                    emoji["shortcuts"][0].string ?: emoji.at("image", "accessibility", "accessibilityData", "label").string ?: ""
                } else {
                    emoji["emojiId"].string ?: emoji["shortcuts"][0].string ?: ""
                }
            }
        }
    }
}
