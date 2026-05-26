/**
 * Lattice — behavioral pattern intelligence.
 *
 * Types mirror what the memory.thinkfleet.ai backend exposes at
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
