import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import type {
  BehaviorPatternRecord,
  ExtractPatternsRequest,
  ExtractPatternsResult,
  GetContextParams,
  LatticeContextBundle,
  ListContactPatternsResponse,
  ListPatternsParams,
  MineMemoriesRequest,
  MonitorStatus,
  MonitorTickResult,
  PredictRequest,
  PredictResult,
  RiskIndicator,
  Subject,
  SubjectProfile,
} from '../types/lattice.js'

/**
 * Lattice — behavioral pattern intelligence for memory.thinkfleet.ai.
 *
 * Mines a contact's event history for repeatable behaviors and exposes
 * a context bundle the agent can hand to a message-rendering step.
 *
 * @example
 * ```ts
 * // Bulk re-extract patterns across the project
 * const result = await tf.lattice.extractPatterns({ windowDays: 90 })
 * console.log(`${result.patternsCreated} new patterns mined`)
 *
 * // Get a contact's patterns
 * const { data: patterns } = await tf.lattice.listPatterns(contactId)
 *
 * // Get the full retrieval bundle for AI rendering
 * const ctx = await tf.lattice.getContext(contactId)
 * ```
 */
export class LatticeResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Force pattern (re-)extraction. Omit `contactId` for a project-wide
   * bulk run; pass it to limit to one contact.
   *
   * Defaults to mining the memory corpus (source='memories') via the
   * Rust engine. Pass source='contact_events' to use the legacy
   * TS path that mines from clawdbot_contact_event.
   *
   * Rate-limited server-side at 5 calls/minute when the platform's
   * auth-aware rate limiter is enabled.
   */
  async extractPatterns(
    body: ExtractPatternsRequest = {},
    options?: RequestOptions,
  ): Promise<ExtractPatternsResult> {
    return this.http.post<ExtractPatternsResult>('/lattice/patterns/extract', body, options)
  }

  /**
   * Mine behavioral patterns from the memory corpus. Subject-agnostic:
   * works on any subject kind (contact, user, team, workspace, service).
   * Patterns become memory items of type='behavior_pattern' on the
   * storage side and are retrievable via `tf.memory.admin.list()` or
   * `tf.memory.admin.search()`.
   *
   * Thin wrapper over `extractPatterns({ source: 'memories', ... })`.
   *
   * @example
   * ```ts
   * // Mine across every subject in the project
   * const result = await tf.lattice.mineMemories({ windowDays: 90 })
   *
   * // Mine for one specific subject
   * await tf.lattice.mineMemories({
   *   subject: { kind: 'contact', externalId: 'sarah' },
   *   windowDays: 30,
   * })
   * ```
   */
  async mineMemories(
    body: MineMemoriesRequest = {},
    options?: RequestOptions,
  ): Promise<ExtractPatternsResult> {
    return this.http.post<ExtractPatternsResult>(
      '/lattice/patterns/extract',
      { ...body, source: 'memories' },
      options,
    )
  }

  /**
   * Inspect a single pattern by id. Returns 404 if the pattern doesn't
   * exist or belongs to a different project.
   */
  async getPattern(patternId: string, options?: RequestOptions): Promise<BehaviorPatternRecord> {
    return this.http.get<BehaviorPatternRecord>(
      `/lattice/patterns/${encodeURIComponent(patternId)}`,
      undefined,
      options,
    )
  }

  /**
   * List behavior patterns Lattice has learned for a contact. Cursor-
   * paginated — pass the response's `nextCursor` back as `cursor` for
   * the next page.
   */
  async listPatterns(
    contactId: string,
    params?: ListPatternsParams,
    options?: RequestOptions,
  ): Promise<ListContactPatternsResponse> {
    return this.http.get<ListContactPatternsResponse>(
      `/lattice/contacts/${encodeURIComponent(contactId)}/patterns`,
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
  }

  /**
   * Full retrieval bundle for a contact — profile, active patterns,
   * recent events, recent memories, and (optionally) entity/edge graph.
   * The single payload a downstream AI message step needs to produce a
   * personalized response without juggling multiple calls.
   *
   * Supports bi-temporal replay via `asOf`: pass an ISO-8601 timestamp
   * to see the bundle as it was at that point in time.
   */
  async getContext(
    contactId: string,
    params?: GetContextParams,
    options?: RequestOptions,
  ): Promise<LatticeContextBundle> {
    return this.http.get<LatticeContextBundle>(
      `/lattice/contacts/${encodeURIComponent(contactId)}/context`,
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
  }

  /**
   * Manually run the pattern-break monitor tick. The platform runs this
   * on a cron; manual triggers exist primarily for debugging and tests
   * that need an overdue pattern to fire immediately.
   */
  async runMonitorTick(options?: RequestOptions): Promise<MonitorTickResult> {
    return this.http.post<MonitorTickResult>('/lattice/monitor/tick', {}, options)
  }

  /**
   * Monitor health: timestamp of the last tick and a count of patterns
   * due for the next check. Useful as a liveness probe for the
   * pattern-break dispatcher.
   */
  async getMonitorStatus(options?: RequestOptions): Promise<MonitorStatus> {
    return this.http.get<MonitorStatus>('/lattice/monitor/status', undefined, options)
  }

  /**
   * Project future events for a subject based on their active
   * behavior patterns. Each prediction names the pattern that drove
   * it and the raw memories that produced the pattern (provenance)
   * so callers can explain or audit any single prediction.
   *
   * @example
   * ```ts
   * const result = await tf.lattice.predict({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   horizonDays: 30,
   * })
   * for (const p of result.predictions) {
   *   console.log(`${p.expectedAt}: ${p.description} (conf ${p.confidence.toFixed(2)})`)
   * }
   * ```
   */
  async predict(
    body: PredictRequest,
    options?: RequestOptions,
  ): Promise<PredictResult> {
    return this.http.post<PredictResult>('/lattice/predict', body, options)
  }

  /**
   * Behavioral profile snapshot for a subject — RFM segment + top
   * entity + cadence summary + risk indicators. Non-temporal
   * counterpart to predict(): predict answers "what will they do?",
   * getProfile answers "who are they?".
   *
   * @example
   * ```ts
   * const p = await tf.lattice.getProfile({
   *   kind: 'contact', externalId: 'sarah-pizza',
   * })
   * console.log(p.rfmSegment, p.cadenceSummary, p.risks)
   * ```
   */
  async getProfile(
    subject: Subject,
    options?: RequestOptions,
  ): Promise<SubjectProfile> {
    return this.http.post<SubjectProfile>('/lattice/profile', { subject }, options)
  }

  /**
   * Find subjects in the project whose behavior looks similar to the
   * target. Returns top-K nearest neighbors ranked by a blended
   * similarity score (RFM + entity Jaccard + pattern-kind Jaccard).
   *
   * @example
   * ```ts
   * const { members } = await tf.lattice.getCohort({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   k: 10,
   *   minSimilarity: 0.5,
   * })
   * for (const m of members) {
   *   console.log(`${m.subject.externalId}: ${m.similarity.toFixed(2)} (${m.rfmSegment})`)
   * }
   * ```
   */
  async getCohort(
    body: GetCohortRequest,
    options?: RequestOptions,
  ): Promise<GetCohortResponse> {
    return this.http.post<GetCohortResponse>('/lattice/cohort', body, options)
  }

  /**
   * Cohort-aware predictions — "people like the target also did X."
   * Computes the target's cohort first, then aggregates each member's
   * predictions weighted by similarity. Predictions that show up in
   * multiple cohort members reinforce each other; solo predictions
   * get penalized.
   *
   * Every prediction carries `supportingSubjects` + `sourceMemoryIds`
   * so the answer is fully traceable back to which cohort members
   * (and which raw memories of theirs) contributed.
   *
   * @example
   * ```ts
   * const { predictions } = await tf.lattice.predictByCohort({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   cohortK: 10,
   *   predictionLimit: 5,
   * })
   * for (const p of predictions) {
   *   console.log(`${p.description} (${(p.confidence * 100).toFixed(0)}% conf, ${p.supportingSubjects.length} supporters)`)
   * }
   * ```
   */
  async predictByCohort(
    body: PredictByCohortRequest,
    options?: RequestOptions,
  ): Promise<PredictByCohortResponse> {
    return this.http.post<PredictByCohortResponse>('/lattice/cohort/predict', body, options)
  }
}

export interface GetCohortRequest {
  subject: Subject
  /** How many nearest neighbors to return. Server clamps to [1, 50]. Default 10. */
  k?: number
  /** Minimum similarity (0..1) for a member to be included. Default 0. */
  minSimilarity?: number
}

export interface CohortMember {
  subject: Subject
  similarity: number
  rfmSegment: string
  patternKinds: string[]
}

export interface GetCohortResponse {
  target: Subject
  members: CohortMember[]
  candidateCount: number
  generatedAt: string
  durationMs: number
}

export interface PredictByCohortRequest {
  subject: Subject
  cohortK?: number
  predictionLimit?: number
  minSimilarity?: number
}

export interface CohortPrediction {
  patternKind: string
  description: string
  expectedAt: string
  confidence: number
  windowMinutes: number
  supportingSubjects: Subject[]
  sourceMemoryIds: string[]
}

export interface PredictByCohortResponse {
  target: Subject
  cohort: CohortMember[]
  predictions: CohortPrediction[]
  generatedAt: string
  durationMs: number
}
