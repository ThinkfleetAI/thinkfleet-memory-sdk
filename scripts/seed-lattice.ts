#!/usr/bin/env npx tsx
/**
 * Lattice seed script — generate shopping-shaped activity memories
 * across multiple subjects, then mine behavioral patterns from them.
 *
 * The script writes ~12 weeks of weekly-cadence "purchase" events as
 * memory items of type=event with metadata.subject (subject-agnostic
 * shape), then calls tf.lattice.mineMemories() to spin the Rust engine
 * and persist the resulting behavior_pattern memories.
 *
 * After it finishes, the AdminMemoryPage will show:
 *   - The raw event memories under All Memories (category=sdk-lattice-seed)
 *   - The mined behavior_pattern memories under All Memories
 *     (the same UI surface — patterns ARE memories on the storage side)
 *
 * Usage:
 *   API_KEY=sk-... PROJECT_ID=proj_... BASE_URL=https://app.memmesh.ai \
 *     npx tsx scripts/seed-lattice.ts
 *
 * Flags:
 *   --cleanup-only   delete every memory tagged with category='sdk-lattice-seed' and exit
 *   --no-cleanup     skip the pre-seed cleanup step (default: clean then seed)
 *   --no-mine        seed only; skip the lattice extraction step
 */

import { ThinkFleetMemory, MemoryItemType, MemoryScope } from '../src/index.js'

// ── Config ──────────────────────────────────────────────────────────

const API_KEY = process.env.API_KEY ?? process.env.THINKFLEET_API_KEY
const PROJECT_ID = process.env.PROJECT_ID ?? process.env.THINKFLEET_PROJECT_ID
const BASE_URL = process.env.BASE_URL ?? process.env.THINKFLEET_BASE_URL ?? 'https://app.memmesh.ai'

if (!API_KEY || !PROJECT_ID) {
  console.error('Missing required environment variables:')
  console.error('  API_KEY=sk-...')
  console.error('  PROJECT_ID=proj_...')
  console.error('  BASE_URL=https://app.memmesh.ai   (optional)')
  process.exit(1)
}

const args = process.argv.slice(2)
const cleanupOnly = args.includes('--cleanup-only')
const noCleanup = args.includes('--no-cleanup')
const noMine = args.includes('--no-mine')

const tf = new ThinkFleetMemory({
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  baseUrl: BASE_URL,
  timeout: 60_000,
})

const SEED_CATEGORY = 'sdk-lattice-seed'

// ── Subjects + cadences ─────────────────────────────────────────────

interface SubjectSpec {
  /** Subject kind. */
  kind: string
  /** External id within `kind`. */
  externalId: string
  /** Inter-event interval in days. */
  periodDays: number
  /** Number of events to generate, going back from today. */
  count: number
  /** Free-text description of what's being purchased / done. */
  activity: string
  /** Order total in USD (approximate; randomized ±20%). */
  approxValue: number
}

const SUBJECTS: SubjectSpec[] = [
  // Weekly coffee — classic recurring pattern.
  { kind: 'contact', externalId: 'sarah-pizza',
    periodDays: 7,  count: 12, activity: 'pizza order from Tony\'s',  approxValue: 38 },
  // Bi-weekly grocery delivery.
  { kind: 'contact', externalId: 'alex-grocery',
    periodDays: 14, count: 8,  activity: 'grocery delivery from Whole Foods', approxValue: 140 },
  // Monthly subscription renewal.
  { kind: 'contact', externalId: 'jordan-saas',
    periodDays: 30, count: 6,  activity: 'SaaS subscription renewal',  approxValue: 89 },
  // Daily dev tool usage — non-contact subject (workspace-scoped).
  { kind: 'workspace', externalId: 'ryan-laptop',
    periodDays: 1,  count: 30, activity: 'Claude Code session',        approxValue: 0 },
]

// ── Cleanup ─────────────────────────────────────────────────────────

async function cleanupSeed(): Promise<number> {
  let total = 0
  let offset = 0
  const pageSize = 200
  while (true) {
    const items = await tf.memory.admin.list({ limit: pageSize, offset })
    if (items.length === 0) break
    const seeded = items.filter((m) => m.category === SEED_CATEGORY)
    for (const m of seeded) {
      await tf.memory.admin.delete(m.id)
      total++
    }
    if (items.length < pageSize) break
    offset += pageSize
    if (offset > 5000) break // hard cap
  }
  // Patterns mined off the seed data carry source='lattice:mine_memories' —
  // those are valid behavior_pattern memories. Don't delete them on
  // category cleanup; let the next mine run supersede them naturally.
  return total
}

// ── Seed ────────────────────────────────────────────────────────────

function jitter(value: number, pct: number): number {
  return value * (1 + (Math.random() - 0.5) * 2 * pct)
}

async function seedSubject(spec: SubjectSpec): Promise<number> {
  let created = 0
  const now = Date.now()
  for (let i = 0; i < spec.count; i++) {
    // Anchor each event so the most recent fires today; spread back
    // by periodDays * (count - 1).
    const occurredMs = now - (spec.count - 1 - i) * spec.periodDays * 86_400_000
    const occurredIso = new Date(occurredMs).toISOString()
    const total = Math.round(jitter(spec.approxValue, 0.2) * 100) / 100

    try {
      await tf.memory.admin.create({
        content: `${spec.externalId} — ${spec.activity} ($${total})`,
        type: MemoryItemType.EVENT,
        scope: MemoryScope.PROJECT,
        importance: 5,
        category: SEED_CATEGORY,
        source: 'admin_created',
        metadata: {
          subject: { kind: spec.kind, externalId: spec.externalId },
          eventType: spec.activity.replace(/\s+/g, '_').toLowerCase(),
          occurredAt: occurredIso,
          total,
          currency: 'USD',
        },
      })
      created++
      process.stdout.write('.')
    } catch (err) {
      process.stdout.write('x')
      console.log(`\n  failed for ${spec.externalId} (i=${i}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return created
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('app.memmesh.ai lattice seed script')
  console.log(`  base:    ${BASE_URL}`)
  console.log(`  project: ${PROJECT_ID}`)

  if (!noCleanup) {
    process.stdout.write(`\n→ Cleaning up prior lattice seed data (category=${SEED_CATEGORY})... `)
    const deleted = await cleanupSeed()
    console.log(`deleted ${deleted}`)
  }

  if (cleanupOnly) {
    console.log('Done (cleanup-only).')
    return
  }

  console.log('\n→ Seeding subjects:')
  for (const spec of SUBJECTS) {
    console.log(`\n  ${spec.kind}:${spec.externalId} — every ${spec.periodDays}d × ${spec.count} events`)
    const n = await seedSubject(spec)
    console.log(`\n  seeded ${n}/${spec.count}`)
  }

  if (noMine) {
    console.log('\nDone (--no-mine: skipped extraction step).')
    return
  }

  console.log('\n→ Running lattice mine across the project...')
  const result = await tf.lattice.mineMemories({ windowDays: 180 })

  console.log('\nMining result:')
  console.log(`  subjects processed: ${result.contactsProcessed ?? '(n/a — engine uses subject count)'}`)
  console.log(`  patterns created:    ${result.patternsCreated}`)
  console.log(`  patterns refreshed:  ${result.patternsRefreshed}`)
  console.log(`  patterns deactivated:${result.patternsDeactivated}`)
  console.log(`  duration:            ${result.durationMs}ms`)

  console.log(`\nOpen the AdminMemoryPage to see both raw events + the mined behavior_pattern memories:`)
  console.log(`  ${BASE_URL}/projects/${PROJECT_ID}/agent-memory`)
  console.log('\nTo wipe seed data: npx tsx scripts/seed-lattice.ts --cleanup-only')
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
