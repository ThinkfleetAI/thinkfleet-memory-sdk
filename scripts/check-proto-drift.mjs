#!/usr/bin/env node
// Guards the SDK against silently falling behind the engine's RPC surface.
//
// Parses the RPC names out of the vendored proto/memory.proto and checks that
// every one is classified in proto/coverage.json (either `covered` — has an SDK
// method — or `internal` — intentionally not exposed). Fails if:
//   - a proto RPC is in neither list (new engine capability → classify it), or
//   - coverage.json lists an RPC that no longer exists in the proto (stale).
//
// Run: `npm run check:proto`. Wire into CI so bumping the vendored proto forces
// a conscious decision about each new RPC.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const proto = readFileSync(join(root, 'proto', 'memory.proto'), 'utf8')
const coverage = JSON.parse(readFileSync(join(root, 'proto', 'coverage.json'), 'utf8'))

const protoRpcs = new Set(
  [...proto.matchAll(/^\s*rpc\s+([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]),
)
const classified = new Set([
  ...Object.keys(coverage.covered ?? {}),
  ...Object.keys(coverage.internal ?? {}),
])

const unclassified = [...protoRpcs].filter((r) => !classified.has(r))
const stale = [...classified].filter((r) => !protoRpcs.has(r))

let failed = false
if (unclassified.length > 0) {
  failed = true
  console.error(
    `\n✗ ${unclassified.length} engine RPC(s) not classified in proto/coverage.json:\n` +
      unclassified.map((r) => `    - ${r}`).join('\n') +
      `\n  Add each to "covered" (with its SDK method) or "internal" (with a reason).`,
  )
}
if (stale.length > 0) {
  failed = true
  console.error(
    `\n✗ ${stale.length} RPC(s) in coverage.json no longer exist in the proto:\n` +
      stale.map((r) => `    - ${r}`).join('\n'),
  )
}

if (failed) {
  process.exit(1)
}

console.log(
  `✓ proto in sync: ${protoRpcs.size} RPCs — ` +
    `${Object.keys(coverage.covered ?? {}).length} covered, ` +
    `${Object.keys(coverage.internal ?? {}).length} internal.`,
)
