import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import { MemoryItemType, MemoryScope, type MemoryItem } from '../types/memory.js'

export interface ConsentSubject {
  kind: string
  externalId: string
}

export interface OptOutRequest {
  subject: ConsentSubject
  /** Free-text reason for the audit log (GDPR Art. 17 request id, etc.). */
  reason?: string
}

export interface OptInRequest {
  subject: ConsentSubject
}

export interface ConsentStatus {
  subject: ConsentSubject
  optedOut: boolean
  /** ISO timestamp of the opt-out, or null if never opted out. */
  optedOutAt: string | null
  reason: string | null
  /** Id of the underlying consent memory item (for audit linking). */
  memoryId: string | null
}

/**
 * Subject-level consent / opt-out.
 *
 * Records consent decisions as memory items of `type='consent'` so the
 * audit log captures every change. The Rust mining engine honors
 * opt-outs at the start of every mine pass — opted-out subjects are
 * skipped, and their behavior patterns aren't generated.
 *
 * Foundations of the EU AI Act / GDPR Art. 22 compliance story:
 *   - subject-level: per-person (or per-team / per-workspace) opt-out
 *   - audit-traceable: every opt-out is a confirmed memory item
 *   - reversible: opt-in re-enables mining (without restoring prior
 *     patterns — those need to be re-mined to honor the gap)
 *
 * Note: v1 stores consent as memory items. Phase 3c-bis introduces a
 * dedicated `subject_consent` table for sub-ms lookups; the SDK
 * contract here doesn't change when that lands.
 */
export class ConsentResource {
  constructor(
    private readonly http: HttpClient,
    private readonly listMemories: (
      params: { limit?: number; offset?: number },
      options?: RequestOptions,
    ) => Promise<MemoryItem[]>,
    private readonly createMemory: (
      body: {
        content: string
        type: MemoryItemType
        scope: MemoryScope
        importance?: number
        category?: string
        metadata?: Record<string, unknown>
      },
      options?: RequestOptions,
    ) => Promise<MemoryItem>,
    private readonly deleteMemory: (memoryId: string, options?: RequestOptions) => Promise<void>,
  ) {}

  /**
   * Mark a subject as opted-out. Mining and recall must honor this:
   * the Rust engine skips opted-out subjects at mine time.
   *
   * @example
   * ```ts
   * await tf.memory.consent.optOut({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   reason: 'GDPR Art. 17 request 2026-05-25',
   * })
   * ```
   */
  async optOut(body: OptOutRequest, options?: RequestOptions): Promise<ConsentStatus> {
    // Supersede any prior consent record so the audit log shows the
    // history but only one row is "active".
    await this.supersedePriorConsent(body.subject, options)

    const now = new Date().toISOString()
    const memory = await this.createMemory(
      {
        content: `[consent] ${body.subject.kind}:${body.subject.externalId} opted out`,
        type: MemoryItemType.CONSENT,
        scope: MemoryScope.PROJECT,
        importance: 10,
        category: 'consent',
        metadata: {
          subject: body.subject,
          optedOut: true,
          optedOutAt: now,
          reason: body.reason ?? null,
          recordKind: 'consent',
        },
      },
      options,
    )

    return {
      subject: body.subject,
      optedOut: true,
      optedOutAt: now,
      reason: body.reason ?? null,
      memoryId: memory.id,
    }
  }

  /**
   * Restore consent for a subject. Mining resumes from the next pass.
   * Prior patterns are NOT auto-restored — they must be re-mined so
   * the gap during opt-out is honored.
   */
  async optIn(body: OptInRequest, options?: RequestOptions): Promise<ConsentStatus> {
    await this.supersedePriorConsent(body.subject, options)

    const now = new Date().toISOString()
    const memory = await this.createMemory(
      {
        content: `[consent] ${body.subject.kind}:${body.subject.externalId} opted in`,
        type: MemoryItemType.CONSENT,
        scope: MemoryScope.PROJECT,
        importance: 10,
        category: 'consent',
        metadata: {
          subject: body.subject,
          optedOut: false,
          optedOutAt: null,
          reason: null,
          recordKind: 'consent',
        },
      },
      options,
    )

    return {
      subject: body.subject,
      optedOut: false,
      optedOutAt: null,
      reason: null,
      memoryId: memory.id,
    }
  }

  /**
   * Read the current consent status for a subject. Returns
   * `optedOut: false` (default) if no consent record exists.
   */
  async getStatus(
    subject: ConsentSubject,
    options?: RequestOptions,
  ): Promise<ConsentStatus> {
    const active = await this.findActiveConsent(subject, options)
    if (!active) {
      return { subject, optedOut: false, optedOutAt: null, reason: null, memoryId: null }
    }
    const md = (active.metadata ?? {}) as Record<string, unknown>
    return {
      subject,
      optedOut: Boolean(md.optedOut),
      optedOutAt: (md.optedOutAt as string | null) ?? null,
      reason: (md.reason as string | null) ?? null,
      memoryId: active.id,
    }
  }

  // ── private helpers ─────────────────────────────────────────────

  private async findActiveConsent(
    subject: ConsentSubject,
    options?: RequestOptions,
  ): Promise<MemoryItem | null> {
    const all = await this.listMemories({ limit: 1000 }, options)
    const matches = all
      .filter((m) => m.type === MemoryItemType.CONSENT && this.subjectMatches(m, subject))
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    return matches[0] ?? null
  }

  private async supersedePriorConsent(
    subject: ConsentSubject,
    options?: RequestOptions,
  ): Promise<void> {
    const prior = await this.findActiveConsent(subject, options)
    if (prior) {
      // Hard-delete the prior row. The audit log keeps the historical
      // trail; we don't need the old row in the active set anymore.
      await this.deleteMemory(prior.id, options)
    }
  }

  private subjectMatches(item: MemoryItem, subject: ConsentSubject): boolean {
    const md = (item.metadata ?? {}) as Record<string, unknown>
    const s = md.subject as ConsentSubject | undefined
    if (!s) return false
    return s.kind === subject.kind && s.externalId === subject.externalId
  }
}
