import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'

/** A conversation turn, in the shape every chat SDK already uses. */
export interface ConversationTurn {
  role?: string
  content: string
}

export interface ConversationContextRequest {
  /**
   * The conversation. Prefer TURNS over a joined string: subject attribution
   * reads the last human turn, and concatenation destroys the boundary that
   * makes that possible.
   */
  turns?: ConversationTurn[]
  /** Alternative to `turns` when all you have is text. */
  conversation?: string
  /**
   * What you are about to do ("draft the renewal reply"). Weighted AHEAD of
   * the conversation, because it describes the turn the context is for.
   */
  intent?: string
  /** Hard cap on the assembled block. Default 1200. */
  tokenBudget?: number
  /** Candidate pool before budgeting. Default 25. */
  limit?: number
  /** Min-necessary access — withhold these categories from this query. */
  excludeCategories?: string[]
  /** Brain isolation. Required when consuming a published brain. */
  brainId?: string
}

export interface ConversationContextBundle {
  /** Ready to inject into a system prompt. Null when nothing applies. */
  context: string | null
  /** Who we decided this is about, and how the decision was made. */
  subject: {
    kind: string
    externalId: string
    origin: 'explicit' | 'speaker-first-person' | 'speaker' | 'user'
    confidence: number
  } | null
  /** Every row that reached the block. Pass any to `memory.explain()`. */
  memoryIds: string[]
  tokensEstimate: number
  tokenBudget: number
  /**
   * Retrieved candidates the budget could not fit. Non-zero means "raise
   * tokenBudget", NOT "we know nothing" — the two are otherwise
   * indistinguishable from an empty-looking block.
   */
  droppedForBudget: number
  /** The query retrieval actually ran on. For debugging a bad bundle. */
  query: string
}

export type ContextSection =
  | 'profile'
  | 'patterns'
  | 'predictions'
  | 'memories'
  | 'observations'

export interface ContextBuildRequest {
  subject: { kind: string; externalId: string }
  /** Which sections to include. Default: all five. */
  include?: ContextSection[]
  /** Hard cap on bundle size. Sections truncate to fit. Default 2000. */
  maxTokens?: number
  /** Max raw memories. Default 10. */
  memoryLimit?: number
  /** Max predictions. Default 5. */
  predictionLimit?: number
  /**
   * Phase 3f min-necessary access — drop memories whose `category`
   * is in this list. Use to keep medical / HR / PII out of queries
   * that don't need them, even when they share the same project.
   */
  excludeCategories?: string[]
}

export interface ContextBundle {
  subject: { kind: string; externalId: string }
  profile: ContextProfile | null
  patterns: ContextPattern[]
  predictions: ContextPrediction[]
  memories: ContextMemory[]
  observations: ContextObservation[]
  /** Every id contributing to the bundle. Call tf.memory.explain() on any of these. */
  provenance: {
    memoryIds: string[]
    patternIds: string[]
    observationIds: string[]
  }
  /** Honest within ±15%. */
  tokensEstimate: number
  /** Sections that were truncated to fit the maxTokens budget. */
  truncated: ContextSection[]
  generatedAt: string
  durationMs: number
}

export interface ContextProfile {
  rfmSegment: string | null
  recencyScore: number | null
  frequencyScore: number | null
  monetaryScore: number | null
  topEntity: string | null
  cadenceSummary: string | null
  risks: Array<{
    kind: string
    description: string
    severity: number
    sourcePatternId: string
  }>
}

export interface ContextPattern {
  id: string
  patternKind: string
  summary: string
  confidence: number
  nextExpectedAt: string | null
}

export interface ContextPrediction {
  patternId: string
  patternKind: string
  description: string
  expectedAt: string
  confidence: number
  sourceMemoryIds: string[]
}

export interface ContextMemory {
  id: string
  type: string
  content: string
  importance: number
  created: string
}

export interface ContextObservation {
  id: string
  content: string
  proofCount: number
  sourceMemoryIds: string[]
  created: string
}

/**
 * Context Builder — the unified "give my LLM everything it needs in
 * one call" surface. Replaces 4-5 separate SDK round-trips:
 *
 *   await tf.memory.admin.list({...})
 *   await tf.memory.admin.search({...})
 *   await tf.lattice.predict({...})
 *   await tf.lattice.getProfile({...})
 *   ...
 *
 * with:
 *
 *   const ctx = await tf.context.build({ subject })
 *
 * Returns a token-budgeted bundle paste-ready into a system prompt.
 * Every claim has a sourceMemoryId / sourcePatternId / etc., so the
 * LLM (or a downstream auditor) can call tf.memory.explain() on
 * anything in the bundle and trace it back to raw memories.
 *
 * @example
 * ```ts
 * const ctx = await tf.context.build({
 *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
 *   include: ['profile', 'predictions', 'memories'],
 *   maxTokens: 1500,
 * })
 *
 * console.log(ctx.profile?.rfmSegment)        // 'at_risk_high_value'
 * console.log(ctx.profile?.risks)             // [{ kind: 'declining_engagement', ... }]
 * console.log(ctx.predictions[0].description) // 'pizza order from Tony's'
 * console.log(ctx.tokensEstimate)             // 1342
 * console.log(ctx.truncated)                  // ['memories'] if budget was tight
 *
 * // Drop into a system prompt:
 * const prompt = `Subject context:\n${JSON.stringify(ctx, null, 2)}\n\nUser question: ...`
 * ```
 */
/** One edge of the temporal knowledge graph. */
export interface GraphEdge {
  id: string
  subjectId: string
  predicate: string
  /** Exactly one of objectId (entity) or objectLiteral is set. */
  objectId?: string
  objectLiteral?: string
  weight: number
  validFrom: string
  /** Absent = still current. */
  validTo?: string
}

export interface QueryGraphRequest {
  /** Narrow to a subject entity and/or predicate. */
  subjectId?: string
  predicate?: string
  /** RFC3339 instant for a point-in-time view. Omit for the current graph. */
  asOf?: string
  /** Max edges. Default 100, clamped [1, 1000]. */
  limit?: number
}

export interface BatchContextBuildRequest {
  /** Subjects to build context for (<= 500). Options below apply to all. */
  subjects: Array<{ kind: string; externalId: string }>
  include?: ContextSection[]
  maxTokens?: number
  memoryLimit?: number
  predictionLimit?: number
  excludeCategories?: string[]
}

export class ContextResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Assemble injectable context FOR A CONVERSATION — no subject id required.
   *
   * The subject-keyed `build()` answers "what do we know about this subject", which needs
   * you to know who the subject IS. This answers "what should the model know
   * before it replies to this", which is the question a host application
   * actually has, once per turn, with a conversation in hand and no id.
   *
   * @example
   * ```ts
   * const { context } = await mm.context.forConversation({
   *   turns: messages,
   *   intent: 'answer the billing question',
   *   tokenBudget: 800,
   * })
   * if (context) messages.unshift({ role: 'system', content: context })
   * ```
   */
  async forConversation(
    body: ConversationContextRequest,
    options?: RequestOptions,
  ): Promise<ConversationContextBundle> {
    return this.http.post<ConversationContextBundle>('/memory/context', body, options)
  }

  async build(
    body: ContextBuildRequest,
    options?: RequestOptions,
  ): Promise<ContextBundle> {
    return this.http.post<ContextBundle>('/lattice/context', body, options)
  }

  /**
   * Build context bundles for many subjects in ONE call (up to 500). Replaces
   * the N-round-trip bulk load — return order matches `subjects`.
   */
  async batchBuild(
    body: BatchContextBuildRequest,
    options?: RequestOptions,
  ): Promise<ContextBundle[]> {
    const r = await this.http.post<{ bundles: ContextBundle[] }>(
      '/lattice/context/batch',
      body,
      options,
    )
    return r.bundles
  }

  /**
   * Point-in-time knowledge-graph query: edges valid AT `asOf` (or current if
   * omitted), filtered by subject/predicate. "What did we believe about X on
   * date Y."
   */
  async queryGraph(
    body: QueryGraphRequest = {},
    options?: RequestOptions,
  ): Promise<GraphEdge[]> {
    const r = await this.http.post<{ edges: GraphEdge[] }>('/lattice/graph/query', body, options)
    return r.edges
  }
}
