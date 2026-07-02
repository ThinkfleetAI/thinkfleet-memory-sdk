import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import type { Subject } from '../types/lattice.js'

/** Tuning for a discovery run. All optional; the engine clamps to safe ranges. */
export interface DiscoverParams {
  /** Minimum similarity [0,1] for a subject to join a cluster. Higher = tighter,
   *  more numerous clusters. Default 0.75. */
  simThreshold?: number
  /** A cluster smaller than this is noise, not a behavior. Default 3. */
  minClusterSize?: number
  /** Drop clusters whose cohesion (mean intra-cluster similarity) is below this.
   *  Default 0.6. */
  minStability?: number
  /** Cap on member subjects returned per behavior. Default 50. */
  maxMembers?: number
}

/**
 * One emergent behavior — a cohesive cluster of subjects the engine grouped
 * together because they behave alike, with the statistics that justify treating
 * it as real. Behaviors are discovered from the data, not chosen from a fixed
 * menu.
 */
export interface DiscoveredBehavior {
  /** Rule-based description (RFM band + frequency + dominant pattern + entity).
   *  Upgraded to an LLM-authored name in a later engine release. */
  label: string
  /** Fraction of the analyzed cohort in this cluster, [0,1] — how common it is. */
  prevalence: number
  /** Cohesion: mean pairwise similarity within the cluster, [0,1] — how tightly
   *  these subjects actually behave alike. */
  stability: number
  /** Total subjects in the cluster (may exceed memberSubjects length when capped
   *  by maxMembers). */
  size: number
  /** Up to maxMembers subjects, medoid first — provenance for who exhibits it. */
  memberSubjects: Subject[]
  /** Human-readable signals behind the label (e.g. "pattern: recurring_event"). */
  exemplarEvidence: string[]
}

export interface DiscoverResult {
  /** Discovered behaviors, sorted by prevalence then stability (most common,
   *  most cohesive first). Empty when there isn't enough signal — discovery
   *  abstains structurally rather than inventing weak behaviors. */
  behaviors: DiscoveredBehavior[]
  /** Total subjects analyzed (the prevalence denominator). */
  subjectsAnalyzed: number
  generatedAt: string
  durationMs: number
}

/**
 * Behaviors — emergent behavior discovery.
 *
 * Where `tf.lattice.predict` answers "what will this subject do?" and
 * `getProfile` answers "who is this subject?", `discover` answers a project-wide
 * question: **"what behaviors exist in my data that nobody defined?"** It
 * clusters subjects by their feature vectors and surfaces the dense, cohesive
 * groups as behaviors — each with prevalence, stability, members, and
 * explainable evidence.
 *
 * @example
 * ```ts
 * const { behaviors } = await tf.behaviors.discover()
 * for (const b of behaviors) {
 *   console.log(`${b.label} — ${(b.prevalence * 100).toFixed(0)}% of subjects, `
 *     + `stability ${b.stability.toFixed(2)}, ${b.size} members`)
 *   console.log('  evidence:', b.exemplarEvidence.join(', '))
 * }
 * ```
 */
export class BehaviorsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Discover emergent behaviors across the project. Returns clusters of
   * like-behaving subjects, sorted most-common-and-cohesive first. An empty
   * result means the engine abstained — not enough signal to assert any
   * behavior — never "there are no behaviors".
   */
  async discover(
    params: DiscoverParams = {},
    options?: RequestOptions,
  ): Promise<DiscoverResult> {
    return this.http.post<DiscoverResult>('/lattice/discover', params, options)
  }
}
