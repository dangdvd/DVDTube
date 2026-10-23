package com.dangdvd.dvdtube.ui.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.dangdvd.dvdtube.core.innertube.AuthSession
import org.json.JSONObject

data class WebPlayerEvent(val time: Double, val duration: Double, val paused: Boolean, val isAd: Boolean, val error: String?)

/**
 * Fallback player: YouTube's official embed in a WebView, used only when the native
 * stream is refused (e.g. YouTube's "confirm you're not a bot" check). A script injected
 * into the embed frame hides ad overlays and skips video ads.
 *
 * One WebView per role is kept alive and moved between the mini player and the watch page,
 * so minimizing does not restart the video.
 */
class WebPlayerHost(private val onEvent: (WebPlayerEvent) -> Unit) {
    private var webView: WebView? = null
    var videoId: String? = null
        private set
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    fun view(context: Context): WebView {
        webView?.let { existing ->
            (existing.parent as? ViewGroup)?.removeView(existing)
            return existing
        }
        val view = WebView(context.applicationContext)
        view.setBackgroundColor(Color.BLACK)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.mediaPlaybackRequiresUserGesture = false
        view.webChromeClient = WebChromeClient()
        view.webViewClient = WebViewClient()
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        // Injected into every frame (including the cross-origin embed).
        view.addJavascriptInterface(Bridge(), "DVDBridge")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, EMBED_SCRIPT, setOf("https://www.youtube.com", "https://www.youtube-nocookie.com"))
        }
        webView = view
        return view
    }

    fun load(videoId: String, startAt: Double, loop: Boolean = false) {
        val view = webView ?: return
        this.videoId = videoId
        val query = mutableListOf(
            "autoplay=1", "playsinline=1", "rel=0", "modestbranding=1", "enablejsapi=1", "iv_load_policy=3",
            "origin=" + Uri.encode(ORIGIN),
        )
        if (startAt > 1) query += "start=${startAt.toInt()}"
        if (loop) query += listOf("loop=1", "playlist=$videoId")
        // Signed in: the youtube.com embed uses the account cookies, which also avoids
        // most "confirm you're not a bot" checks. Otherwise the no-cookie domain.
        val host = if (AuthSession.isAuthenticated) "www.youtube.com" else "www.youtube-nocookie.com"
        val src = "https://$host/embed/$videoId?" + query.joinToString("&")
        val html = """
            <!doctype html><html><head>
            <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
            <meta name="referrer" content="strict-origin-when-cross-origin">
            <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
            iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style>
            </head><body>
            <iframe id="player" src="$src" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            <script>
            function dvdCommand(name, args) {
              document.getElementById('player').contentWindow.postMessage(
                JSON.stringify({event: 'command', func: name, args: args || []}), '*');
            }
            </script>
            </body></html>
        """.trimIndent()
        view.loadDataWithBaseURL(ORIGIN, html, "text/html", "utf-8", null)
    }

    fun command(name: String, arguments: String = "[]") {
        webView?.evaluateJavascript("dvdCommand('$name', $arguments)", null)
    }

    val current: WebView? get() = webView

    fun destroy() {
        webView?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.stopLoading()
            it.loadUrl("about:blank")
            it.destroy()
        }
        webView = null
        videoId = null
    }

    private inner class Bridge {
        @JavascriptInterface
        fun post(message: String) {
            val json = runCatching { JSONObject(message) }.getOrNull() ?: return
            val event = WebPlayerEvent(
                time = json.optDouble("t", -1.0),
                duration = json.optDouble("d", -1.0),
                paused = json.optBoolean("paused", true),
                isAd = json.optBoolean("ad", false),
                error = json.optString("error").takeIf { it.isNotEmpty() && it != "null" },
            )
            main.post { onEvent(event) }
        }
    }

    companion object {
        /** YouTube requires embeds to identify their host through the HTTP Referer. */
        const val ORIGIN = "https://com.dangdvd.dvdtube"

        /**
         * Runs inside the embed frame: hides ad UI, fast-forwards/skips video ads,
         * and reports playback state back to the app once per second.
         */
        private val EMBED_SCRIPT = """
            (function () {
              if (!/youtube/.test(location.hostname) || window.__dvdInstalled) return;
              window.__dvdInstalled = true;
              var css = '.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-image-overlay,.ytp-ad-text-overlay,' +
                '.ytp-paid-content-overlay,.ytp-pause-overlay,.ytp-ce-element,.ytp-endscreen-content,' +
                '.ytp-show-cards-title,.ytp-watermark,.ytp-youtube-button{display:none!important}';
              var mutedForAd = false, lastPost = 0;
              function post(message) {
                try { DVDBridge.post(JSON.stringify(message)); } catch (e) {}
              }
              setInterval(function () {
                if (document.head && !document.getElementById('dvd-style')) {
                  var style = document.createElement('style');
                  style.id = 'dvd-style';
                  style.textContent = css;
                  document.head.appendChild(style);
                }
                var player = document.querySelector('.html5-video-player');
                var video = document.querySelector('video');
                var isAd = !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
                if (isAd && video) {
                  if (!video.muted) { video.muted = true; mutedForAd = true; }
                  if (isFinite(video.duration) && video.duration > 0) { video.currentTime = video.duration; }
                  var skip = document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button');
                  if (skip) { skip.click(); }
                } else if (video && mutedForAd) {
                  video.muted = false;
                  mutedForAd = false;
                }
                var now = Date.now();
                if (now - lastPost > 1000) {
                  lastPost = now;
                  var error = document.querySelector('.ytp-error-content-wrap-reason, .ytp-error');
                  post({
                    t: video ? video.currentTime : -1,
                    d: video && isFinite(video.duration) ? video.duration : -1,
                    paused: video ? video.paused : true,
                    ad: isAd,
                    error: error ? (error.innerText || '').slice(0, 200) : null
                  });
                }
              }, 250);
            })();
        """.trimIndent()
    }
}
