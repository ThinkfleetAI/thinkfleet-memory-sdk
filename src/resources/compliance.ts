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
}
