#!/usr/bin/env npx tsx
/**
 * Memory seed script — populates a project with realistic memories
 * so the AdminMemoryPage has data to display while developing or
 * demoing.
 *
 * Theme: AI-engineering team's institutional knowledge base.
 *
 * Usage:
 *   API_KEY=sk-... PROJECT_ID=proj_... BASE_URL=https://app.memmesh.ai \
 *     npx tsx scripts/seed-memory.ts
 *
 * Flags:
 *   --cleanup-only   delete every memory tagged with category='sdk-seed' and exit
 *   --no-cleanup     skip the pre-seed cleanup step (default: clean then seed)
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

const tf = new ThinkFleetMemory({
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  baseUrl: BASE_URL,
  timeout: 30_000,
})

const SEED_CATEGORY = 'sdk-seed'

// ── Seed data ───────────────────────────────────────────────────────

interface SeedItem {
  content: string
  type: MemoryItemType
  scope: MemoryScope
  importance: number
}

const SEED: SeedItem[] = [
  // ── Platform-wide knowledge (compliance + cross-product rules) ──
  {
    content: 'GDPR requires customer-data deletion within 30 days of an Article 17 request.',
    type: MemoryItemType.RULE,
    scope: MemoryScope.PLATFORM,
    importance: 10,
  },
  {
    content: 'Never store API keys, OAuth tokens, or session secrets in chat transcripts. Redact on ingest.',
    type: MemoryItemType.RULE,
    scope: MemoryScope.PLATFORM,
    importance: 10,
  },
  {
    content: 'All AI-generated customer communications must be reviewable in the audit log for 7 years (SOC 2 retention).',
    type: MemoryItemType.RULE,
    scope: MemoryScope.PLATFORM,
    importance: 9,
  },

  // ── Project-level facts + preferences ─────────────────────────
  {
    content: 'Enterprise-tier customers prefer email over phone for non-urgent issues; SMS only for outage notifications.',
    type: MemoryItemType.PREFERENCE,
    scope: MemoryScope.PROJECT,
    importance: 8,
  },
  {
    content: 'Refund requests over $500 require manager approval before issuance.',
    type: MemoryItemType.RULE,
    scope: MemoryScope.PROJECT,
    importance: 9,
  },
  {
    content: 'The primary support channel for premium-tier customers is the shared Slack Connect channel, not email.',
    type: MemoryItemType.FACT,
    scope: MemoryScope.PROJECT,
    importance: 7,
  },
  {
    content: 'Our SLA for P0 incidents is 15-minute first response, 4-hour resolution.',
    type: MemoryItemType.FACT,
    scope: MemoryScope.PROJECT,
    importance: 9,
  },
  {
    content: 'Quarterly business reviews land on the second Thursday of January, April, July, and October.',
    type: MemoryItemType.EVENT,
    scope: MemoryScope.PROJECT,
    importance: 6,
  },
  {
    content: 'When customers ask about model accuracy, link to the eval methodology doc rather than quoting numbers verbatim — the eval set is versioned and the numbers shift between releases.',
    type: MemoryItemType.INSIGHT,
    scope: MemoryScope.PROJECT,
    importance: 7,
  },
  {
    content: 'Customers in the EU region must be served via the eu-west-1 endpoint to satisfy data-residency requirements.',
    type: MemoryItemType.RULE,
    scope: MemoryScope.PROJECT,
    importance: 9,
  },
  {
    content: 'Tickets created between 10pm and 6am Pacific are tagged "after-hours" and routed to the on-call rotation.',
    type: MemoryItemType.OBSERVATION,
    scope: MemoryScope.PROJECT,
    importance: 5,
  },
  {
    content: 'The onboarding email template was rewritten 2026-03-12 to mention the desktop runner explicitly — older drafts still reference the deprecated browser-only flow.',
    type: MemoryItemType.CORRECTION,
    scope: MemoryScope.PROJECT,
    importance: 6,
  },
  {
    content: 'Common cause of "MCP tool not found" errors in support tickets: customer is on the wrong plan tier — MCP gated to Pro+.',
    type: MemoryItemType.INSIGHT,
    scope: MemoryScope.PROJECT,
    importance: 7,
  },
  {
    content: 'Q1 2026 NPS landed at 62 (industry benchmark ~45). Most-cited driver: response speed; most-cited blocker: documentation.',
    type: MemoryItemType.SUMMARY,
    scope: MemoryScope.PROJECT,
    importance: 6,
  },

  // ── User-scoped preferences ───────────────────────────────────
  {
    content: 'Prefers code examples in TypeScript over Python when given a choice.',
    type: MemoryItemType.PREFERENCE,
    scope: MemoryScope.USER,
    importance: 6,
  },
  {
    content: 'Likes the assistant to skip preamble — get straight to the answer, then explain if asked.',
    type: MemoryItemType.PREFERENCE,
    scope: MemoryScope.USER,
    importance: 7,
  },
  {
    content: 'Schedules deep-work blocks 9am–noon; prefers async responses during that window.',
    type: MemoryItemType.PREFERENCE,
    scope: MemoryScope.USER,
    importance: 5,
  },
  {
    content: 'Reviews PRs in batches on Friday afternoons — don\'t request review more than once per day.',
    type: MemoryItemType.OBSERVATION,
    scope: MemoryScope.USER,
    importance: 4,
  },

  // ── Agent-scoped (no chatbots in this product, but shown for type variety) ──
  // These will fall back to higher scope if chatbotId is null.
  {
    content: 'When summarizing technical incidents, lead with the customer impact, not the root cause.',
    type: MemoryItemType.RULE,
    scope: MemoryScope.PROJECT,
    importance: 7,
  },
]

// ── Cleanup ─────────────────────────────────────────────────────────

async function cleanupSeed(): Promise<number> {
  let total = 0
  let page = 0
  const pageSize = 100
  while (true) {
    const items = await tf.memory.admin.list({ limit: pageSize, offset: page * pageSize })
    if (items.length === 0) break
    const seeded = items.filter((m) => m.category === SEED_CATEGORY)
    for (const m of seeded) {
      await tf.memory.admin.delete(m.id)
      total++
    }
    if (items.length < pageSize) break
    page++
    if (page > 50) break // hard cap, prevents runaway loop
  }
  return total
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`app.memmesh.ai seed script`)
  console.log(`  base:    ${BASE_URL}`)
  console.log(`  project: ${PROJECT_ID}`)

  if (!noCleanup) {
    process.stdout.write(`\n→ Cleaning up prior seed data (category=${SEED_CATEGORY})... `)
    const deleted = await cleanupSeed()
    console.log(`deleted ${deleted}`)
  }

  if (cleanupOnly) {
    console.log('Done (cleanup-only).')
    return
  }

  console.log(`\n→ Seeding ${SEED.length} memories...`)
  let created = 0
  let failed = 0

  for (const item of SEED) {
    try {
      await tf.memory.admin.create({
        content: item.content,
        type: item.type,
        scope: item.scope,
        importance: item.importance,
        category: SEED_CATEGORY,
        source: 'admin_created',
      })
      created++
      process.stdout.write('.')
    } catch (err) {
      failed++
      process.stdout.write('x')
      console.log(`\n  failed: ${item.content.slice(0, 60)}...`)
      console.log(`  reason: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(`\n\n✓ Seeded ${created}/${SEED.length} memories (${failed} failed)`)

  const stats = await tf.memory.admin.stats()
  console.log(`\nProject totals after seed:`)
  console.log(`  total:          ${stats.total}`)
  console.log(`  pending review: ${stats.pendingReview}`)
  console.log(`  flagged:        ${stats.flagged}`)
  console.log(`  by scope:       ${JSON.stringify(stats.byScope)}`)
  console.log(`  by status:      ${JSON.stringify(stats.byStatus)}`)

  console.log(`\nDone. Open the AdminMemoryPage to see the data:`)
  console.log(`  ${BASE_URL.replace(/^https?:\/\/(api\.)?/, 'https://')}/projects/${PROJECT_ID}/agent-memory`)
  console.log(`\nTo wipe: npx tsx scripts/seed-memory.ts --cleanup-only`)
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
