// "Trình phát web": when every native source fails (bot check, 403, no streams) the renderer
// plays YouTube's embed in a <webview>. Embeds refuse to play without a Referer / origin (error
// 153), so the webview loads a small host page from this computer (http://localhost:<port>, a
// normal web origin) that contains the embed iframe and drives it with the IFrame API
// (postMessage; play / pause / seek / time / ended). A script injected into the embed frame
// hides ad overlays and skips video ads, like the Android web player.
//
// The host page reports its state to the renderer with console messages prefixed `DVDWEB`; the
// renderer sends commands with `dvdCommand(name, args)`.

import { createServer, type Server } from 'node:http'
import { shell, webFrameMain, type WebContents } from 'electron'
import { listen } from './lan'
import { log } from './log'

let server: Server | null = null
let serverV6: Server | null = null
let port = 0

export const WEB_PARTITIONS = ['yt-anon', 'persist:yt']

/** Injected into the youtube.com / youtube-nocookie.com embed frame. */
export const EMBED_SCRIPT = `(function () {
  if (!/youtube/.test(location.hostname) || window.__dvdInstalled) return;
  window.__dvdInstalled = true;
  var css = '.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-image-overlay,.ytp-ad-text-overlay,' +
    '.ytp-paid-content-overlay,.ytp-pause-overlay,.ytp-ce-element,.ytp-endscreen-content,' +
    '.ytp-show-cards-title,.ytp-watermark,.ytp-youtube-button,.ytp-chrome-top,.ytp-gradient-top,' +
    '.ytp-contextmenu,.ytp-impression-link,.branding-img-container{display:none!important}';
  var mutedForAd = false, lastAd = null;
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
    if (isAd !== lastAd) {
      lastAd = isAd;
      try { window.parent.postMessage(JSON.stringify({ dvdAd: isAd }), '*'); } catch (e) {}
    }
  }, 250);
})();`

function hostPage(videoId: string, start: number, loop: boolean, embedHost: string, origin: string): string {
  const query = new URLSearchParams({
    autoplay: '1',
    enablejsapi: '1',
    playsinline: '1',
    controls: '0',
    disablekb: '1',
    fs: '0',
    rel: '0',
    iv_load_policy: '3',
    modestbranding: '1',
    origin,
    widget_referrer: origin + '/',
  })
  if (start > 1) query.set('start', String(Math.floor(start)))
  if (loop) {
    query.set('loop', '1')
    query.set('playlist', videoId)
  }
  const src = `https://${embedHost}/embed/${videoId}?${query.toString()}`
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'unsafe-inline'; img-src https: data:">
<title>DVDTube</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
#player{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe id="player" src="${src.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
(function () {
  var player = null, ready = false, ad = false, raw = null;
  function post(message) { console.log('DVDWEB' + JSON.stringify(message)); }
  function frame() { var f = document.getElementById('player'); return f && f.contentWindow; }
  function send(message) { var w = frame(); if (w) w.postMessage(JSON.stringify(message), '*'); }
  window.dvdCommand = function (func, args) {
    try {
      if (player && ready && typeof player[func] === 'function') { player[func].apply(player, args || []); return; }
    } catch (e) {}
    send({ event: 'command', func: func, args: args || [], id: 'player', channel: 'widget' });
  };
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', { events: {
      onReady: function () { ready = true; post({ ev: 'ready' }); },
      onStateChange: function (e) { report(); },
      onError: function (e) { post({ ev: 'error', code: e.data }); }
    } });
  };
  window.addEventListener('message', function (e) {
    var data = e.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (x) { return; }
    if (!data || typeof data !== 'object') return;
    if (data.dvdAd !== undefined) { ad = !!data.dvdAd; return; }
    // Without the IFrame API script: the raw postMessage protocol.
    if (!player && data.event === 'infoDelivery' && data.info) { raw = Object.assign(raw || {}, data.info); }
    if (!player && data.event === 'onError') post({ ev: 'error', code: data.info });
    if (!player && data.event === 'onReady') post({ ev: 'ready' });
  });
  function report() {
    if (player && ready && player.getCurrentTime) {
      post({ ev: 'state', t: player.getCurrentTime(), d: player.getDuration(), s: player.getPlayerState(),
        m: player.isMuted(), v: player.getVolume(), r: player.getPlaybackRate ? player.getPlaybackRate() : 1, ad: ad });
    } else if (raw) {
      post({ ev: 'state', t: raw.currentTime || 0, d: raw.duration || 0, s: raw.playerState, m: !!raw.muted, v: raw.volume, r: raw.playbackRate || 1, ad: ad });
    }
  }
  setInterval(report, 250);
  // If the API script cannot load, listen to the embed directly.
  setTimeout(function () {
    if (player) return;
    setInterval(function () { if (!player) send({ event: 'listening', id: 'player', channel: 'widget' }); }, 1000);
  }, 4000);
  var api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  document.body.appendChild(api);
})();
</script>
</body></html>`
}

export function webPlayerOrigin(): string {
  return `http://localhost:${port}`
}

/** Starts the host page server (127.0.0.1 / ::1 only). */
export async function startWebPlayerHost(): Promise<void> {
  if (server) return
  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const id = url.searchParams.get('v') ?? ''
    if (url.pathname !== '/embed.html' || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    const start = Math.max(0, Number(url.searchParams.get('start')) || 0)
    const host = url.searchParams.get('host') === 'www.youtube.com' ? 'www.youtube.com' : 'www.youtube-nocookie.com'
    const body = Buffer.from(hostPage(id, start, url.searchParams.get('loop') === '1', host, webPlayerOrigin()), 'utf8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
    res.end(body)
  }
  const main = createServer(handler)
  port = await listen(main, 0, '127.0.0.1')
  server = main
  // "localhost" may resolve to ::1 first.
  const v6 = createServer(handler)
  try {
    await new Promise<void>((resolve, reject) => {
      v6.once('error', reject)
      v6.listen(port, '::1', () => resolve())
    })
    serverV6 = v6
  } catch {
    serverV6 = null
  }
  log.info(`web player: host page on port ${port}`)
}

export async function webPlayerSource(videoId: string, start: number, loop: boolean, signedIn: boolean): Promise<{ url: string; partition: string }> {
  await startWebPlayerHost()
  // Signed in, the youtube.com embed uses the account (fewer "not a bot" checks); else no cookies.
  const host = signedIn ? 'www.youtube.com' : 'www.youtube-nocookie.com'
  const query = new URLSearchParams({ v: videoId, start: String(Math.max(0, Math.floor(start))), host, loop: loop ? '1' : '0' })
  return { url: `${webPlayerOrigin()}/embed.html?${query.toString()}`, partition: signedIn ? 'persist:yt' : 'yt-anon' }
}

function isHostPage(url: string | undefined): boolean {
  return !!url && port > 0 && url.startsWith(`${webPlayerOrigin()}/embed.html?`)
}

function isYouTubeFrame(url: string): boolean {
  try {
    return /(^|\.)youtube(-nocookie)?\.com$/.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Only our host page may be loaded in a <webview>, sandboxed, without preload, in a YouTube partition. */
export function guardWebviews(contents: WebContents): void {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isHostPage(params.src)) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    const partition = params.partition && WEB_PARTITIONS.includes(params.partition) ? params.partition : 'yt-anon'
    params.partition = partition
    webPreferences.partition = partition
  })
  contents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (isYouTubeFrame(url) && /^https:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      if (!isHostPage(url)) event.preventDefault()
    })
    const inject = () => {
      for (const frame of guest.mainFrame.framesInSubtree) {
        if (frame !== guest.mainFrame && isYouTubeFrame(frame.url)) frame.executeJavaScript(EMBED_SCRIPT).catch(() => {})
      }
    }
    guest.on('did-frame-finish-load', (_e, isMainFrame, frameProcessId, frameRoutingId) => {
      if (isMainFrame) return
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (frame && isYouTubeFrame(frame.url)) frame.executeJavaScript(EMBED_SCRIPT).catch(() => {})
    })
    guest.on('dom-ready', inject)
    guest.on('did-finish-load', inject)
  })
}

export function stopWebPlayerHost(): void {
  server?.close()
  serverV6?.close()
  server = null
  serverV6 = null
}
