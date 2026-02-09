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
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from "axios"

import {getAgentaApiUrl} from "./env"

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
