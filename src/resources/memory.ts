import { ConsentResource } from './consent.js'
import { GraphResource } from './graph.js'
import type { HttpClient } from '../core/http-client.js'
import { renderProcedureContent } from '../core/procedural.js'
import type { RequestOptions } from '../core/types.js'
import {
  MemoryItemType,
  MemoryScope,
  type ConfirmMemoryRequest,
  type CreateProcedureRequest,
  type MemoryPrecedencePolicy,
  type ReviewQueueItem,
  type CreateMemoryRequest,
  type ListMemoryParams,
  type MemoryFeedback,
  type MemoryItem,
  type MemorySearchRequest,
  type MemorySearchResult,
  type MemoryStats,
  type IngestMediaRequest,
  type IngestMediaResult,
  type ConsolidateRequest,
  type ConsolidateResult,
  type BackfillEmbeddingsRequest,
  type BackfillEmbeddingsResult,
  type DedupRequest,
  type DedupResult,
  type ReflectRequest,
  type ReflectResult,
  type PrefetchRelatedRequest,
  type ObserveAttachmentRequest,
  type ObserveDocumentRequest,
  type ObserveRequest,
  type ObserveResponse,
  type ObserveVoiceRequest,
  type PromoteMemoryRequest,
  type SubmitFeedbackRequest,
  type UpdateMemoryRequest,
} from '../types/memory.js'

/**
 * Largest page `GET /admin/memory` will serve — the route rejects anything
 * bigger. Keep in sync with `AdminListRoute` on the server.
 */
const MAX_PAGE_SIZE = 500

/**
 * Encode a binary payload as base64. Works in Node (Buffer present)
 * and browsers (uses the WebStream-friendly btoa path).
 */
function toBase64(bytes: Uint8Array): string {
  // Node: Buffer is the fastest path.
  const g = globalThis as { Buffer?: { from(arr: Uint8Array): { toString(enc: string): string } } }
  if (typeof g.Buffer !== 'undefined') {
    return g.Buffer.from(bytes).toString('base64')
  }
  // Browser fallback: chunked btoa so we don't blow the call stack on
  // multi-MB images.
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Memory — primary surface for app.memmesh.ai.
 *
 * Two sub-resources:
 *  - `tf.memory` (this class) — current-user memories at
 *    `/api/v1/projects/{projectId}/memory/*`
 *  - `tf.memory.admin` — full admin surface at
 *    `/api/v1/projects/{projectId}/admin/memory/*` (requires
 *    READ_MEMORY / WRITE_MEMORY permission)
 *
 * @example
 * ```ts
 * // List your own memories
 * const mine = await tf.memory.mine({ limit: 20 })
 *
 * // Admin: list every memory in the project
 * const all = await tf.memory.admin.list({ scope: 'project' })
 *
 * // Admin: semantic search
 * const hits = await tf.memory.admin.search({ query: 'pizza', limit: 10 })
 * ```
 */
export class MemoryResource {
  readonly admin: AdminMemoryResource
  readonly consent: ConsentResource

  constructor(private readonly http: HttpClient) {
    this.admin = new AdminMemoryResource(http)
    this.consent = new ConsentResource(
      http,
      (params, options) => this.admin.list(params, options),
      (body, options) =>
        this.admin.create(
          {
            content: body.content,
            type: body.type,
            scope: body.scope,
            importance: body.importance,
            category: body.category,
            metadata: body.metadata,
          },
          options,
        ),
      (memoryId, options) => this.admin.delete(memoryId, options),
    )
  }

  /**
   * Ergonomic ingest for agents. One-liner that writes a memory item
   * with sensible defaults (type=event, scope=project, status=confirmed,
   * importance=5) and stamps a `metadata.subject` so the mining engine
   * picks it up.
   *
   * Use this when you want to record "something happened" — an action,
   * an observation, an interaction. Pattern mining runs over these
   * items automatically (15-min cron, or call `tf.lattice.mineMemories()`
   * to force).
   *
   * @example
   * ```ts
   * // Workspace activity
   * await tf.memory.observe({
   *   subject: { kind: 'workspace', externalId: 'ryan-laptop' },
   *   content: 'Ran Claude Code session — 45 min, 3 files edited',
   *   activityType: 'claude_code_session',
   * })
   *
   * // Customer interaction
   * await tf.memory.observe({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   content: 'Ordered large pepperoni pizza, no tip',
   *   activityType: 'pizza_order',
   *   metadata: { total: 38.50, currency: 'USD' },
   * })
   * ```
   */
  async observe(
    body: ObserveRequest,
    options?: RequestOptions,
  ): Promise<ObserveResponse> {
    // PRIMARY path: hand the engine the raw turn and let it decide what to keep.
    // POST /memory/observe runs the Observe pipeline (extract → dedupe → budget)
    // and returns { saved, candidateCount }; filler comes back with saved: [].
    if (body.text != null && body.text.trim().length > 0) {
      return this.http.post<ObserveResponse>(
        '/memory/observe',
        {
          text: body.text,
          role: body.role ?? 'user',
          // Provenance, all optional server-side. Omitted rather than sent as
          // null so a turn without them is indistinguishable from one made by
          // an older client.
          ...(body.userId ? { userId: body.userId } : {}),
          ...(body.agentId ? { agentId: body.agentId } : {}),
          ...(body.sessionId ? { sessionId: body.sessionId } : {}),
          ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
        },
        options,
      )
    }
    // LEGACY path: caller handed a pre-decided fact. Store it verbatim (no
    // extraction) and wrap the single item so the return shape stays consistent.
    if (body.content != null && body.content.trim().length > 0) {
      const item = await this.admin.create(
        {
          content: body.content,
          type: body.type ?? MemoryItemType.EVENT,
          scope: body.scope ?? MemoryScope.PROJECT,
          importance: body.importance ?? 5,
          category: body.category,
          source: 'admin_created',
          // Event time, not ingest time. `validFrom` is the column the mining
          // engine reads to bucket day-of-week / time-of-day, so this mapping is
          // what makes backfills work: without it every historical order lands at
          // the wall-clock instant of the import and the patterns describe the
          // import job. The metadata copy is kept for backwards compatibility
          // with readers that already look for `metadata.occurredAt`.
          validFrom: body.occurredAt,
          metadata: {
            subject: body.subject,
            ...(body.activityType ? { eventType: body.activityType } : {}),
            ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
            ...(body.metadata ?? {}),
          },
        },
        options,
      )
      return { saved: [item], candidateCount: 1 }
    }
    throw new Error('observe requires `text` (preferred) or `content`')
  }

  /**
   * Record an image as a memory item. The image is uploaded as a
   * MEMORY_ATTACHMENT file, and a memory item is created with the
   * subject + activity metadata you provide.
   *
   * Pass `content` for the searchable caption — the engine doesn't
   * auto-caption today (vision LLM hook lands in a follow-up). The
   * image bytes are stored in S3 and accessible via the file id in
   * `metadata.fileId` of the returned memory.
   *
   * @example
   * ```ts
   * await tf.memory.observeImage({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   image: imageBuffer,           // Uint8Array, Buffer, or base64 string
   *   mimeType: 'image/jpeg',
   *   fileName: 'receipt.jpg',
   *   content: 'Receipt for $38 pizza order',
   * })
   * ```
   */
  async observeImage(
    body: ObserveAttachmentRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.uploadAttachment(body, options)
  }

  /**
   * Record a voice clip / audio file as a memory item. The audio is
   * uploaded as a MEMORY_ATTACHMENT file, and a memory item is created
   * with the subject + activity metadata you provide.
   *
   * Pass `content` for the searchable transcript — the engine doesn't
   * auto-transcribe today (Whisper hook lands in a follow-up). Audio
   * bytes are stored in S3 and accessible via `metadata.fileId`.
   *
   * @example
   * ```ts
   * await tf.memory.observeVoice({
   *   subject: { kind: 'user', externalId: 'ryan' },
   *   audio: audioBuffer,
   *   mimeType: 'audio/mpeg',
   *   fileName: 'voicenote-2026-05-25.mp3',
   *   content: 'Reminder to follow up on the SOC 2 audit next week',
   * })
   * ```
   */
  async observeVoice(
    body: ObserveVoiceRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    const { audio, ...rest } = body
    return this.uploadAttachment({ ...rest, image: audio }, options)
  }

  /**
   * Record a document (PDF, Word, Markdown, plain text, etc.) as a
   * memory item. Backend stores the bytes as a MEMORY_ATTACHMENT file
   * and creates a memory item of modality='document' pointing at it.
   *
   * Pass `content` for the searchable text. The engine doesn't auto-
   * extract from PDFs/Office files yet (that lands behind the
   * AP_MEMORY_DOC_EXTRACT_ENABLED flag in a follow-up); until then,
   * use a parser of your choice (pdftotext, mammoth, etc.) before
   * calling this method.
   *
   * @example
   * ```ts
   * import { readFile } from 'node:fs/promises'
   *
   * const pdfBytes = await readFile('contract.pdf')
   * await tf.memory.observeDocument({
   *   subject: { kind: 'project', externalId: 'acme-contract' },
   *   document: pdfBytes,
   *   mimeType: 'application/pdf',
   *   fileName: 'acme-msa-2026.pdf',
   *   content: 'ACME MSA dated 2026-04-12. Term: 24 months. Payment terms: NET 30. ...',
   * })
   * ```
   */
  async observeDocument(
    body: ObserveDocumentRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    const { document, ...rest } = body
    return this.uploadAttachment({ ...rest, image: document }, options)
  }

  private async uploadAttachment(
    body: ObserveAttachmentRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    const { image, ...rest } = body
    const dataBase64 = typeof image === 'string' ? image : toBase64(image)
    return this.http.post<MemoryItem>(
      '/memory/attachments',
      { ...rest, dataBase64 },
      options,
    )
  }

  /**
   * Ingest a media item — image, audio, or document — as memories. The engine
   * extracts text (vision / transcription / OCR via LiteLLM) and runs it
   * through the full observe pipeline, so the result is real memories with
   * graph wiring and embeddings, not just a stored file. Requires multimodal
   * to be enabled on the engine.
   *
   * ```ts
   * const res = await tf.memory.ingestMedia({
   *   media: fs.readFileSync('receipt.png'),
   *   mimeType: 'image/png',
   *   source: 'receipt.png',
   * })
   * console.log(res.extractedText, res.saved.length)
   * ```
   */
  async ingestMedia(
    body: IngestMediaRequest,
    options?: RequestOptions,
  ): Promise<IngestMediaResult> {
    const { media, ...rest } = body
    const dataBase64 = typeof media === 'string' ? media : toBase64(media)
    return this.http.post<IngestMediaResult>(
      '/memory/media',
      { ...rest, dataBase64 },
      options,
    )
  }

  /**
   * List the current user's memories across all scopes.
   */
  async mine(
    params?: { limit?: number; offset?: number },
    options?: RequestOptions,
  ): Promise<MemoryItem[]> {
    return this.http.get<MemoryItem[]>(
      '/memory/mine',
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
  }

  /**
   * Delete a memory item in this project.
   *
   * PROJECT-SCOPED, not owner-scoped — this was previously documented as
   * "one of your own memory items", which it has never been. Your API key can
   * delete any memory in the project it is scoped to. That is the intended
   * behaviour for a backend managing its own data; it is the wrong thing to
   * put behind an end user's "forget this about me" button.
   */
  async delete(memoryId: string, options?: RequestOptions): Promise<void> {
    return this.http.delete(`/memory/${memoryId}`, options)
  }

  /**
   * Right-to-explanation API. For a `behavior_pattern` memory item,
   * fetch the raw source memories that produced it. For any other
   * memory item, returns the item itself with `sourceMemories: []`.
   *
   * Powers two things:
   *   1. Customer-facing GDPR Art. 22 / EU AI Act explanation
   *      requests — "why did the agent predict this for me?"
   *   2. Operator debugging — "what raw events drove this pattern?"
   *
   * The pattern memory carries `metadata.sourceMemoryIds[]` — this
   * helper just resolves each id back to its full memory item via
   * `admin.list()`. No backend extension needed; provenance was
   * built into the storage shape from day one.
   *
   * @example
   * ```ts
   * const { memory, sourceMemories } = await tf.memory.explain(patternId)
   * console.log(`Pattern: ${memory.content}`)
   * console.log(`Derived from ${sourceMemories.length} raw memories:`)
   * for (const m of sourceMemories) {
   *   console.log(`  - ${m.created}: ${m.content}`)
   * }
   * ```
   */
  async explain(
    memoryId: string,
    options?: RequestOptions,
  ): Promise<{ memory: MemoryItem; sourceMemories: MemoryItem[] }> {
    const memory = await this.admin.get(memoryId, options)

    // Pull source ids from metadata. Both camelCase and snake_case
    // are accepted because the Rust engine emits camelCase but
    // legacy items may carry snake.
    const md = (memory.metadata ?? {}) as Record<string, unknown>
    const rawIds = (md.sourceMemoryIds ?? md.source_memory_ids ?? []) as unknown
    const ids = Array.isArray(rawIds) ? rawIds.filter((x): x is string => typeof x === 'string') : []

    if (ids.length === 0) {
      return { memory, sourceMemories: [] }
    }

    // Point-lookup each source. This used to scan `list({ limit: 1000 })` and
    // filter client-side — which silently missed any source outside the newest
    // 1000 rows, and in fact 400'd outright since the route caps `limit` at 500.
    // A source that has since been deleted or superseded is skipped rather than
    // failing the whole explain.
    const sourceMemories = (
      await Promise.all(ids.map((id) => this.admin.get(id, options).catch(() => null)))
    ).filter((m): m is MemoryItem => m !== null)

    return { memory, sourceMemories }
  }

  /**
   * Submit feedback on a memory item — `positive` reinforces, `negative`
   * counts toward the auto-flag threshold (3 negatives → review queue).
   */
  async submitFeedback(
    body: { memoryId: string } & SubmitFeedbackRequest,
    options?: RequestOptions,
  ): Promise<void> {
    return this.http.post('/memory/feedback', body, options)
  }
}

/**
 * Admin memory resource — covers the full surface used by the
 * AdminMemoryPage. Requires READ_MEMORY / WRITE_MEMORY permission;
 * non-admin keys get a 403.
 */
export class AdminMemoryResource {
  /** The knowledge graph extraction builds from observed memory. */
  readonly graph: GraphResource

  constructor(private readonly http: HttpClient) {
    this.graph = new GraphResource(http)
  }

  /**
   * List memories in the project, filtered by scope/status/etc.
   *
   * Returns one page — newest first. `limit` maxes out at 500 (default 50);
   * page by bumping `offset`. A page shorter than `limit` means you've reached
   * the end. To walk everything without hand-rolling that loop, use
   * {@link listAll}.
   */
  async list(params?: ListMemoryParams, options?: RequestOptions): Promise<MemoryItem[]> {
    return this.http.get<MemoryItem[]>(
      '/admin/memory',
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
  }

  /**
   * Fetch a single memory by id.
   */
  async get(memoryId: string, options?: RequestOptions): Promise<MemoryItem> {
    return this.http.get<MemoryItem>(`/admin/memory/${memoryId}`, undefined, options)
  }

  /**
   * Walk every memory matching `params`, transparently paging under the hood.
   * Yields items one at a time so a large corpus never has to fit in memory.
   *
   * Note this pages by offset over a newest-first list, so writes landing
   * mid-walk can shift rows across page boundaries. Fine for browsing and
   * export; for an exact snapshot, filter by a fixed `asOf`.
   *
   * ```ts
   * for await (const m of tf.memory.admin.listAll({ type: MemoryItemType.EVENT })) {
   *   console.log(m.id, m.content)
   * }
   * ```
   */
  async *listAll(
    params?: Omit<ListMemoryParams, 'offset'>,
    options?: RequestOptions,
  ): AsyncGenerator<MemoryItem, void, undefined> {
    const limit = Math.min(params?.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE)
    let offset = 0
    for (;;) {
      const page = await this.list({ ...params, limit, offset }, options)
      for (const item of page) yield item
      if (page.length < limit) return
      offset += page.length
    }
  }

  /**
   * List platform-level memories (shared across all projects on this platform).
   */
  async listPlatform(
    params?: { status?: string; limit?: number; offset?: number },
    options?: RequestOptions,
  ): Promise<MemoryItem[]> {
    return this.http.get<MemoryItem[]>(
      '/admin/memory/platform',
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
  }

  /**
   * List the adjudication queue — everything the system is unsure about. Each
   * row carries a `reviewReason`: `pending` (awaiting confirmation), `flagged`
   * (>= 3 negative), `low_confidence` (weak auto-extraction), or `stale`
   * (old and long-unused).
   */
  async listPendingReview(
    params?: { limit?: number; offset?: number },
    options?: RequestOptions,
  ): Promise<ReviewQueueItem[]> {
    return this.http.get<ReviewQueueItem[]>(
      '/admin/memory/review',
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
  }

  /**
   * Aggregate stats for the admin dashboard (totals, by-scope, by-status,
   * pending-review count, flagged count).
   */
  async stats(options?: RequestOptions): Promise<MemoryStats> {
    return this.http.get<MemoryStats>('/admin/memory/stats', undefined, options)
  }

  /**
   * Create a memory at any scope. Use this for seeded knowledge that
   * agents should know without observing first.
   */
  async create(body: CreateMemoryRequest, options?: RequestOptions): Promise<MemoryItem> {
    return this.http.post<MemoryItem>('/admin/memory', body, options)
  }

  /**
   * Author a procedure — "how this job is done here" (goal + steps + failure
   * modes). Stored as a PROCEDURE memory: the structured shape goes on
   * `metadata` and the rendered how-to text on `content`, so retrieval injects
   * it as an explicit exemplar. A cheaper model reasons better on-domain when
   * handed the procedure instead of a flattened fact.
   */
  async createProcedure(
    body: CreateProcedureRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    const { category, scope, importance, ...metadata } = body
    return this.create(
      {
        type: MemoryItemType.PROCEDURE,
        content: renderProcedureContent(metadata),
        category,
        scope: scope ?? MemoryScope.PROJECT,
        importance: importance ?? 7,
        metadata: metadata as unknown as Record<string, unknown>,
      },
      options,
    )
  }

  /**
   * Get the project's memory precedence policy — which memory wins when two
   * disagree. Falls back to the default ladder (human-verified > local >
   * licensed-brain > base) when unset.
   */
  async getPrecedence(options?: RequestOptions): Promise<MemoryPrecedencePolicy> {
    return this.http.get<MemoryPrecedencePolicy>(
      '/admin/memory/precedence',
      undefined,
      options,
    )
  }

  /**
   * Save the project's memory precedence policy. Requires the Memory Steward
   * role (MANAGE_MEMORY_POLICY).
   */
  async setPrecedence(
    policy: MemoryPrecedencePolicy,
    options?: RequestOptions,
  ): Promise<MemoryPrecedencePolicy> {
    return this.http.put<MemoryPrecedencePolicy>(
      '/admin/memory/precedence',
      policy,
      options,
    )
  }

  /**
   * Update any memory item.
   */
  async update(
    memoryId: string,
    body: UpdateMemoryRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.patch<MemoryItem>(`/admin/memory/${memoryId}`, body, options)
  }

  /**
   * Confirm or reject a pending memory.
   */
  async confirm(
    memoryId: string,
    body: ConfirmMemoryRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(`/admin/memory/${memoryId}/confirm`, body, options)
  }

  /**
   * Copy a memory to a higher (or lower) scope. The original is preserved;
   * the new row is a confirmed sibling at the target scope.
   *
   * @example
   * ```ts
   * // Promote a project-scoped memory to platform-wide
   * await tf.memory.admin.promote('memoryId', { targetScope: 'platform' })
   * ```
   */
  async promote(
    memoryId: string,
    body: PromoteMemoryRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(`/admin/memory/${memoryId}/promote`, body, options)
  }

  /**
   * Semantic search across every scope visible to the project. The
   * results are vector-similarity sorted with optional scope/status
   * filtering applied first.
   */
  async search(
    params: MemorySearchRequest,
    options?: RequestOptions,
  ): Promise<MemorySearchResult[]> {
    return this.http.post<MemorySearchResult[]>('/admin/memory/search', params, options)
  }

  /**
   * Hard-delete any memory item. There is no soft-delete — gone is gone.
   */
  async delete(memoryId: string, options?: RequestOptions): Promise<void> {
    return this.http.delete(`/admin/memory/${memoryId}`, options)
  }

  /**
   * LLM-driven deductive consolidation. Reads recent activity memories
   * for a subject (or every subject if omitted), batches them with
   * existing observations, and lets an LLM emit create / update /
   * supersede actions.
   *
   * Each observation is a one-facet-per-row distilled fact with
   * provenance (sourceMemoryIds[]) and a proofCount. This is the
   * deductive counterpart to Lattice's inductive pattern miner —
   * inductive answers "what's repeating?", deductive answers
   * "what's true?".
   *
   * Architectural pattern from vectorize-io/hindsight; runs server-
   * side using the platform's configured AI provider.
   *
   * @example
   * ```ts
   * // Consolidate one subject's recent activity into observations
   * const result = await tf.memory.admin.consolidate({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   windowDays: 30,
   * })
   * console.log(
   *   `${result.observationsCreated} new, ` +
   *   `${result.observationsUpdated} reinforced, ` +
   *   `${result.observationsSuperseded} contradicted`
   * )
   * ```
   */
  async consolidate(
    body: ConsolidateRequest = {},
    options?: RequestOptions,
  ): Promise<ConsolidateResult> {
    return this.http.post<ConsolidateResult>('/admin/memory/llm-consolidate', body, options)
  }

  /**
   * Vectorize memory items that have no embedding yet (catch-up
   * embedding work-list). Call repeatedly until `embedded` is 0 to drain a
   * large corpus. Idempotent — already-embedded items are skipped.
   *
   * @example
   * ```ts
   * let n: number
   * do { ({ embedded: n } = await tf.memory.admin.backfillEmbeddings({ batch: 500 })) } while (n > 0)
   * ```
   */
  async backfillEmbeddings(
    body: BackfillEmbeddingsRequest = {},
    options?: RequestOptions,
  ): Promise<BackfillEmbeddingsResult> {
    return this.http.post<BackfillEmbeddingsResult>('/admin/memory/embeddings/backfill', body, options)
  }

  /**
   * Semantic dedup: collapse near-duplicate memories (cosine ≥ threshold),
   * keep the strongest, supersede the rest. Distinct from consolidate(), which
   * is the LLM-driven deductive-observations pass.
   */
  /**
   * Collapse clusters of near-duplicate memories into ONE lossless survivor.
   *
   * Unlike `dedup()`, which keeps the newer of a pair and supersedes the
   * older — losing any detail only the older one carried — this writes a NEW
   * memory covering the union and supersedes the cluster onto it. Originals
   * stay verbatim behind it.
   *
   * DEFAULTS TO A DRY RUN. Call it that way first: it reports how much of the
   * corpus is near-duplicate, and in what cluster sizes, without invoking a
   * model or writing anything. A real run also needs merge writes enabled
   * server-side, and returns an abstention count — read that before trusting
   * the merges.
   */
  async merge(
    body?: {
      dryRun?: boolean
      threshold?: number
      maxClusters?: number
      maxClusterSize?: number
    },
    options?: RequestOptions,
  ): Promise<{
    clustersFound: number
    clustersMerged: number
    clustersAbstained: number
    memoriesSuperseded: number
  }> {
    return this.http.post('/admin/memory/merge', body ?? {}, options)
  }

  async dedup(
    body: DedupRequest = {},
    options?: RequestOptions,
  ): Promise<DedupResult> {
    return this.http.post<DedupResult>('/admin/memory/dedup', body, options)
  }

  /**
   * Reflection / insight synthesis: review a subject's recent confirmed
   * memories and synthesize higher-order "insight" memories — cross-cutting
   * generalizations supported by multiple raw memories (e.g. "churns after a
   * price increase"). Insights are saved as first-class memories
   * (kind="insight") with provenance back to their sources, so later
   * retrieval returns synthesized understanding, not just raw facts. Pass
   * `dryRun` to preview without persisting. Intended to run on a schedule.
   */
  async reflect(
    body: ReflectRequest = {},
    options?: RequestOptions,
  ): Promise<ReflectResult> {
    return this.http.post<ReflectResult>('/admin/memory/reflect', body, options)
  }

  /**
   * Predictive (anticipatory) retrieval — spreading activation over the
   * knowledge graph. Given the memories a session is currently working with
   * (`seedMemoryIds`), returns other memories linked to the SAME graph
   * entities, ranked by how many distinct shared entities connect them — the
   * context most likely needed next, surfaced before it's asked for.
   * Deterministic and read-only.
   */
  async prefetchRelated(
    body: PrefetchRelatedRequest,
    options?: RequestOptions,
  ): Promise<MemoryItem[]> {
    return this.http.post<MemoryItem[]>('/admin/memory/prefetch-related', body, options)
  }

  /**
   * List the feedback records attached to a memory item — useful when
   * inspecting auto-flagged items to decide whether to confirm or reject.
   */
  async listFeedback(memoryId: string, options?: RequestOptions): Promise<MemoryFeedback[]> {
    return this.http.get<MemoryFeedback[]>(
      `/admin/memory/${memoryId}/feedback`,
      undefined,
      options,
    )
  }
}
