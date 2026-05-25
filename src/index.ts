// Client
export { ThinkFleetMemory, type ThinkFleetMemoryOptions } from './client.js'

// Core
export {
  ThinkFleetMemoryError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from './core/errors.js'

export type {
  SeekPage,
  RequestOptions,
  RequestInterceptor,
  ResponseInterceptor,
} from './core/types.js'

// Resources
export { MemoryResource, AdminMemoryResource } from './resources/memory.js'
export { LatticeResource } from './resources/lattice.js'

// Types — common
export type { BaseModel } from './types/common.js'

// Types — memory
export type {
  MemoryItem,
  CreateMemoryRequest,
  UpdateMemoryRequest,
  ConfirmMemoryRequest,
  PromoteMemoryRequest,
  MemorySearchRequest,
  MemorySearchResult,
  MemoryFeedback,
  SubmitFeedbackRequest,
  ListMemoryParams,
  MemoryStats,
} from './types/memory.js'

export {
  MemoryItemType,
  MemoryScope,
  MemoryStatus,
  MemoryImpact,
  MemoryFeedbackRating,
} from './types/memory.js'

// Types — lattice
export type {
  BehaviorPatternKind,
  Cadence,
  BehaviorPatternMetadata,
  BehaviorPatternRecord,
  ExtractPatternsRequest,
  ContactExtractError,
  ExtractPatternsResult,
  ListPatternsParams,
  ListContactPatternsResponse,
  GetContextParams,
  LatticeContextContact,
  LatticeContextEvent,
  LatticeContextMemory,
  LatticeContextEntity,
  LatticeContextEdge,
  LatticeContextBundle,
  MonitorTickResult,
  MonitorStatus,
} from './types/lattice.js'
