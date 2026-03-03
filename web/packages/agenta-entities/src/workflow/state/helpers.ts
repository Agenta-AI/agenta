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
 * Resolve the correct service URL for a builtin (non-custom) app workflow.
 *
 * For builtin apps with URI like "agenta:builtin:completion:v0", the service
 * is hosted at a deterministic path: `{origin}/services/{serviceType}`.
 *
 * This handles stale `data.url` values pointing to old/migrated domains.
 *
 * TODO: Remove once backend migration patches all revision data.url values.
 * After migration, data.url will always be correct and this resolution
 * will be unnecessary for non-evaluator app workflows.
 *
 * @returns Corrected service URL, or null if not a builtin app
 */
export function resolveBuiltinAppServiceUrl(entity: Workflow): string | null {
    if (!entity.data) return null
    if (entity.flags?.is_evaluator) return null
    if (entity.flags?.is_custom) return null

    const uri = entity.data.uri
    if (!uri || !uri.startsWith("agenta:builtin:")) return null

    // Extract service type: "agenta:builtin:completion:v0" → "completion"
    const parts = uri.split(":")
    const serviceType = parts[2]
    if (!serviceType || !["completion", "chat"].includes(serviceType)) return null

    const apiUrl = getAgentaApiUrl()
    if (!apiUrl) return null

    const origin = apiUrl.replace(/\/api\/?$/, "")
    return `${origin}/services/${serviceType}`
}
