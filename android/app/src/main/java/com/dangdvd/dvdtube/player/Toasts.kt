package com.dangdvd.dvdtube.player

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dangdvd.dvdtube.core.storage.AppScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Short messages shown at the bottom of the screen, optionally with a button ("Hoàn tác"). */
object Toasts {
    class Action(val label: String, val run: () -> Unit)

    var message by mutableStateOf<String?>(null)
        private set
    var action by mutableStateOf<Action?>(null)
        private set
    private var job: Job? = null

    fun show(text: String, action: Action? = null) {
        AppScope.launch {
            message = text
            this@Toasts.action = action
            job?.cancel()
            job = AppScope.launch {
                delay(if (action == null) 2500 else 5000)
                message = null
                this@Toasts.action = null
            }
        }
    }

    /** The toast's button was pressed. */
    fun runAction() {
        val pending = action ?: return
        job?.cancel()
        message = null
        action = null
        pending.run()
    }
}
