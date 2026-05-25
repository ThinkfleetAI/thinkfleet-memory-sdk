export class ThinkFleetMemoryError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly params?: Record<string, unknown>

  constructor(message: string, statusCode: number, code: string, params?: Record<string, unknown>) {
    super(message)
    this.name = 'ThinkFleetMemoryError'
    this.code = code
    this.statusCode = statusCode
    this.params = params
  }
}

export class AuthenticationError extends ThinkFleetMemoryError {
  constructor(message = 'Invalid or missing API key') {
    super(message, 401, 'AUTHENTICATION_ERROR')
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends ThinkFleetMemoryError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR')
    this.name = 'AuthorizationError'
  }
}

export class NotFoundError extends ThinkFleetMemoryError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ThinkFleetMemoryError {
  constructor(message = 'Validation failed', params?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', params)
    this.name = 'ValidationError'
  }
}

export class RateLimitError extends ThinkFleetMemoryError {
  readonly retryAfterMs: number | null

  constructor(message = 'Rate limit exceeded', retryAfterMs: number | null = null) {
    super(message, 429, 'RATE_LIMIT')
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export class ServerError extends ThinkFleetMemoryError {
  constructor(message = 'Internal server error', statusCode = 500) {
    super(message, statusCode, 'SERVER_ERROR')
    this.name = 'ServerError'
  }
}

export class TimeoutError extends ThinkFleetMemoryError {
  constructor(message = 'Request timed out') {
    super(message, 0, 'TIMEOUT')
    this.name = 'TimeoutError'
  }
}
