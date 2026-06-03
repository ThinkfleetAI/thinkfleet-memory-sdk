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
  /** Subject this observation applies to. Required so mining works. */
  subject: { kind: string; externalId: string }
  /** Free-text content of the observation. */
  content: string
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
  limit?: number
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
