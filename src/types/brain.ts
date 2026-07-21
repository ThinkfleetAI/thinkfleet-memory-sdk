import type { BaseModel } from './common.js'

/**
 * Brain marketplace types.
 *
 * A Brain is a publishable/consumable unit of memory: a Brain Card manifest
 * plus a stable `externalId` slug the Mesh Router addresses it by. This SDK
 * covers the registry (create / list / get / update / delete). Consumption of a
 * published brain happens over the hosted MCP endpoint
 * (`/api/v1/projects/{projectId}/brains/{brainId}/mcp-server/http`), which an
 * MCP client connects to directly — it is not a REST call.
 */

export type BrainVisibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'
export type BrainStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/** Provenance of the facts in a brain — where they came from and under what license. */
export interface BrainProvenance {
  source: string
  license: string
  url?: string
}

/**
 * Coverage the induced reasoning layer advertises on a Brain Card — the
 * procedure/checklist/decomposition memories that make a brain worth more than a
 * plain dataset. A facts-only brain reports `total: 0`.
 */
export interface BrainReasoningCoverage {
  procedures?: number
  checklists?: number
  decompositions?: number
  total?: number
}

/** The Brain Card manifest (stored on the brain, surfaced in the catalog). */
export interface BrainCard {
  ontologyRef?: string
  provenance?: BrainProvenance[]
  changelogRef?: string
  coverage?: {
    subjects?: number
    facts?: number
    reasoning?: BrainReasoningCoverage
    freshness?: string
  }
  evaluation?: { benchmark?: string; score?: number }
  predictEnabled?: boolean
  pricing?: { model?: string; unit?: string }
}

export interface Brain extends BaseModel {
  projectId: string
  /** Stable slug the Router addresses the brain by (unique per project). */
  externalId: string
  name: string
  domain: string | null
  /** Brain Interface contract version the brain conforms to (e.g. "v1"). */
  brainInterface: string
  version: string
  visibility: BrainVisibility
  status: BrainStatus
  rightsAttested: boolean
  card: BrainCard | null
}

export interface CreateBrainRequest {
  externalId: string
  name: string
  domain?: string
  version?: string
  visibility?: BrainVisibility
  rightsAttested?: boolean
  card?: BrainCard
}

export interface UpdateBrainRequest {
  name?: string
  domain?: string
  version?: string
  visibility?: BrainVisibility
  status?: BrainStatus
  rightsAttested?: boolean
  card?: BrainCard
}

export interface ListBrainsParams {
  limit?: number
  cursor?: string
}

/**
 * High-level options for {@link BrainsResource.createFromProject} — the easy
 * path to turning a project's memory into a brain. A minimal set of fields; the
 * Brain Card (provenance/coverage) is filled in for you.
 */
export interface CreateBrainFromProjectOptions {
  /** Stable slug the Router addresses the brain by (unique per project). */
  externalId: string
  name: string
  /** Domain the brain covers, e.g. "finance". Required before publishing PUBLIC. */
  domain?: string
  /** Semantic version. Defaults to "1.0.0". */
  version?: string
  /** Defaults to "PRIVATE". A brain is only consumable once separately PUBLISHED. */
  visibility?: BrainVisibility
}
