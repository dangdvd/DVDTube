// `npm run smoke`: the built app end to end, as close to a TV as a CI machine gets.
//
// 1. dist/service/service.js runs under Node (SMOKE_NODE=/path/to/node to pick the binary, e.g.
//    Node 8.12) with the fake `webos-service` bus (tools/fake-modules), driven over IPC.
// 2. dist/app/index.html opens from file:// in headless Chromium at 1920×1080, with a simulated
//    PalmServiceBridge (luna calls to com.dangdvd.dvdtube.service go to that process; the TV's
//    own services answer like a TV) and PalmSystem.
// 3. Steps against the real service: connect (start + keepAlive), home, search, open a video
//    (stream through the HLS relay), channel, Shorts, music, settings, cast to the TV receiver,
//    and closing the app (the service must exit on its own once the subscription is gone).
//    YouTube steps are "skipped" when YouTube is unreachable from this machine or answers with
//    its bot check; headless Chromium cannot decode H.264, so playback itself is informational.
// 4. The same tour in mock mode ("Chế độ mẫu", sample data) for screenshots of every screen.
//
// Writes dist/smoke/*.png, service.log and report.json. Exits 1 only on real failures: page
// errors, a crashed / never-starting service, broken screens, a relay that does not answer.

import { fork } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { buildAll } from './build.mjs'
import { ROOT } from './esbuild-config.mjs'

const OUT = join(ROOT, 'dist', 'smoke')
const APP = join(ROOT, 'dist', 'app', 'index.html')
const SERVICE = join(ROOT, 'dist', 'service', 'service.js')
const NETWORK_ERROR = /kết nối|mạng|phản hồi quá chậm|HTTP \d|429|giới hạn/i
const BOT_CHECK = /bot|đăng nhập để|xác nhận|robot|không khả dụng|unavailable/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = {
  startedAt: new Date().toISOString(),
  runner: { node: process.version, platform: process.platform },
  serviceNode: null,
  chromium: null,
  youtubeReachable: null,
  service: null,
  steps: [],
  pageErrors: [],
  result: 'ok',
}

function record(pass, step, status, detail, screenshot = null) {
  report.steps.push({ pass, step, status, detail, screenshot })
  const mark = status === 'ok' ? 'ok     ' : status === 'skipped' ? 'skipped' : 'FAILED '
  console.log(`[${pass}] ${mark} ${step}: ${detail}`)
}

/** Direct HTTPS (no proxy, like the service on the TV). */
function youtubeReachable() {
  return new Promise((resolve) => {
    const req = httpsRequest('https://www.youtube.com/generate_204', { method: 'GET', timeout: 8000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 204 || res.statusCode === 200)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(false))
    req.end()
  })
}

// MARK: The service on the fake bus

function startService() {
  const execPath = process.env.SMOKE_NODE || process.execPath
  const child = fork(SERVICE, [], {
    execPath,
    cwd: join(ROOT, 'dist', 'service'),
    env: { ...process.env, NODE_PATH: join(ROOT, 'tools', 'fake-modules'), NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d.toString()))
  child.stderr.on('data', (d) => (log += d.toString()))
  const state = { child, log: () => log, exitReason: null, exitCode: null, exited: false, start: null, keepAlive: null, onResponse: null }
  child.on('message', (msg) => {
    if (msg && msg.type === 'exit') state.exitReason = msg.reason
    if (msg && msg.type === 'response') state.onResponse?.(msg)
  })
  state.exitPromise = new Promise((resolve) =>
    child.on('exit', (code) => {
      state.exited = true
      state.exitCode = code
      resolve()
    }),
  )
  return state
}

// MARK: The page

const BRIDGE_SCRIPT = `(() => {
  let next = 1
  const bridges = new Map()
  window.__smokeDeliver = (id, payload) => {
    const b = bridges.get(id)
    if (b && typeof b.onservicecallback === 'function') b.onservicecallback(JSON.stringify(payload))
  }
  const TV = {
    'com.webos.service.tv.systemproperty/getSystemInfo': { returnValue: true, modelName: 'OLED55C1PVB', sdkVersion: '6.3.0' },
    'com.webos.settingsservice/getSystemSettings': { returnValue: true, settings: { deviceName: 'Phòng khách TV' } },
  }
  function PalmServiceBridge() { this.id = next++; this.onservicecallback = null }
  PalmServiceBridge.prototype.call = function (uri, params) {
    const m = /^luna:\\/\\/([^/]+)\\/(.+)$/.exec(String(uri))
    let payload = {}
    try { payload = JSON.parse(params || '{}') } catch (e) {}
    bridges.set(this.id, this)
    if (m && m[1] === 'com.dangdvd.dvdtube.service') {
      window.__smokeLuna({ type: 'call', id: this.id, method: m[2], payload })
      return
    }
    const answer = (m && TV[m[1] + '/' + m[2]]) || { returnValue: false, errorCode: -1, errorText: 'Service does not exist: ' + (m ? m[1] : uri) }
    const id = this.id
    setTimeout(() => window.__smokeDeliver(id, answer), 5)
  }
  PalmServiceBridge.prototype.cancel = function () {
    if (bridges.delete(this.id)) window.__smokeLuna({ type: 'cancel', id: this.id })
  }
  window.PalmServiceBridge = PalmServiceBridge
  window.PalmSystem = {
    deviceInfo: JSON.stringify({ modelName: 'OLED55C1PVB', platformVersion: '6.3.0', screenWidth: 1920, screenHeight: 1080 }),
    launchParams: '{}',
    activate() {},
    platformBack() { window.__smokePlatformBack = (window.__smokePlatformBack || 0) + 1 },
    setWindowOrientation() {},
  }
})()`

async function newPage(browser, pass, service) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.pageErrors.push(`[${pass}] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) report.pageErrors.push(`[${pass}] console: ${m.text()}`)
  })
  const calls = []
  if (service) {
    // Like the luna hub: subscriptions of an app that goes away are cancelled for it.
    const subscriptions = new Set()
    await context.exposeBinding('__smokeLuna', (_source, msg) => {
      if (msg.type === 'call' && msg.payload && msg.payload.subscribe === true) subscriptions.add(msg.id)
      if (msg.type === 'cancel') subscriptions.delete(msg.id)
      if (!service.exited) service.child.send(msg)
    })
    page.on('close', () => {
      for (const id of subscriptions) if (!service.exited) service.child.send({ type: 'cancel', id })
      subscriptions.clear()
    })
    service.onResponse = (msg) => {
      if (msg.payload && msg.payload.token && !service.start) service.start = msg.payload
      if (msg.payload && msg.payload.subscribed === true) service.keepAlive = msg.payload
      page.evaluate(([id, payload]) => window.__smokeDeliver(id, payload), [msg.id, msg.payload]).catch(() => {})
    }
    await context.addInitScript(BRIDGE_SCRIPT)
    page.on('response', async (response) => {
      const m = /\/api\/call\?m=([A-Za-z]+)/.exec(response.url())
      if (!m) return
      try {
        calls.push({ method: m[1], status: response.status(), body: await response.json() })
      } catch {
        calls.push({ method: m[1], status: response.status(), body: null })
      }
    })
  }
  return { context, page, calls }
}

function makeHelpers(page, pass) {
  let counter = 0
  return {
    async shot(name) {
      const file = join(OUT, `${pass}-${String(++counter).padStart(2, '0')}-${name}.png`)
      await page.screenshot({ path: file })
      return file.slice(ROOT.length + 1)
    },
    async rail(section) {
      await page.click(`[data-testid="rail-${section}"]`)
      await page.mouse.move(1900, 1070)
      await sleep(700)
    },
    async closeOverlays() {
      for (let i = 0; i < 3; i++) {
        const open = await page.evaluate(() => !!document.querySelector('[data-testid="player"], [data-testid="dialog"]'))
        if (!open) return
        await page.keyboard.press('Escape')
        await sleep(400)
      }
    },
    /** Waits for the first selector that appears; returns its index or -1. */
    async first(selectors, timeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = await page.evaluate((list) => list.findIndex((s) => {
          const el = document.querySelector(s)
          return !!el && el.getBoundingClientRect().width > 0
        }), selectors)
        if (found >= 0) return found
        await sleep(250)
      }
      return -1
    },
    text: (selector) => page.evaluate((s) => (document.querySelector(s)?.innerText ?? '').trim().split(/\s*\n+\s*/).join(' — '), selector),
  }
}

/** A YouTube-dependent step that did not work: skipped when the cause is outside our control. */
function verdict(message, reachable) {
  if (!reachable) return ['skipped', `YouTube is unreachable from this machine (${message || 'no answer'})`]
  if (BOT_CHECK.test(message) || NETWORK_ERROR.test(message)) return ['skipped', `YouTube refused: ${message}`]
  return ['failed', message || 'nothing shown']
}

// MARK: Pass 1 — the real service

async function servicePass(browser, reachable) {
  const pass = 'service'
  const service = startService()
  const { context, page, calls } = await newPage(browser, pass, service)
  const h = makeHelpers(page, pass)
  const visibleMessage = '.page:not([hidden]) .message, .screen:not([hidden]) .message'
  try {
    await page.goto(`${pathToFileURL(APP).href}?debug=1`)
    // connect: start → port/token, keepAlive subscription, first API calls over HTTP.
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline && !(service.start && service.keepAlive && calls.some((c) => c.method === 'configure'))) await sleep(200)
    if (!service.start) {
      record(pass, 'connect', 'failed', `the service did not answer luna start\n${service.log().slice(-2000)}`, await h.shot('connect'))
      return
    }
    report.service = { port: service.start.port, version: service.start.version, node: service.start.node }
    report.serviceNode = service.start.node
    const keep = service.keepAlive ? 'keepAlive subscribed' : 'NO keepAlive subscription'
    const httpOk = calls.filter((c) => c.status === 200).length
    record(pass, 'connect', service.keepAlive && httpOk > 0 ? 'ok' : 'failed', `service ${service.start.version} on Node ${service.start.node}, 127.0.0.1:${service.start.port}, ${keep}, ${httpOk} API calls over HTTP`)

    // home
    const home = await h.first(['[data-testid="recommended-shelf"] [data-testid="video-card"]', '[data-testid="home-feed"] .message'], 30_000)
    if (home === 0) {
      const cards = await page.locator('[data-testid="home-feed"] [data-testid="video-card"]').count()
      record(pass, 'home', 'ok', `${cards} videos`, await h.shot('home'))
    } else {
      const detail = home === 1 ? await h.text('[data-testid="home-feed"] .message') : ''
      const [status, why] = home === 1 ? verdict(detail, reachable) : ['failed', 'neither videos nor a message after 30 s']
      record(pass, 'home', status, why, await h.shot('home'))
    }

    // search
    await h.rail('search')
    await page.click('[data-testid="search-box"]')
    await page.keyboard.type('nhạc trẻ', { delay: 30 })
    await sleep(600)
    await page.keyboard.press('Enter')
    const search = await h.first(['[data-testid="search-results"] [data-testid="video-card"]', '[data-testid="search-results"] .message'], 30_000)
    let firstVideo = null
    if (search === 0) {
      const cards = await page.locator('[data-testid="search-results"] [data-testid="video-card"]').count()
      record(pass, 'search', 'ok', `"nhạc trẻ": ${cards} videos`, await h.shot('search'))
      const result = calls.filter((c) => c.method === 'search' && c.body?.ok).pop()
      firstVideo = result?.body.result.items.find((i) => i.type === 'video')?.video ?? null
    } else {
      const [status, why] = search === 1 ? verdict(await h.text('[data-testid="search-results"] .message'), reachable) : ['failed', 'no results and no message after 30 s']
      record(pass, 'search', status, why, await h.shot('search'))
    }

    // open video
    if (firstVideo) {
      await page.evaluate(() => document.querySelector('[data-testid="search-results"] .grid [data-testid="video-card"]')?.focus())
      await page.keyboard.press('Enter')
      const opened = await h.first(['[data-testid="player"]'], 10_000)
      const deadlineStream = Date.now() + 30_000
      let stream = null
      while (Date.now() < deadlineStream && !(stream = calls.find((c) => c.method === 'stream'))) await sleep(250)
      await sleep(4000)
      const playerState = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="player"]')
        const v = document.querySelector('video')
        return { status: p?.getAttribute('data-status') ?? null, source: p?.getAttribute('data-source') ?? null, error: document.querySelector('[data-testid="player-error"]')?.textContent?.trim() ?? null, src: v?.currentSrc || v?.src || null, readyState: v?.readyState ?? null }
      })
      const shotFile = await h.shot('player')
      if (opened < 0) record(pass, 'open video', 'failed', 'the player did not open', shotFile)
      else if (!stream) record(pass, 'open video', 'failed', 'the player never asked the service for the stream', shotFile)
      else if (!stream.body?.ok) {
        const message = stream.body?.error ?? `HTTP ${stream.status}`
        // YouTube's bot check / an unplayable (region, age…) video is not our failure.
        const [status, why] = ['loginRequired', 'unplayable', 'noStreams'].includes(stream.body?.kind) ? ['skipped', `YouTube refused (${stream.body.kind}): ${message}`] : verdict(message, reachable)
        record(pass, 'open video', status, why, shotFile)
      } else {
        const s = stream.body.result
        const label = `${s.videoId} "${s.title}" (${s.client})`
        const relay = s.hls || s.mp4
        const playback = `player status ${playerState.status}, source ${playerState.source || '-'}${playerState.error ? `, "${playerState.error}" (headless Chromium has no H.264 / HLS decoder)` : ''}`
        if (!relay) record(pass, 'open video', 'failed', `${label}: the stream has no relay URL`, shotFile)
        else {
          try {
            const r = await fetch(relay, { headers: s.hls ? {} : { Range: 'bytes=0-1023' } })
            const body = s.hls ? await r.text() : ''
            const variants = (body.match(/#EXT-X-STREAM-INF/g) || []).length
            if (r.status >= 400) {
              // googlevideo refusing the relay (e.g. 403) is reported, but YouTube-side.
              const [status, why] = verdict(`HTTP ${r.status} from YouTube through the relay`, reachable)
              record(pass, 'open video', status, `${label}: ${why}`, shotFile)
            } else if (s.hls) {
              const ok = r.status === 200 && body.startsWith('#EXTM3U') && body.includes('http://127.0.0.1:') && variants > 0
              record(pass, 'open video', ok ? 'ok' : 'failed', `${label}: HLS master via relay HTTP ${r.status}, ${variants} variants, qualities ${s.qualities.join('/')}; ${playback}`, shotFile)
            } else {
              record(pass, 'open video', r.status === 206 || r.status === 200 ? 'ok' : 'failed', `${label}: MP4 via relay HTTP ${r.status}; ${playback}`, shotFile)
            }
          } catch (error) {
            record(pass, 'open video', 'failed', `${label}: relay request failed (${error.message})`, shotFile)
          }
        }
      }
    } else {
      record(pass, 'open video', 'skipped', 'no search result to open')
    }

    // channel
    const channelId = firstVideo?.channelId ?? null
    await h.closeOverlays()
    if (channelId) {
      await page.evaluate(([id, name]) => window.__dvd.nav.open({ name: 'channel', channel: { id, name } }), [channelId, firstVideo.channelName ?? ''])
      const channel = await h.first(['[data-testid="channel-page"] [data-testid="video-card"]', '[data-testid="channel-page"] .message'], 30_000)
      const name = await h.text('[data-testid="channel-name"]')
      if (channel === 0) record(pass, 'channel', 'ok', `${name || channelId}: ${await page.locator('[data-testid="channel-page"] [data-testid="video-card"]').count()} videos`, await h.shot('channel'))
      else {
        const [status, why] = channel === 1 ? verdict(await h.text('[data-testid="channel-page"] .message'), reachable) : ['failed', 'nothing shown after 30 s']
        record(pass, 'channel', status, why, await h.shot('channel'))
      }
      await page.keyboard.press('Escape')
      await sleep(500)
    } else {
      record(pass, 'channel', 'skipped', 'no channel known (search did not answer)')
    }

    // shorts
    await h.rail('shorts')
    const shorts = await h.first(['[data-testid="shorts-stage"]', '[data-testid="shorts-page"] .message'], 30_000)
    if (shorts === 0) record(pass, 'shorts', 'ok', 'the Shorts player opened', await h.shot('shorts'))
    else {
      const [status, why] = shorts === 1 ? verdict(await h.text('[data-testid="shorts-page"] .message'), reachable) : ['failed', 'nothing shown after 30 s']
      record(pass, 'shorts', status, why, await h.shot('shorts'))
    }
    await h.closeOverlays()

    // music
    await h.rail('music')
    const musicHome = await h.first(['[data-testid="music-page"]'], 5000)
    await page.click('[data-testid="music-search"]').catch(() => {})
    await page.keyboard.type('Sơn Tùng', { delay: 30 })
    await page.keyboard.press('Enter')
    const music = await h.first(['[data-testid="music-results"] [data-testid="music-track"]', '[data-testid="music-results"] [data-testid="music-card"]', '[data-testid="music-page"] .message'], 30_000)
    if (musicHome < 0) record(pass, 'music', 'failed', 'the music page did not open', await h.shot('music'))
    else if (music === 0 || music === 1) record(pass, 'music', 'ok', `"Sơn Tùng": ${await page.locator('[data-testid="music-results"] [data-testid="music-track"]').count()} songs`, await h.shot('music'))
    else {
      const [status, why] = music === 2 ? verdict(await h.text('[data-testid="music-page"] .message'), reachable) : ['failed', 'nothing shown after 30 s']
      record(pass, 'music', status, why, await h.shot('music'))
    }

    // settings (no network needed)
    await h.rail('settings')
    const settingsOk = (await h.first(['[data-testid="settings-page"] [data-testid="check-update"]'], 5000)) === 0
    record(pass, 'settings', settingsOk ? 'ok' : 'failed', settingsOk ? 'settings page with "Kiểm tra cập nhật"' : 'the settings page did not render', await h.shot('settings'))

    // cast to the TV (receiver kind tv on the port the service reports)
    try {
      const info = calls.filter((c) => c.method === 'appInfo' && c.body?.ok).pop()?.body.result
      const appInfo = info ?? (await (await fetch(`http://127.0.0.1:${service.start.port}/api/call?m=appInfo`, { method: 'POST', body: JSON.stringify({ t: service.start.token, args: [] }) })).json()).result
      let castPort = appInfo.castPort
      for (let i = 0; i < 20 && !castPort; i++) {
        await sleep(250)
        castPort = (await (await fetch(`http://127.0.0.1:${service.start.port}/api/call?m=appInfo`, { method: 'POST', body: JSON.stringify({ t: service.start.token, args: [] }) })).json()).result.castPort
      }
      if (!castPort) throw new Error('the cast receiver is not running')
      const castInfo = await (await fetch(`http://127.0.0.1:${castPort}/api/info`)).json()
      const play = await fetch(`http://127.0.0.1:${castPort}/api/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video: { id: 'jNQXAC9IVRw', title: 'Me at the zoo', channelName: 'jawed' }, sender: 'Điện thoại thử' }),
      })
      const opened = await h.first(['[data-testid="player"]'], 8000)
      const title = opened === 0 ? await h.text('[data-testid="player-title"]') : ''
      await sleep(1500)
      const status = (await (await fetch(`http://127.0.0.1:${castPort}/api/status`)).json()).state
      const ok = castInfo.kind === 'tv' && castInfo.protocol === 1 && play.status === 200 && opened === 0
      record(pass, 'cast', ok ? 'ok' : 'failed', `receiver "${castInfo.name}" (kind ${castInfo.kind}) on port ${castPort}; /api/play → HTTP ${play.status}, player ${opened === 0 ? `opened ("${title}")` : 'did not open'}; /api/status: ${status}`, await h.shot('cast'))
    } catch (error) {
      record(pass, 'cast', 'failed', error.message, await h.shot('cast'))
    }
    await h.closeOverlays()

    // Closing the app cancels keepAlive; the service must end by itself (webOS idle timeout).
    await context.close()
    const t0 = Date.now()
    await Promise.race([service.exitPromise, sleep(20_000)])
    if (service.exited) record(pass, 'exit', service.exitReason === 'idle' ? 'ok' : 'failed', `service ended ${((Date.now() - t0) / 1000).toFixed(1)} s after the app closed (reason ${service.exitReason}, code ${service.exitCode})`)
    else record(pass, 'exit', 'failed', 'the service kept running 20 s after the app closed')
  } catch (error) {
    record(pass, 'run', 'failed', error.stack || String(error), await h.shot('crash').catch(() => null))
  } finally {
    writeFileSync(join(OUT, 'service.log'), service.log())
    if (/uncaught|unhandled rejection/i.test(service.log())) record(pass, 'service log', 'failed', 'uncaught errors in the service log (see dist/smoke/service.log)')
    if (!service.exited) service.child.kill()
    await context.close().catch(() => {})
  }
}

// MARK: Pass 2 — mock mode, every screen

async function mockPass(browser) {
  const pass = 'mock'
  const { context, page } = await newPage(browser, pass, null)
  const h = makeHelpers(page, pass)
  const check = async (step, selector, detail, timeoutMs = 8000) => {
    const ok = (await h.first([selector], timeoutMs)) === 0
    await sleep(500)
    record(pass, step, ok ? 'ok' : 'failed', ok ? detail : `${selector} did not appear`, await h.shot(step.replace(/\s+/g, '-')))
    return ok
  }
  try {
    await page.goto(`${pathToFileURL(APP).href}?mock=1&demo=1`)
    await check('home', '[data-testid="recommended-shelf"] [data-testid="video-card"]', 'sample home feed')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await sleep(400)
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
    record(pass, 'd-pad focus', focused ? 'ok' : 'failed', `focus on ${focused}`, await h.shot('dpad'))

    await h.rail('search')
    await page.click('[data-testid="search-box"]')
    await page.keyboard.type('nhạc lofi', { delay: 30 })
    await page.keyboard.press('Enter')
    await check('search', '[data-testid="search-results"] [data-testid="video-card"]', 'sample results')

    await page.evaluate(() => document.querySelector('[data-testid="search-results"] .grid [data-testid="video-card"]')?.focus())
    await page.keyboard.press('Enter')
    if (await check('open video', '[data-testid="player"] [data-testid="player-title"]', 'player with controls')) {
      const status = await page.evaluate(() => document.querySelector('[data-testid="player"]')?.getAttribute('data-status'))
      if (status === 'error') record(pass, 'playback', 'failed', 'the sample playback reported an error')
      await page.click('[data-testid="open-channel"]').catch(() => {})
      await page.mouse.move(1900, 1070)
      await check('channel', '[data-testid="channel-page"] [data-testid="video-card"]', 'sample channel')
      await page.keyboard.press('Escape')
      await sleep(400)
    }
    await h.closeOverlays()

    await h.rail('shorts')
    await check('shorts', '[data-testid="shorts-stage"]', 'Shorts player')
    await h.closeOverlays()

    await h.rail('music')
    await page.click('[data-testid="music-search"]').catch(() => {})
    await page.keyboard.type('Sơn Tùng', { delay: 30 })
    await page.keyboard.press('Enter')
    await check('music', '[data-testid="music-results"] [data-testid="music-track"]', 'sample songs')

    await h.rail('settings')
    await check('settings', '[data-testid="settings-page"] [data-testid="check-update"]', 'settings')

    // Back on Home with the rail focused asks before leaving.
    await h.rail('home')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await check('exit dialog', '[data-testid="confirm-dialog"]', '"Thoát DVDTube?"', 3000)
  } catch (error) {
    record(pass, 'run', 'failed', error.stack || String(error), await h.shot('crash').catch(() => null))
  } finally {
    await context.close().catch(() => {})
  }
}

async function main() {
  if (process.argv.includes('--no-build') && existsSync(APP) && existsSync(SERVICE)) console.log('using the existing dist/')
  else await buildAll({ quiet: true })
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  report.youtubeReachable = await youtubeReachable()
  console.log(`YouTube ${report.youtubeReachable ? 'reachable' : 'NOT reachable'} from this machine (direct HTTPS)`)
  const browser = await chromium.launch()
  report.chromium = browser.version()
  try {
    await servicePass(browser, report.youtubeReachable)
    await mockPass(browser)
  } finally {
    await browser.close()
  }

  const failed = report.steps.filter((s) => s.status === 'failed')
  if (failed.length || report.pageErrors.length) report.result = 'failed'
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  const count = (status) => report.steps.filter((s) => s.status === status).length
  console.log(`\nsmoke: ${count('ok')} ok, ${count('skipped')} skipped, ${failed.length} failed, ${report.pageErrors.length} page errors → ${join(OUT, 'report.json')}`)
  for (const e of report.pageErrors) console.log(`page error: ${e}`)
  if (report.result !== 'ok') process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
