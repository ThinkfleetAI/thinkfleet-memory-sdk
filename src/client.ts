import { HttpClient } from './core/http-client.js'
import type { RequestInterceptor, ResponseInterceptor } from './core/types.js'
import { AlertsResource } from './resources/alerts.js'
import { BehaviorsResource } from './resources/behaviors.js'
import { BrainsResource } from './resources/brains.js'
import { ComplianceResource } from './resources/compliance.js'
import { ContextResource } from './resources/context.js'
import { EventsResource } from './resources/events.js'
import { FinancialResource } from './resources/financial.js'
import { HealthResource } from './resources/health.js'
import { LatticeResource } from './resources/lattice.js'
import { LearningResource } from './resources/learning.js'
import { MemoryResource } from './resources/memory.js'
import { TypedAttributesResource } from './resources/typed.js'

export interface ThinkFleetMemoryOptions {
  /** API key (`sk-...`) from Platform Admin → API Keys. */
  apiKey: string
  /** Default project ID for all requests. Can be overridden per-call via `{ projectId: ... }`. */
  projectId: string
  /** Base URL of the app.memmesh.ai API. Default: `https://app.memmesh.ai`. */
  baseUrl?: string
  /** Retries 429 + 5xx with exponential backoff. Default 2. */
  maxRetries?: number
  /** Default request timeout in ms. Default 30000. */
  timeout?: number
  /** Custom fetch (e.g. node-fetch on Node < 18, undici, or a polyfill). */
  fetch?: typeof globalThis.fetch
  /** Middleware called before each request — useful for swapping the API key for a Cognito JWT. */
  requestInterceptors?: RequestInterceptor[]
  /** Middleware called after each response, before JSON parsing. */
  responseInterceptors?: ResponseInterceptor[]
}

/**
 * TypeScript client for app.memmesh.ai.
 *
 * Exposes two resources:
 *  - `memory`  — admin + project memory CRUD, semantic search, feedback
 *  - `lattice` — behavioral pattern intelligence (extract, monitor,
 *    retrieve, search, observe)
 *
 * @example
 * ```ts
 * import { ThinkFleetMemory } from '@thinkfleet/memory-sdk'
 *
 * const tf = new ThinkFleetMemory({
 *   apiKey: 'sk-...',
 *   projectId: 'proj_...',
 * })
 *
 * const stats = await tf.memory.admin.stats()
 * console.log(`${stats.total} memories, ${stats.pendingReview} pending review`)
 * ```
 */
export class ThinkFleetMemory {
  readonly memory: MemoryResource
  readonly lattice: LatticeResource
  readonly learning: LearningResource
  readonly behaviors: BehaviorsResource
  readonly context: ContextResource
  readonly events: EventsResource
  readonly alerts: AlertsResource
  readonly compliance: ComplianceResource
  readonly health: HealthResource
  readonly financial: FinancialResource
  readonly typed: TypedAttributesResource
  readonly brains: BrainsResource

  constructor(options: ThinkFleetMemoryOptions) {
    if (!options.apiKey) {
      throw new Error('ThinkFleetMemory: apiKey is required')
    }
    if (!options.projectId) {
      throw new Error('ThinkFleetMemory: projectId is required')
    }

    const http = new HttpClient({
      apiKey: options.apiKey,
      projectId: options.projectId,
      baseUrl: (options.baseUrl ?? 'https://app.memmesh.ai').replace(/\/+$/, ''),
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeout ?? 30000,
      fetchFn: options.fetch ?? globalThis.fetch.bind(globalThis),
      requestInterceptors: options.requestInterceptors,
      responseInterceptors: options.responseInterceptors,
    })

    this.memory = new MemoryResource(http)
    this.lattice = new LatticeResource(http)
    this.learning = new LearningResource(http)
    this.behaviors = new BehaviorsResource(http)
    this.context = new ContextResource(http)
    this.events = new EventsResource(http)
    this.alerts = new AlertsResource(http)
    this.compliance = new ComplianceResource(http)
    this.health = new HealthResource(http)
    this.financial = new FinancialResource(http)
    this.typed = new TypedAttributesResource(http)
    this.brains = new BrainsResource(http)
  }
}
