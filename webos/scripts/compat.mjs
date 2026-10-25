// Checks that a bundle only uses syntax the oldest supported webOS TV understands: the service
// runs on Node.js 8.12 (ES2017 + the regex features of V8 6.2), the interface on Chromium 68
// (ES2019 syntax without optional chaining / nullish coalescing / class fields). Also reports
// APIs that must come from our polyfills when they are not installed by them.

import { readFileSync } from 'node:fs'
import { parse } from 'acorn'

const TARGETS = {
  node8: { ecmaVersion: 2017, polyfilled: ['flatMap', 'fromEntries', 'randomUUID', 'queueMicrotask', 'RelativeTimeFormat', 'AbortController'] },
  chrome68: { ecmaVersion: 2019, polyfilled: ['flatMap', 'fromEntries', 'queueMicrotask'] },
}

/** @returns {string[]} problems (empty = fine) */
export function checkCompat(file, target) {
  const code = readFileSync(file, 'utf8')
  const settings = TARGETS[target]
  const problems = []
  try {
    parse(code, { ecmaVersion: settings.ecmaVersion, sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true })
  } catch (error) {
    const pos = typeof error.pos === 'number' ? error.pos : 0
    problems.push(`${file} (${target}): ${error.message} near: ${JSON.stringify(code.slice(Math.max(0, pos - 60), pos + 60))}`)
  }
  // The polyfills must be part of the bundle when the code uses those APIs.
  for (const name of settings.polyfilled) {
    const used = new RegExp(`[.\\s]${name}\\b`).test(code)
    if (used && !code.includes(`"${name}"`) && !code.includes(`'${name}'`) && !code.includes(`.${name} =`) && !code.includes(`.${name}=`)) {
      problems.push(`${file} (${target}): uses ${name} but no polyfill for it is bundled`)
    }
  }
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, target] = process.argv.slice(2)
  const problems = checkCompat(file, target)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.log(`${file}: OK for ${target}`)
}
