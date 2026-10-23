package com.dangdvd.dvdtube

import android.app.Application

class DVDTubeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: DVDTubeApp
            private set
    }
}
