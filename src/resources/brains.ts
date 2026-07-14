import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions, SeekPage } from '../core/types.js'
import type {
  Brain,
  CreateBrainRequest,
  ListBrainsParams,
  UpdateBrainRequest,
} from '../types/brain.js'

/**
 * Brains — the marketplace registry.
 *
 * Register, version, and manage the brains a project publishes. A brain carries
 * a Brain Card manifest (ontology, provenance, coverage, eval, pricing) and a
 * stable `externalId` slug. Once a brain is `PUBLISHED` + `PUBLIC`, any caller
 * can consume it over the hosted MCP endpoint
 * (`/brains/{brainId}/mcp-server/http`); consumption is an MCP connection, not a
 * REST call, so it lives outside this resource.
 *
 * @example
 * ```ts
 * const brain = await tf.brains.create({
 *   externalId: 'sec-edgar-financials',
 *   name: 'SEC EDGAR Financials',
 *   domain: 'finance',
 *   version: '2026.07.0',
 *   card: { provenance: [{ source: 'SEC EDGAR', license: 'public-domain' }] },
 * })
 * await tf.brains.update(brain.id, { visibility: 'PUBLIC', status: 'PUBLISHED' })
 *
 * const page = await tf.brains.list({ limit: 20 })
 * for (const b of page.data) console.log(b.externalId, b.status)
 * ```
 */
export class BrainsResource {
  constructor(private readonly http: HttpClient) {}

  /** Register a new brain in the project's catalog. */
  async create(body: CreateBrainRequest, options?: RequestOptions): Promise<Brain> {
    return this.http.post<Brain>('/brains', body, options)
  }

  /** List the project's brains (cursor-paginated). */
  async list(params?: ListBrainsParams, options?: RequestOptions): Promise<SeekPage<Brain>> {
    return this.http.get<SeekPage<Brain>>(
      '/brains',
      params as Record<string, string | number | boolean | undefined> | undefined,
      options,
    )
  }

  /** Fetch one brain by id. */
  async get(brainId: string, options?: RequestOptions): Promise<Brain> {
    return this.http.get<Brain>(`/brains/${brainId}`, undefined, options)
  }

  /** Update / version a brain (name, version, visibility, status, card, …). */
  async update(brainId: string, body: UpdateBrainRequest, options?: RequestOptions): Promise<Brain> {
    return this.http.patch<Brain>(`/brains/${brainId}`, body, options)
  }

  /** Delete a brain from the catalog. */
  async delete(brainId: string, options?: RequestOptions): Promise<void> {
    await this.http.delete<{ success: boolean }>(`/brains/${brainId}`, options)
  }
}
