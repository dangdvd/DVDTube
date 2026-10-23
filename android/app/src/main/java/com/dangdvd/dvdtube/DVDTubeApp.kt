package com.dangdvd.dvdtube

import android.app.Application
import com.dangdvd.dvdtube.cast.CastController
import com.dangdvd.dvdtube.core.AppSettings
import com.dangdvd.dvdtube.core.innertube.APIConfig
import com.dangdvd.dvdtube.core.innertube.AuthSession
import com.dangdvd.dvdtube.core.storage.AccountStore
import com.dangdvd.dvdtube.core.storage.AppScope
import com.dangdvd.dvdtube.core.storage.DownloadManager
import com.dangdvd.dvdtube.core.storage.LibraryStore
import com.dangdvd.dvdtube.player.PlayerController
import com.dangdvd.dvdtube.player.ShortsPlayer
import kotlinx.coroutines.launch

class DVDTubeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        AppSettings.init(this)
        AuthSession.init(this)
        LibraryStore.init(this)
        DownloadManager.init(this)
        PlayerController.init(this)
        ShortsPlayer.init(this)
        AccountStore.init()
        CastController.init(this)
        AppScope.launch { APIConfig.refreshRemoteConfig() }
    }

    companion object {
        lateinit var instance: DVDTubeApp
            private set
    }
}
