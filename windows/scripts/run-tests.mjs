// Unit tests of the main-process core: bundles `src/main/tests/*.test.ts` with esbuild (already
// installed as a Vite dependency) into `out-test/`, then runs them with `node --test`.
// Usage: node scripts/run-tests.mjs [name-filter]

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = join(root, 'src', 'main', 'tests')
const outDir = join(root, 'out-test')
const filter = process.argv[2] ?? ''

const entries = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts') && name.includes(filter))
  .map((name) => join(testsDir, name))

if (entries.length === 0) {
  console.error('no test files found')
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: entries,
  outdir: outDir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  alias: { '@shared': join(root, 'src', 'shared') },
  // The tested modules must not need Electron; fail loudly if one does.
  external: ['electron'],
  // Bundled CommonJS dependencies (qrcode) require Node built-ins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
})

const files = readdirSync(outDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => join(outDir, name))

const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', '--test-reporter=spec', ...files], {
  stdio: 'inherit',
  cwd: root,
})
process.exit(result.status ?? 1)
