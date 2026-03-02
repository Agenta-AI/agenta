/**
 * Testset API Helpers
 *
 * Cache redirect utilities and data transformation helpers.
 */

import {testsetSchema, variantSchema, type Testset, type Variant} from "../core"

// ============================================================================
// CACHE REDIRECT HELPERS
// These look up entities in query caches before making API calls
// ============================================================================

/**
 * Find a testset in the list query cache
 */
export function findTestsetInCache(
    queryClient: import("@tanstack/react-query").QueryClient,
    testsetId: string,
): Testset | undefined {
    const queries = queryClient.getQueriesData({queryKey: ["testsets-list"]})

    for (const [_queryKey, data] of queries) {
        if (!data || typeof data !== "object") continue

        const testsets = (data as {testsets?: unknown[]})?.testsets
        if (Array.isArray(testsets)) {
            const found = testsets.find((t: unknown) => (t as {id?: string})?.id === testsetId)
            if (found) {
                try {
                    return testsetSchema.parse(found)
                } catch {
                    continue
                }
            }
        }
    }

    return undefined
}

/**
 * Find a variant in query caches
 */
export function findVariantInCache(
    queryClient: import("@tanstack/react-query").QueryClient,
    variantId: string,
): Variant | undefined {
    const queries = queryClient.getQueriesData({queryKey: ["variant"]})

    for (const [_queryKey, data] of queries) {
        if (!data || typeof data !== "object") continue
        if ((data as {id?: string})?.id === variantId) {
            try {
                return variantSchema.parse(data)
            } catch {
                continue
            }
        }
    }

    return undefined
}
