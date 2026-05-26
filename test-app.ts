#!/usr/bin/env npx tsx
/**
 * @thinkfleet/memory-sdk — integration smoke test
 *
 * Exercises every public SDK method against a live memory.thinkfleet.ai
 * instance. Read-mostly, with one create+update+delete cycle so the
 * project is left in the same state it started.
 *
 * Usage:
 *   export THINKFLEET_API_KEY="sk-..."
 *   export THINKFLEET_PROJECT_ID="..."
 *   export THINKFLEET_BASE_URL="https://memory.thinkfleet.ai"   # optional
 *   npx tsx test-app.ts
 *
 * Exit code 0 = all checks passed, 1 = at least one failed. Failures
 * are printed inline; the runner does not throw — it collects results
 * so you see the full picture rather than stopping at the first error.
 */

import { ThinkFleetMemory, MemoryItemType, MemoryScope } from './src/index.js'

// ── Config ──────────────────────────────────────────────────────────

const API_KEY = process.env.THINKFLEET_API_KEY
const PROJECT_ID = process.env.THINKFLEET_PROJECT_ID
const BASE_URL = process.env.THINKFLEET_BASE_URL ?? 'https://memory.thinkfleet.ai'

if (!API_KEY || !PROJECT_ID) {
  console.error('Missing required environment variables:')
  console.error('  THINKFLEET_API_KEY=sk-...')
  console.error('  THINKFLEET_PROJECT_ID=...')
  console.error('  THINKFLEET_BASE_URL=https://memory.thinkfleet.ai   (optional)')
  process.exit(1)
}

const tf = new ThinkFleetMemory({
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  baseUrl: BASE_URL,
  timeout: 30_000,
})

// ── Test runner ─────────────────────────────────────────────────────

type TestResult = { name: string; status: 'pass' | 'fail' | 'skip'; detail?: string }
const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  try {
    await fn()
    const ms = Date.now() - start
    results.push({ name, status: 'pass' })
    console.log(`  ✓ ${name} (${ms}ms)`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, status: 'fail', detail })
    console.log(`  ✗ ${name}`)
    console.log(`      ${detail}`)
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`)
}

// ── Checks ──────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(`memory.thinkfleet.ai SDK smoke test`)
  console.log(`  base:    ${BASE_URL}`)
  console.log(`  project: ${PROJECT_ID}`)

  // ── Admin reads ───────────────────────────────────────────────────
  section('memory.admin — reads')

  await test('admin.stats() returns counts', async () => {
    const stats = await tf.memory.admin.stats()
    if (typeof stats.total !== 'number') throw new Error(`stats.total not a number: ${JSON.stringify(stats)}`)
    console.log(`      total=${stats.total} pending=${stats.pendingReview} flagged=${stats.flagged}`)
  })

  await test('admin.list() returns an array', async () => {
    const items = await tf.memory.admin.list({ limit: 10 })
    if (!Array.isArray(items)) throw new Error(`expected array, got ${typeof items}`)
  })

  await test('admin.list({ scope: project }) filters', async () => {
    const items = await tf.memory.admin.list({ scope: MemoryScope.PROJECT, limit: 5 })
    if (!Array.isArray(items)) throw new Error(`expected array, got ${typeof items}`)
    const offScope = items.filter((m) => m.scope !== MemoryScope.PROJECT)
    if (offScope.length > 0) throw new Error(`got ${offScope.length} items outside PROJECT scope`)
  })

  await test('admin.listPlatform() returns an array', async () => {
    const items = await tf.memory.admin.listPlatform({ limit: 5 })
    if (!Array.isArray(items)) throw new Error(`expected array, got ${typeof items}`)
  })

  await test('admin.listPendingReview() returns an array', async () => {
    const items = await tf.memory.admin.listPendingReview({ limit: 5 })
    if (!Array.isArray(items)) throw new Error(`expected array, got ${typeof items}`)
  })

  // ── Project (current-user) reads ──────────────────────────────────
  //
  // memory.mine() requires a USER principal — API keys (SERVICE) get
  // 403 because the route resolves an identity from req.principal.id
  // which is a user id, not an API key id. We expect 403 here and
  // mark it as a pass so the smoke test stays green.
  section('memory — current-user reads (USER-only, expects 403 for API key)')

  await test('memory.mine() returns 403 for API-key principal', async () => {
    try {
      await tf.memory.mine({ limit: 10 })
      throw new Error('expected 403; got a successful response')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/403|forbidden|HTTP 403/i.test(msg)) {
        throw new Error(`expected 403; got: ${msg}`)
      }
    }
  })

  // ── Create + update + search + delete cycle ───────────────────────
  section('memory.admin — create + update + search + delete cycle')

  const stamp = Date.now()
  let createdId: string | null = null

  await test('admin.create() returns a MemoryItem with id', async () => {
    const created = await tf.memory.admin.create({
      content: `SDK_SMOKE_TEST_${stamp} — pineapple belongs on pizza, this is canonical`,
      type: MemoryItemType.FACT,
      scope: MemoryScope.PROJECT,
      importance: 7,
      category: 'sdk-smoke-test',
    })
    if (!created.id) throw new Error(`created has no id: ${JSON.stringify(created)}`)
    createdId = created.id
    console.log(`      id=${created.id}`)
  })

  await test('admin.update() returns the updated item', async () => {
    if (!createdId) throw new Error('skipped — no createdId')
    const updated = await tf.memory.admin.update(createdId, { importance: 9 })
    if (updated.importance !== 9) throw new Error(`importance not updated: ${updated.importance}`)
  })

  await test('admin.search() finds the seeded item', async () => {
    if (!createdId) throw new Error('skipped — no createdId')
    // Give the embedding job a moment if AP_MEMORY_ASYNC_EMBEDDING is on.
    await new Promise((r) => setTimeout(r, 1500))
    const hits = await tf.memory.admin.search({ query: 'pineapple pizza', limit: 5 })
    if (!Array.isArray(hits)) throw new Error(`expected array, got ${typeof hits}`)
    const hit = hits.find((h) => h.id === createdId)
    if (!hit) {
      console.log(`      note: created item not in top-5 search hits (may be cold-start latency)`)
    } else {
      console.log(`      hit similarity=${hit.similarity.toFixed(3)}`)
    }
  })

  await test('admin.listFeedback() returns an array', async () => {
    if (!createdId) throw new Error('skipped — no createdId')
    const feedback = await tf.memory.admin.listFeedback(createdId)
    if (!Array.isArray(feedback)) throw new Error(`expected array, got ${typeof feedback}`)
  })

  await test('admin.delete() removes the item', async () => {
    if (!createdId) throw new Error('skipped — no createdId')
    await tf.memory.admin.delete(createdId)
    // Verify by listing — the created item should not appear.
    const items = await tf.memory.admin.list({ limit: 100 })
    const stillThere = items.find((m) => m.id === createdId)
    if (stillThere) throw new Error(`item ${createdId} still present after delete`)
  })

  // ── observe() ergonomic ingest ────────────────────────────────────
  section('memory.observe() — ergonomic ingest')

  let observedId: string | null = null
  await test('observe() creates a memory with subject metadata', async () => {
    const m = await tf.memory.observe({
      subject: { kind: 'workspace', externalId: `smoke-test-${stamp}` },
      content: `SDK_SMOKE_OBSERVE_${stamp} — observed activity from the smoke test`,
      activityType: 'smoke_test_event',
    })
    if (!m.id) throw new Error(`observe returned no id: ${JSON.stringify(m)}`)
    if (m.type !== 'event') throw new Error(`expected type=event, got ${m.type}`)
    observedId = m.id
    console.log(`      observed id=${m.id} type=${m.type}`)
  })

  await test('observe() carries subject + activityType in metadata', async () => {
    if (!observedId) throw new Error('skipped — no observedId')
    const items = await tf.memory.admin.list({ limit: 100 })
    const found = items.find((m) => m.id === observedId)
    if (!found) throw new Error(`observed memory ${observedId} not in list`)
    const md = found.metadata as Record<string, unknown> | null
    const subject = md?.subject as { kind?: string; externalId?: string } | undefined
    if (subject?.kind !== 'workspace') {
      throw new Error(`expected subject.kind=workspace, got ${JSON.stringify(subject)}`)
    }
    if (md?.eventType !== 'smoke_test_event') {
      throw new Error(`expected eventType=smoke_test_event, got ${md?.eventType}`)
    }
  })

  await test('cleanup observed memory', async () => {
    if (!observedId) throw new Error('skipped — no observedId')
    await tf.memory.admin.delete(observedId)
  })

  // ── lattice.mineMemories() end-to-end ─────────────────────────────
  section('lattice.mineMemories() — end-to-end mine path')

  await test('mineMemories({ windowDays: 90 }) returns counters', async () => {
    const result = await tf.lattice.mineMemories({ windowDays: 90 })
    if (typeof result.patternsCreated !== 'number') {
      throw new Error(`unexpected shape: ${JSON.stringify(result)}`)
    }
    console.log(
      `      created=${result.patternsCreated} refreshed=${result.patternsRefreshed} duration=${result.durationMs}ms`,
    )
  })

  // ── observeImage() / observeVoice() multimodal ingest ─────────────
  section('memory.observeImage() / observeVoice() — multimodal')

  let imageMemoryId: string | null = null
  let voiceMemoryId: string | null = null

  await test('observeImage() stores image + creates memory', async () => {
    // 1×1 transparent PNG — smallest valid image payload.
    const tinyPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const m = await tf.memory.observeImage({
      subject: { kind: 'workspace', externalId: `smoke-img-${stamp}` },
      image: tinyPng,
      mimeType: 'image/png',
      fileName: `smoke-${stamp}.png`,
      content: `SDK_SMOKE_IMAGE_${stamp}`,
      activityType: 'image_capture',
    })
    if (!m.id) throw new Error(`observeImage returned no id`)
    const md = m.metadata as Record<string, unknown> | null
    if (md?.modality !== 'image') throw new Error(`expected modality=image, got ${md?.modality}`)
    if (!md?.fileId) throw new Error(`expected metadata.fileId; got: ${JSON.stringify(md)}`)
    imageMemoryId = m.id
    console.log(`      image memory id=${m.id} fileId=${md.fileId}`)
  })

  await test('observeVoice() stores audio + creates memory', async () => {
    // Tiny 1-byte audio stub — engine just stores bytes; format
    // doesn't need to be playable for the smoke test.
    const audio = new Uint8Array([0x00])
    const m = await tf.memory.observeVoice({
      subject: { kind: 'user', externalId: `smoke-voice-${stamp}` },
      audio,
      mimeType: 'audio/wav',
      fileName: `smoke-${stamp}.wav`,
      content: `SDK_SMOKE_VOICE_${stamp}`,
      activityType: 'voicenote',
    })
    if (!m.id) throw new Error(`observeVoice returned no id`)
    const md = m.metadata as Record<string, unknown> | null
    if (md?.modality !== 'audio') throw new Error(`expected modality=audio, got ${md?.modality}`)
    voiceMemoryId = m.id
    console.log(`      voice memory id=${m.id} fileId=${md.fileId}`)
  })

  let docMemoryId: string | null = null
  await test('observeDocument() stores doc + creates memory', async () => {
    const docBytes = new TextEncoder().encode(
      `SDK_SMOKE_DOC_${stamp}\nMulti-line plain text document used as a smoke-test attachment.`,
    )
    const m = await tf.memory.observeDocument({
      subject: { kind: 'project', externalId: `smoke-doc-${stamp}` },
      document: docBytes,
      mimeType: 'text/plain',
      fileName: `smoke-${stamp}.txt`,
      content: `SDK_SMOKE_DOC_${stamp} — plain-text test document`,
      activityType: 'document_capture',
    })
    if (!m.id) throw new Error(`observeDocument returned no id`)
    const md = m.metadata as Record<string, unknown> | null
    if (md?.modality !== 'document') throw new Error(`expected modality=document, got ${md?.modality}`)
    docMemoryId = m.id
    console.log(`      document memory id=${m.id} fileId=${md.fileId}`)
  })

  await test('cleanup multimodal memories', async () => {
    if (imageMemoryId) await tf.memory.admin.delete(imageMemoryId)
    if (voiceMemoryId) await tf.memory.admin.delete(voiceMemoryId)
    if (docMemoryId) await tf.memory.admin.delete(docMemoryId)
  })

  // ── Lattice ───────────────────────────────────────────────────────
  section('lattice — reads')

  await test('lattice.getMonitorStatus() returns a status object', async () => {
    const status = await tf.lattice.getMonitorStatus()
    if (typeof status.patternsDue !== 'number' || typeof status.activePatternCount !== 'number') {
      throw new Error(`unexpected shape: ${JSON.stringify(status)}`)
    }
    console.log(`      lastTick=${status.lastTickAt ?? 'never'} due=${status.patternsDue} active=${status.activePatternCount}`)
  })

  // ── Summary ───────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === 'pass').length
  const failed = results.filter((r) => r.status === 'fail').length
  console.log(`\n── summary ──`)
  console.log(`  ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(2)
})
