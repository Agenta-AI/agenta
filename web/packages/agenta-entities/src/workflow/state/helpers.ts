/**
 * Workflow State Helpers
 *
 * Shared utility functions used by both `store.ts` and `runnableSetup.ts`.
 * Extracted to avoid circular dependencies between those modules.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl} from "@agenta/shared/api"

import type {Workflow} from "../core"

/**
 * Extract service type from a URI like "agenta:builtin:completion:v0".
 *
 * @returns "completion" | "chat" | null
 */
export function resolveServiceTypeFromUri(uri: string | null | undefined): string | null {
    if (!uri || !uri.startsWith("agenta:builtin:")) return null
    const parts = uri.split(":")
    const serviceType = parts[2]
    if (!serviceType || !["completion", "chat"].includes(serviceType)) return null
    return serviceType
}

/**
 * Extract service type from a URL path like "http://host/services/completion"
 * or "http://host/services/builtin/completion/v0".
 *
 * Used as a fallback when `uri` is missing (post-migration data where
 * `data.url` is correct but `data.uri` was not preserved).
 *
 * @returns "completion" | "chat" | null
 */
export function resolveServiceTypeFromUrl(url: string | null | undefined): string | null {
    if (!url) return null
    // Match both old-style /services/completion and new-style /services/builtin/completion/v0
    const match = url.match(/\/services\/(?:builtin\/)?(completion|chat)(?:[/?]|$|\/v\d+)/)
    return match ? match[1] : null
}

/**
 * Check whether a URL points to any managed agenta service.
 *
 * Returns true for any `/services/...` URL — builtin, custom, evaluator, etc.
 * Used to suppress the OpenAPI fallback for managed service URLs.
 */
export function isManagedServiceUrl(url: string | null | undefined): boolean {
    if (!url) return false
    return /\/services\//.test(url)
}

/**
 * Build a service URL from an agenta URI.
 *
 * Converts `agenta:{kind}:{key}:{version}` → `{origin}/services/{kind}/{key}/{version}`
 *
 * @returns Service URL, or null if the URI is not an agenta URI
 */
export function buildServiceUrlFromUri(uri: string | null | undefined): string | null {
    if (!uri || !uri.startsWith("agenta:")) return null
    const apiUrl = getAgentaApiUrl()
    if (!apiUrl) return null
    const origin = apiUrl.replace(/\/api\/?$/, "")
    // agenta:{kind}:{key}:{version} → {kind}/{key}/{version}
    const path = uri.replace(/^agenta:/, "").replace(/:/g, "/")
    return `${origin}/services/${path}`
}

/**
 * Resolve the correct service URL for a builtin (non-custom) app workflow.
 *
 * For builtin apps with URI like "agenta:builtin:completion:v0", the service
 * is hosted at a deterministic path: `{origin}/services/{serviceType}`.
 * The URI is preferred because `data.url` may point to a stale/migrated domain.
 *
 * When the URI is missing (post-migration data corruption), falls back to
 * `data.url` if it matches the builtin `/services/{type}` pattern — these
 * revisions were created after the migration so their URL is already correct.
 *
 * @returns Corrected service URL, or null if not a builtin app
 */
export function resolveBuiltinAppServiceUrl(entity: Workflow): string | null {
    if (!entity.data) return null
    if (entity.flags?.is_evaluator) return null
    if (entity.flags?.is_custom) return null

    const uri = entity.data.uri
    const url = entity.data.url

    // Case 1: URI exists — extract type from URI, build canonical URL
    const serviceTypeFromUri = resolveServiceTypeFromUri(uri)
    if (serviceTypeFromUri) {
        const apiUrl = getAgentaApiUrl()
        if (!apiUrl) return null
        const origin = apiUrl.replace(/\/api\/?$/, "")
        return `${origin}/services/${serviceTypeFromUri}`
    }

    // Case 2: URI missing but URL contains /services/{type} — use URL as-is
    // (post-migration data where data.url is already correct)
    const serviceTypeFromUrl = resolveServiceTypeFromUrl(url)
    if (serviceTypeFromUrl) {
        return url!
    }

    return null
}
