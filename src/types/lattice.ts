/**
 * Lattice — behavioral pattern intelligence.
 *
 * These types mirror the schemas exposed by the ThinkFleet API at
 * `/api/v1/projects/{projectId}/lattice/...`. The server-side
 * implementation is a Rust gRPC engine; the API translates between
 * REST and gRPC so SDK callers stay HTTP/JSON.
 *
 * Domain-neutral by design — `entity_external_ids` covers products
 * (commerce), features (SaaS), content items (media), clinicians
 * (healthcare), etc. The engine doesn't care what the entities mean.
 */

/** Behavioral pattern kinds the extractor can emit. */
export type BehaviorPatternKind =
  | 'recurring_event'
  | 'day_of_week'
  | 'time_of_day'
  | 'entity_preference'
  | 'entity_bundle'
  | 'declining_engagement'
  | 'offer_responsiveness'

/** Time-anchored cadence — only present on temporal patterns. */
export interface Cadence {
  /** Approximate inter-event interval in days (e.g. 7 for weekly). */
  periodDays?: number
  /** 0 = Sunday … 6 = Saturday, when the pattern peaks. */
  dayOfWeek?: number
  /** Local time of day in "HH:MM" format. */
  timeOfDayLocal?: string
  /** IANA timezone the local time refers to (e.g. "America/Chicago"). */
  timezone?: string
}

/** Shape carried on a behavior_pattern memory item's `metadata` jsonb. */
export interface BehaviorPatternMetadata {
  patternKind: BehaviorPatternKind
  contactId: string
  entityExternalIds?: string[]
  entityKind?: string
  eventType?: string
  cadence?: Cadence
  /** Confidence 0..1 in the pattern's accuracy. */
  confidence: number
  observationCount: number
  observationWindowDays: number
  /** ISO timestamp of the last observed event. */
  lastObservedAt: string
  /** ISO timestamp the monitor expects the pattern to fire next. */
  nextExpectedAt?: string
  /** Acceptable lag in minutes before the monitor declares a break. */
  toleranceMinutes?: number
  active: boolean
}

// ── ExtractPatterns ──────────────────────────────────────────────

export interface ExtractPatternsRequest {
  /** When set, extracts for one contact. Otherwise bulk across the project. */
  contactId?: string
  /** Look-back window in days (7–730). Default 90. */
  windowDays?: number
  /** Force re-extraction even if recent patterns exist. */
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
  /** Per-(contact, eventType) errors. Bulk extract is fail-soft. */
  errors?: ContactExtractError[]
}

// ── MonitorTick ──────────────────────────────────────────────────

export interface PatternFailure {
  patternId: string
  error: string
}

export interface MonitorTickResult {
  patternsChecked: number
  patternsBroken: number
  breaksEmitted: number
  durationMs: number
  /** True when the tick hit the MAX_PATTERNS_PER_TICK cap. */
  capped: boolean
  failures: PatternFailure[]
}

// ── ListContactsWithPatterns ────────────────────────────────────

export interface LatticeContactSummary {
  contactId: string
  displayName?: string
  email?: string
  activePatternCount: number
  totalPatternCount: number
  lastObservedAt?: string
  nextExpectedAt?: string
}

export interface ListLatticeContactsParams {
  /** Page size, 1–200. Default 50. */
  limit?: number
  /** Pagination cursor; advance by `limit` for each page. */
  offset?: number
  /** Restrict to contacts with at least one active pattern. */
  activeOnly?: boolean
}

export interface ListLatticeContactsResponse {
  contacts: LatticeContactSummary[]
  hasMore: boolean
}

// ── ListPatternsForContact ──────────────────────────────────────

export interface PatternSummary {
  memoryId: string
  kind: BehaviorPatternKind
  summary: string
  confidence: number
  observationCount: number
  lastObservedAt: string
  nextExpectedAt?: string
  active: boolean
  /** Full metadata — useful for advanced rendering / debugging. */
  metadata: BehaviorPatternMetadata
}

export interface ListPatternsParams {
  /** Page size, 1–200. Default 50. */
  limit?: number
  offset?: number
  /** Include deactivated patterns (e.g. for historical reasoning). */
  includeInactive?: boolean
}

export interface ListPatternsResponse {
  contactId: string
  patterns: PatternSummary[]
}

// ── GetContactContext ────────────────────────────────────────────

export interface ContactContextContact {
  id: string
  displayName: string
  email?: string
  phone?: string
  segment?: string
  tags?: string[]
  lifetimeValue?: number
  lastInteractionAt?: string
}

export interface ContactContextEvent {
  id: string
  eventType: string
  title: string
  occurredAt: string
}

export interface ContactContextMemory {
  id: string
  content: string
  importance: number
  learnedAt: string
}

export interface ContactContextResponse {
  contactId: string
  contact: ContactContextContact
  activePatterns: Array<{
    memoryId: string
    kind: BehaviorPatternKind
    summary: string
    confidence: number
    nextExpectedAt?: string
  }>
  recentEvents: ContactContextEvent[]
  recentMemories: ContactContextMemory[]
}

export interface GetContextParams {
  /** Recent events to include (1–200). Default 25. */
  eventLimit?: number
  /** Recent memories to include (1–200). Default 25. */
  memoryLimit?: number
}

// ── Search ───────────────────────────────────────────────────────

export type LatticeSearchScope = 'contact' | 'event' | 'pattern'

export interface LatticeSearchContactHit {
  type: 'contact'
  contactId: string
  displayName?: string
  email?: string
  phone?: string
  tags?: string[]
  matchedField: string
}

export interface LatticeSearchEventHit {
  type: 'event'
  eventId: string
  contactId: string
  eventType: string
  title: string
  description?: string
  occurredAt: string
  matchedField: string
}

export interface LatticeSearchPatternHit {
  type: 'pattern'
  memoryId: string
  contactId: string
  patternKind: BehaviorPatternKind
  summary: string
  confidence: number
  active: boolean
  nextExpectedAt?: string
  matchedField: string
}

export interface LatticeSearchParams {
  /** Free-text query. Minimum 2 characters. */
  q: string
  /** Restrict scope; default searches all three groups. */
  types?: LatticeSearchScope[]
  /** Per-group cap, 1–50. Default 20. */
  limit?: number
}

export interface LatticeSearchResponse {
  query: string
  contacts: LatticeSearchContactHit[]
  events: LatticeSearchEventHit[]
  patterns: LatticeSearchPatternHit[]
  /** True if any group hit its per-type cap. */
  truncated: boolean
}

// ── Subjects + generic activity ingest ──────────────────────────
//
// Lattice mines patterns from any subject's activity stream, not just
// `clawdbot_contact` rows. SubjectType discriminates the kind:
//   - `contact`   — existing customer/contact record (21-char ApId)
//   - `user`      — authenticated user (21-char ApId)
//   - `workspace` — local workstation / desktop ("ryan@desktop")
//   - `service`   — headless worker / job ("billing-cron-job")
//
// Free-form ids work for workspace/service since those don't have a
// platform-issued ApId. The engine compares subjectId as an opaque
// string — no FK on lattice_activity.subjectId.
export type SubjectType = 'contact' | 'user' | 'workspace' | 'service'

export interface ObserveActivityRequest {
  subjectType: SubjectType
  subjectId: string
  /** Free-form per domain (`purchase`, `code_commit`, `tool_invoked`, …). */
  activityType: string
  /** Short human-readable title for the dashboard. Optional. */
  title?: string
  /** Long-form free text. Optional. */
  description?: string
  /** Structured payload — entityIds, amount, etc. Optional. */
  activityData?: Record<string, unknown>
  /** ISO 8601 timestamp the activity occurred at. */
  occurredAt: string
  /** Where the activity came from (`sdk`, `mcp`, `webhook`, …). Optional. */
  source?: string
}

export interface ObserveActivityResult {
  /** The 21-char id assigned to the persisted activity row. */
  id: string
}

// ── Demo seed (dev/QA only — gated by AP_ALLOW_DEMO_SEED) ───────

export interface RunDemoSeedRequest {
  /** Contacts to spawn per template. Default 5 → ~25 total. */
  contactsPerTemplate?: number
  /** Days of history to backfill (14–365). Default 84. */
  historyDays?: number
}

export interface RunDemoSeedTemplateResult {
  namePrefix: string
  contactsCreated: number
  eventsCreated: number
}

export interface RunDemoSeedResult {
  contactsCreated: number
  eventsCreated: number
  templates: RunDemoSeedTemplateResult[]
  durationMs: number
}
