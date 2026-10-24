// A thin, read-only wrapper around parsed JSON (port of the Android `JNode`). InnerTube
// responses are huge and their shape changes often, so instead of strict models we navigate
// them defensively: every lookup returns a node and a missing key simply yields an empty node.

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INT_PATTERN = /^\s*[-+]?\d+\s*$/
const NUMBER_PATTERN = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/

export class JNode {
  static readonly EMPTY = new JNode(null)

  constructor(readonly raw: unknown) {}

  static parse(text: string): JNode {
    return new JNode(JSON.parse(text))
  }

  get(key: string | number): JNode {
    if (typeof key === 'number') {
      if (!Array.isArray(this.raw)) return JNode.EMPTY
      return key >= 0 && key < this.raw.length ? new JNode(this.raw[key]) : JNode.EMPTY
    }
    if (!isObject(this.raw)) return JNode.EMPTY
    return Object.prototype.hasOwnProperty.call(this.raw, key) ? new JNode(this.raw[key]) : JNode.EMPTY
  }

  /** Follows a path of keys, e.g. `node.at('a', 'b', 'c')`. */
  at(...keys: string[]): JNode {
    let node: JNode = this
    for (const key of keys) {
      node = node.get(key)
      if (!node.exists) return JNode.EMPTY
    }
    return node
  }

  get exists(): boolean {
    return this.raw !== null && this.raw !== undefined
  }

  get keys(): string[] {
    return isObject(this.raw) ? Object.keys(this.raw) : []
  }

  get isArray(): boolean {
    return Array.isArray(this.raw)
  }

  get array(): JNode[] {
    return Array.isArray(this.raw) ? this.raw.map((value) => new JNode(value)) : []
  }

  get first(): JNode {
    return this.get(0)
  }

  get string(): string | null {
    const value = this.raw
    if (typeof value === 'string') return value
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
    if (typeof value === 'boolean') return String(value)
    return null
  }

  get int(): number | null {
    const value = this.raw
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
    if (typeof value === 'string' && INT_PATTERN.test(value)) {
      const parsed = parseInt(value, 10)
      return Number.isSafeInteger(parsed) ? parsed : null
    }
    return null
  }

  /** Same as `int` (JS numbers hold every value YouTube sends exactly up to 2^53). */
  get long(): number | null {
    return this.int
  }

  get double(): number | null {
    const value = this.raw
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string' && NUMBER_PATTERN.test(value)) return parseFloat(value)
    return null
  }

  get bool(): boolean | null {
    const value = this.raw
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value === 'true'
    if (typeof value === 'number') return Math.trunc(value) !== 0
    return null
  }

  /**
   * Human readable text from the many shapes InnerTube uses: plain strings, `{simpleText}`,
   * `{runs: [{text}]}` and `{content}`.
   */
  get text(): string | null {
    if (typeof this.raw === 'string') return this.raw
    const simple = this.get('simpleText').string
    if (simple !== null) return simple
    const runs = this.get('runs')
    if (runs.isArray) {
      const joined = runs.array
        .map((run) => run.get('text').raw)
        .filter((text): text is string => typeof text === 'string')
        .join('')
      return joined === '' ? null : joined
    }
    const content = this.get('content').string
    if (content !== null) return content
    const text = this.get('text')
    if (typeof text.raw === 'string') return text.raw
    if (text.exists) return text.text
    return null
  }

  /** Depth-first search for every value stored under `key`. */
  findAll(key: string, limit = Number.MAX_SAFE_INTEGER): JNode[] {
    const results: JNode[] = []
    collect(this.raw, key, results, limit)
    return results
  }

  findFirst(key: string): JNode {
    return this.findAll(key, 1)[0] ?? JNode.EMPTY
  }

  /** URL of the widest image in `{thumbnails: […]}` or `{sources: […]}` lists. */
  get bestImageUrl(): string | null {
    let candidates = this.get('thumbnails').array
    if (candidates.length === 0) candidates = this.get('sources').array
    if (candidates.length === 0) candidates = this.array
    let best: JNode | null = null
    let bestWidth = -1
    for (const candidate of candidates) {
      const width = candidate.get('width').int ?? 0
      if (width > bestWidth) {
        best = candidate
        bestWidth = width
      }
    }
    const url = best?.get('url').string
    return url ? youtubeImage(url) : null
  }

  toString(): string {
    return this.raw === undefined ? 'null' : JSON.stringify(this.raw)
  }
}

function collect(value: unknown, key: string, results: JNode[], limit: number): void {
  if (results.length >= limit) return
  if (Array.isArray(value)) {
    for (const item of value) {
      collect(item, key, results, limit)
      if (results.length >= limit) return
    }
    return
  }
  if (!isObject(value)) return
  for (const k of Object.keys(value)) {
    const v = value[k]
    if (k === key) {
      results.push(new JNode(v))
      if (results.length >= limit) return
    } else {
      collect(v, key, results, limit)
    }
    if (results.length >= limit) return
  }
}

/** Image URLs from InnerTube are sometimes protocol-relative (`//yt3.ggpht.com/…`). */
export function youtubeImage(url: string): string {
  return url.startsWith('//') ? 'https:' + url : url
}
