import {
  ThinkFleetMemoryError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from './errors.js'
import type { HttpClientOptions, RequestOptions } from './types.js'

export class HttpClient {
  private readonly options: HttpClientOptions

  constructor(options: HttpClientOptions) {
    this.options = options
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    requestOptions?: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, params, requestOptions)
    return this.request<T>(url, { method: 'GET' }, requestOptions)
  }

  async post<T>(path: string, body?: unknown, requestOptions?: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, undefined, requestOptions)
    return this.request<T>(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      },
      requestOptions,
    )
  }

  async patch<T>(path: string, body?: unknown, requestOptions?: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, undefined, requestOptions)
    return this.request<T>(
      url,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      },
      requestOptions,
    )
  }

  async put<T>(path: string, body?: unknown, requestOptions?: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, undefined, requestOptions)
    return this.request<T>(
      url,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      },
      requestOptions,
    )
  }

  async delete<T>(path: string, requestOptions?: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, undefined, requestOptions)
    return this.request<T>(url, { method: 'DELETE' }, requestOptions)
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    requestOptions?: RequestOptions,
  ): string {
    const projectId = requestOptions?.projectId ?? this.options.projectId
    const base = `${this.options.baseUrl}/api/v1/projects/${projectId}${path}`

    if (!params) return base

    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const qs = searchParams.toString()
    return qs ? `${base}?${qs}` : base
  }

  private async request<T>(url: string, init: RequestInit, requestOptions?: RequestOptions): Promise<T> {
    const timeout = requestOptions?.timeout ?? this.options.timeout
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(500 * Math.pow(2, attempt - 1), 10000)
        const jitter = delay * (0.5 + Math.random() * 0.5)
        await new Promise((resolve) => setTimeout(resolve, jitter))
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        let finalInit: RequestInit = {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            'Authorization': `Bearer ${this.options.apiKey}`,
          },
          signal: requestOptions?.signal ?? controller.signal,
        }

        if (this.options.requestInterceptors) {
          for (const interceptor of this.options.requestInterceptors) {
            finalInit = await interceptor(url, finalInit)
          }
        }

        let response = await this.options.fetchFn(url, finalInit)
        clearTimeout(timeoutId)

        if (this.options.responseInterceptors) {
          for (const interceptor of this.options.responseInterceptors) {
            response = await interceptor(response, url)
          }
        }

        if (response.ok) {
          if (response.status === 204) {
            return undefined as T
          }
          return (await response.json()) as T
        }

        const errorBody = await response.text().catch(() => '')
        let errorMessage = `HTTP ${response.status}`
        let errorCode = 'UNKNOWN'
        let errorParams: Record<string, unknown> | undefined

        try {
          const parsed = JSON.parse(errorBody)
          errorMessage = parsed.message ?? parsed.error ?? errorMessage
          errorCode = parsed.code ?? errorCode
          errorParams = parsed.params
        } catch {
          if (errorBody) errorMessage = errorBody
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : null
          lastError = new RateLimitError(errorMessage, retryAfterMs)
          if (attempt < this.options.maxRetries) continue
          throw lastError
        }

        if (response.status >= 500) {
          lastError = new ServerError(errorMessage, response.status)
          if (attempt < this.options.maxRetries) continue
          throw lastError
        }

        switch (response.status) {
          case 401:
            throw new AuthenticationError(errorMessage)
          case 403:
            throw new AuthorizationError(errorMessage)
          case 404:
            throw new NotFoundError(errorMessage)
          case 400:
          case 422:
            throw new ValidationError(errorMessage, errorParams)
          default:
            throw new ThinkFleetMemoryError(errorMessage, response.status, errorCode, errorParams)
        }
      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof ThinkFleetMemoryError) {
          throw error
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new TimeoutError(`Request timed out after ${timeout}ms`)
        }

        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < this.options.maxRetries) continue
        throw new ThinkFleetMemoryError(`Network error: ${lastError.message}`, 0, 'NETWORK_ERROR')
      }
    }

    throw lastError ?? new ThinkFleetMemoryError('Request failed', 0, 'UNKNOWN')
  }
}
