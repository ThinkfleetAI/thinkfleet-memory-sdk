import type { HttpClient } from '../core/http-client.js'
import type { RequestOptions } from '../core/types.js'

// ── Triggers ─────────────────────────────────────────────────────────

export type AlertTrigger =
  | { kind: 'engine-event'; eventTypes: string[] }
  | { kind: 'segment-change'; from?: string; to: string }
  | { kind: 'pattern-emerged'; patternKind: string }

// ── Filter ───────────────────────────────────────────────────────────

export interface AlertFilter {
  subjectKind?: string
  /** Glob pattern. Use `*` for wildcards: `vip-*` matches any externalId starting with `vip-`. */
  subjectExternalIdPattern?: string
  categories?: string[]
  /** Dot-path keys; equality match against event payload. */
  metadataMatch?: Record<string, unknown>
}

// ── Channels ─────────────────────────────────────────────────────────

export type NotificationChannel =
  | {
      kind: 'webhook'
      url: string
      /** Shared secret for HMAC-SHA256 signing of the body. Sent as X-ThinkFleet-Signature. */
      secret?: string
    }
  | {
      /**
       * Self-documenting alert: writes the firing event as a memory item
       * of type=OBSERVATION. The next tf.context.build() call for the
       * subject surfaces it to the LLM automatically — no external
       * orchestration needed.
       */
      kind: 'memory'
      writeAs: {
        /**
         * Template with `{{event.eventType}}`, `{{event.severity}}`,
         * `{{subject.kind}}`, `{{subject.externalId}}`, `{{rule.name}}`.
         */
        content: string
        scope?: 'project' | 'platform' | 'user'
      }
    }

// ── Throttling ───────────────────────────────────────────────────────

export interface ThrottleConfig {
  maxPerHour?: number
  cooldownMinutes?: number
  dedupOn?: 'subject' | 'subject+rule' | 'rule'
}

// ── Rule shape ───────────────────────────────────────────────────────

export interface AlertRule {
  id: string
  projectId: string
  name: string
  description: string | null
  enabled: boolean
  trigger: AlertTrigger
  filter: AlertFilter | null
  notify: NotificationChannel[]
  throttle: ThrottleConfig | null
  created: string
  updated: string
}

export interface CreateAlertRuleRequest {
  name: string
  description?: string
  enabled?: boolean
  trigger: AlertTrigger
  filter?: AlertFilter
  notify: NotificationChannel[]
  throttle?: ThrottleConfig
}

export interface UpdateAlertRuleRequest {
  name?: string
  description?: string | null
  enabled?: boolean
  trigger?: AlertTrigger
  filter?: AlertFilter | null
  notify?: NotificationChannel[]
  throttle?: ThrottleConfig | null
}

export interface AlertFire {
  id: string
  alertRuleId: string
  eventId: string | null
  dedupeKey: string
  deliveryResults: Array<{ channel: string; ok: boolean; error?: string }>
  firedAt: string
}

/**
 * User-defined alert rules (Phase 3j).
 *
 * Define "tell me when X happens, this way" rules that hook into the
 * engine event stream. Triggers match against the same event types
 * tf.events.poll() returns; channels deliver via HTTP webhook or
 * write the alert back as a memory item for the LLM to pick up.
 *
 * @example
 * ```ts
 * // 1. Slack webhook on VIP churn risk
 * await tf.alerts.create({
 *   name: 'VIP at risk',
 *   trigger: { kind: 'engine-event', eventTypes: ['risk.fired'] },
 *   filter: { metadataMatch: { riskKind: 'rfm_at_risk_high_value' } },
 *   notify: [{ kind: 'webhook', url: 'https://hooks.slack.com/...' }],
 *   throttle: { dedupOn: 'subject', cooldownMinutes: 60 },
 * })
 *
 * // 2. Self-documenting alert — LLM sees it on next context.build()
 * await tf.alerts.create({
 *   name: 'Churn risk to memory',
 *   trigger: { kind: 'engine-event', eventTypes: ['risk.fired'] },
 *   notify: [{
 *     kind: 'memory',
 *     writeAs: {
 *       content: 'Risk fired: {{subject.kind}}/{{subject.externalId}} — investigate.',
 *       scope: 'project',
 *     },
 *   }],
 * })
 *
 * // 3. Pattern emergence Slack digest
 * await tf.alerts.create({
 *   name: 'New weekly buyer detected',
 *   trigger: { kind: 'pattern-emerged', patternKind: 'recurring_event' },
 *   notify: [{ kind: 'webhook', url: 'https://hooks.slack.com/...' }],
 * })
 * ```
 */
export class AlertsResource {
  constructor(private readonly http: HttpClient) {}

  async list(options?: RequestOptions): Promise<AlertRule[]> {
    return this.http.get<AlertRule[]>('/memory-alerts', undefined, options)
  }

  async get(alertId: string, options?: RequestOptions): Promise<AlertRule> {
    return this.http.get<AlertRule>(`/memory-alerts/${alertId}`, undefined, options)
  }

  async create(body: CreateAlertRuleRequest, options?: RequestOptions): Promise<AlertRule> {
    return this.http.post<AlertRule>('/memory-alerts', body, options)
  }

  async update(
    alertId: string,
    body: UpdateAlertRuleRequest,
    options?: RequestOptions,
  ): Promise<AlertRule> {
    return this.http.patch<AlertRule>(`/memory-alerts/${alertId}`, body, options)
  }

  async delete(alertId: string, options?: RequestOptions): Promise<void> {
    return this.http.delete(`/memory-alerts/${alertId}`, options)
  }

  /** Convenience — patch only the `enabled` flag. */
  async enable(alertId: string, options?: RequestOptions): Promise<AlertRule> {
    return this.update(alertId, { enabled: true }, options)
  }
  async disable(alertId: string, options?: RequestOptions): Promise<AlertRule> {
    return this.update(alertId, { enabled: false }, options)
  }

  /** Last ~100 fires for an alert rule, newest first. */
  async listFires(alertId: string, options?: RequestOptions): Promise<AlertFire[]> {
    return this.http.get<AlertFire[]>(`/memory-alerts/${alertId}/fires`, undefined, options)
  }
}
