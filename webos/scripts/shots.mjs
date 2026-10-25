// `npm run shots [-- <dir>]`: screenshots of every screen in mock mode ("Chế độ mẫu", no network)
// at 1920×1080, driven like a remote (arrow keys, OK, Back) and like the Magic Remote (clicks).
// Writes <dir>/NN-name.png (default: dist/shots). Needs `npm run build` first.

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { ROOT } from './esbuild-config.mjs'

const outDir = resolve(process.argv[2] || join(ROOT, 'dist', 'shots'))
const appFile = join(ROOT, 'dist', 'app', 'index.html')
if (!existsSync(appFile)) {
  console.error('dist/app is missing: run `npm run build` first')
  process.exit(1)
}
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let counter = 0

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))

  const shot = async (name, wait = 700) => {
    await sleep(wait)
    const file = join(outDir, `${String(++counter).padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path: file })
    console.log('shot', file)
  }
  const press = async (key, times = 1, gap = 160) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key)
      await sleep(gap)
    }
  }
  /** Remote keys without a keyboard name (webOS key codes: Back 461, colours 403–406…). */
  const remote = async (keyCode) => {
    await page.evaluate((code) => {
      const fire = (type) => {
        const e = new KeyboardEvent(type, { bubbles: true, cancelable: true })
        Object.defineProperty(e, 'keyCode', { get: () => code })
        Object.defineProperty(e, 'which', { get: () => code })
        document.dispatchEvent(e)
      }
      fire('keydown')
      fire('keyup')
    }, keyCode)
    await sleep(250)
  }
  const focusKey = () => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-key'))
  const railTo = async (section) => {
    await page.click(`[data-testid="rail-${section}"]`)
    await page.mouse.move(1900, 1070)
    await sleep(900)
  }

  const base = pathToFileURL(appFile).href
  await page.goto(`${base}?mock=1&demo=1`)
  await sleep(2500)
  await shot('home', 1200)

  await press('ArrowRight', 2)
  await press('ArrowDown')
  await shot('home-dpad-focus')

  await press('ArrowLeft', 6)
  await shot('rail-expanded')

  // Search with the remote: rail → Tìm kiếm → OK → field → OK opens the keyboard.
  while ((await focusKey()) !== 'rail-search') await press('ArrowUp')
  await press('Enter')
  await sleep(800)
  await shot('search')
  await press('Enter')
  await page.keyboard.type('nhạc lofi', { delay: 40 })
  await sleep(700)
  await shot('search-typing')
  await press('Enter')
  await sleep(1500)
  await shot('search-results')

  // Open a video from the results (focus a video card, then OK).
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="search-results"] .grid [data-testid="video-card"]')
    if (card) card.focus()
  })
  await press('Enter')
  await sleep(2200)
  await shot('player-controls')
  await press('ArrowDown')
  await sleep(700)
  await shot('player-related')
  await remote(406)
  await shot('player-quality-dialog')
  await press('Escape')
  await remote(405)
  await sleep(400)
  await press('ArrowDown')
  await press('Enter')
  await sleep(900)
  await press('Escape')
  await sleep(300)
  await press('Escape')
  await shot('player-captions', 1200)
  await press('ArrowRight')
  await shot('player-seek', 300)
  // Long OK on the Like button: nothing special; open "Mở kênh" from the overlay instead.
  await press('Enter')
  await sleep(500)
  await page.click('[data-testid="open-channel"]')
  await page.mouse.move(1900, 1070)
  await sleep(1500)
  await shot('channel')
  await press('Escape')
  await sleep(500)

  // Long press OK on a card: the video options.
  await railTo('home')
  await sleep(800)
  await page.keyboard.down('Enter')
  await sleep(900)
  await page.keyboard.up('Enter')
  await shot('card-options')
  await press('Escape')

  await railTo('shorts')
  await sleep(1500)
  await shot('shorts')
  await press('ArrowDown')
  await shot('shorts-next', 1200)

  await railTo('music')
  await press('Enter')
  await page.keyboard.type('Sơn Tùng', { delay: 40 })
  await press('Enter')
  await sleep(1200)
  await shot('music-results')
  await press('ArrowDown', 2)
  await press('Enter')
  await sleep(2600)
  await shot('music-now-playing')
  await press('Escape')
  await sleep(600)

  await railTo('subscriptions')
  await shot('subscriptions', 1200)

  await railTo('library')
  await shot('library', 1200)

  await railTo('account')
  await shot('account')
  await press('Enter')
  await sleep(1200)
  await shot('pairing')
  await press('Escape')

  await railTo('settings')
  await shot('settings')
  await press('ArrowDown', 14, 90)
  await shot('settings-scrolled')
  await page.click('[data-testid="open-sync"]')
  await page.mouse.move(1900, 1070)
  await sleep(1200)
  await shot('sync')
  await press('Escape')
  await sleep(400)
  await page.click('[data-testid="check-update"]')
  await sleep(1200)
  await shot('update-dialog')
  await press('Escape')

  // Parental controls: enable with a PIN (1234 twice), then the screen.
  await page.evaluate(() => window.__dvd.nav.open({ name: 'parental' }))
  await sleep(800)
  await press('Enter')
  await sleep(500)
  await shot('parental-new-pin')
  await page.keyboard.type('12341234', { delay: 120 })
  await sleep(800)
  await shot('parental-enabled')

  // Back on Home with the rail focused: "Thoát DVDTube?"
  await railTo('home')
  await press('ArrowLeft', 6)
  await press('Escape')
  await shot('exit-confirm')
  await press('ArrowRight')
  await press('Enter')

  // Signed in (sample account): identities.
  await page.goto(`${base}?mock=1&demo=1&signedIn=1`)
  await sleep(2000)
  await page.click('[data-testid="rail-account"]')
  await page.mouse.move(1900, 1070)
  await shot('account-signed-in', 1200)

  console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors')
  await browser.close()
  if (errors.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
