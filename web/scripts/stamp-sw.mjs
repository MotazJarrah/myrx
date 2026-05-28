// Postbuild step — replaces the __SW_BUILD_VERSION__ placeholder in
// the built service worker with a per-build timestamp. This guarantees
// every production deploy generates fresh cache names (myrx-assets-XXX
// + myrx-shell-XXX), which makes the SW's activate handler reliably
// wipe all caches from the previous deploy.
//
// Without this stamping, the cache name only changed when we manually
// bumped v4 → v5 in source, which is error-prone — and a forgotten
// bump means the new SW reuses old (possibly poisoned) caches.
//
// Runs from: package.json "postbuild": "node scripts/stamp-sw.mjs"
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SW_PATH = resolve('dist/sw.js')

const stamp = new Date().toISOString()
  .replace(/[:.]/g, '-')
  .replace(/T/, 'T')
  .slice(0, 19) // 2026-05-25T12-34-56

const original = readFileSync(SW_PATH, 'utf8')
if (!original.includes('__SW_BUILD_VERSION__')) {
  console.warn('[stamp-sw] WARNING: __SW_BUILD_VERSION__ placeholder not found in', SW_PATH)
  console.warn('[stamp-sw] The SW may already be stamped, or the placeholder was removed.')
  process.exit(0)
}

const stamped = original.replace(/__SW_BUILD_VERSION__/g, stamp)
writeFileSync(SW_PATH, stamped)
console.log(`[stamp-sw] sw.js stamped with build version: ${stamp}`)
