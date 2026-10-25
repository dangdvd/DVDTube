// The built app (dist/): the webOS package layout and appinfo, the syntax level of both bundles
// (Node.js 8.12 / Chromium 68), and the real service.js started like on the TV — under the fake
// `webos-service` bus — through start → keepAlive → cancel → idle exit.
//
// OLD_NODE=/path/to/node additionally runs service.js under that Node binary (CI can point it at
// Node 8.12 to match webOS TV 5).

import assert from 'node:assert/strict'
import { fork, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = process.cwd()
const APP = join(ROOT, 'dist', 'app')
const SERVICE = join(ROOT, 'dist', 'service')

function pngSize(file: string): [number, number] {
  const b = readFileSync(file)
  assert.equal(b.toString('latin1', 1, 4), 'PNG', file)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('package layout', () => {
  test('appinfo.json and the app files', () => {
    const info = JSON.parse(readFileSync(join(APP, 'appinfo.json'), 'utf8'))
    assert.equal(info.id, 'com.dangdvd.dvdtube')
    assert.match(info.version, /^\d+\.\d+\.\d+$/)
    assert.equal(info.type, 'web')
    assert.equal(info.main, 'index.html')
    assert.equal(info.title, 'DVDTube')
    assert.equal(info.resolution, '1920x1080')
    assert.equal(info.disableBackHistoryAPI, true)
    assert.equal(info.handlesRelaunch, true)
    assert.deepEqual(pngSize(join(APP, info.icon)), [80, 80])
    assert.deepEqual(pngSize(join(APP, info.largeIcon)), [130, 130])
    assert.deepEqual(pngSize(join(APP, info.splashBackground)), [1920, 1080])
    for (const f of ['index.html', 'app.js', 'app.css']) assert.ok(existsSync(join(APP, f)), f)
    const html = readFileSync(join(APP, 'index.html'), 'utf8')
    assert.ok(html.includes('app.js') && html.includes('app.css'))
    assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]+"/g, '')), 'no remote resources in index.html')
  })

  test('service package: id, version, one service.js', () => {
    const services = JSON.parse(readFileSync(join(SERVICE, 'services.json'), 'utf8'))
    assert.equal(services.id, 'com.dangdvd.dvdtube.service')
    assert.deepEqual(services.services.map((s: { name: string }) => s.name), ['com.dangdvd.dvdtube.service'])
    const pkg = JSON.parse(readFileSync(join(SERVICE, 'package.json'), 'utf8'))
    assert.equal(pkg.main, 'service.js')
    const app = JSON.parse(readFileSync(join(APP, 'appinfo.json'), 'utf8'))
    assert.equal(pkg.version, app.version)
    assert.ok(services.id.startsWith(`${app.id}.`), 'the service id must extend the app id')
  })
})

describe('bundle compatibility', () => {
  for (const [file, target] of [
    [join(SERVICE, 'service.js'), 'node8'],
    [join(APP, 'app.js'), 'chrome68'],
  ] as const) {
    test(`${target}: ${file.slice(ROOT.length + 1)}`, () => {
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'compat.mjs'), file, target], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr || r.stdout)
    })
  }

  test('service.js only requires Node built-ins (without node: prefix) and webos-service', () => {
    const code = readFileSync(join(SERVICE, 'service.js'), 'utf8')
    const required = new Set<string>()
    for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) required.add(m[1])
    assert.ok(required.has('webos-service'))
    for (const name of required) {
      if (name === 'webos-service') continue
      assert.ok(!name.startsWith('node:'), `${name}: Node 8 has no node: prefix`)
      assert.ok(builtinModules.includes(name), `${name} is not a built-in module`)
      assert.ok(!['worker_threads', 'perf_hooks', 'async_hooks', 'http2', 'inspector', 'trace_events'].includes(name), `${name} is missing / experimental on Node 8`)
    }
  })

  test('the interface talks to the service over the luna bus and keeps no cookies', () => {
    const code = readFileSync(join(APP, 'app.js'), 'utf8')
    assert.ok(code.includes('PalmServiceBridge'))
    assert.ok(code.includes('luna://com.dangdvd.dvdtube.service'))
    assert.ok(!/document\.cookie\s*=/.test(code), 'no cookies in the web view')
  })
})

// MARK: service.js on the fake bus

interface Child {
  proc: ChildProcess
  call(method: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>>
  subscribe(method: string, onResponse: (payload: Record<string, unknown>) => void): { id: number; cancel(): void }
  exited: Promise<{ reason: string | null; code: number | null }>
  output: () => string
}

function startService(execPath: string): Child {
  const proc = fork(join(SERVICE, 'service.js'), [], {
    execPath,
    cwd: SERVICE,
    env: { ...process.env, NODE_PATH: join(ROOT, 'tools', 'fake-modules'), FAKE_LUNA_IDLE_SECONDS: '1.5', NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let out = ''
  proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
  proc.stderr?.on('data', (d: Buffer) => (out += d.toString()))
  let nextId = 1
  const handlers = new Map<number, (p: Record<string, unknown>) => void>()
  let exitReason: string | null = null
  proc.on('message', (msg: { type: string; id?: number; payload?: Record<string, unknown>; reason?: string }) => {
    if (msg.type === 'response' && msg.id !== undefined) handlers.get(msg.id)?.(msg.payload ?? {})
    if (msg.type === 'exit') exitReason = msg.reason ?? null
  })
  const exited = new Promise<{ reason: string | null; code: number | null }>((resolve) => proc.on('exit', (code) => resolve({ reason: exitReason, code })))
  return {
    proc,
    exited,
    output: () => out,
    call(method, payload = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method}: no answer\n${out}`)), 20_000)
        handlers.set(id, (p) => {
          clearTimeout(timer)
          handlers.delete(id)
          resolve(p)
        })
        proc.send({ type: 'call', id, method, payload })
      })
    },
    subscribe(method, onResponse) {
      const id = nextId++
      handlers.set(id, onResponse)
      proc.send({ type: 'call', id, method, payload: { subscribe: true } })
      return { id, cancel: () => proc.send({ type: 'cancel', id }) }
    },
  }
}

async function apiCall(port: number, token: string, method: string, ...args: unknown[]): Promise<{ ok: boolean; result?: any; error?: string }> {
  const r = await fetch(`http://127.0.0.1:${port}/api/call?m=${method}`, { method: 'POST', body: JSON.stringify({ t: token, args }) })
  return (await r.json()) as { ok: boolean; result?: unknown }
}

const nodes: [string, string][] = [['current Node', process.execPath]]
if (process.env.OLD_NODE) nodes.push([`OLD_NODE ${process.env.OLD_NODE}`, process.env.OLD_NODE])

for (const [label, execPath] of nodes) {
  test(`Node 8 self-check: polyfills, fetcher, player, relay, pairing, sync (${label})`, { timeout: 60_000 }, () => {
    const r = spawnSync(execPath, [join(ROOT, 'out-test', 'node8-selfcheck.js')], { encoding: 'utf8', timeout: 50_000, env: { ...process.env, NODE_OPTIONS: '' } })
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
    assert.match(r.stdout, /SELFCHECK OK/)
  })

  describe(`service.js on the fake luna bus (${label})`, () => {
    test('start → HTTP API → keepAlive holds the service → cancel → idle exit', { timeout: 60_000 }, async () => {
      const child = startService(execPath)
      try {
        const started = await child.call('start')
        assert.equal(started.returnValue, true, child.output())
        const port = started.port as number
        const token = started.token as string
        assert.ok(port > 0)
        assert.match(token, /^[0-9a-f]{32}$/)
        assert.match(String(started.version), /^\d+\.\d+\.\d+$/)

        const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { ok: boolean; app: string }
        assert.deepEqual([health.ok, health.app], [true, 'DVDTube'])
        const info = await apiCall(port, token, 'appInfo')
        assert.equal(info.ok, true)
        assert.equal(info.result.platform, 'webos')
        assert.equal(info.result.node, started.node)
        const bad = await apiCall(port, token, 'watchInfo', '???')
        assert.deepEqual([bad.ok, bad.error], [false, 'Mã video không hợp lệ.'])

        const unknown = await child.call('nothing')
        assert.equal(unknown.returnValue, false)

        const answers: Record<string, unknown>[] = []
        const sub = child.subscribe('keepAlive', (p) => answers.push(p))
        // Longer than the idle timeout: the subscription keeps the service running.
        await new Promise((r) => setTimeout(r, 2500))
        assert.equal(child.proc.exitCode, null, `service exited while subscribed\n${child.output()}`)
        assert.equal(answers[0]?.subscribed, true)
        assert.equal(answers[0]?.port, port)
        assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)

        sub.cancel()
        const t0 = Date.now()
        const exit = await child.exited
        assert.equal(exit.reason, 'idle')
        assert.equal(exit.code, 0)
        assert.ok(Date.now() - t0 < 10_000)
        assert.match(child.output(), /keepAlive cancelled/)
        assert.ok(!/uncaught|unhandled rejection/i.test(child.output()), child.output())
      } finally {
        if (child.proc.exitCode === null) child.proc.kill()
      }
    })
  })
}
