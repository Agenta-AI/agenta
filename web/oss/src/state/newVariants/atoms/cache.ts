import {atom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

/**
 * Cache Intelligence Atoms
 * Pure atoms for smart cache lookup and redirection
 */

export interface CacheFinderResult {
    variant?: any
    revision?: any
    source?: string
}

// Pure cache lookup logic atom
export const cacheFinderAtom = atom((get) => {
    const queryClient = get(queryClientAtom)

    return {
        findVariantInCache: (variantId: string): any | null => {
            const queryCache = queryClient.getQueryCache()
            const bulkQueries = queryCache.findAll(["variants-priority"])

            for (const query of bulkQueries) {
                const data = query.state.data as any
                if (data?.variants) {
                    const found = data.variants.find((v: any) => v.id === variantId)
                    if (found) return found
                }
            }

            // Also check individual variant queries
            const individualQuery = queryCache.find(["variant", variantId])
            if (individualQuery?.state.data) {
                return individualQuery.state.data
            }

            return null
        },

        findRevisionInCache: (revisionId: string): CacheFinderResult | null => {
            const queryCache = queryClient.getQueryCache()
            const bulkQueries = queryCache.findAll(["variants-priority"])

            for (const query of bulkQueries) {
                const data = query.state.data as any
                if (data?.variants) {
                    for (const variant of data.variants) {
                        const revision = variant.revisions?.find((r: any) => r.id === revisionId)
                        if (revision) {
                            return {variant, revision, source: "bulk"}
                        }
                    }
                }
            }

            // Check individual revision queries
            const revisionQuery = queryCache.find(["revision", revisionId])
            if (revisionQuery?.state.data) {
                return {
                    revision: revisionQuery.state.data,
                    source: "individual",
                }
            }

            return null
        },

        findVariantsInCache: (variantIds: string[]): any[] => {
            return variantIds.map((id) => this.findVariantInCache(id)).filter(Boolean)
        },

        getCacheStats: () => {
            const queryCache = queryClient.getQueryCache()
            const allQueries = queryCache.getAll()
            const variantQueries = allQueries.filter(
                (q) => q.queryKey[0] === "variants-priority" || q.queryKey[0] === "variant",
            )

            return {
                totalQueries: allQueries.length,
                variantQueries: variantQueries.length,
                bulkQueries: variantQueries.filter((q) => q.queryKey[0] === "variants-priority")
                    .length,
                individualQueries: variantQueries.filter((q) => q.queryKey[0] === "variant").length,
                cacheSize: variantQueries.reduce((acc, q) => {
                    const data = q.state.data as any
                    return acc + (data?.variants?.length || (data ? 1 : 0))
                }, 0),
            }
        },
    }
})

// Cache invalidation actions atom
export const cacheInvalidationAtom = atom(
    null,
    (
        get,
        set,
        action: {
            type: "invalidateApp" | "invalidateVariant" | "invalidateRevision" | "invalidateAll"
            appId?: string
            variantId?: string
            revisionId?: string
        },
    ) => {
        const queryClient = get(queryClientAtom)

        switch (action.type) {
            case "invalidateApp":
                if (action.appId) {
                    queryClient.invalidateQueries({queryKey: ["variants-priority", action.appId]})
                }
                break

            case "invalidateVariant":
                if (action.variantId) {
                    queryClient.invalidateQueries({queryKey: ["variant", action.variantId]})
                    // Also invalidate any bulk queries that might contain this variant
                    queryClient.invalidateQueries({queryKey: ["variants-priority"]})
                }
                break

            case "invalidateRevision":
                if (action.revisionId) {
                    queryClient.invalidateQueries({queryKey: ["revision", action.revisionId]})
                    // Also invalidate parent variant and bulk queries
                    queryClient.invalidateQueries({queryKey: ["variants-priority"]})
                }
                break

            case "invalidateAll":
                queryClient.invalidateQueries({queryKey: ["variants-priority"]})
                queryClient.invalidateQueries({queryKey: ["variant"]})
                queryClient.invalidateQueries({queryKey: ["revision"]})
                break
        }
    },
)

// Cache preloading atom for background prefetching
export const cachePreloadAtom = atom(
    null,
    (
        get,
        set,
        action: {
            type: "preloadVariant" | "preloadRevision"
            id: string
            appId?: string
        },
    ) => {
        const queryClient = get(queryClientAtom)
        const cacheFinder = get(cacheFinderAtom)

        switch (action.type) {
            case "preloadVariant":
                // Only preload if not already in cache
                if (!cacheFinder.findVariantInCache(action.id)) {
                    queryClient.prefetchQuery({
                        queryKey: ["variant", action.id],
                        queryFn: () =>
                            import("../api/variants").then((api) =>
                                api.fetchVariantById(action.id),
                            ),
                        staleTime: 1000 * 60,
                    })
                }
                break

            case "preloadRevision":
                if (!cacheFinder.findRevisionInCache(action.id)) {
                    queryClient.prefetchQuery({
                        queryKey: ["revision", action.id],
                        queryFn: () =>
                            import("../api/variants").then((api) =>
                                api.fetchRevisionById(action.id),
                            ),
                        staleTime: 1000 * 60,
                    })
                }
                break
        }
    },
)
