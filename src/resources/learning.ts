import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import type { Subject } from '../types/lattice.js'

/**
 * A causal input to a decision — the pattern/prediction/observation the
 * actor was reacting to. `weight` splits credit across multiple inputs.
 */
export interface ProvenanceRef {
  /** Memory id of the pattern/prediction/observation that informed the decision. */
  memoryId: string
  /** What kind of memory this ref points at. Defaults to "pattern". */
  refType?: 'pattern' | 'prediction' | 'observation' | 'collective' | (string & {})
  /** Credit-assignment weight; 0/unset is treated as 1.0. */
  weight?: number
}

export interface RecordDecisionInput {
  /** Who/what the decision is about. */
  subject: Subject
  /** Who made it: "agent:copilot" | "human:owner" | "policy:winback-v1". */
  actor?: string
  /** Generic label: "offer" | "outreach" | "escalation". */
  decisionType?: string
  /** Optional policy id/version. */
  policy?: string
  /** The patterns/predictions that informed the decision (credit assignment). */
  informedBy?: ProvenanceRef[]
  /** The executed effect: "send_message" | "apply_discount" | ... */
  actionType?: string
  /** Opaque action params. */
  params?: Record<string, string>
  /** "proposed" | "executed" | "skipped". Defaults to "executed". */
  status?: 'proposed' | 'executed' | 'skipped' | (string & {})
  /** Client RFC3339 timestamp; the engine fills now() when omitted. */
  occurredAt?: string
  metadata?: Record<string, string>
  /** Re-sending the same key returns the existing decision, no duplicate. */
  idempotencyKey?: string
}

export interface DecisionRecord {
  decisionId: string
  subject: Subject | null
  actor: string
  decisionType: string
  policy: string
  informedBy: ProvenanceRef[]
  actionType: string
  status: string
  occurredAt: string
  created: string
}

export interface RecordDecisionResult {
  decision: DecisionRecord | null
}

export interface RecordOutcomeInput {
  /** The decision this outcome resulted from. */
  decisionId: string
  /** Optional — defaults to the linked decision's subject. */
  subject?: Subject
  /** "conversion" | "engagement" | "no_response". */
  outcomeType?: string
  /** "success" | "failure" | "partial". */
  result: 'success' | 'failure' | 'partial' | (string & {})
  /** Numeric reward signal (revenue, 0/1, points…). */
  reward?: number
  /** Client RFC3339 timestamp; the engine fills now() when omitted. */
  realizedAt?: string
  /** How long after the decision this outcome still counts, in seconds. */
  attributionWindowSecs?: number
  metadata?: Record<string, string>
  /** Exactly-once guard: a replayed key won't double-count calibration. */
  idempotencyKey?: string
}

/** One informing ref re-weighted by an outcome (before/after confidence). */
export interface CalibrationUpdate {
  refId: string
  refType: string
  priorConfidence: number
  posteriorConfidence: number
  hits: number
  misses: number
}

export interface RecordOutcomeResult {
  outcomeId: string
  /** Which informing refs were re-weighted, and by how much. */
  updates: CalibrationUpdate[]
}

export interface OutcomeRecord {
  outcomeId: string
  decisionId: string
  subject: Subject | null
  decisionType: string
  actionType: string
  outcomeType: string
  result: string
  reward: number
  occurredAt: string
  realizedAt: string
}

export interface GetOutcomesParams {
  /** Restrict to one subject; omit for scope-wide. */
  subject?: Subject
  decisionType?: string
  actionType?: string
  /** Default 100, clamped [1, 1000]. */
  limit?: number
}

export type EffectivenessGroupBy =
  | 'action_type'
  | 'decision_type'
  | 'policy'
  | 'pattern_kind'

export interface GetEffectivenessParams {
  /** Dimension to roll up by. Defaults to "action_type". */
  groupBy?: EffectivenessGroupBy
  /** Return only groups with at least this many outcomes. */
  minSupport?: number
}

/** One "what worked" aggregation row. */
export interface EffectivenessRow {
  groupKey: string
  /** Support: outcome count in this group. */
  n: number
  /** Fraction with result="success". */
  successRate: number
  avgReward: number
  /** Beta-Binomial posterior mean of the success rate. */
  confidence: number
}

/**
 * Learning — the closed-loop **decision → action → outcome** primitive.
 *
 * Where `tf.lattice.predict` answers "what will happen?", the learning
 * loop answers **"did acting on it work?"**. Record a decision (with links
 * to the patterns/predictions that informed it), record its realized
 * outcome, and every informing pattern's calibrated confidence moves
 * toward what actually happened. `getEffectiveness` rolls "what worked" up
 * per action_type / decision_type / policy / pattern_kind.
 *
 * Domain-agnostic by design — subject/decision/action/outcome/reward only.
 *
 * @example
 * ```ts
 * const { decision } = await tf.learning.recordDecision({
 *   subject: { kind: 'contact', externalId: 'sarah' },
 *   actor: 'policy:winback-v1',
 *   decisionType: 'offer',
 *   actionType: 'apply_discount',
 *   informedBy: [{ memoryId: patternId, refType: 'pattern' }],
 *   params: { pct: '15' },
 * })
 *
 * const { updates } = await tf.learning.recordOutcome({
 *   decisionId: decision!.decisionId,
 *   outcomeType: 'conversion',
 *   result: 'success',
 *   reward: 84.0,
 * })
 * // updates[i].posteriorConfidence shows how each informing pattern moved.
 *
 * const rows = await tf.learning.getEffectiveness({ groupBy: 'action_type' })
 * ```
 */
export class LearningResource {
  constructor(private readonly http: HttpClient) {}

  /** Record a decision and its causal provenance. */
  async recordDecision(
    body: RecordDecisionInput,
    options?: RequestOptions,
  ): Promise<RecordDecisionResult> {
    return this.http.post<RecordDecisionResult>('/lattice/decisions', body, options)
  }

  /**
   * Record the realized outcome of a decision. Folds the result into the
   * online calibrated confidence of every pattern the decision was
   * informed_by, and returns the before/after for each.
   */
  async recordOutcome(
    body: RecordOutcomeInput,
    options?: RequestOptions,
  ): Promise<RecordOutcomeResult> {
    return this.http.post<RecordOutcomeResult>('/lattice/outcomes', body, options)
  }

  /** List recorded outcomes for a subject (or the whole scope), newest first. */
  async getOutcomes(
    params: GetOutcomesParams = {},
    options?: RequestOptions,
  ): Promise<OutcomeRecord[]> {
    const query: Record<string, string | number | undefined> = {
      subjectKind: params.subject?.kind,
      subjectExternalId: params.subject?.externalId,
      decisionType: params.decisionType,
      actionType: params.actionType,
      limit: params.limit,
    }
    const r = await this.http.get<{ outcomes: OutcomeRecord[] }>(
      '/lattice/outcomes',
      query,
      options,
    )
    return r.outcomes
  }

  /**
   * "What worked" roll-up — success rate, average reward, and posterior
   * confidence per group. Per-scope only; cross-tenant aggregation +
   * K-anonymity are the consuming app's responsibility.
   */
  async getEffectiveness(
    params: GetEffectivenessParams = {},
    options?: RequestOptions,
  ): Promise<EffectivenessRow[]> {
    const query: Record<string, string | number | undefined> = {
      groupBy: params.groupBy,
      minSupport: params.minSupport,
    }
    const r = await this.http.get<{ rows: EffectivenessRow[] }>(
      '/lattice/effectiveness',
      query,
      options,
    )
    return r.rows
  }
}
