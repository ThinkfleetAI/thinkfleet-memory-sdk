#!/usr/bin/env npx tsx
/**
 * @thinkfleet/memory-sdk — v2 "predict anything" + abstention demo
 *
 * The whole moat in one file: declare ANY target and the engine predicts it
 * from a subject's observation history — calibrated, with provenance, and
 * *abstaining* when there isn't enough signal. No model picking, no per-target
 * RPC, no canned detector menu.
 *
 * It shows all four target kinds against the SAME subject:
 *   1. event_occurrence → will they churn / reorder within the horizon?
 *   2. numeric          → what's their next order total?
 *   3. event_time       → when is their next visit?
 *   4. anomaly          → is their latest reading an outlier?
 *
 * The point to notice: a fresh subject with thin history comes back
 * `abstained` — "I don't know yet" — instead of a confident guess. That's the
 * trust layer competitors don't ship.
 *
 * Usage:
 *   export THINKFLEET_API_KEY="sk-..."
 *   export THINKFLEET_PROJECT_ID="..."
 *   export THINKFLEET_BASE_URL="https://app.memmesh.ai"   # optional
 *   export DEMO_SUBJECT="customer:acct-42"                      # optional, kind:externalId
 *   npx tsx examples/predict-anything.ts
 */

import { ThinkFleetMemory } from '../src/index.js'
import type { PredictionTarget, TargetPrediction, Subject } from '../src/index.js'

// ── Config ──────────────────────────────────────────────────────────

const API_KEY = process.env.THINKFLEET_API_KEY
const PROJECT_ID = process.env.THINKFLEET_PROJECT_ID
const BASE_URL = process.env.THINKFLEET_BASE_URL ?? 'https://app.memmesh.ai'

const [subjectKind, subjectId] = (process.env.DEMO_SUBJECT ?? 'customer:acct-42').split(':')
const SUBJECT: Subject = { kind: subjectKind, externalId: subjectId }

if (!API_KEY || !PROJECT_ID) {
  console.error('Set THINKFLEET_API_KEY and THINKFLEET_PROJECT_ID first.')
  process.exit(1)
}

// ── The target registry — declare WHAT to predict, not HOW ──────────
//
// This is the v2 contract: each entry is a question, not a model. Add a row
// here and you've added a prediction — no SDK or engine change required. This
// is exactly how a vertical (Shopify churn, health risk, fraud) is just a
// different registry over the same engine.

const TARGETS: Array<{ label: string; horizonDays: number; target: PredictionTarget }> = [
  {
    label: 'Reorder within 90 days?',
    horizonDays: 90,
    target: { kind: 'event_occurrence', eventType: 'order_placed' },
  },
  {
    label: 'Next order total',
    horizonDays: 30,
    target: { kind: 'numeric', attributeKey: 'order_total' },
  },
  {
    label: 'When is the next visit?',
    horizonDays: 60,
    target: { kind: 'event_time', eventType: 'visit' },
  },
  {
    label: 'Is the latest resting HR an outlier?',
    horizonDays: 30,
    target: { kind: 'anomaly', attributeKey: 'resting_hr' },
  },
]

// ── Render one prediction the way a caller SHOULD — abstention first ─

function render(label: string, p: TargetPrediction): void {
  console.log(`\n• ${label}`)

  // The non-negotiable rule: an abstention is "unknown", never "no/low risk".
  if (p.abstained) {
    console.log(`  ↳ ABSTAINED — ${p.abstentionReason || 'insufficient signal'}`)
    console.log(`     (treat as unknown; do not act as if the answer were "no")`)
    return
  }

  switch (p.targetKind) {
    case 'event_occurrence':
      console.log(
        `  ↳ ${(p.probability * 100).toFixed(0)}% ` +
          `[${(p.probabilityLower * 100).toFixed(0)}–${(p.probabilityUpper * 100).toFixed(0)}%]`,
      )
      break
    case 'numeric':
      console.log(`  ↳ ${p.value.toFixed(2)} [${p.valueLower.toFixed(2)}–${p.valueUpper.toFixed(2)}]`)
      break
    case 'event_time':
      console.log(`  ↳ ~${p.daysUntil.toFixed(0)} days (${p.expectedAt})`)
      console.log(`     window: ${p.expectedAtLower} → ${p.expectedAtUpper}`)
      break
    case 'anomaly':
      console.log(
        `  ↳ ${p.isAnomaly ? 'ANOMALY' : 'normal'} — z=${p.anomalyScore.toFixed(2)}, ` +
          `latest ${p.value.toFixed(2)} vs [${p.valueLower.toFixed(2)}–${p.valueUpper.toFixed(2)}]`,
      )
      break
    default:
      console.log(`  ↳ ${JSON.stringify(p)}`)
  }

  if (p.explanation) console.log(`     why: ${p.explanation}`)
  if (p.evidenceMemoryIds.length) {
    console.log(`     evidence: ${p.evidenceMemoryIds.slice(0, 3).join(', ')}` +
      (p.evidenceMemoryIds.length > 3 ? ` (+${p.evidenceMemoryIds.length - 3} more)` : ''))
  }
}

// ── Run ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tf = new ThinkFleetMemory({ apiKey: API_KEY!, projectId: PROJECT_ID!, baseUrl: BASE_URL })

  console.log(`Predicting for ${SUBJECT.kind}:${SUBJECT.externalId} — ${TARGETS.length} declared targets`)

  for (const { label, horizonDays, target } of TARGETS) {
    try {
      const p = await tf.lattice.predictTarget(SUBJECT, target, { horizonDays })
      render(label, p)
    } catch (err) {
      console.log(`\n• ${label}\n  ↳ error: ${(err as Error).message}`)
    }
  }

  console.log('\nDone. Note which targets abstained — that honesty is the product.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
