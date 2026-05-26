import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'

export interface ComplianceSubject {
  kind: string
  externalId: string
}

export interface ExportSubjectResponse {
  subject: ComplianceSubject
  export: {
    subject: ComplianceSubject
    memories: unknown[]
    patterns: unknown[]
    observations: unknown[]
    events: unknown[]
    alert_fires: unknown[]
    generated_at: string
  } | null
  counts: {
    memories: number
    patterns: number
    observations: number
    events: number
    alertFires: number
  }
  generatedAt: string
  durationMs: number
}

export interface HardDeleteSubjectRequest {
  subject: ComplianceSubject
  /** Free-text reason for the audit log. Required — Art. 17 requests carry a case id. */
  reason: string
  /** Preview-only when true; no rows touched. */
  dryRun?: boolean
}

export interface HardDeleteSubjectResponse {
  subject: ComplianceSubject
  memoriesDeleted: number
  patternsDeleted: number
  observationsDeleted: number
  eventsDeleted: number
  alertFiresDeleted: number
  dryRun: boolean
  auditEventId: string | null
  generatedAt: string
  durationMs: number
}

export interface ListAuditParams {
  /** Restrict to events touching this subject. */
  subject?: ComplianceSubject
  /** Restrict to a specific actor (user or service key id). */
  actor?: string
  /** Event types to include. Empty = all. */
  eventTypes?: string[]
  /** ISO-8601 lower bound. Newer events only. */
  since?: string
  /** Max events to return. Default 100, max 1000. */
  limit?: number
}

export interface AuditEvent {
  id: string
  created: string
  actor: string
  /** "read.search", "read.context", "read.predict", "read.profile",
   *  "read.export", "subject.hard_delete", etc. */
  eventType: string
  query: string | null
  memoryIds: string | null
  resultCount: number
  metadata: Record<string, unknown>
}

/**
 * GDPR-grade compliance surface (Phase 3f).
 *
 * Two subject-scoped operations:
 *  - exportSubject (Art. 15) — return every memory, pattern,
 *    observation, event, and alert fire for the subject in a single
 *    bundle the controller can hand to the data subject.
 *  - hardDeleteSubject (Art. 17) — cascade-delete the same set and
 *    write a tombstone audit row so the deletion itself is auditable.
 *
 * @example
 * ```ts
 * // Art. 15 subject-access request
 * const bundle = await tf.compliance.exportSubject({
 *   kind: 'contact', externalId: 'sarah-pizza',
 * })
 * console.log(bundle.counts)
 *
 * // Art. 17 right-to-erasure (dry run first, then commit)
 * const preview = await tf.compliance.hardDeleteSubject({
 *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
 *   reason: 'GDPR Art. 17 case 2026-05-25-A',
 *   dryRun: true,
 * })
 * if (preview.memoriesDeleted + preview.eventsDeleted < 10_000) {
 *   await tf.compliance.hardDeleteSubject({
 *     subject: { kind: 'contact', externalId: 'sarah-pizza' },
 *     reason: 'GDPR Art. 17 case 2026-05-25-A',
 *   })
 * }
 * ```
 */
export class ComplianceResource {
  constructor(private readonly http: HttpClient) {}

  async exportSubject(
    subject: ComplianceSubject,
    options?: RequestOptions,
  ): Promise<ExportSubjectResponse> {
    return this.http.post<ExportSubjectResponse>(
      '/memory-compliance/export',
      { subject },
      options,
    )
  }

  async hardDeleteSubject(
    body: HardDeleteSubjectRequest,
    options?: RequestOptions,
  ): Promise<HardDeleteSubjectResponse> {
    return this.http.post<HardDeleteSubjectResponse>(
      '/memory-compliance/hard-delete',
      body,
      options,
    )
  }

  /**
   * Read the memory_audit_event log. GDPR Art. 15 "who accessed my
   * data and when." Pass a subject to narrow to one person's access
   * log; omit for project-wide audit.
   *
   * @example
   * ```ts
   * const events = await tf.compliance.listAuditEvents({
   *   subject: { kind: 'contact', externalId: 'sarah-pizza' },
   *   eventTypes: ['read.context', 'read.export'],
   *   since: '2026-05-01T00:00:00Z',
   * })
   * ```
   */
  async listAuditEvents(
    params: ListAuditParams = {},
    options?: RequestOptions,
  ): Promise<AuditEvent[]> {
    const query: Record<string, string | number | undefined> = {
      subjectKind: params.subject?.kind,
      subjectExternalId: params.subject?.externalId,
      actor: params.actor,
      since: params.since,
      limit: params.limit,
    }
    if (params.eventTypes && params.eventTypes.length > 0) {
      query.eventTypes = params.eventTypes.join(',')
    }
    return this.http.get<AuditEvent[]>('/memory-compliance/audit', query, options)
  }
}
