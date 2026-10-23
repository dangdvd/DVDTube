package com.dangdvd.dvdtube.core.storage

import com.dangdvd.dvdtube.core.ChannelItem
import com.dangdvd.dvdtube.core.VideoItem
import kotlinx.coroutines.launch

/** Like / dislike / watch later / subscribe: on the YouTube account when signed in, otherwise local. */
object LibraryActions {
    fun isLiked(videoId: String, reported: String? = null): Boolean =
        if (AccountStore.isSignedIn) AccountStore.rating(videoId, reported) == "LIKE" else LibraryStore.isLiked(videoId)

    fun isDisliked(videoId: String, reported: String? = null): Boolean =
        if (AccountStore.isSignedIn) AccountStore.rating(videoId, reported) == "DISLIKE" else videoId in LibraryStore.disliked

    fun toggleLike(video: VideoItem, reported: String? = null) {
        if (AccountStore.isSignedIn) {
            val next = if (isLiked(video.id, reported)) "INDIFFERENT" else "LIKE"
            AppScope.launch { AccountStore.setRating(video.id, next) }
        } else {
            LibraryStore.toggleLike(video)
        }
    }

    fun toggleDislike(video: VideoItem, reported: String? = null) {
        if (AccountStore.isSignedIn) {
            val next = if (isDisliked(video.id, reported)) "INDIFFERENT" else "DISLIKE"
            AppScope.launch { AccountStore.setRating(video.id, next) }
        } else {
            LibraryStore.toggleDislike(video)
        }
    }

    fun isInWatchLater(videoId: String): Boolean =
        if (AccountStore.isSignedIn) AccountStore.isInWatchLater(videoId) else LibraryStore.isInWatchLater(videoId)

    fun toggleWatchLater(video: VideoItem) {
        if (AccountStore.isSignedIn) {
            val add = !AccountStore.isInWatchLater(video.id)
            AppScope.launch { AccountStore.setWatchLater(video, add) }
        } else {
            LibraryStore.toggleWatchLater(video)
        }
    }

    fun isSubscribed(channelId: String): Boolean =
        if (AccountStore.isSignedIn) AccountStore.isSubscribed(channelId) else LibraryStore.isSubscribed(channelId)

    fun toggleSubscription(channel: ChannelItem) {
        if (AccountStore.isSignedIn) {
            val subscribe = !AccountStore.isSubscribed(channel.id)
            AppScope.launch { AccountStore.setSubscribed(channel, subscribe) }
        } else {
            LibraryStore.toggleSubscription(channel)
        }
    }
}
