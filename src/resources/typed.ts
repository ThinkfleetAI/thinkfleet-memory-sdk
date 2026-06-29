import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'

/** The declared type of an attribute. */
export type AttributeDataType = 'numeric' | 'categorical' | 'temporal' | 'boolean'

/** Acceptance status of an ingested observation. */
export type ObservationStatus = 'accepted' | 'quarantined'

/** A registered attribute definition — drives input validation on ingest. */
export interface AttributeDef {
  id: string
  platformId?: string
  projectId?: string
  attributeKey: string
  dataType: AttributeDataType
  unit?: string
  /** Inclusive plausibility bounds; values outside are quarantined. */
  minValid?: number
  maxValid?: number
  required: boolean
  metadataJson?: string
}

/** Input shape for registering/updating an attribute definition. */
export interface RegisterAttributeRequest {
  attributeKey: string
  dataType: AttributeDataType
  unit?: string
  minValid?: number
  maxValid?: number
  required?: boolean
  metadata?: unknown
}

/** One typed measurement of an attribute for a subject at a point in time. */
export interface TypedObservationInput {
  id?: string
  attributeKey: string
  subjectKind: string
  subjectExternalId: string
  valueNumeric?: number
  valueText?: string
  valueBool?: boolean
  /** ISO-8601 for temporal values. */
  valueTs?: string
  /** ISO-8601 observation time. */
  observedAt: string
  source?: string
  /** Source-trust weight in 0..1 (default 1). */
  trust?: number
}

export interface TypedObservation extends TypedObservationInput {
  id: string
  platformId?: string
  projectId?: string
  qualityScore?: number
  status?: ObservationStatus
}

/** Outcome of a batch ingest. */
export interface IngestReport {
  accepted: number
  quarantined: number
  duplicates: number
  /** observationId -> quarantine reason */
  quarantineReasons: Record<string, string>
}

/** Per-(subject, attribute) running statistics. */
export interface Accumulator {
  subjectKind: string
  subjectExternalId: string
  attributeKey: string
  count: number
  sum: number
  sumSq: number
  minVal?: number
  maxVal?: number
  lastVal?: number
  lastObservedAt?: string
  cumulative: number
  ewma?: number
  ewmaVar?: number
  /** Derived on read. */
  mean?: number
  variance?: number
  stddev?: number
}

export interface QueryObservationsParams {
  subjectKind?: string
  subjectExternalId?: string
  attributeKey?: string
  /** ISO-8601 inclusive bounds on observedAt. */
  since?: string
  until?: string
  minValue?: number
  maxValue?: number
  status?: ObservationStatus
  limit?: number
  offset?: number
}

export interface AccumulatorParams {
  subjectKind: string
  subjectExternalId: string
  attributeKey: string
}

/**
 * Typed attributes — structured/numeric data the engine reasons over
 * (credit scores, sensor readings, balances) instead of opaque metadata.
 *
 * Register an attribute's schema once, then ingest observations: each is
 * validated against the definition (accepted or quarantined) and accepted
 * numeric values are folded into per-subject accumulators you can read back
 * with running mean/variance/min/max/cumulative. Pair with a `memory-value`
 * alert rule (see `tf.alerts`) to fire on a threshold/range.
 *
 * @example
 * ```ts
 * await tf.typed.registerAttribute({
 *   attributeKey: 'credit_score', dataType: 'numeric', minValid: 300, maxValid: 850,
 * })
 * const report = await tf.typed.ingest([
 *   { attributeKey: 'credit_score', subjectKind: 'contact', subjectExternalId: 'sarah',
 *     valueNumeric: 650, observedAt: new Date().toISOString() },
 * ])
 * const acc = await tf.typed.accumulator({
 *   subjectKind: 'contact', subjectExternalId: 'sarah', attributeKey: 'credit_score',
 * })
 * console.log(acc.mean) // 650
 * ```
 */
export class TypedAttributesResource {
  constructor(private readonly http: HttpClient) {}

  /** Register or update an attribute definition (type + plausibility range). */
  async registerAttribute(
    body: RegisterAttributeRequest,
    options?: RequestOptions,
  ): Promise<AttributeDef> {
    return this.http.post<AttributeDef>('/memory-typed/attributes', body, options)
  }

  /** List registered attribute definitions for the project. */
  async listAttributes(
    params: { attributeKey?: string; limit?: number; offset?: number } = {},
    options?: RequestOptions,
  ): Promise<AttributeDef[]> {
    return this.http.get<AttributeDef[]>(
      '/memory-typed/attributes',
      {
        attributeKey: params.attributeKey,
        limit: params.limit,
        offset: params.offset,
      },
      options,
    )
  }

  /**
   * Ingest a batch of typed observations synchronously and return the report
   * (accepted / quarantined / duplicate counts + quarantine reasons).
   */
  async ingest(
    observations: TypedObservationInput[],
    options?: RequestOptions,
  ): Promise<IngestReport> {
    return this.http.post<IngestReport>('/memory-typed/observations', { observations }, options)
  }

  /**
   * Queue a batch for asynchronous ingest (the scalable path for high volume).
   * Returns the count accepted onto the queue; results are folded in by a
   * background worker.
   */
  async enqueue(
    observations: TypedObservationInput[],
    options?: RequestOptions,
  ): Promise<{ enqueued: number }> {
    return this.http.post<{ enqueued: number }>(
      '/memory-typed/observations/enqueue',
      { observations },
      options,
    )
  }

  /** Query raw observations by subject, attribute, time window, and value range. */
  async queryObservations(
    params: QueryObservationsParams = {},
    options?: RequestOptions,
  ): Promise<TypedObservation[]> {
    return this.http.get<TypedObservation[]>(
      '/memory-typed/observations',
      {
        subjectKind: params.subjectKind,
        subjectExternalId: params.subjectExternalId,
        attributeKey: params.attributeKey,
        since: params.since,
        until: params.until,
        minValue: params.minValue,
        maxValue: params.maxValue,
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      },
      options,
    )
  }

  /** Read the running statistics for a subject + attribute. */
  async accumulator(
    params: AccumulatorParams,
    options?: RequestOptions,
  ): Promise<Accumulator> {
    return this.http.get<Accumulator>(
      '/memory-typed/accumulator',
      {
        subjectKind: params.subjectKind,
        subjectExternalId: params.subjectExternalId,
        attributeKey: params.attributeKey,
      },
      options,
    )
  }
}
