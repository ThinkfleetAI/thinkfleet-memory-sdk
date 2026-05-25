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
  MonitorStatus,
  MonitorTickResult,
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
   * Rate-limited server-side at 10 calls/minute when the platform's
   * auth-aware rate limiter is enabled.
   */
  async extractPatterns(
    body: ExtractPatternsRequest = {},
    options?: RequestOptions,
  ): Promise<ExtractPatternsResult> {
    return this.http.post<ExtractPatternsResult>('/lattice/patterns/extract', body, options)
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
}
