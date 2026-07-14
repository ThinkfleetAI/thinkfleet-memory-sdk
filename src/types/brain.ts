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

/** The Brain Card manifest (stored on the brain, surfaced in the catalog). */
export interface BrainCard {
  ontologyRef?: string
  provenance?: BrainProvenance[]
  changelogRef?: string
  coverage?: { subjects?: number; facts?: number; freshness?: string }
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
