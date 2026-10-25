// The few APIs Chromium 68 (webOS TV 5.0) lacks and the interface or the shared modules use.
// (Syntax is lowered by esbuild with target chrome68.)

/* eslint-disable @typescript-eslint/no-explicit-any */

function define(target: object, name: string, value: unknown): void {
  if (!(name in target)) Object.defineProperty(target, name, { configurable: true, writable: true, value })
}

define(Array.prototype, 'flat', function flat(this: unknown[], depth = 1): unknown[] {
  const out: unknown[] = []
  const walk = (list: unknown[], d: number) => {
    for (const item of list) {
      if (Array.isArray(item) && d > 0) walk(item, d - 1)
      else out.push(item)
    }
  }
  walk(this, Math.floor(Number(depth)) || 0)
  return out
})

define(Array.prototype, 'flatMap', function flatMap(this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, thisArg?: unknown): unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < this.length; i++) {
    const value = fn.call(thisArg, this[i], i, this)
    if (Array.isArray(value)) out.push(...value)
    else out.push(value)
  }
  return out
})

define(Object, 'fromEntries', function fromEntries(entries: Iterable<[PropertyKey, unknown]>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of entries as Iterable<[PropertyKey, unknown]>) out[key as string] = value
  return out
})

if (typeof (window as any).queueMicrotask !== 'function') {
  ;(window as any).queueMicrotask = (fn: () => void) => {
    Promise.resolve().then(fn)
  }
}

if (typeof (Promise as any).allSettled !== 'function') {
  ;(Promise as any).allSettled = (items: Iterable<unknown>) =>
    Promise.all(
      Array.from(items, (item) =>
        Promise.resolve(item).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
      ),
    )
}

define(String.prototype, 'replaceAll', function replaceAll(this: string, search: string, replacement: string) {
  return this.split(search).join(replacement)
})

export {}
