/**
 * Lattice — behavioral pattern intelligence.
 *
 * Types mirror what the app.memmesh.ai backend exposes at
 * `/api/v1/projects/{projectId}/lattice/*`. The server-side
 * implementation is TS today; cuts over to a Rust gRPC engine in a
 * follow-up.
 */

/** Behavioral pattern kinds the extractor emits. */
export type BehaviorPatternKind =
  | 'recurring_event'
  | 'day_of_week'
  | 'time_of_day'
  | 'entity_preference'
  | 'entity_bundle'
  | 'declining_engagement'
  | 'offer_responsiveness'

export interface Cadence {
  /** Approximate inter-event interval in days (e.g. 7 for weekly). */
  periodDays?: number
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek?: number
  /** Local time of day in "HH:MM" format. */
  timeOfDayLocal?: string
  /** IANA timezone the local time refers to (e.g. "America/Chicago"). */
  timezone?: string
}

export interface BehaviorPatternMetadata {
  patternKind: BehaviorPatternKind
  contactId: string
  entityExternalIds?: string[]
  entityKind?: string
  eventType?: string
  cadence?: Cadence
  /** Confidence 0..1. */
  confidence: number
  observationCount: number
  observationWindowDays: number
  lastObservedAt: string
  nextExpectedAt?: string
  toleranceMinutes?: number
  active: boolean
}

// ── ExtractPatterns ──────────────────────────────────────────────

export interface ExtractPatternsRequest {
  /** Restrict extraction to a single contact. Omit for project-wide bulk. */
  contactId?: string
  /** Look-back window in days (7–730). Default 90. */
  windowDays?: number
  /** Force re-extraction even if recent patterns exist. */
  force?: boolean
  /**
   * Activity source. `memories` (default) mines from memory items via
   * the Rust engine; `contact_events` keeps the legacy TS path.
   */
  source?: 'memories' | 'contact_events'
  /**
   * Restrict mining to one subject. Only meaningful when
   * source='memories' (the contact_events path is contact-only).
   */
  subject?: Subject
}

export interface Subject {
  /** Free-form: "contact", "user", "team", "workspace", "service", etc. */
  kind: string
  /** Stable external id within `kind`. Opaque to the engine. */
  externalId: string
}

/**
 * Convenience request type for `tf.lattice.mineMemories()`. Same shape
 * as `ExtractPatternsRequest` but without `contactId` (legacy field
 * that doesn't apply to the subject-agnostic mining path) and without
 * `source` (the helper sets it implicitly).
 */
export interface MineMemoriesRequest {
  subject?: Subject
  windowDays?: number
  force?: boolean
}

export interface ContactExtractError {
  contactId: string
  eventType: string
  error: string
}

export interface ExtractPatternsResult {
  contactsProcessed: number
  patternsCreated: number
  patternsRefreshed: number
  patternsDeactivated: number
  durationMs: number
  errors?: ContactExtractError[]
}

// ── Pattern records ──────────────────────────────────────────────

export interface BehaviorPatternRecord {
  id: string
  projectId: string | null
  contactId: string
  /** Free-text summary; mirrors the `content` of the underlying memory item. */
  summary: string
  metadata: BehaviorPatternMetadata
  active: boolean
  confidence: number
  created: string
  updated: string
}

// ── ListPatternsForContact ──────────────────────────────────────

export interface ListPatternsParams {
  /** Default true. Set false to include retired patterns. */
  activeOnly?: boolean
  /** Page size, 1–100. Default 50. */
  limit?: number
  /** Opaque cursor from a prior response's `nextCursor`. */
  cursor?: string
}

export interface ListContactPatternsResponse {
  data: BehaviorPatternRecord[]
  nextCursor: string | null
}

// ── GetContactContext ────────────────────────────────────────────

export interface GetContextParams {
  /**
   * Bi-temporal query: return the bundle as it was at this ISO-8601 timestamp.
   * Useful for replaying agent decisions. Default = now.
   */
  asOf?: string
  /** Recent events to include (1–200). Default 25. */
  eventsLimit?: number
  /** Recent memories to include (1–100). Default 25. */
  memoriesLimit?: number
  /** Graph traversal depth (1–3). Default 1. */
  graphHops?: number
}

export interface LatticeContextContact {
  id: string
  displayName?: string
  email?: string
  phone?: string
  segment?: string
  tags?: string[]
  lifetimeValue?: number
  lastInteractionAt?: string
}

export interface LatticeContextEvent {
  id: string
  eventType: string
  title: string
  occurredAt: string
  data?: Record<string, unknown>
}

export interface LatticeContextMemory {
  id: string
  content: string
  importance: number
  scope: string
  type: string
  created: string
}

export interface LatticeContextEntity {
  id: string
  kind: string
  name: string
  metadata: Record<string, unknown>
}

export interface LatticeContextEdge {
  id: string
  sourceEntityId: string
  targetEntityId: string
  kind: string
  weight?: number
}

export interface LatticeContextBundle {
  contactId: string
  contact: LatticeContextContact
  activePatterns: BehaviorPatternRecord[]
  recentEvents: LatticeContextEvent[]
  recentMemories: LatticeContextMemory[]
  entities?: LatticeContextEntity[]
  edges?: LatticeContextEdge[]
}

// ── Monitor ─────────────────────────────────────────────────────

export interface MonitorTickResult {
  patternsChecked: number
  patternsBroken: number
  breaksEmitted: number
  durationMs: number
  capped: boolean
  failures: Array<{ patternId: string; error: string }>
}

// ── Predict ──────────────────────────────────────────────────────

export interface PredictRequest {
  /** Subject to project predictions for. */
  subject: Subject
  /** How far forward to project (in days). Default 30, clamped [1, 365]. */
  horizonDays?: number
  /** Max predictions to return. Default 20, max 200. */
  limit?: number
  /** Minimum confidence (0..1) to surface. Default 0.5. */
  minConfidence?: number
  /**
   * Forward view: how many future occurrences to project per fixed-cadence
   * pattern. 1 (default) = just the next firing; higher yields "the next N
   * firings", each with its own horizon-decayed confidence.
   */
  occurrencesPerPattern?: number
  /**
   * Predictions→events bridge: when true, emit a `prediction.imminent` event
   * for each prediction due within `imminentWithinHours`. Per-day dedupe means
   * a daily run won't double-fire. Default false.
   */
  emitEvents?: boolean
  /** Imminence window for event emission, in hours. Default 48, clamped [1, 720]. */
  imminentWithinHours?: number
  /**
   * v2 general prediction. When set, the engine predicts THIS declared target
   * from the subject's observation history instead of projecting mined behavior
   * patterns — "predict anything", not the canned menu. The result arrives in
   * `PredictResult.targetPrediction` (with first-class abstention). When unset,
   * `predict()` behaves exactly as before (pattern projection).
   */
  target?: PredictionTarget
}

/** Target kinds the v2 engine can predict. The kind drives model selection. */
export type TargetKind = 'event_occurrence' | 'numeric' | 'event_time' | 'anomaly'

/**
 * A declaratively-specified prediction target (v2). You declare *what* to
 * predict; the engine selects the model family from `kind`. Callers never pick
 * a model.
 *
 * @example
 * ```ts
 * // Will this customer reorder in the next 30 days?
 * { kind: 'event_occurrence', eventType: 'order_placed' }
 * // What will their next order total be?
 * { kind: 'numeric', attributeKey: 'order_total' }
 * // When is their next visit expected?
 * { kind: 'event_time', eventType: 'visit' }
 * // Is their latest reading an outlier?
 * { kind: 'anomaly', attributeKey: 'resting_hr' }
 * ```
 */
export interface PredictionTarget {
  /** Target type — drives model selection. */
  kind: TargetKind
  /**
   * For event_occurrence / event_time: the activity event to predict. Matched
   * against an observation's eventType, then category, then content substring.
   * Empty = "any activity".
   */
  eventType?: string
  /**
   * For numeric / anomaly: the typed-observation attribute to predict (e.g.
   * "order_total"). Required for those kinds; ignored otherwise.
   */
  attributeKey?: string
  /** How many days of history to learn from. Default 365, clamped [1, 3650]. */
  lookbackDays?: number
}

/** One projected event derived from one active behavior pattern. */
export interface PredictedEvent {
  patternId: string
  /** e.g. 'recurring_event', 'day_of_week', ... */
  patternKind: string
  description: string
  /** ISO timestamp the event is expected at. */
  expectedAt: string
  /** 0..1 confidence inherited from the pattern's dominance score. */
  confidence: number
  /** Calibrated 95% interval around `confidence` (Wilson score). */
  confidenceLower?: number
  confidenceUpper?: number
  /** Tolerance window in minutes. */
  windowMinutes: number
  /** Provenance — raw memories that produced the source pattern. */
  sourceMemoryIds: string[]
}

/**
 * The single calibrated estimate for a declared `target`. Exactly one field
 * group is meaningful per `targetKind`:
 *  - event_occurrence → `probability` (+ lower/upper)
 *  - numeric          → `value` (+ lower/upper)
 *  - event_time       → `expectedAt` (+ lower/upper, `daysUntil`)
 *  - anomaly          → `anomalyScore` / `isAnomaly` (value = latest reading)
 *
 * Always check `abstained` first: when true, the engine declined to guess —
 * treat it as "unknown", never as "no/low risk".
 */
export interface TargetPrediction {
  targetKind: TargetKind | string
  eventType: string
  /** event_occurrence: P(event within horizon), calibrated. */
  probability: number
  probabilityLower: number
  probabilityUpper: number
  /** numeric: predicted next value + 95% interval. */
  value: number
  valueLower: number
  valueUpper: number
  /** event_time: when the next occurrence is expected (ISO-8601) + interval. */
  expectedAt: string
  expectedAtLower: string
  expectedAtUpper: string
  daysUntil: number
  /** anomaly: |z| from baseline, and whether it crosses the threshold. */
  anomalyScore: number
  isAnomaly: boolean
  /** First-class abstention — true when there isn't enough signal to estimate. */
  abstained: boolean
  abstentionReason: string
  /** Human-readable derivation (counts, rate, horizon) for explainability. */
  explanation: string
  /** Provenance: ids of the observations the estimate was derived from. */
  evidenceMemoryIds: string[]
}

export interface PredictResult {
  subject: Subject
  predictions: PredictedEvent[]
  /** Total active patterns considered, whether or not each produced a prediction. */
  activePatternCount: number
  /** Number of `prediction.imminent` events emitted (when emitEvents=true). */
  eventsEmitted?: number
  /** ISO timestamp the prediction was generated. */
  generatedAt: string
  durationMs: number
  /**
   * First-class abstention: true when the engine declines to predict because
   * there isn't enough signal. Callers MUST treat an abstention as "unknown",
   * never as "no/low risk" — this is what keeps the engine safe for regulated
   * use.
   */
  abstained?: boolean
  /** Machine-readable reason when `abstained` is true (empty otherwise). */
  abstentionReason?: string
  /**
   * Set instead of `predictions` when the request carried a declarative
   * `target`: the single calibrated estimate for that target.
   */
  targetPrediction?: TargetPrediction | null
}

// ── Profile ──────────────────────────────────────────────────────

export interface RiskIndicator {
  /** "declining_engagement", "rfm_at_risk_high_value", ... */
  kind: string
  description: string
  /** 0..1 severity. */
  severity: number
  /** Pattern memory id that produced the signal. */
  sourcePatternId: string
}

/**
 * Behavioral profile snapshot — "who is this subject" view. Non-temporal
 * counterpart to PredictResult. Aggregates the subject's active behavior
 * patterns into one payload.
 */
export interface SubjectProfile {
  subject: Subject
  /** RFM segment label when an rfm_segment pattern is active. */
  rfmSegment: string | null
  recencyScore: number | null
  frequencyScore: number | null
  monetaryScore: number | null
  /** Subject's dominant entity (from entity_preference). */
  topEntity: string | null
  /** "weekly", "Fridays at 19:00", etc. */
  cadenceSummary: string | null
  risks: RiskIndicator[]
  /** Ids of every pattern that fed this profile. */
  contributingPatternIds: string[]
  generatedAt: string
  durationMs: number
}

export interface MonitorStatus {
  /** ISO timestamp of the last monitor tick, or null if it has never run. */
  lastTickAt: string | null
  /** Duration of the last tick in ms, or null if never run. */
  lastTickDurationMs: number | null
  /** Patterns whose `nextExpectedAt` falls inside the next monitor window. */
  patternsDue: number
  /** Total active patterns the monitor is watching. */
  activePatternCount: number
}

// ── Estimate (deterministic estimators, e.g. PhenoAge bio-age) ───────

export interface EstimateRequest {
  /** Subject whose signals to score. */
  subject: Subject
  /** Which estimator to run. v1: "phenoage". */
  estimatorId: string
  /**
   * Persist the score as a memory (kind="estimate") so it builds a trajectory
   * and feeds the calibration loop. Default false (compute-only).
   */
  persist?: boolean
}

export interface ScoreContributor {
  signal: string
  /** Signed contribution to the score (positive pushed it up). */
  contribution: number
}

export interface EstimateResult {
  subject: Subject
  estimatorId: string
  /** True when every required signal was present and a score was produced. */
  ok: boolean
  value: number
  unit: string
  contributors: ScoreContributor[]
  confidence: number
  provenance: string[]
  /** Always set: an "estimate" framing, never a diagnosis. */
  framing: string
  disclaimer: string
  /** Required signals with no reading, when ok=false. */
  missingSignals: string[]
}

// ── Calibration (prediction reliability) ─────────────────────────────

export interface CalibrationBucket {
  lower: number
  upper: number
  /** Active patterns whose stated confidence falls in this band. */
  patterns: number
  /** Predictions from those patterns that have been scored (hits+misses). */
  predictions: number
  hits: number
  misses: number
  /** hits / predictions; only meaningful when hasData is true. */
  realizedHitRate: number
  /** False when no prediction in this band has been scored yet. */
  hasData: boolean
}

export interface CalibrationReport {
  buckets: CalibrationBucket[]
  totalPatterns: number
  totalPredictions: number
}

export interface GetCalibrationParams {
  /** Number of equal-width confidence buckets over [0,1]. Default 5, clamped [1,20]. */
  bucketCount?: number
}

// ── Emit event (write-side of the event log) ─────────────────────────

export interface EmitEventRequest {
  eventType: string
  subject?: Subject
  /** info | warn | critical. Defaults to "info". */
  severity?: string
  /** Free-form JSON payload (can include "value", "channel", etc.). */
  payloadJson?: string
  sourceMemoryIds?: string[]
  sourcePatternId?: string
}

export interface EmitEventResult {
  /** False when a dedupe collision suppressed the insert. */
  emitted: boolean
  event: {
    id: string
    eventType: string
    severity: string
    occurredAt: string
  } | null
  /** Number of alert rules that matched + dispatched. */
  alertDispatches: number
}
