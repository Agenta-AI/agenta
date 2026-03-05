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
 * Extract the builtin service type ("completion" | "chat") from a URL path.
 *
 * Handles URLs like `http://host/services/completion` or
 * `http://host/services/chat`.
 *
 * Used as a fallback when `data.uri` is missing (e.g. after backend
 * migration that didn't populate the URI field).
 *
 * @returns The service type, or null if the URL doesn't match
 */
export function resolveServiceTypeFromUrl(url: string | null | undefined): string | null {
    if (!url) return null
    const match = url.match(/\/services\/(completion|chat)(?:[/?]|$)/)
    return match ? match[1] : null
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
    if (uri && uri.startsWith("agenta:builtin:")) {
        // Case 1: URI exists — extract type and build canonical URL from host
        const parts = uri.split(":")
        const serviceType = parts[2]
        if (!serviceType || !["completion", "chat"].includes(serviceType)) return null

        const apiUrl = getAgentaApiUrl()
        if (!apiUrl) return null

        const origin = apiUrl.replace(/\/api\/?$/, "")
        return `${origin}/services/${serviceType}`
    }

    // Case 2: No URI — fall back to data.url if it's a builtin service URL
    const urlServiceType = resolveServiceTypeFromUrl(entity.data.url)
    if (urlServiceType) {
        return entity.data.url!
    }

    return null
}
