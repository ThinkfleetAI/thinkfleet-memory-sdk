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
  type ObserveRequest,
  type PromoteMemoryRequest,
  type SubmitFeedbackRequest,
  type UpdateMemoryRequest,
} from '../types/memory.js'

/**
 * Memory — primary surface for memory.thinkfleet.ai.
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

  constructor(private readonly http: HttpClient) {
    this.admin = new AdminMemoryResource(http)
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
