import { ConsentResource } from './consent.js'
import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import {
  MemoryItemType,
  MemoryScope,
  type ConfirmMemoryRequest,
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
  type ObserveVoiceRequest,
  type PromoteMemoryRequest,
  type SubmitFeedbackRequest,
  type UpdateMemoryRequest,
} from '../types/memory.js'

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
  ): Promise<MemoryItem> {
    return this.admin.create(
      {
        content: body.content,
        type: body.type ?? MemoryItemType.EVENT,
        scope: body.scope ?? MemoryScope.PROJECT,
        importance: body.importance ?? 5,
        category: body.category,
        source: 'admin_created',
        metadata: {
          subject: body.subject,
          ...(body.activityType ? { eventType: body.activityType } : {}),
          ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
          ...(body.metadata ?? {}),
        },
      },
      options,
    )
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
   * Delete one of your own memory items.
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
    // Fetch the target pattern. There's no GET /admin/memory/:id route;
    // pull a page wide enough to find it (with category=lattice this
    // is fast — the project usually has tens of patterns, not thousands).
    const all = await this.admin.list({ limit: 200 }, options)
    const memory = all.find((m) => m.id === memoryId)
    if (!memory) {
      throw new Error(`memory ${memoryId} not found in this project`)
    }

    // Pull source ids from metadata. Both camelCase and snake_case
    // are accepted because the Rust engine emits camelCase but
    // legacy items may carry snake.
    const md = (memory.metadata ?? {}) as Record<string, unknown>
    const rawIds = (md.sourceMemoryIds ?? md.source_memory_ids ?? []) as unknown
    const ids = Array.isArray(rawIds) ? rawIds.filter((x): x is string => typeof x === 'string') : []

    if (ids.length === 0) {
      return { memory, sourceMemories: [] }
    }

    // Resolve each id by scanning the broader project memory list.
    // For very large projects this won't scale; once the backend
    // exposes a GET /admin/memory/:id route the SDK switches to
    // parallel point-lookups.
    const wide = await this.admin.list({ limit: 1000 }, options)
    const idSet = new Set(ids)
    const sourceMemories = wide.filter((m) => idSet.has(m.id))

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
  constructor(private readonly http: HttpClient) {}

  /**
   * List every memory in the project, filtered by scope/status/etc.
   */
  async list(params?: ListMemoryParams, options?: RequestOptions): Promise<MemoryItem[]> {
    return this.http.get<MemoryItem[]>(
      '/admin/memory',
      params as Record<string, string | number | boolean | undefined>,
      options,
    )
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
   * List memories pending review — either freshly extracted (status=pending)
   * or auto-flagged by negative feedback (negativeRatingCount >= 3).
   */
  async listPendingReview(
    params?: { limit?: number; offset?: number },
    options?: RequestOptions,
  ): Promise<MemoryItem[]> {
    return this.http.get<MemoryItem[]>(
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
