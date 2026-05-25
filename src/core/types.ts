export interface SeekPage<T> {
  data: T[]
  next: string | null
  previous: string | null
}

export interface RequestOptions {
  /** Override the default projectId for this call. */
  projectId?: string
  timeout?: number
  signal?: AbortSignal
}

/** Middleware called before each request. Use to add custom headers (e.g. a Cognito JWT). */
export type RequestInterceptor = (url: string, init: RequestInit) => RequestInit | Promise<RequestInit>

/** Middleware called after each response, before JSON parsing. */
export type ResponseInterceptor = (response: Response, url: string) => Response | Promise<Response>

export interface HttpClientOptions {
  apiKey: string
  projectId: string
  baseUrl: string
  maxRetries: number
  timeout: number
  fetchFn: typeof globalThis.fetch
  requestInterceptors?: RequestInterceptor[]
  responseInterceptors?: ResponseInterceptor[]
}
