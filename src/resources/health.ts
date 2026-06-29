import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import { MemoryItemType, MemoryScope, type MemoryItem } from '../types/memory.js'
import type {
  Biomarker,
  CohortHealthRisk,
  ConditionInput,
  DemographicsInput,
  HealthProfile,
  Subject,
} from '../types/health.js'

/**
 * Health — biological ("health") age + condition prediction for the
 * memory engine's health vertical.
 *
 * Health data is just memory data: you record biomarkers, demographics,
 * and ICD-10 diagnoses as memory items, and the engine derives a
 * biological age (PhenoAge core + composite adjustments) and condition
 * predictions (biomarkers trending toward / above clinical thresholds),
 * plus cohort base rates ("of patients like this one, X% have Y").
 *
 * You decide where the data originates — EHR feed, document extraction,
 * wearable, manual entry. The SDK only gives you the typed way in and out.
 *
 * Requires the `@thinkfleet/pack-healthcare` pack enabled on the project;
 * the read methods return FAILED_PRECONDITION otherwise.
 *
 * Recorded items are stored as non-activity `fact` memories, so they feed
 * the health engine without being mined as behavioral patterns.
 *
 * @example
 * ```ts
 * const subject = { kind: 'patient', externalId: 'p-123' }
 * await tf.health.recordDemographics(subject, { ageYears: 54, sex: 'female', weightKg: 82, heightCm: 170, activity: 'low' })
 * await tf.health.recordBiomarker(subject, 'hba1c', 6.2, { unit: '%' })
 * await tf.health.recordCondition(subject, { icd10: 'I10', status: 'active' })
 *
 * const profile = await tf.health.getProfile(subject)
 * console.log(profile.biologicalAge?.biologicalAgeYears, profile.predictedConditions)
 *
 * const cohort = await tf.health.getCohortRisk(subject)
 * for (const r of cohort.risks) console.log(`${r.condition}: ${(r.cohortPrevalence * 100).toFixed(0)}% of similar patients`)
 * ```
 */
export class HealthResource {
  constructor(private readonly http: HttpClient) {}

  // ── Input — record health signals (stored as memory items) ──

  /**
   * Record a biomarker reading. Send whatever unit the lab reported via
   * `opts.unit`; the engine normalizes it.
   */
  async recordBiomarker(
    subject: Subject,
    biomarker: Biomarker | (string & {}),
    value: number,
    opts?: { unit?: string; observedAt?: string },
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    const health: Record<string, unknown> = { biomarker, value }
    if (opts?.unit) health.unit = opts.unit
    if (opts?.observedAt) health.observedAt = opts.observedAt
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: `${biomarker} = ${value}${opts?.unit ? ` ${opts.unit}` : ''}`,
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'health',
        source: 'sdk:health',
        metadata: { subject, health },
      },
      options,
    )
  }

  /** Record/refresh a subject's demographics. Latest values win. */
  async recordDemographics(
    subject: Subject,
    demographics: DemographicsInput,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: 'Demographics update',
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'health',
        source: 'sdk:health',
        metadata: { subject, demographic: demographics },
      },
      options,
    )
  }

  /** Record an ICD-10 diagnosis. */
  async recordCondition(
    subject: Subject,
    condition: ConditionInput,
    options?: RequestOptions,
  ): Promise<MemoryItem> {
    return this.http.post<MemoryItem>(
      '/admin/memory',
      {
        content: `Diagnosis ${condition.icd10}`,
        type: MemoryItemType.FACT,
        scope: MemoryScope.PROJECT,
        category: 'health',
        source: 'sdk:health',
        metadata: { subject, condition },
      },
      options,
    )
  }

  // ── Read — derived profile + cohort outcomes ──

  /**
   * Biological-age estimate + condition predictions + latest biomarkers
   * for a subject, derived from their recorded health data.
   */
  async getProfile(subject: Subject, options?: RequestOptions): Promise<HealthProfile> {
    return this.http.post<HealthProfile>('/lattice/health/profile', { subject }, options)
  }

  /**
   * Cohort outcomes — condition prevalence among the patients most similar
   * to this subject by baseline features. An epidemiological base rate to
   * complement the individual projections from `getProfile`.
   *
   * @param opts.k cohort size (nearest patients); default 25.
   */
  async getCohortRisk(
    subject: Subject,
    opts?: { k?: number },
    options?: RequestOptions,
  ): Promise<CohortHealthRisk> {
    return this.http.post<CohortHealthRisk>(
      '/lattice/health/cohort-risk',
      { subject, ...(opts?.k != null ? { k: opts.k } : {}) },
      options,
    )
  }
}
