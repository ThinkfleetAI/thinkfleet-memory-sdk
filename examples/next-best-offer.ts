#!/usr/bin/env npx tsx
/**
 * @thinkfleet/memory-sdk — Next Best Offer, end to end
 *
 * A working sample app for the question: *"which offer is right for this
 * contact, and when is the right time to send it?"* — and, crucially, *how
 * does the system get better at answering that every time an offer lands?*
 *
 * The loop it demonstrates:
 *
 *   1. LEARN     feed each contact's activity into memory, mine behavior
 *                patterns  (tf.memory.observe → tf.lattice.mineMemories)
 *   2. UNDERSTAND read the subject back: who they are + what they'll do next
 *                (tf.lattice.getProfile / tf.lattice.predict)
 *   3. DECIDE    ask Claude to pick the offer + send time, grounded in that
 *                signal AND in what has actually worked before
 *                (tf.learning.getEffectiveness → Claude → tf.learning.recordDecision)
 *   4. ACT+LEARN record the realized outcome; every pattern the decision leaned
 *                on is re-calibrated, so the next suggestion is smarter
 *                (tf.learning.recordOutcome → tf.learning.getEffectiveness)
 *
 * Division of responsibility: the ENGINE owns memory, pattern-mining,
 * prediction, and calibration. CLAUDE owns the judgement call (which offer,
 * when) — "your model, your key". This app is the thin glue between them.
 *
 * Usage:
 *   export THINKFLEET_API_KEY="sk-..."
 *   export THINKFLEET_PROJECT_ID="..."
 *   export THINKFLEET_BASE_URL="https://app.memmesh.ai"   # optional
 *   export ANTHROPIC_API_KEY="sk-ant-..."
 *   npx tsx examples/next-best-offer.ts
 *
 * Requires (dev): @anthropic-ai/sdk, zod  →  npm install
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { ThinkFleetMemory } from '../src/index.js'

// ─── The offer catalog (domain data your app owns) ───────────────────
//
// The engine is domain-agnostic — it never sees "offer" as a concept. Your
// app owns the catalog; the decision loop only records the generic
// action_type="send_offer" and the chosen offer id as the decision_type, so
// effectiveness rolls up per offer.

interface Offer {
  id: string
  label: string
  description: string
  bestFor: string
}

const OFFERS: Offer[] = [
  {
    id: 'winback_20pct',
    label: '20% win-back',
    description: '20% off the next order, 7-day expiry.',
    bestFor: 'Lapsing customers who used to be regular but have gone quiet.',
  },
  {
    id: 'loyalty_perk',
    label: 'Loyalty perk',
    description: 'Free add-on / priority service, no discount.',
    bestFor: 'Engaged, high-frequency customers — reward without eroding margin.',
  },
  {
    id: 'replenish_reminder',
    label: 'Replenishment nudge',
    description: 'A timely "time to reorder?" nudge, no discount.',
    bestFor: 'Customers on a predictable repurchase cadence.',
  },
  {
    id: 'bundle_upsell',
    label: 'Bundle upsell',
    description: 'A complementary product bundle at a small saving.',
    bestFor: 'Customers with a clear category preference and room to expand basket.',
  },
]

// ─── Types for the contact activity we seed ──────────────────────────

interface Activity {
  activityType: string // "order_placed" | "site_visit" | "email_open" | ...
  content: string
  occurredAt: string // ISO
  metadata?: Record<string, unknown>
}

interface Contact {
  externalId: string
  activity: Activity[]
}

const SUBJECT = (externalId: string) => ({ kind: 'contact', externalId })

// ─── 1. LEARN — ingest activity + mine patterns ──────────────────────

async function learnAboutContact(tf: ThinkFleetMemory, c: Contact): Promise<void> {
  for (const a of c.activity) {
    await tf.memory.observe({
      subject: SUBJECT(c.externalId),
      content: a.content,
      activityType: a.activityType,
      occurredAt: a.occurredAt,
      metadata: a.metadata,
    })
  }
  // Mine this subject's activity into behavior patterns (cadence, RFM,
  // entity preference, lapsing risk, …). Idempotent + subject-scoped.
  await tf.lattice.mineMemories({ subject: SUBJECT(c.externalId) })
  console.log(`  · learned ${c.activity.length} events for ${c.externalId}`)
}

// ─── 2. UNDERSTAND — read the subject back ───────────────────────────

interface Signal {
  externalId: string
  profile: unknown
  predictions: Array<{
    patternId: string
    description: string
    expectedAt: string
    confidence: number
  }>
  abstained: boolean
  effectiveness: Array<{
    groupKey: string
    n: number
    successRate: number
    avgReward: number
    confidence: number
  }>
}

async function gatherSignal(tf: ThinkFleetMemory, externalId: string): Promise<Signal> {
  const subject = SUBJECT(externalId)

  // Who is this subject? (RFM segment, cadence, top entity, risk indicators)
  const profile = await tf.lattice.getProfile(subject).catch(() => null)

  // What will they do next, and when? Pattern projection → the send-time signal.
  const predictResult = await tf.lattice.predict({ subject, horizonDays: 30 })

  // What has actually worked, per offer? The closed-loop signal — empty on the
  // very first run, then it grows as outcomes come in.
  const effectiveness = await tf.learning
    .getEffectiveness({ groupBy: 'decision_type', minSupport: 1 })
    .catch(() => [])

  return {
    externalId,
    profile,
    predictions: (predictResult.predictions ?? []).map((p) => ({
      patternId: p.patternId,
      description: p.description,
      expectedAt: p.expectedAt,
      confidence: p.confidence,
    })),
    abstained: predictResult.abstained ?? false,
    effectiveness,
  }
}

// ─── 3. DECIDE — Claude picks the offer + send time ──────────────────

const DecisionSchema = z.object({
  offerId: z.string().describe('The chosen offer id from the catalog.'),
  sendAtIso: z
    .string()
    .describe('When to send, ISO-8601. Time the offer to land just before the predicted next engagement.'),
  sendTimeReason: z.string().describe('One sentence on why that send time.'),
  rationale: z.string().describe('Two or three sentences justifying the offer choice from the signal.'),
  confidence: z.number().describe('0..1 — how confident this is the right call.'),
})
type OfferDecision = z.infer<typeof DecisionSchema>

const SYSTEM_PROMPT = `You are a lifecycle-marketing strategist. Given one contact's \
behavioral profile, the engine's prediction of their next engagement, and the historical \
effectiveness of each offer type, choose the SINGLE best offer to send and the best time \
to send it.

Rules:
- Choose exactly one offer id from the catalog provided.
- Time the send to land shortly before the predicted next engagement, when there is one.
- Weigh historical effectiveness: prefer offers with a higher observed success rate and \
average reward once there is enough evidence (n). With little or no evidence, reason from \
the profile and predictions instead.
- If the engine abstained (not enough signal), say so in the rationale and pick the safest \
broadly-applicable offer.
- Be concise and specific. Do not invent facts not present in the signal.`

async function decideOffer(anthropic: Anthropic, signal: Signal): Promise<OfferDecision> {
  const userContent = [
    `Contact: ${signal.externalId}`,
    ``,
    `OFFER CATALOG:`,
    ...OFFERS.map((o) => `- ${o.id} (${o.label}): ${o.description} Best for: ${o.bestFor}`),
    ``,
    `PROFILE: ${JSON.stringify(signal.profile ?? 'none', null, 2)}`,
    ``,
    signal.abstained
      ? `PREDICTIONS: engine ABSTAINED — not enough signal to predict next engagement.`
      : `PREDICTED NEXT ENGAGEMENTS (soonest first):\n` +
        signal.predictions
          .map((p) => `- ${p.expectedAt} — ${p.description} (confidence ${p.confidence.toFixed(2)})`)
          .join('\n'),
    ``,
    signal.effectiveness.length
      ? `WHAT HAS WORKED (per offer, from realized outcomes):\n` +
        signal.effectiveness
          .map(
            (e) =>
              `- ${e.groupKey}: ${(e.successRate * 100).toFixed(0)}% success over n=${e.n} ` +
              `(avg reward ${e.avgReward.toFixed(2)}, calibrated ${(e.confidence * 100).toFixed(0)}%)`,
          )
          .join('\n')
      : `WHAT HAS WORKED: no outcome history yet — this is a cold start.`,
    ``,
    `Today is ${new Date().toISOString()}. Choose the offer and send time.`,
  ].join('\n')

  const resp = await anthropic.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    output_config: { format: zodOutputFormat(DecisionSchema) },
  })

  if (!resp.parsed_output) {
    throw new Error(`Claude did not return a parseable decision (stop_reason=${resp.stop_reason})`)
  }
  return resp.parsed_output
}

// ─── Suggest for one contact: understand → decide → record ───────────

interface Suggestion {
  externalId: string
  decisionId: string
  offer: Offer
  sendAtIso: string
  rationale: string
  confidence: number
}

async function suggestForContact(
  tf: ThinkFleetMemory,
  anthropic: Anthropic,
  externalId: string,
): Promise<Suggestion> {
  const signal = await gatherSignal(tf, externalId)
  const decision = await decideOffer(anthropic, signal)
  const offer = OFFERS.find((o) => o.id === decision.offerId) ?? OFFERS[0]

  // Record the decision, linking it to the patterns/predictions that informed
  // it. When we later record an outcome, THOSE patterns get re-calibrated —
  // that's what closes the loop.
  const { decision: recorded } = await tf.learning.recordDecision({
    subject: SUBJECT(externalId),
    actor: 'agent:next-best-offer',
    decisionType: offer.id, // effectiveness rolls up per offer
    actionType: 'send_offer',
    policy: 'next-best-offer-v1',
    informedBy: signal.predictions.map((p) => ({ memoryId: p.patternId, refType: 'pattern' })),
    params: { offerId: offer.id, sendAt: decision.sendAtIso },
    status: 'proposed',
    // Idempotency: one proposed offer per contact per day.
    idempotencyKey: `nbo:${externalId}:${decision.sendAtIso.slice(0, 10)}`,
  })

  return {
    externalId,
    decisionId: recorded!.decisionId,
    offer,
    sendAtIso: decision.sendAtIso,
    rationale: decision.rationale,
    confidence: decision.confidence,
  }
}

// ─── Suggest for a list: rank by confidence ──────────────────────────

async function suggestForList(
  tf: ThinkFleetMemory,
  anthropic: Anthropic,
  externalIds: string[],
): Promise<Suggestion[]> {
  const suggestions: Suggestion[] = []
  for (const id of externalIds) {
    // Sequential to keep prompt-cache warm and stay under rate limits; for a
    // large list, batch with a concurrency pool.
    suggestions.push(await suggestForContact(tf, anthropic, id))
  }
  // Rank: who should we act on first? Highest-confidence, soonest send.
  return suggestions.sort(
    (a, b) => b.confidence - a.confidence || a.sendAtIso.localeCompare(b.sendAtIso),
  )
}

// ─── 4. ACT + LEARN — record the realized outcome ────────────────────

async function recordResult(
  tf: ThinkFleetMemory,
  s: Suggestion,
  result: 'success' | 'failure' | 'partial',
  reward: number,
): Promise<void> {
  const { updates } = await tf.learning.recordOutcome({
    decisionId: s.decisionId,
    subject: SUBJECT(s.externalId),
    outcomeType: 'conversion',
    result,
    reward,
    idempotencyKey: `outcome:${s.decisionId}`,
  })
  const moved = updates
    .map((u) => `${u.refId.slice(0, 8)} ${u.priorConfidence.toFixed(2)}→${u.posteriorConfidence.toFixed(2)}`)
    .join(', ')
  console.log(
    `  · ${s.externalId}: ${s.offer.id} → ${result} (reward ${reward})` +
      (moved ? ` | recalibrated: ${moved}` : ''),
  )
}

// ─── Demo data: three contacts with distinct behavior ────────────────

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

const CONTACTS: Contact[] = [
  {
    // Regular-then-quiet → a win-back candidate.
    externalId: 'sarah-lapsing',
    activity: [
      { activityType: 'order_placed', content: 'Order #1 — $42 pizza', occurredAt: daysAgo(90) },
      { activityType: 'order_placed', content: 'Order #2 — $38 pizza', occurredAt: daysAgo(76) },
      { activityType: 'order_placed', content: 'Order #3 — $45 pizza', occurredAt: daysAgo(62) },
      { activityType: 'order_placed', content: 'Order #4 — $40 pizza', occurredAt: daysAgo(48) },
      { activityType: 'site_visit', content: 'Browsed menu, did not order', occurredAt: daysAgo(20) },
    ],
  },
  {
    // Frequent + steady → reward, don't discount.
    externalId: 'mike-loyal',
    activity: [
      { activityType: 'order_placed', content: 'Order — $30', occurredAt: daysAgo(21) },
      { activityType: 'order_placed', content: 'Order — $34', occurredAt: daysAgo(14) },
      { activityType: 'order_placed', content: 'Order — $28', occurredAt: daysAgo(7) },
      { activityType: 'email_open', content: 'Opened weekly newsletter', occurredAt: daysAgo(2) },
    ],
  },
  {
    // Predictable monthly cadence → replenishment timing play.
    externalId: 'ana-replenish',
    activity: [
      { activityType: 'order_placed', content: 'Coffee beans 1kg — $24', occurredAt: daysAgo(88) },
      { activityType: 'order_placed', content: 'Coffee beans 1kg — $24', occurredAt: daysAgo(58) },
      { activityType: 'order_placed', content: 'Coffee beans 1kg — $24', occurredAt: daysAgo(29) },
    ],
  },
]

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.THINKFLEET_API_KEY
  const projectId = process.env.THINKFLEET_PROJECT_ID
  if (!apiKey || !projectId) {
    console.error('Set THINKFLEET_API_KEY and THINKFLEET_PROJECT_ID (and ANTHROPIC_API_KEY).')
    process.exit(1)
  }

  const tf = new ThinkFleetMemory({
    apiKey,
    projectId,
    baseUrl: process.env.THINKFLEET_BASE_URL,
  })
  const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY

  console.log('\n① LEARN — ingest activity + mine patterns')
  for (const c of CONTACTS) await learnAboutContact(tf, c)

  console.log('\n② + ③ SUGGEST for one contact (understand → decide → record)')
  const first = await suggestForContact(tf, anthropic, 'sarah-lapsing')
  console.log(`  → ${first.externalId}: send "${first.offer.label}" at ${first.sendAtIso}`)
  console.log(`    confidence ${first.confidence.toFixed(2)} · ${first.rationale}`)

  console.log('\n④ SUGGEST for the whole list, ranked')
  const ranked = await suggestForList(
    tf,
    anthropic,
    CONTACTS.map((c) => c.externalId),
  )
  ranked.forEach((s, i) =>
    console.log(
      `  ${i + 1}. ${s.externalId.padEnd(16)} ${s.offer.label.padEnd(20)} ` +
        `conf ${s.confidence.toFixed(2)}  send ${s.sendAtIso.slice(0, 10)}`,
    ),
  )

  console.log('\n⑤ ACT + LEARN — record outcomes; the loop calibrates')
  // Simulate: the win-back converted well, the loyalty perk landed, the
  // replenishment nudge got no response. In production these come from your
  // order/CRM system, attributed back to the decision id.
  const outcomes: Record<string, ['success' | 'failure' | 'partial', number]> = {
    'sarah-lapsing': ['success', 42],
    'mike-loyal': ['success', 30],
    'ana-replenish': ['failure', 0],
  }
  for (const s of ranked) {
    const [result, reward] = outcomes[s.externalId] ?? ['partial', 0]
    await recordResult(tf, s, result, reward)
  }

  console.log('\n⑥ WHAT WORKED — effectiveness now has evidence to steer the next run')
  const eff = await tf.learning.getEffectiveness({ groupBy: 'decision_type', minSupport: 1 })
  if (!eff.length) {
    console.log('  (no rows yet — run again so more outcomes accumulate)')
  } else {
    for (const e of eff) {
      console.log(
        `  ${e.groupKey.padEnd(20)} success ${(e.successRate * 100).toFixed(0)}%  ` +
          `avg reward ${e.avgReward.toFixed(2)}  n=${e.n}  calibrated ${(e.confidence * 100).toFixed(0)}%`,
      )
    }
  }
  console.log(
    '\nRun it again: the DECIDE step now sees this effectiveness and shifts ' +
      'toward what actually converted.\n',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
