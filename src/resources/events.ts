import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import type { EmitEventRequest, EmitEventResult } from '../types/lattice.js'

/** Severity tier emitted on every event. */
export type EventSeverity = 'info' | 'warn' | 'critical'

/**
 * One row from the memory event log. Provenance pointers
 * (`sourceMemoryIds` / `sourcePatternId`) let consumers call
 * `tf.memory.explain()` to drill down to the raw memories that
 * produced the event.
 */
export interface MemoryEvent {
  id: string
  eventType: string
  subject: { kind: string; externalId: string } | null
  severity: EventSeverity
  payload: Record<string, unknown>
  sourceMemoryIds: string[]
  sourcePatternId: string | null
  emittedByPack: string | null
  occurredAt: string
}

export interface PollEventsParams {
  /** ISO timestamp of the last event you saw. Returns events newer than this. */
  since?: string
  /** Max events to return per call. Default 100, max 1000. */
  limit?: number
  /** Restrict to specific event types. */
  eventTypes?: string[]
}

/**
 * Memory event subscription surface (Phase 3i).
 *
 * The engine emits durable events on interesting state changes —
 * pattern emergence, risk firing, segment shift, consent change.
 * Subscribers consume them via this polling loop:
 *
 * @example
 * ```ts
 * let cursor: string | undefined
 * for (;;) {
 *   const events = await tf.events.poll({ since: cursor, limit: 100 })
 *   for (const e of events) {
 *     await handleEvent(e)
 *     cursor = e.occurredAt
 *   }
 *   await sleep(2_000)
 * }
 * ```
 *
 * A simpler subscribe() wrapper is provided for the common case;
 * it polls in the background and invokes a callback per event.
 */
export class EventsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Pull events newer than `since`. Single round-trip; use the last
   * event's `occurredAt` as the next `since` to walk the log.
   */
  async poll(
    params: PollEventsParams = {},
    options?: RequestOptions,
  ): Promise<MemoryEvent[]> {
    const query: Record<string, string | number | undefined> = {
      since: params.since,
      limit: params.limit,
    }
    if (params.eventTypes && params.eventTypes.length > 0) {
      query.eventTypes = params.eventTypes.join(',')
    }
    return this.http.get<MemoryEvent[]>('/memory-events', query, options)
  }

  /**
   * Append an event to the durable log. Matching alert rules fire
   * synchronously. The write-side counterpart to poll().
   *
   * @example
   * ```ts
   * await tf.events.emit({
   *   eventType: 'cart.abandoned',
   *   subject: { kind: 'contact', externalId: 'sarah' },
   *   severity: 'warn',
   *   payloadJson: JSON.stringify({ cartValue: 84 }),
   * })
   * ```
   */
  async emit(
    body: EmitEventRequest,
    options?: RequestOptions,
  ): Promise<EmitEventResult> {
    return this.http.post<EmitEventResult>('/lattice/events/emit', body, options)
  }

  /**
   * Convenience: poll in a loop and invoke `handler` for each event.
   * Returns an unsubscribe function that cancels the loop.
   *
   * @example
   * ```ts
   * const stop = tf.events.subscribe(
   *   { eventTypes: ['risk.fired', 'segment.changed'] },
   *   async (e) => {
   *     console.log(`[${e.severity}] ${e.eventType} for`, e.subject)
   *   },
   *   { intervalMs: 3_000 },
   * )
   * // later: stop()
   * ```
   */
  subscribe(
    params: PollEventsParams,
    handler: (event: MemoryEvent) => void | Promise<void>,
    opts: { intervalMs?: number } = {},
  ): () => void {
    const interval = Math.max(500, opts.intervalMs ?? 5000)
    let cancelled = false
    let cursor: string | undefined = params.since

    const loop = async () => {
      while (!cancelled) {
        try {
          const events = await this.poll({ ...params, since: cursor })
          for (const e of events) {
            if (cancelled) break
            try {
              await handler(e)
            } catch {
              // handler errors are the caller's concern; don't kill the loop
            }
            cursor = e.occurredAt
          }
        } catch {
          // network blip — back off briefly and retry
        }
        await new Promise<void>((resolve) => setTimeout(resolve, interval))
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
  }
}
