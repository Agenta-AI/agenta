/**
 * Shared Axios instance for API requests.
 *
 * This provides a base axios instance that can be extended by the app
 * with authentication interceptors and other app-specific configuration.
 *
 * @example
 * ```typescript
 * // In app initialization (e.g., _app.tsx)
 * import { configureAxios, axios } from '@agenta/shared'
 *
 * // Configure interceptors once at app startup
 * configureAxios({
 *   requestInterceptor: async (config) => {
 *     const jwt = await getJWT()
 *     if (jwt) config.headers.set('Authorization', `Bearer ${jwt}`)
 *     return config
 *   },
 *   responseInterceptor: (response) => response,
 *   errorInterceptor: (error) => {
 *     if (error.response?.status === 401) signOut()
 *     throw error
 *   }
 * })
 * ```
 */

import axiosApi, {
    type AxiosInstance,
    type AxiosRequestConfig,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from "axios"

import {getAgentaApiUrl} from "./env"

/**
 * Per-request config that demotes a request to low network priority when we're only revalidating
 * data we already have from a persisted cache. The browser can't set a priority on an XHR (axios's
 * default adapter — Chrome shows it as "High"), so we route these through axios's fetch adapter,
 * which forwards `fetchOptions.priority: "low"` as the Fetch Priority hint. Interceptors (auth) still
 * run. When `cached` is false the request is on the critical path, so we leave it at the XHR default.
 */
export function lowPriorityWhenCached(cached: boolean | undefined): AxiosRequestConfig {
    return cached ? ({adapter: "fetch", fetchOptions: {priority: "low"}} as AxiosRequestConfig) : {}
}

/**
 * Create a new axios instance with Agenta API defaults.
 */
export const createAxiosInstance = (): AxiosInstance => {
    return axiosApi.create({
        baseURL: getAgentaApiUrl(),
        headers: {
            "Content-Type": "application/json",
        },
    })
}

/**
 * Shared axios instance.
 * Apps should configure interceptors on this instance for auth, error handling, etc.
 */
export const axios = createAxiosInstance()

/**
 * Configuration options for axios interceptors.
 */
export interface AxiosInterceptorConfig {
    /** Request interceptor - called before each request */
    requestInterceptor?: (
        config: InternalAxiosRequestConfig,
    ) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>
    /** Response interceptor - called on successful responses */
    responseInterceptor?: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>
    /** Error interceptor - called on failed responses */
    errorInterceptor?: (error: unknown) => unknown
}

let isConfigured = false

/**
 * Configure the shared axios instance with custom interceptors.
 * Should be called once at app initialization.
 *
 * @param config - Interceptor configuration
 */
export function configureAxios(config: AxiosInterceptorConfig): void {
    if (isConfigured) {
        console.warn("[configureAxios] Axios already configured, skipping duplicate configuration")
        return
    }

    if (config.requestInterceptor) {
        axios.interceptors.request.use(config.requestInterceptor)
    }

    if (config.responseInterceptor || config.errorInterceptor) {
        axios.interceptors.response.use(config.responseInterceptor, config.errorInterceptor)
    }

    isConfigured = true
}

/**
 * Reset axios configuration (for testing).
 */
export function resetAxiosConfig(): void {
    isConfigured = false
}

export default axios

// ─── Auth token accessor ─────────────────────────────────────────────────────────────────────
// The axios interceptor covers every request that goes through this instance, but a few paths
// cannot: a streaming download writes into a FileSystemWritableFileStream, which needs a raw
// `fetch` and therefore the bearer token in hand. Apps register their own getter (the desktop's
// supertokens-auth-react session, mobile's supertokens-web-js one) so package code never imports
// an auth library.
let authTokenProvider: (() => Promise<string | undefined>) | null = null

/** Register the app's bearer-token getter. Call once at startup, beside {@link configureAxios}. */
export function configureAuthToken(provider: () => Promise<string | undefined>): void {
    authTokenProvider = provider
}

/** The current bearer token, or undefined when unauthenticated / unconfigured. */
export async function getAuthToken(): Promise<string | undefined> {
    if (!authTokenProvider) return undefined
    try {
        return await authTokenProvider()
    } catch {
        return undefined
    }
}

/**
 * Request flags the app's response interceptor reads. Declared here so callers can set them
 * without an `as any` cast — the desktop's interceptor owns the behaviour, this only types it.
 */
declare module "axios" {
    interface AxiosRequestConfig {
        /** Skip the global error toast; the caller handles the failure itself. */
        _ignoreError?: boolean
        /** Do not redirect to the auth-upgrade flow on a 401/403. */
        _skipAuthUpgradeRedirect?: boolean
    }
}
