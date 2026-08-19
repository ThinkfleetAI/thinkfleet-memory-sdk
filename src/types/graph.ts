/**
 * Knowledge-graph types — the structural half of memory.
 *
 * Observing text doesn't only produce embeddable rows; it also resolves
 * entities and writes typed edges between them. That graph is what lets a query
 * reach a fact no single memory states outright ("who does Sarah report to?"
 * answered from `sarah -[member_of]-> team` + `team -[led_by]-> priya`).
 *
 * Entities and edges are bi-temporal: `validFrom` / `validTo` say when the fact
 * was TRUE in the world, which is not the same as when we believed it. The read
 * routes return only currently-believed edges, so a row superseded by a
 * contradicting one simply stops appearing rather than coming back flagged.
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
   * this is provenance, NOT an isolation key — brain-scoped graph work filters
   * on the edge's `brainId`, which the read routes do server-side.
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

/**
 * An edge as the READ routes return it — hydrated, not the raw `memory_edge`
 * row. `subject` and `object` are resolved entities rather than ids, and `hop`
 * says how far from the seed the walk found it.
 *
 * This is the server's `GraphTraversalEdge`, returned by `listEdges`,
 * `traverse`, and the `edges` of `getEntity`. The raw row shape (with
 * `subjectId` / `objectId` / `brainId`) is not exposed by any read route, so it
 * is deliberately not modelled here — a type nothing returns is a trap.
 */
export interface GraphTraversalEdge {
  /** Edge primary key — needed for invalidation. */
  id: string
  /** The entity this edge starts from, hydrated. */
  subject: MemoryEntity
  /** The relationship — `works_at`, `owns`, `located_in`, ... */
  predicate: string
  /** The target entity, hydrated. `null` when `objectLiteral` carries the value. */
  object: MemoryEntity | null
  /** Literal value, when the object is not an entity (a date, a price, "v1.2.3"). */
  objectLiteral: string | null
  /** Confidence, 0..1. */
  weight: number
  validFrom: string
  /** Null while the edge is still valid. */
  validTo: string | null
  /** The memory this edge was extracted from. */
  sourceMemoryId: string | null
  /**
   * Distance from the seed entity on a `traverse` — 1 for a direct neighbour.
   * `listEdges` has no seed, so every edge comes back with `hop: 0`.
   */
  hop: number
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
  edges: GraphTraversalEdge[]
}
