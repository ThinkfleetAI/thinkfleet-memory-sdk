import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions, SeekPage } from '../core/types.js'
import type {
  Brain,
  CreateBrainFromProjectOptions,
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

  /**
   * Create a brain from the calling project's memory — the easy, high-level path.
   *
   * Where {@link create} wants a full {@link CreateBrainRequest}, this builds a
   * sensible one for you from just a slug + name (plus optional domain / version
   * / visibility) and an empty-but-valid Brain Card. Coverage (subjects, facts,
   * and the induced reasoning layer) is computed server-side from the project's
   * own memory, so you don't pass it. The brain is created as a DRAFT + PRIVATE;
   * publishing and pricing are deliberate, separate steps.
   *
   * @example
   * ```ts
   * const brain = await tf.brains.createFromProject({
   *   externalId: 'my-support-playbook',
   *   name: 'Support Playbook',
   *   domain: 'support',
   * })
   * // brain.status === 'DRAFT', brain.visibility === 'PRIVATE'
   *
   * // Publish it later, once you're ready:
   * await tf.brains.update(brain.id, { visibility: 'PUBLIC', status: 'PUBLISHED' })
   * ```
   */
  async createFromProject(
    opts: CreateBrainFromProjectOptions,
    options?: RequestOptions,
  ): Promise<Brain> {
    const body: CreateBrainRequest = {
      externalId: opts.externalId,
      name: opts.name,
      domain: opts.domain,
      version: opts.version ?? '1.0.0',
      visibility: opts.visibility ?? 'PRIVATE',
      // Empty-but-valid card: an empty provenance list and empty coverage. The
      // server recomputes coverage from the project's memory; a real licensed
      // provenance source is only required to publish PUBLIC (a separate step).
      card: { provenance: [], coverage: {} },
    }
    return this.create(body, options)
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
