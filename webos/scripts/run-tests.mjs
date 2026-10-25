// `npm test`: builds the app (the bundle tests check dist/), compiles test/*.test.ts with esbuild
// (they import the service / UI sources and the shared desktop modules directly) and runs them
// with `node --test`. `npm test -- hls` runs only test files whose name contains "hls".
//
// OLD_NODE=/path/to/node (e.g. Node 8.12 or 12) additionally runs the built service.js and the
// Node 8 self-check (test/node8/selfcheck.ts, built like service.js) under that binary.

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildAll } from './build.mjs'
import { ROOT, repoResolver } from './esbuild-config.mjs'

const filter = process.argv[2] || ''
const OUT = join(ROOT, 'out-test')

await buildAll({ quiet: true })

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const files = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.ts') && f.includes(filter))
if (files.length === 0) {
  console.error(`no test files match "${filter}"`)
  process.exit(1)
}
await build({
  entryPoints: files.map((f) => join(ROOT, 'test', f)),
  outdir: OUT,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['webos-service', 'playwright', 'acorn'],
  plugins: [repoResolver()],
  define: { __APP_VERSION__: '"1.0.0"' },
  logLevel: 'warning',
})
// Built like service.js (Node 8 target + polyfills); bundle.test.ts runs it under each Node.
await build({
  entryPoints: [join(ROOT, 'test', 'node8', 'selfcheck.ts')],
  outfile: join(OUT, 'node8-selfcheck.js'),
  bundle: true,
  platform: 'node',
  target: 'node8',
  format: 'cjs',
  external: ['webos-service'],
  inject: [join(ROOT, 'service', 'src', 'polyfills.ts')],
  plugins: [repoResolver()],
  define: { __APP_VERSION__: '"1.0.0"' },
  logLevel: 'warning',
})
const outputs = readdirSync(OUT)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(OUT, f))
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...outputs], { stdio: 'inherit', cwd: ROOT, env: process.env })
process.exit(result.status ?? 1)
