import type { BaseModel } from './common.js'

export enum MemoryItemType {
  FACT = 'fact',
  PREFERENCE = 'preference',
  EVENT = 'event',
  INSIGHT = 'insight',
  OBSERVATION = 'observation',
  RULE = 'rule',
  CORRECTION = 'correction',
  SUMMARY = 'summary',
}

export enum MemoryScope {
  PLATFORM = 'platform',
  PROJECT = 'project',
  AGENT = 'agent',
  USER = 'user',
  SESSION = 'session',
}

export enum MemoryStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SUPERSEDED = 'superseded',
  REJECTED = 'rejected',
}

export enum MemoryImpact {
  HIGH = 'HIGH',
  LOW = 'LOW',
}

export enum MemoryFeedbackRating {
  POSITIVE = 'positive',
  NEGATIVE = 'negative',
}

export interface MemoryItem extends BaseModel {
  platformId: string
  projectId: string | null
  chatbotId: string | null
  chatIdentityId: string | null
  type: MemoryItemType
  content: string
  category: string | null
  importance: number
  source: string | null
  sessionKey: string | null
  metadata: Record<string, unknown> | null
  scope: MemoryScope
  status: MemoryStatus
  confidence: number
  impact: MemoryImpact | null
  supersededById: string | null
  confirmedByUserId: string | null
  confirmedAt: string | null
  negativeRatingCount: number
}

export interface CreateMemoryRequest {
  content: string
  type?: MemoryItemType
  category?: string
  importance?: number
  source?: string
  scope?: MemoryScope
  chatbotId?: string
  chatIdentityId?: string
  sessionKey?: string
  metadata?: Record<string, unknown>
  impact?: MemoryImpact
}

export interface UpdateMemoryRequest {
  content?: string
  type?: MemoryItemType
  category?: string
  importance?: number
  scope?: MemoryScope
  status?: MemoryStatus
}

export interface ConfirmMemoryRequest {
  status: 'confirmed' | 'rejected'
  comment?: string
}

export interface PromoteMemoryRequest {
  targetScope: MemoryScope
}

export interface MemorySearchRequest {
  query: string
  chatIdentityId?: string
  scope?: MemoryScope
  status?: MemoryStatus
  limit?: number
}

export interface MemorySearchResult {
  id: string
  type: string
  content: string
  category: string | null
  similarity: number
  metadata: Record<string, unknown> | null
  scope: MemoryScope
  status: MemoryStatus
  importance: number
}

export interface MemoryFeedback {
  id: string
  memoryId: string
  responseId: string | null
  rating: MemoryFeedbackRating
  comment: string | null
  createdByUserId: string | null
  created: string
}

export interface SubmitFeedbackRequest {
  responseId?: string
  rating: MemoryFeedbackRating
  comment?: string
}

export interface ListMemoryParams {
  type?: MemoryItemType
  scope?: MemoryScope
  status?: MemoryStatus
  source?: string
  chatbotId?: string
  chatIdentityId?: string
  limit?: number
  offset?: number
}

export interface MemoryStats {
  total: number
  pendingReview: number
  flagged: number
  byScope: Record<string, number>
  byStatus: Record<string, number>
}
