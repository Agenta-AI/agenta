/**
 * Environment variable access with runtime override support.
 *
 * Supports:
 * 1. Runtime config via window.__env (for containerized deployments)
 * 2. Build-time process.env values
 */

// Build-time environment variables
export const processEnv = {
    NEXT_PUBLIC_AGENTA_LICENSE: process.env.NEXT_PUBLIC_AGENTA_LICENSE,
    NEXT_PUBLIC_AGENTA_WEB_URL: process.env.NEXT_PUBLIC_AGENTA_WEB_URL,
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
    NEXT_PUBLIC_LOG_APP_ATOMS: process.env.NEXT_PUBLIC_LOG_APP_ATOMS,
    NEXT_PUBLIC_ENABLE_ATOM_LOGS: process.env.NEXT_PUBLIC_ENABLE_ATOM_LOGS,
}

/**
 * Get environment variable value.
 * Checks window.__env first (runtime), falls back to process.env (build-time).
 */
export const getEnv = (envKey: string): string => {
    // Check for window.__env if in browser (runtime config)
    if (
        typeof window !== "undefined" &&
        Object.keys((window as any).__env || {}).length > 0 &&
        (window as any).__env[envKey]
    ) {
        return (window as any).__env[envKey]
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

    if (!apiUrl && typeof window !== "undefined") {
        return `${window.location.protocol}//${window.location.hostname}`
    }

    return apiUrl
}
