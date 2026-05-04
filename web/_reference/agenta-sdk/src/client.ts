/**
 * Agenta TypeScript SDK — Core HTTP client.
 *
 * Mirrors the Python SDK's authed_api() pattern:
 *   sdk/agenta/sdk/utils/client.py
 *
 * Key differences from the old lib/agenta.ts:
 *   - All routes use the /preview/ prefix (new API)
 *   - project_id is sent as a query parameter on every request
 *   - Errors are thrown, never silently swallowed
 *   - Request envelopes match the API models exactly
 */

/**
 * Async function that returns an authorization header value.
 * Used for JWT-based auth where tokens expire and need refreshing.
 *
 * @example
 * ```typescript
 * // SuperTokens JWT
 * const getAuth = async () => {
 *   const jwt = await getJWT();
 *   return jwt ? `Bearer ${jwt}` : undefined;
 * };
 * ```
 */
export type AuthProvider = () => Promise<string | undefined>

export interface AgentaClientConfig {
    /** Base URL of the Agenta API (e.g. "http://localhost" or "https://cloud.agenta.ai"). */
    host?: string
    /**
     * Base path appended to host (e.g. "/api"). Default: "/api".
     * Set to "" for direct connections without a proxy path prefix.
     */
    basePath?: string
    /** Static API key for authentication. Sent as `Authorization: <key>`. */
    apiKey?: string
    /**
     * Dynamic auth provider (e.g. JWT). Called before each request.
     * Takes precedence over `apiKey` when both are set.
     */
    authProvider?: AuthProvider
    /** Project ID. Required — scopes all requests. */
    projectId?: string
    /**
     * Dynamic project ID resolver. Called before each request.
     * Takes precedence over static `projectId` when set.
     */
    projectIdProvider?: () => string | undefined
    /** Request timeout in milliseconds. Default: 30_000. */
    timeout?: number
    /**
     * Response interceptor — called on every response before returning.
     * Throw from here to trigger error handling (e.g. 401 → sign out).
     */
    onResponse?: (response: Response, endpoint: string) => void | Promise<void>
    /**
     * Total number of attempts (including the first). Default: 3.
     * Set to 1 to disable retries.
     */
    retries?: number
    /**
     * Base delay in milliseconds for the exponential backoff. Default: 200.
     * Backoff uses full jitter: `random(0, base * 2^attempt)`.
     */
    retryBackoffMs?: number
}

export class AgentaApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly detail: string,
        public readonly endpoint: string,
    ) {
        super(`Agenta API ${endpoint}: ${status} ${detail}`)
        this.name = "AgentaApiError"
    }
}

/** 401 / 403 — authentication or authorization failure. */
export class AgentaAuthError extends AgentaApiError {
    constructor(status: number, detail: string, endpoint: string) {
        super(status, detail, endpoint)
        this.name = "AgentaAuthError"
    }
}

/** 404 — resource not found. */
export class AgentaNotFoundError extends AgentaApiError {
    constructor(detail: string, endpoint: string) {
        super(404, detail, endpoint)
        this.name = "AgentaNotFoundError"
    }
}

/** 400 / 422 — request validation failure. */
export class AgentaValidationError extends AgentaApiError {
    constructor(status: number, detail: string, endpoint: string) {
        super(status, detail, endpoint)
        this.name = "AgentaValidationError"
    }
}

/** 429 — rate limited. Carries `retryAfterMs` parsed from the `Retry-After` header. */
export class AgentaRateLimitError extends AgentaApiError {
    constructor(
        detail: string,
        endpoint: string,
        public readonly retryAfterMs: number | undefined,
    ) {
        super(429, detail, endpoint)
        this.name = "AgentaRateLimitError"
    }
}

/** 5xx — backend failure. */
export class AgentaServerError extends AgentaApiError {
    constructor(status: number, detail: string, endpoint: string) {
        super(status, detail, endpoint)
        this.name = "AgentaServerError"
    }
}

/**
 * Build a typed error subclass from an HTTP response.
 *
 * Maps status codes to the most specific error class. Falls back to the
 * `AgentaApiError` base for codes that don't fit a category (e.g. 418).
 */
function errorFromResponse(
    status: number,
    detail: string,
    endpoint: string,
    retryAfterMs?: number,
): AgentaApiError {
    if (status === 401 || status === 403) return new AgentaAuthError(status, detail, endpoint)
    if (status === 404) return new AgentaNotFoundError(detail, endpoint)
    if (status === 400 || status === 422) return new AgentaValidationError(status, detail, endpoint)
    if (status === 429) return new AgentaRateLimitError(detail, endpoint, retryAfterMs)
    if (status >= 500 && status < 600) return new AgentaServerError(status, detail, endpoint)
    return new AgentaApiError(status, detail, endpoint)
}

/**
 * Parse a `Retry-After` header. Supports the two RFC 7231 forms:
 *   - delay-seconds: "120" → 120000 ms
 *   - HTTP-date: "Wed, 21 Oct 2025 07:28:00 GMT" → ms-from-now (clamped >= 0)
 *
 * Caps at 60 seconds to prevent a hostile or buggy server from stalling us.
 */
function parseRetryAfter(headerValue: string | null): number | undefined {
    if (!headerValue) return undefined
    const trimmed = headerValue.trim()
    if (!trimmed) return undefined

    const MAX_RETRY_AFTER_MS = 60_000

    const seconds = Number(trimmed)
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    }

    const date = Date.parse(trimmed)
    if (Number.isFinite(date)) {
        const ms = Math.max(0, date - Date.now())
        return Math.min(ms, MAX_RETRY_AFTER_MS)
    }

    return undefined
}

/**
 * Full-jitter backoff: `random(0, base * 2^attempt)`.
 * `attempt` is 0-indexed (first retry uses attempt=0).
 */
function jitterDelayMs(attempt: number, baseMs: number): number {
    const cap = baseMs * 2 ** attempt
    return Math.floor(Math.random() * cap)
}

const DEFAULT_RETRIES = 3
const DEFAULT_BACKOFF_BASE_MS = 200

/**
 * True if the thrown value looks like a network or timeout failure that's safe
 * to retry. AbortError (from our own timeout) is retryable; user-supplied abort
 * signals will surface as the same error class but with a different `.cause`,
 * which we don't currently distinguish — acceptable trade-off for now.
 */
function isRetryableNetworkError(err: unknown): boolean {
    if (err instanceof Error) {
        if (err.name === "AbortError") return true
        // fetch() throws TypeError on DNS / connect / TLS failures.
        if (err.name === "TypeError") return true
    }
    return false
}

/**
 * Read the error detail from a non-2xx response. Tries JSON first, falls back
 * to plain text. Used to construct AgentaApiError subclasses.
 */
async function readErrorDetail(res: Response): Promise<string> {
    try {
        const data = await res.json()
        if (typeof data === "object" && data !== null && "detail" in data) {
            return String((data as {detail: unknown}).detail)
        }
        return JSON.stringify(data)
    } catch {
        try {
            return await res.text()
        } catch {
            return res.statusText || `HTTP ${res.status}`
        }
    }
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AgentaClient {
    readonly host: string
    readonly basePath: string
    readonly apiKey: string
    private readonly authProvider?: AuthProvider
    readonly projectId: string
    private readonly projectIdProvider?: () => string | undefined
    private readonly timeout: number
    private readonly onResponse?: (response: Response, endpoint: string) => void | Promise<void>
    readonly retries: number
    readonly retryBackoffMs: number

    constructor(config?: AgentaClientConfig) {
        this.host =
            config?.host ??
            process.env.AGENTA_HOST ??
            process.env.NEXT_PUBLIC_AGENTA_HOST ??
            "http://localhost"
        this.basePath = config?.basePath ?? "/api"
        this.apiKey =
            config?.apiKey ??
            process.env.AGENTA_API_KEY ??
            process.env.NEXT_PUBLIC_AGENTA_API_KEY ??
            ""
        this.authProvider = config?.authProvider
        this.projectId =
            config?.projectId ??
            process.env.AGENTA_PROJECT_ID ??
            process.env.NEXT_PUBLIC_AGENTA_PROJECT_ID ??
            ""
        this.projectIdProvider = config?.projectIdProvider
        this.timeout = config?.timeout ?? 30_000
        this.onResponse = config?.onResponse
        this.retries = Math.max(1, config?.retries ?? DEFAULT_RETRIES)
        this.retryBackoffMs = config?.retryBackoffMs ?? DEFAULT_BACKOFF_BASE_MS
    }

    /** Base API URL: host + basePath (e.g. "http://localhost/api" or "http://localhost"). */
    get baseUrl(): string {
        return `${this.host}${this.basePath}`
    }

    /**
     * Make an authenticated request to the Agenta API.
     *
     * - Prepends `/preview` to all endpoints (new API convention).
     * - Adds `project_id` as a query parameter.
     * - Adds `Authorization: ApiKey <key>` header.
     * - Retries network errors, 5xx, and 429 with exponential backoff + jitter.
     */
    async request<T = unknown>(
        method: string,
        endpoint: string,
        options?: {
            body?: unknown
            params?: Record<string, string>
            /** Set to true to skip the /preview prefix (for legacy endpoints). */
            legacy?: boolean
            /** Per-request timeout in ms. Overrides the client default. */
            timeout?: number
        },
    ): Promise<T> {
        const res = await this.executeWithRetries(
            method,
            endpoint,
            options?.legacy ?? false,
            options?.params,
            {"Content-Type": "application/json"},
            options?.body != null ? JSON.stringify(options.body) : undefined,
            options?.timeout,
        )
        return (await res.json()) as T
    }

    /**
     * Make an authenticated raw request to the Agenta API.
     *
     * Unlike `request()`, this method:
     * - Does not set Content-Type (caller controls it, e.g. FormData)
     * - Does not JSON.stringify the body
     * - Does not parse the response — returns the raw `Response` object
     * - Still runs the onResponse interceptor
     * - Still throws a typed Agenta error subclass on non-2xx
     * - Still retries on network errors, 5xx, and 429
     */
    async requestRaw(
        method: string,
        endpoint: string,
        options?: {
            body?: BodyInit
            headers?: Record<string, string>
            params?: Record<string, string>
            /** Set to true to skip the /preview prefix (for legacy endpoints). */
            legacy?: boolean
            /** Per-request timeout in ms. Overrides the client default. */
            timeout?: number
        },
    ): Promise<Response> {
        return this.executeWithRetries(
            method,
            endpoint,
            options?.legacy ?? false,
            options?.params,
            options?.headers ?? {},
            options?.body,
            options?.timeout,
        )
    }

    /**
     * Run a request with retries on network errors, 5xx, and 429.
     *
     * Returns the `Response` on success. Throws a typed `AgentaApiError`
     * subclass on a non-retryable failure or after the final attempt.
     */
    private async executeWithRetries(
        method: string,
        endpoint: string,
        legacy: boolean,
        params: Record<string, string> | undefined,
        baseHeaders: Record<string, string>,
        body: BodyInit | undefined,
        perRequestTimeout: number | undefined,
    ): Promise<Response> {
        const prefix = legacy ? "" : "/preview"
        const url = new URL(`${this.baseUrl}${prefix}${endpoint}`)

        const projectId = this.projectIdProvider?.() ?? this.projectId
        if (projectId) url.searchParams.set("project_id", projectId)
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                url.searchParams.set(k, v)
            }
        }

        const headers: Record<string, string> = {...baseHeaders}
        if (this.authProvider) {
            const auth = await this.authProvider()
            if (auth) headers["Authorization"] = auth
        } else if (this.apiKey) {
            headers["Authorization"] = this.apiKey
        }

        const endpointLabel = `${method} ${endpoint}`
        let lastError: unknown

        for (let attempt = 0; attempt < this.retries; attempt++) {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), perRequestTimeout ?? this.timeout)

            let res: Response
            try {
                res = await fetch(url.toString(), {
                    method,
                    headers,
                    body,
                    signal: controller.signal,
                })
            } catch (err) {
                lastError = err
                clearTimeout(timer)
                if (attempt < this.retries - 1 && isRetryableNetworkError(err)) {
                    await sleep(jitterDelayMs(attempt, this.retryBackoffMs))
                    continue
                }
                throw err
            } finally {
                clearTimeout(timer)
            }

            if (this.onResponse) {
                await this.onResponse(res, endpointLabel)
            }

            if (res.ok) return res

            const detail = await readErrorDetail(res)
            const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"))
            const apiError = errorFromResponse(res.status, detail, endpointLabel, retryAfterMs)

            const isRetryableStatus = res.status === 429 || (res.status >= 500 && res.status < 600)
            if (attempt < this.retries - 1 && isRetryableStatus) {
                lastError = apiError
                const delayMs =
                    res.status === 429 && retryAfterMs !== undefined
                        ? retryAfterMs
                        : jitterDelayMs(attempt, this.retryBackoffMs)
                await sleep(delayMs)
                continue
            }

            throw apiError
        }

        // We exhausted retries on a transient failure. Throw the last seen error.
        throw lastError ?? new Error(`Agenta API ${endpointLabel}: retries exhausted`)
    }

    /** Shorthand: POST request. */
    async post<T = unknown>(
        endpoint: string,
        body?: unknown,
        options?: {legacy?: boolean; params?: Record<string, string>},
    ): Promise<T> {
        return this.request<T>("POST", endpoint, {body, ...options})
    }

    /** Shorthand: GET request. */
    async get<T = unknown>(
        endpoint: string,
        options?: {legacy?: boolean; params?: Record<string, string>},
    ): Promise<T> {
        return this.request<T>("GET", endpoint, options)
    }

    /** Shorthand: PUT request. */
    async put<T = unknown>(
        endpoint: string,
        body?: unknown,
        options?: {legacy?: boolean; params?: Record<string, string>},
    ): Promise<T> {
        return this.request<T>("PUT", endpoint, {body, ...options})
    }

    /** Shorthand: DELETE request. */
    async delete<T = unknown>(
        endpoint: string,
        options?: {legacy?: boolean; params?: Record<string, string>},
    ): Promise<T> {
        return this.request<T>("DELETE", endpoint, options)
    }

    /**
     * Invoke a deployed Agenta prompt application.
     *
     * Mirrors Python SDK's `invoke_deployed_prompt()`:
     *   POST {baseUrl}/services/completion/run
     *   Body: { inputs, environment, app }
     *
     * @param appSlug - The application slug (e.g. "generate-test-cases")
     * @param inputs - Template variable values to pass to the prompt
     * @param environmentSlug - Environment slug (default: "production")
     * @returns The parsed response data and optional trace ID
     */
    async invokePrompt<T = unknown>(
        appSlug: string,
        inputs: Record<string, string>,
        environmentSlug = "production",
    ): Promise<{data: T; traceId?: string}> {
        const result = await this.post<Record<string, unknown>>(
            "/services/completion/run",
            {
                inputs,
                environment: environmentSlug,
                app: appSlug,
            },
            {legacy: true},
        )

        const traceId = (result.trace_id as string) ?? (result.traceId as string) ?? undefined

        return {data: result.data as T, traceId}
    }

    /**
     * Fetch from an external service URL (not the Agenta API).
     *
     * Unlike `request()`, this takes an absolute URL and does NOT prepend
     * the baseUrl or /preview prefix. Optionally includes project_id as a
     * query param and auth headers.
     *
     * Used for hitting deployed app services (e.g., /openapi.json, /inspect).
     *
     * @param url - Absolute URL to fetch
     * @param options - Optional params, auth inclusion, signal, timeout
     */
    async fetchExternal<T = unknown>(
        url: string,
        options?: {
            method?: string
            body?: unknown
            params?: Record<string, string>
            /** Include project_id as a query param. Default: false. */
            includeProjectId?: boolean
            /** Include auth headers. Default: false. */
            includeAuth?: boolean
            signal?: AbortSignal
            timeout?: number
        },
    ): Promise<{data: T; status: number}> {
        const fetchUrl = new URL(url)

        if (options?.includeProjectId) {
            const projectId = this.projectIdProvider?.() ?? this.projectId
            if (projectId) {
                fetchUrl.searchParams.set("project_id", projectId)
            }
        }

        if (options?.params) {
            for (const [k, v] of Object.entries(options.params)) {
                fetchUrl.searchParams.set(k, v)
            }
        }

        const headers: Record<string, string> = {}
        if (options?.includeAuth) {
            if (this.authProvider) {
                const auth = await this.authProvider()
                if (auth) headers["Authorization"] = auth
            } else if (this.apiKey) {
                headers["Authorization"] = this.apiKey
            }
        }
        if (options?.body != null) {
            headers["Content-Type"] = "application/json"
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), options?.timeout ?? this.timeout)

        // Combine external signal with our timeout signal
        const signal = options?.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal

        try {
            const res = await fetch(fetchUrl.toString(), {
                method: options?.method ?? "GET",
                headers,
                body: options?.body != null ? JSON.stringify(options.body) : undefined,
                signal,
            })

            const data = res.ok ? ((await res.json()) as T) : (null as T)
            return {data, status: res.status}
        } finally {
            clearTimeout(timer)
        }
    }
}
