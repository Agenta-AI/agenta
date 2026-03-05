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
    type InternalAxiosRequestConfig,
    type AxiosResponse,
} from "axios"

import {getAgentaApiUrl} from "./env"

/**
 * Create a new axios instance with Agenta API defaults.
 */
export const createAxiosInstance = (): AxiosInstance => {
    const instance = axiosApi.create({
        baseURL: getAgentaApiUrl(),
        headers: {
            "Content-Type": "application/json",
        },
    })

    // Backward-compatible hardening for legacy revisions query:
    // some callers still send only `revision_ids` and omit `resolve`.
    // We inject `resolve` from local persisted playground mode when available.
    instance.interceptors.request.use((config) => {
        const rawUrl = `${config.baseURL ?? ""}${config.url ?? ""}`
        if (!rawUrl.includes("/variants/revisions/query")) {
            return config
        }

        const paramsRecord =
            config.params && typeof config.params === "object"
                ? (config.params as Record<string, unknown>)
                : {}
        const resolveFromParams = paramsRecord.resolve

        let payload: Record<string, unknown> = {}
        if (typeof config.data === "string") {
            try {
                const parsed = JSON.parse(config.data) as unknown
                if (parsed && typeof parsed === "object") {
                    payload = parsed as Record<string, unknown>
                }
            } catch {
                payload = {}
            }
        } else if (config.data && typeof config.data === "object") {
            payload = config.data as Record<string, unknown>
        }

        const resolveFromBody = payload.resolve
        let resolveFromStorage: boolean | undefined
        if (typeof window !== "undefined") {
            const stored = window.localStorage.getItem("agenta:playground:embed-resolution-view")
            if (stored === "resolved") resolveFromStorage = true
            if (stored === "unresolved") resolveFromStorage = false
        }

        const effectiveResolve =
            typeof resolveFromBody === "boolean"
                ? resolveFromBody
                : typeof resolveFromParams === "boolean"
                  ? resolveFromParams
                  : (resolveFromStorage ?? false)

        payload.resolve = effectiveResolve
        config.data = payload
        config.params = {...paramsRecord, resolve: effectiveResolve}

        const headersMaybe = config.headers as unknown
        if (
            headersMaybe &&
            typeof headersMaybe === "object" &&
            "set" in headersMaybe &&
            typeof headersMaybe.set === "function"
        ) {
            const headersWithSet = headersMaybe as {
                set: (name: string, value: string) => void
            }
            headersWithSet.set("x-agenta-resolve-source", "agenta-shared.axios-interceptor")
            headersWithSet.set("x-agenta-resolve-value", String(effectiveResolve))
        } else {
            config.headers = {
                ...(config.headers ?? {}),
                "x-agenta-resolve-source": "agenta-shared.axios-interceptor",
                "x-agenta-resolve-value": String(effectiveResolve),
            }
        }

        return config
    })

    return instance
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
