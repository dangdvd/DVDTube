package com.dangdvd.dvdtube.player

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.storage.AppScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Short messages shown at the bottom of the screen. */
object Toasts {
    var message by mutableStateOf<String?>(null)
        private set
    private var job: Job? = null

    fun show(text: String) {
        AppScope.launch {
            message = text
            job?.cancel()
            job = AppScope.launch {
                delay(2500)
                message = null
            }
        }
    }
}
