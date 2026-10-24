// Development helper: screenshots the built renderer in MOCK mode (no preload, no network).
//
//   npm run build
//   NODE_OPTIONS= xvfb-run -a node_modules/electron/dist/electron --no-sandbox --disable-gpu \
//     scripts/shot.cjs out.png --hash=/results?q=lofi --wait=2500 --size=1280x800 \
//     [--eval="document.querySelector('button').click()"] [--eval-wait=1500]
//
// Renderer console messages and page errors are printed, so this also catches runtime crashes.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith(path.basename(__filename))) + 1)
const option = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}
const out = args.find((a) => !a.startsWith('--')) || 'shot.png'
const hash = option('hash', '')
const wait = Number(option('wait', '2500'))
const [width, height] = option('size', '1280x800').split('x').map(Number)
const evalCode = option('eval', '')
const evalWait = Number(option('eval-wait', '1500'))
const appDir = path.resolve(__dirname, '..')

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width, height, show: true, webPreferences: { sandbox: false } })
  window.webContents.on('console-message', (event) => console.log('[renderer]', event.message ?? ''))
  window.webContents.on('render-process-gone', (_e, details) => console.log('[renderer gone]', details.reason))
  await window.loadFile(path.join(appDir, 'out/renderer/index.html'), { hash })
  await new Promise((r) => setTimeout(r, wait))
  if (evalCode) {
    try {
      console.log('[eval]', await window.webContents.executeJavaScript(evalCode))
    } catch (error) {
      console.log('[eval error]', String(error))
    }
    await new Promise((r) => setTimeout(r, evalWait))
  }
  fs.writeFileSync(out, (await window.capturePage()).toPNG())
  console.log('saved', out)
  app.quit()
})
