import type { BaseModel } from './common.js'

export enum MemoryItemType {
  FACT = 'fact',
  PREFERENCE = 'preference',
  EVENT = 'event',
  INSIGHT = 'insight',
  OBSERVATION = 'observation',
  RULE = 'rule',
  CORRECTION = 'correction',
  SUMMARY = 'summary',
  /**
   * A reusable procedure — how a job/task is done here (goal + steps +
   * failure modes). Injected as a how-to exemplar, not a fact, so a cheaper
   * model reasons better on-domain. Structured shape on `metadata`
   * (ProceduralMemoryMetadata); `content` holds the rendered, injectable text
   * (see renderProcedureContent). Author with `admin.createProcedure()`.
   */
  PROCEDURE = 'procedure',
  /** Behavioral pattern emitted by Lattice mining. */
  BEHAVIOR_PATTERN = 'behavior_pattern',
  /** Subject-level consent / opt-out record. See ConsentResource. */
  CONSENT = 'consent',
}

export enum MemoryScope {
  PLATFORM = 'platform',
  PROJECT = 'project',
  AGENT = 'agent',
  USER = 'user',
  SESSION = 'session',
}

export enum MemoryStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SUPERSEDED = 'superseded',
  REJECTED = 'rejected',
}

export enum MemoryImpact {
  HIGH = 'HIGH',
  LOW = 'LOW',
}

export enum MemoryFeedbackRating {
  POSITIVE = 'positive',
  NEGATIVE = 'negative',
}

export interface MemoryItem extends BaseModel {
  platformId: string
  projectId: string | null
  chatbotId: string | null
  chatIdentityId: string | null
  type: MemoryItemType
  content: string
  category: string | null
  importance: number
  source: string | null
  sessionKey: string | null
  metadata: Record<string, unknown> | null
  scope: MemoryScope
  status: MemoryStatus
  confidence: number
  impact: MemoryImpact | null
  supersededById: string | null
  confirmedByUserId: string | null
  confirmedAt: string | null
  negativeRatingCount: number
}

/**
 * Ergonomic ingest shape for `tf.memory.observe()`. Pair the
 * agent-friendly required fields (`subject`, `content`) with optional
 * structured overrides — the SDK fills sensible defaults for type,
 * scope, importance, etc.
 */
export interface ObserveRequest {
  /**
   * Raw message text — the PRIMARY field. Send the whole turn, verbatim; the
   * engine runs extraction (heuristic + optional LLM) and keeps only what's
   * worth remembering, dropping filler. Prefer this over `content`.
   */
  text?: string
  /** Who said `text` — defaults to "user". */
  role?: 'user' | 'assistant' | 'system'
  /**
   * The end user this turn belongs to — your own identifier, not a MemMesh one.
   * Recorded as provenance on whatever the engine keeps.
   *
   * NOT a tenancy boundary. `admin.search({ chatIdentityId })` filters
   * permissively (`IS NULL OR = $1`), so project-wide memories stay visible to
   * every caller. Isolating one end user's memories from another's needs a
   * project per tenant.
   */
  userId?: string
  /** The agent or assistant that produced this turn. Provenance only. */
  agentId?: string
  /** Conversation/thread id, so turns from one session stay linkable. */
  sessionId?: string
  /**
   * WHO this observation is ABOUT — distinct from `userId`, who was SPEAKING.
   *
   * SEND IT. The claim that this is "not needed with `text`" was wrong: the
   * engine did not resolve subjects during extraction, and a memory written
   * without one is searchable but behaviourally invisible — predict, profile,
   * cohort and behaviour discovery all resolve a subject before they can use
   * a row. That is how a real deployment reaches 182k memories against 98
   * subjects with nothing reporting a problem.
   *
   * The server now INFERS a subject when you omit it (from a speaker tag in
   * the text, first-person phrasing, or `userId`) and records how it decided.
   * That is a good safety net and a poor substitute for the caller, which
   * usually knows the answer exactly.
   */
  subject?: { kind: string; externalId: string }
  /**
   * DEPRECATED — a pre-decided fact stored verbatim, bypassing extraction.
   * Prefer `text` and let the engine decide what to keep.
   */
  content?: string
  /** Event type identifier (`pizza_order`, `code_commit`, ...). Free-form. */
  activityType?: string
  /** ISO-8601 timestamp the activity occurred at. Defaults to now server-side. */
  occurredAt?: string
  /** Override the default `EVENT` type if this is e.g. an OBSERVATION. */
  type?: MemoryItemType
  /** Override the default PROJECT scope. */
  scope?: MemoryScope
  /** 0-10 importance, defaults to 5. */
  importance?: number
  /** Optional category tag for filtering. */
  category?: string
  /** Free-form metadata — merged into the underlying memory item. */
  metadata?: Record<string, unknown>
}

/**
 * What `observe` returns: the memories the engine chose to keep (empty when the
 * turn was filler) plus how many candidates it found before the dedupe/budget
 * pass. `saved.length <= candidateCount`.
 */
export interface ObserveResponse {
  saved: MemoryItem[]
  candidateCount: number
}

/**
 * Image / audio attachment request. The `image` field accepts a
 * Uint8Array (cross-platform), Node Buffer (which extends Uint8Array),
 * or a pre-encoded base64 string for callers that already have one.
 */
export interface ObserveAttachmentRequest {
  /** Subject this attachment is for. */
  subject: { kind: string; externalId: string }
  /** Bytes — Uint8Array / Buffer — or a pre-encoded base64 string. */
  image: Uint8Array | string
  /** Standard mime: `image/jpeg`, `image/png`, `audio/mpeg`, `audio/wav`, etc. */
  mimeType: string
  /** Optional file name for display. */
  fileName?: string
  /** Caption (image) / transcript (audio). Becomes the memory's searchable content. */
  content?: string
  /** Free-form activity tag (`receipt_capture`, `voicenote`, ...). */
  activityType?: string
  /** ISO-8601 timestamp the activity occurred at. Defaults to now. */
  occurredAt?: string
  /** 0-10 importance, defaults to 5. */
  importance?: number
  /** Free-form metadata merged into the memory item. */
  metadata?: Record<string, unknown>
}

/** Voice-flavored convenience type — uses `audio` instead of `image`. */
export interface ObserveVoiceRequest
  extends Omit<ObserveAttachmentRequest, 'image'> {
  /** Audio bytes — Uint8Array / Buffer — or a base64 string. */
  audio: Uint8Array | string
}

/**
 * Ingest a media item (image / audio / document). The engine extracts text via
 * LiteLLM, then runs it through the full Observe pipeline — so the returned
 * memories get extraction, graph wiring, and embedding like any observation.
 * Requires multimodal to be enabled on the engine.
 */
export interface IngestMediaRequest {
  /** Bytes — Uint8Array / Buffer — or a pre-encoded base64 string. */
  media: Uint8Array | string
  /** Standard mime: `image/png`, `audio/mpeg`, `application/pdf`, `text/*`. */
  mimeType: string
  /** Optional attribution + threading (same as observe). */
  userId?: string
  agentId?: string
  sessionId?: string
  /** Optional source (filename / URL), recorded on the memory's provenance. */
  source?: string
}

/** Result of ingesting one media item. */
export interface IngestMediaResult {
  /** Memories extracted from the media. */
  saved: MemoryItem[]
  /** Extraction candidates before dedupe. `saved.length <= candidateCount`. */
  candidateCount: number
  /** The text the model extracted from the media. */
  extractedText: string
  /** Classified modality: `image` | `audio` | `document`. */
  modality: string
  /** Durable location of the retained media (empty if not stored). */
  blobUri: string
}

/** Document-flavored convenience type — uses `document` instead of `image`. */
export interface ObserveDocumentRequest
  extends Omit<ObserveAttachmentRequest, 'image'> {
  /** Document bytes — Uint8Array / Buffer — or a base64 string. */
  document: Uint8Array | string
}

export interface CreateMemoryRequest {
  content: string
  type?: MemoryItemType
  category?: string
  importance?: number
  source?: string
  scope?: MemoryScope
  chatbotId?: string
  chatIdentityId?: string
  sessionKey?: string
  metadata?: Record<string, unknown>
  impact?: MemoryImpact
  /**
   * ISO-8601 timestamp of when this became true *in the world* — the event
   * time. Distinct from `created`/`learnedAt`, which is when we ingested it.
   * Defaults to now.
   *
   * This is the timestamp behavior mining reads, so **backfills must set it**.
   * Leave it unset while importing history and every mined pattern will
   * describe the moment you ran the import ("clusters around 17:00") rather
   * than when the events actually happened.
   */
  validFrom?: string
}

export interface UpdateMemoryRequest {
  content?: string
  type?: MemoryItemType
  category?: string
  importance?: number
  scope?: MemoryScope
  status?: MemoryStatus
}

export interface ConfirmMemoryRequest {
  status: 'confirmed' | 'rejected'
  comment?: string
}

export interface PromoteMemoryRequest {
  targetScope: MemoryScope
}

export interface MemorySearchRequest {
  query: string
  chatIdentityId?: string
  scope?: MemoryScope
  status?: MemoryStatus
  /** Results per page. Default 10, max 50. */
  limit?: number
  /** Skip this many results — page by bumping it. Default 0. */
  offset?: number
}

export interface MemorySearchResult {
  id: string
  type: string
  content: string
  category: string | null
  similarity: number
  metadata: Record<string, unknown> | null
  scope: MemoryScope
  status: MemoryStatus
  importance: number
}

export interface MemoryFeedback {
  id: string
  memoryId: string
  responseId: string | null
  rating: MemoryFeedbackRating
  comment: string | null
  createdByUserId: string | null
  created: string
}

export interface SubmitFeedbackRequest {
  responseId?: string
  rating: MemoryFeedbackRating
  comment?: string
}

export interface ListMemoryParams {
  type?: MemoryItemType
  scope?: MemoryScope
  status?: MemoryStatus
  source?: string
  chatbotId?: string
  chatIdentityId?: string
  limit?: number
  offset?: number
}

export interface ConsolidateRequest {
  /** Restrict to one subject. Omit for project-wide bulk pass. */
  subject?: { kind: string; externalId: string }
  /** How far back to scan for new activity. Default 30, max 365. */
  windowDays?: number
}

export interface ConsolidateResult {
  subjectsConsidered: number
  observationsCreated: number
  observationsUpdated: number
  observationsSuperseded: number
  durationMs: number
}

export interface MemoryStats {
  total: number
  pendingReview: number
  flagged: number
  byScope: Record<string, number>
  byStatus: Record<string, number>
}

// ── Maintenance ops (embedding backfill + semantic dedup) ────────────

export interface BackfillEmbeddingsRequest {
  /** Max items to embed this call. Default 500, clamped [1, 10000]. Call repeatedly until embedded=0. */
  batch?: number
}

export interface BackfillEmbeddingsResult {
  /** Items vectorized on this pass. */
  embedded: number
}

export interface DedupRequest {
  /** Cosine threshold for "same memory". Default 0.92. */
  threshold?: number
  /** Max items to scan this pass. Default 1000, clamped [1, 10000]. */
  scanLimit?: number
}

export interface DedupResult {
  scanned: number
  groups: number
  superseded: number
}

export interface ReflectRequest {
  /** Subject to reflect on. Narrow the corpus to one subject. */
  userId?: string
  /** Max recent confirmed memories to feed the synthesizer. Default 50, clamped [1, 200]. */
  maxSources?: number
  /** Max insights to synthesize this pass. Default 5, clamped [1, 20]. */
  maxInsights?: number
  /** Preview only — synthesize + return, but don't persist. Default false. */
  dryRun?: boolean
}

/** A synthesized higher-order insight with provenance back to its sources. */
export interface Insight {
  /** Saved insight memory id (empty when dryRun). */
  id: string
  content: string
  /** Ids of the source memories that support this insight. */
  sourceIds: string[]
  confidence: number
}

export interface ReflectResult {
  insights: Insight[]
  /** How many source memories were considered. */
  sourcesConsidered: number
  dryRun: boolean
}

export interface PrefetchRelatedRequest {
  /** The memories the session is currently working with — the activation seed. */
  seedMemoryIds: string[]
  /** Max related memories to return. Default 10, clamped [1, 100]. */
  limit?: number
}

// ── Adjudication queue ───────────────────────────────────────────────

/** Why a memory is in the review queue. The queue reports the highest-priority reason. */
export enum MemoryReviewReason {
  /** Awaiting first confirmation (status = pending). */
  PENDING = 'pending',
  /** Flagged by repeated negative feedback (>= 3). */
  FLAGGED = 'flagged',
  /** Auto-extracted, never human-confirmed, with low confidence. */
  LOW_CONFIDENCE = 'low_confidence',
  /** Old and long-unrecalled — a decay/forget candidate. */
  STALE = 'stale',
}

/** A review-queue row: a memory plus why it needs a steward's attention. */
export interface ReviewQueueItem extends MemoryItem {
  reviewReason: MemoryReviewReason
}

// ── Procedural memory ────────────────────────────────────────────────

/** One step in a procedure. `pitfall` is an optional inline warning. */
export interface ProcedureStep {
  text: string
  pitfall?: string
}

/** Structured shape stored on a PROCEDURE memory's `metadata`. */
export interface ProceduralMemoryMetadata {
  /** What the procedure accomplishes. */
  goal: string
  /** When to reach for it — the trigger condition, in words. */
  whenToUse?: string
  /** Ordered steps. */
  steps: ProcedureStep[]
  /** Known failure modes / anti-patterns — what NOT to do and why. */
  failureModes?: string[]
}

/** Input for `admin.createProcedure()`. */
export interface CreateProcedureRequest extends ProceduralMemoryMetadata {
  /** Optional category tag — used as the heading when injected. */
  category?: string
  /** Override the default PROJECT scope. */
  scope?: MemoryScope
  /** 0-10 importance, defaults to 7. */
  importance?: number
}

// ── Memory precedence policy ─────────────────────────────────────────

/** Origin tier of a memory, used to resolve conflicts. Default order strongest→weakest. */
export enum MemoryProvenanceTier {
  /** Confirmed by a human steward — most trusted. */
  HUMAN_VERIFIED = 'human_verified',
  /** Learned/extracted inside this organization. */
  LOCAL = 'local',
  /** Ingested from a purchased/licensed brain. */
  LICENSED_BRAIN = 'licensed_brain',
  /** Seed / base-model brain baseline. */
  BASE = 'base',
}

/** Category-level override: "for this category, this tier wins." */
export interface MemoryPrecedenceOverride {
  category: string
  winningTier: MemoryProvenanceTier
}

/** Which memory wins when two disagree. See `admin.getPrecedence()` / `setPrecedence()`. */
export interface MemoryPrecedencePolicy {
  /** Tier ranking, strongest first. Tiers omitted rank last. */
  defaultOrder: MemoryProvenanceTier[]
  /** When true, a nearer (more specific) scope breaks ties within a tier. */
  scopeNearestWins: boolean
  /** Category-level exceptions applied before the default order. */
  overrides: MemoryPrecedenceOverride[]
}
