import SwiftUI
import WebKit

struct WebPlayerEvent {
    var time: Double
    var duration: Double
    var paused: Bool
    var isAd: Bool
    var error: String?
}

/// Fallback player: YouTube's official embed in a `WKWebView`, used only when the
/// native stream is refused (e.g. YouTube's "confirm you're not a bot" check).
/// An injected script hides ad overlays and skips video ads inside the embed.
struct WebPlayerView: UIViewRepresentable {
    let videoId: String
    var startAt: Double = 0
    var loop = false
    var onEvent: ((WebPlayerEvent) -> Void)?
    var onWebView: ((WKWebView) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = true
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: Self.embedScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        controller.add(context.coordinator, name: "dvd")
        configuration.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        context.coordinator.onEvent = onEvent
        context.coordinator.load(videoId: videoId, startAt: startAt, loop: loop, in: webView)
        onWebView?(webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onEvent = onEvent
        if context.coordinator.videoId != videoId {
            context.coordinator.load(videoId: videoId, startAt: startAt, loop: loop, in: webView)
            onWebView?(webView)
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "dvd")
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
    }

    /// YouTube requires embeds to identify their host through the HTTP Referer; for apps
    /// that is `https://<bundle id>`.
    static var origin: String { "https://" + (Bundle.main.bundleIdentifier ?? "com.dangdvd.dvdtube").lowercased() }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        var onEvent: ((WebPlayerEvent) -> Void)?
        private(set) var videoId: String?

        func load(videoId: String, startAt: Double, loop: Bool, in webView: WKWebView) {
            self.videoId = videoId
            var query = [
                "autoplay=1", "playsinline=1", "rel=0", "modestbranding=1", "enablejsapi=1", "iv_load_policy=3",
                "origin=" + (WebPlayerView.origin.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""),
            ]
            if startAt > 1 { query.append("start=\(Int(startAt))") }
            if loop { query.append(contentsOf: ["loop=1", "playlist=\(videoId)"]) }
            let src = "https://www.youtube-nocookie.com/embed/\(videoId)?" + query.joined(separator: "&")
            let html = """
            <!doctype html><html><head>
            <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
            <meta name="referrer" content="strict-origin-when-cross-origin">
            <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
            iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style>
            </head><body>
            <iframe id="player" src="\(src)" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
            <script>
            function dvdCommand(name, args) {
              document.getElementById('player').contentWindow.postMessage(
                JSON.stringify({event: 'command', func: name, args: args || []}), '*');
            }
            </script>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: URL(string: WebPlayerView.origin))
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            let event = WebPlayerEvent(
                time: (body["t"] as? Double) ?? -1,
                duration: (body["d"] as? Double) ?? -1,
                paused: (body["paused"] as? Bool) ?? true,
                isAd: (body["ad"] as? Bool) ?? false,
                error: body["error"] as? String
            )
            onEvent?(event)
        }
    }

    /// Runs inside the embed frame: hides ad UI, fast-forwards/skips video ads,
    /// and reports playback state back to the app once per second.
    static let embedScript = """
    (function () {
      if (!/youtube/.test(location.hostname)) return;
      var css = '.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-image-overlay,.ytp-ad-text-overlay,' +
        '.ytp-paid-content-overlay,.ytp-pause-overlay,.ytp-ce-element,.ytp-endscreen-content,' +
        '.ytp-show-cards-title,.ytp-watermark,.ytp-youtube-button{display:none!important}';
      var mutedForAd = false, lastPost = 0;
      function post(message) {
        try { window.webkit.messageHandlers.dvd.postMessage(message); } catch (e) {}
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
    """
}
