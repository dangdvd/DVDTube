// `npm run build`: the TV interface into dist/app (Chromium 68+, webOS TV 5.0+) and the JS
// service into dist/service (one service.js for Node.js 8.12+), ready for `ares-package`.
//
//   APP_VERSION=1.0.42 npm run build     (CI sets the version; default: package.json)

import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, appVersion, repoResolver } from './esbuild-config.mjs'
import { checkCompat } from './compat.mjs'

const DIST = join(ROOT, 'dist')
const APP_OUT = join(DIST, 'app')
const SERVICE_OUT = join(DIST, 'service')

export async function buildAll({ quiet = false } = {}) {
  const version = appVersion()
  const say = (msg) => !quiet && console.log(msg)
  rmSync(APP_OUT, { recursive: true, force: true })
  rmSync(SERVICE_OUT, { recursive: true, force: true })
  mkdirSync(APP_OUT, { recursive: true })
  mkdirSync(SERVICE_OUT, { recursive: true })

  // MARK: Service (Node.js 8.12 on webOS TV 5.0)
  await build({
    entryPoints: [join(ROOT, 'service', 'src', 'main.ts')],
    outfile: join(SERVICE_OUT, 'service.js'),
    bundle: true,
    platform: 'node',
    target: 'node8',
    format: 'cjs',
    external: ['webos-service'],
    inject: [join(ROOT, 'service', 'src', 'polyfills.ts')],
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [repoResolver()],
    legalComments: 'none',
    charset: 'utf8',
    logLevel: quiet ? 'error' : 'warning',
    banner: { js: `// DVDTube for LG webOS TV ${version} — service bundle (Node.js 8.12+)` },
  })
  const services = JSON.parse(readFileSync(join(ROOT, 'service', 'services.json'), 'utf8'))
  writeFileSync(join(SERVICE_OUT, 'services.json'), JSON.stringify(services, null, 2) + '\n')
  const servicePkg = JSON.parse(readFileSync(join(ROOT, 'service', 'package.json'), 'utf8'))
  servicePkg.version = version
  writeFileSync(join(SERVICE_OUT, 'package.json'), JSON.stringify(servicePkg, null, 2) + '\n')

  // MARK: TV interface (Chromium 68 on webOS TV 5.0)
  await build({
    entryPoints: [join(ROOT, 'app', 'src', 'main.tsx')],
    outdir: APP_OUT,
    entryNames: 'app',
    bundle: true,
    platform: 'browser',
    target: ['chrome68'],
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    define: { __APP_VERSION__: JSON.stringify(version), 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css', '.svg': 'text' },
    plugins: [repoResolver()],
    legalComments: 'none',
    charset: 'utf8',
    logLevel: quiet ? 'error' : 'warning',
  })
  cpSync(join(ROOT, 'app', 'index.html'), join(APP_OUT, 'index.html'))
  const assets = join(ROOT, 'assets')
  for (const file of ['icon80.png', 'icon130.png', 'splash.png', 'donate-qr.png']) {
    if (existsSync(join(assets, file))) cpSync(join(assets, file), join(APP_OUT, file))
  }
  const appinfo = JSON.parse(readFileSync(join(ROOT, 'appinfo.json'), 'utf8'))
  appinfo.version = version
  writeFileSync(join(APP_OUT, 'appinfo.json'), JSON.stringify(appinfo, null, 2) + '\n')

  const problems = [...checkCompat(join(SERVICE_OUT, 'service.js'), 'node8'), ...checkCompat(join(APP_OUT, 'app.js'), 'chrome68')]
  if (problems.length) throw new Error('Bundle uses syntax the oldest target lacks:\n' + problems.join('\n'))
  say(`built DVDTube ${version}: dist/app (UI) + dist/service (service.js)`)
  return { version, appDir: APP_OUT, serviceDir: SERVICE_OUT }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAll().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
}
