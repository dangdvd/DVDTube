package com.dangdvd.dvdtube.player

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.MediaItem
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import com.dangdvd.dvdtube.MainActivity
import com.dangdvd.dvdtube.core.storage.AppScope
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import kotlinx.coroutines.launch

/**
 * Keeps playback going in the background with the media notification and lock-screen /
 * headset controls, and lets Android Auto browse and play the library ([AutoLibrary]).
 * The player itself belongs to [PlayerController] and outlives the service.
 */
class PlaybackService : MediaLibraryService() {
    private var session: MediaLibrarySession? = null

    override fun onCreate() {
        super.onCreate()
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaLibrarySession.Builder(this, PlayerController.sessionPlayer, LibraryCallback())
            .setSessionActivity(openApp)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away from Recents closes it: stop the sound and remove the notification.
        PlayerController.appTaskRemoved()
        stopSelf()
    }

    override fun onDestroy() {
        session?.release()
        session = null
        super.onDestroy()
    }

    private class LibraryCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(LibraryResult.ofItem(AutoLibrary.root(), params))

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val future = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
            AppScope.launch {
                val all = runCatching { AutoLibrary.children(parentId) }.getOrDefault(emptyList())
                val pageItems = if (pageSize in 1 until Int.MAX_VALUE) all.drop(page * pageSize).take(pageSize) else all
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(pageItems), params))
            }
            return future
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(LibraryResult.ofItem(AutoLibrary.itemFor(mediaId), null))

        /** Items picked in the car carry only an id: add what is known about them. */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(mediaItems.map(AutoLibrary::resolve).toMutableList())
    }
}
