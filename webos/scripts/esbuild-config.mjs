// Shared esbuild settings: the read-only imports from the desktop app (windows/src/main/core,
// cast, lan, shared, renderer mock data) resolve like they do there, but every npm package comes
// from webos/node_modules (CI only runs `npm ci` in webos/).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO = resolve(ROOT, '..')
export const WINDOWS_SRC = join(REPO, 'windows', 'src')

/** Version of the app: APP_VERSION (CI: 1.0.<run number>) or package.json's. */
export function appVersion() {
  const fromEnv = (process.env.APP_VERSION || process.env.DVDTUBE_VERSION || '').trim().replace(/^v/i, '')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const version = fromEnv || pkg.version || '1.0.0'
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`APP_VERSION must look like 1.0.42 (got "${version}")`)
  return version
}

const STORE_FILE = join(WINDOWS_SRC, 'main', 'store.ts')

/** @returns {import('esbuild').Plugin} */
export function repoResolver() {
  return {
    name: 'dvdtube-repo-resolver',
    setup(build) {
      // @shared/* → windows/src/shared/* (the desktop tsconfig alias).
      build.onResolve({ filter: /^@shared\// }, (args) => ({
        path: resolveTs(join(WINDOWS_SRC, 'shared', args.path.slice('@shared/'.length))),
      }))
      // The desktop's JSON-file store needs Electron's user data folder: use the in-memory shim.
      build.onResolve({ filter: /\/store$/ }, (args) => {
        const target = resolveTs(resolve(args.resolveDir, args.path))
        if (target === STORE_FILE) return { path: join(ROOT, 'service', 'shims', 'store.ts') }
        return undefined
      })
      // npm packages imported by desktop sources come from webos/node_modules.
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData === 'from-root') return undefined
        if (!args.importer.startsWith(WINDOWS_SRC)) return undefined
        if (args.path.startsWith('node:') || args.path.startsWith('@shared/')) return undefined
        const result = await build.resolve(args.path, { resolveDir: ROOT, kind: args.kind, pluginData: 'from-root' })
        if (result.errors.length > 0) return { errors: result.errors }
        return { path: result.path, external: result.external, sideEffects: result.sideEffects }
      })
    },
  }
}

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        if (readFileSync(candidate)) return candidate
      } catch {
        // a directory
      }
    }
  }
  return `${base}.ts`
}
