import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'
import type {
  EntityWithEdges,
  GraphStats,
  ListEdgesParams,
  ListEntitiesParams,
  GraphTraversalEdge,
  MemoryEntity,
  TraverseParams,
} from '../types/graph.js'

/**
 * The knowledge graph built from observed memory.
 *
 * Reached as `tf.memory.admin.graph` — it lives under the admin surface because
 * every route here is admin-tier (`/admin/memory/...`); a project-scoped key
 * gets a 403.
 *
 * Read-only by design. Entity and edge *creation* happens through extraction
 * when you `observe()`; the manual create/retire routes exist on the server for
 * annotation tooling, and exposing them here would invite hand-maintained
 * graphs, which is exactly the work the engine is supposed to do for you.
 */
export class GraphResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Aggregate counts for the whole graph.
   *
   * Prefer this over `listEntities().length` for any "how big is it" question:
   * these are SQL `COUNT(*)`s over the full table, where the list routes page
   * and would silently report the page size as the total.
   */
  async stats(options?: RequestOptions): Promise<GraphStats> {
    return this.http.get<GraphStats>('/admin/memory/graph/stats', undefined, options)
  }

  /** Entities, filtered by type/scope or by a substring of name or alias. */
  async listEntities(
    params?: ListEntitiesParams,
    options?: RequestOptions,
  ): Promise<MemoryEntity[]> {
    return this.http.get<MemoryEntity[]>(
      '/admin/memory/entities',
      params as Record<string, string | number | undefined>,
      options,
    )
  }

  /** One entity plus its 1-hop neighbourhood. */
  async getEntity(
    entityId: string,
    params?: { asOf?: string },
    options?: RequestOptions,
  ): Promise<EntityWithEdges> {
    return this.http.get<EntityWithEdges>(
      `/admin/memory/entities/${entityId}`,
      params as Record<string, string | undefined>,
      options,
    )
  }

  /**
   * Every currently-valid edge. Use for rendering a whole small graph; for a
   * large one, seed from an entity and `traverse` instead.
   */
  async listEdges(params?: ListEdgesParams, options?: RequestOptions): Promise<GraphTraversalEdge[]> {
    return this.http.get<GraphTraversalEdge[]>(
      '/admin/memory/graph/edges',
      params as Record<string, string | number | undefined>,
      options,
    )
  }

  /**
   * Walk out from a seed entity.
   *
   * This is the multi-hop path: the edges returned here connect facts that no
   * single memory states together, which is how a query gets answered from a
   * chain rather than from one lucky vector hit.
   */
  async traverse(
    entityId: string,
    params?: TraverseParams,
    options?: RequestOptions,
  ): Promise<GraphTraversalEdge[]> {
    return this.http.post<GraphTraversalEdge[]>(
      '/admin/memory/graph/traverse',
      { entityId, ...params },
      options,
    )
  }
}
