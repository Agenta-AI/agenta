/**
 * Environment variable access with runtime override support.
 *
 * Supports:
 * 1. Runtime config via window.__env (for containerized deployments)
 * 2. Build-time process.env values
 */

type RuntimeGlobal = typeof globalThis & {
    __env?: Record<string, string>
    location?: {
        protocol?: string
        hostname?: string
        port?: string
    }
}

/** Build an origin string from runtime `window.location` parts, including
 * `port` when present (the browser's `port` field is `""` on default ports
 * 80/443). Returns `undefined` when protocol or hostname is missing. */
const buildRuntimeOrigin = (): string | undefined => {
    const runtimeLocation = (globalThis as RuntimeGlobal).location
    const {protocol, hostname, port} = runtimeLocation ?? {}
    if (!protocol || !hostname) return undefined
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`
}

// Build-time environment variables
export const processEnv = {
    NEXT_PUBLIC_AGENTA_LICENSE: process.env.NEXT_PUBLIC_AGENTA_LICENSE,
    NEXT_PUBLIC_AGENTA_WEB_URL: process.env.NEXT_PUBLIC_AGENTA_WEB_URL,
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
    NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY:
        process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_LOG_APP_ATOMS: process.env.NEXT_PUBLIC_LOG_APP_ATOMS,
    NEXT_PUBLIC_ENABLE_ATOM_LOGS: process.env.NEXT_PUBLIC_ENABLE_ATOM_LOGS,
}

/**
 * Get environment variable value.
 * Checks window.__env first (runtime), falls back to process.env (build-time).
 */
export const getEnv = (envKey: string): string => {
    // Check for runtime config first (browser/worker)
    const runtimeEnv = (globalThis as RuntimeGlobal).__env
    if (runtimeEnv && Object.keys(runtimeEnv).length > 0 && runtimeEnv[envKey]) {
        return runtimeEnv[envKey]
    }

    // Fall back to build-time environment
    return processEnv[envKey as keyof typeof processEnv] || ""
}

/**
 * Get the Agenta API URL.
 * Falls back to current origin if not configured.
 */
export const getAgentaApiUrl = (): string => {
    const apiUrl = getEnv("NEXT_PUBLIC_AGENTA_API_URL")
    if (apiUrl) return apiUrl
    return buildRuntimeOrigin() ?? ""
}

/**
 * Get the Agenta Web URL.
 * Falls back to current origin if not configured.
 */
export const getAgentaWebUrl = (): string => {
    const webUrl = getEnv("NEXT_PUBLIC_AGENTA_WEB_URL")
    if (webUrl) return webUrl
    return buildRuntimeOrigin() ?? ""
}
