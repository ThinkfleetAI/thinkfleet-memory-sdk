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
export { ConsentResource } from './resources/consent.js'
export { ContextResource } from './resources/context.js'
export type {
  ContextSection,
  ContextBuildRequest,
  ContextBundle,
  ContextProfile,
  ContextPattern,
  ContextPrediction,
  ContextMemory,
  ContextObservation,
} from './resources/context.js'

export { EventsResource } from './resources/events.js'
export type {
  EventSeverity,
  MemoryEvent,
  PollEventsParams,
} from './resources/events.js'

export { ComplianceResource } from './resources/compliance.js'
export type {
  ComplianceSubject,
  ExportSubjectResponse,
  HardDeleteSubjectRequest,
  HardDeleteSubjectResponse,
  ListAuditParams,
  AuditEvent,
} from './resources/compliance.js'

export { AlertsResource } from './resources/alerts.js'
export type {
  AlertTrigger,
  AlertFilter,
  NotificationChannel,
  ThrottleConfig,
  AlertRule,
  CreateAlertRuleRequest,
  UpdateAlertRuleRequest,
  AlertFire,
} from './resources/alerts.js'
export type {
  ConsentSubject,
  OptOutRequest,
  OptInRequest,
  ConsentStatus,
} from './resources/consent.js'
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
  ObserveRequest,
  ObserveAttachmentRequest,
  ObserveVoiceRequest,
  ObserveDocumentRequest,
  ConsolidateRequest,
  ConsolidateResult,
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
  MineMemoriesRequest,
  Subject,
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
  PredictRequest,
  PredictedEvent,
  PredictResult,
  SubjectProfile,
  RiskIndicator,
} from './types/lattice.js'
