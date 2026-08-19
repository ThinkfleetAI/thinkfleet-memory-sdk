/**
 * Knowledge-graph types — the structural half of memory.
 *
 * Observing text doesn't only produce embeddable rows; it also resolves
 * entities and writes typed edges between them. That graph is what lets a query
 * reach a fact no single memory states outright ("who does Sarah report to?"
 * answered from `sarah -[member_of]-> team` + `team -[led_by]-> priya`).
 *
 * Both records are bi-temporal, and the two time axes mean different things:
 *   - `validFrom` / `validTo` — when the fact was TRUE in the world.
 *   - `expiredAt` (edges)     — when the graph stopped BELIEVING it, because a
 *                               contradicting edge superseded it.
 * A fact that was true last year and a fact we were wrong about are not the
 * same thing, and collapsing them loses the audit trail.
 */
import type { MemoryScope } from './memory.js'

/** What kind of thing an entity is. Open-ended — the engine adds types over time. */
export type MemoryEntityType = string

export interface MemoryEntity {
  id: string
  created: string
  updated: string
  platformId: string
  projectId: string | null
  /**
   * The brain that first created this entity. Entities dedupe per project, so
   * this is provenance, NOT an isolation key — use `MemoryEdge.brainId` for
   * brain-scoped graph work.
   */
  brainId: string | null
  locationId: string | null
  chatbotId: string | null
  chatIdentityId: string | null
  scope: MemoryScope
  type: MemoryEntityType
  /** The name this entity is filed under; aliases resolve to it. */
  canonicalName: string
  aliases: string[]
  description: string | null
  metadata: Record<string, unknown> | null
  validFrom: string
  /** Null while the entity is still current. */
  validTo: string | null
  supersededById: string | null
}

export interface MemoryEdge {
  id: string
  created: string
  updated: string
  platformId: string
  projectId: string | null
  /** Per-brain KG isolation — edges are written fresh per brain, so this one
   *  IS the enforceable key for brain-scoped walks. Null on legacy edges. */
  brainId: string | null
  locationId: string | null
  chatbotId: string | null
  chatIdentityId: string | null
  scope: MemoryScope
  /** Entity id this edge starts from. */
  subjectId: string
  /** The relationship — `works_at`, `owns`, `located_in`, ... */
  predicate: string
  /** Entity id, when the object is itself an entity. */
  objectId: string | null
  /** Literal value, when the object is not an entity (a date, a price, "v1.2.3"). */
  objectLiteral: string | null
  /** Confidence, 0..1. */
  weight: number
  /** The memory this edge was extracted from. */
  sourceMemoryId: string | null
  metadata: Record<string, unknown> | null
  validFrom: string
  validTo: string | null
  /** Set when a contradicting edge superseded this one. Null = still believed. */
  expiredAt?: string | null
}

export interface ListEntitiesParams {
  type?: MemoryEntityType
  scope?: MemoryScope
  /** Substring match against `canonicalName` and every alias. */
  search?: string
  limit?: number
  offset?: number
}

export interface ListEdgesParams {
  /** Read the graph as it stood at this ISO-8601 instant. */
  asOf?: string
  /** Default 1000, max 10000. */
  limit?: number
}

export interface TraverseParams {
  /** How many hops out from the seed entity. 1-3. */
  hops?: number
  /** Restrict the walk to these predicates, e.g. `['member_of', 'led_by']`. */
  predicates?: string[]
  asOf?: string
}

/**
 * Aggregate graph counts.
 *
 * `memoriesWithEdges` against your total memory count is the useful ratio: it
 * says how much of what you remember made it into the graph rather than
 * remaining an isolated embedding. A low ratio usually means extraction is off
 * or the corpus is prose the extractor found no relations in.
 */
export interface GraphStats {
  entityCount: number
  edgeCount: number
  /** Distinct memories that produced at least one edge. */
  memoriesWithEdges: number
  retiredEntities: number
  retiredEdges: number
  /** Live entity counts keyed by entity type. */
  entitiesByType: Record<string, number>
  /** Whether KG extraction is on, platform-wide and for this project. */
  extraction?: { platformEnabled: boolean; projectEnabled: boolean }
}

/** An entity plus its 1-hop neighbourhood. */
export interface EntityWithEdges {
  entity: MemoryEntity | null
  edges: MemoryEdge[]
}
