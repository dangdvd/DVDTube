// `npm run package`: builds dist/app + dist/service and packs them with the webOS CLI
// (`ares-package`, @webos-tools/cli) into one IPK, copied to dist/DVDTube-webOS.ipk.
//
//   APP_VERSION=1.0.42 npm run package     (CI: the version in appinfo.json and the file name)
//   npm run package -- --no-build          (pack the existing dist/)
//
// Install on a TV in Developer Mode:  ares-install --device <tv> dist/DVDTube-webOS.ipk

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildAll } from './build.mjs'
import { ROOT } from './esbuild-config.mjs'

const DIST = join(ROOT, 'dist')
const APP_DIR = join(DIST, 'app')
const SERVICE_DIR = join(DIST, 'service')
const IPK_DIR = join(DIST, 'ipk')
const TARGET = join(DIST, 'DVDTube-webOS.ipk')
const ARES_PACKAGE = join(ROOT, 'node_modules', '@webos-tools', 'cli', 'bin', 'ares-package.js')

function ares(args) {
  const result = spawnSync(process.execPath, [ARES_PACKAGE, ...args], { cwd: ROOT, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.status !== 0) {
    console.error(output)
    throw new Error(`ares-package ${args[0]} failed (exit ${result.status})`)
  }
  return output
}

async function main() {
  if (!existsSync(ARES_PACKAGE)) throw new Error('@webos-tools/cli is missing: run `npm ci` first')
  let version
  if (process.argv.includes('--no-build') && existsSync(join(APP_DIR, 'appinfo.json')) && existsSync(join(SERVICE_DIR, 'service.js'))) {
    console.log('using the existing dist/app + dist/service')
  } else {
    ;({ version } = await buildAll())
  }

  // Validate first (appinfo.json / services.json / ids), then pack.
  ares(['--check', APP_DIR, SERVICE_DIR])
  rmSync(IPK_DIR, { recursive: true, force: true })
  mkdirSync(IPK_DIR, { recursive: true })
  console.log(ares(['--outdir', IPK_DIR, APP_DIR, SERVICE_DIR]))
  const ipks = readdirSync(IPK_DIR).filter((f) => f.endsWith('.ipk'))
  if (ipks.length !== 1) throw new Error(`expected one .ipk in dist/ipk, found ${ipks.length}`)
  copyFileSync(join(IPK_DIR, ipks[0]), TARGET)

  const info = ares(['--info', TARGET])
  for (const needle of ['com.dangdvd.dvdtube', 'com.dangdvd.dvdtube.service']) {
    if (!info.includes(needle)) throw new Error(`the package does not contain ${needle}:\n${info}`)
  }
  console.log(info)
  const size = (statSync(TARGET).size / 1024).toFixed(0)
  console.log(`\npackaged DVDTube for webOS${version ? ` ${version}` : ''}: ${TARGET} (${size} KB, from ${ipks[0]})`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
