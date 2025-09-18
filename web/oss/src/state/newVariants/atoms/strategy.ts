import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import * as variantApi from "../api/variants"

import {cacheFinderAtom} from "./cache"
import {deepLinkContextAtom, deepLinkPriorityConfigAtom} from "./deepLink"
import {windowConfigAtom} from "./window"

/**
 * Query Strategy Atoms
 * Pure atoms that orchestrate query logic based on mode, windowing, and deep links
 */

export interface QueryConfig {
    appId: string
    mode: "list" | "windowed" | "enhanced"
    windowKey?: string
}

export interface QueryStrategy {
    queryKey: (string | number | boolean | object)[]
    createQueryFn: () => () => Promise<variantApi.VariantQueryResponse>
    staleTime: number
    enabled: boolean
    refetchOnMount: boolean
    refetchOnWindowFocus: boolean
}

// Pure query orchestration logic
export const variantQueryStrategyAtom = atomFamily((config: QueryConfig) =>
    atom<QueryStrategy>((get) => {
        const {appId, mode, windowKey} = config
        const deepLink = get(deepLinkContextAtom)
        const priorityConfig = get(deepLinkPriorityConfigAtom)
        const windowConfig = windowKey ? get(windowConfigAtom(windowKey)) : null
        const cacheFinder = get(cacheFinderAtom)

        return {
            // Query key includes all relevant state
            queryKey: (() => {
                const key: (string | number | boolean | object)[] = [
                    "variants-priority",
                    appId,
                    mode,
                ]
                if (windowConfig) {
                    key.push({offset: windowConfig.offset, limit: windowConfig.limit})
                }
                if (deepLink.priorityIds?.length) {
                    key.push(deepLink.priorityIds.slice().sort())
                }
                return key
            })(),

            // Query function factory
            createQueryFn: () => async (): Promise<variantApi.VariantQueryResponse> => {
                // Check cache first for priority items
                const cachedPriorityItems = deepLink.priorityIds
                    .map((id) => cacheFinder.findVariantInCache(id))
                    .filter(Boolean)

                const uncachedPriorityIds = deepLink.priorityIds.filter(
                    (id) => !cacheFinder.findVariantInCache(id),
                )

                // Fetch strategy
                const promises: Promise<any>[] = []

                // 1. Fetch uncached priority items first
                if (uncachedPriorityIds.length > 0) {
                    promises.push(variantApi.fetchPriorityVariants(appId, uncachedPriorityIds))
                }

                // 2. Fetch regular data based on mode
                const regularDataPromise = (() => {
                    const options: variantApi.VariantQueryOptions = {
                        exclude_ids: deepLink.priorityIds, // Don't duplicate priority items
                    }

                    switch (mode) {
                        case "list":
                            return variantApi.fetchAppVariants(appId, options)

                        case "windowed":
                            if (!windowConfig)
                                throw new Error("Window config required for windowed mode")
                            return variantApi.fetchVariantsWindowed(appId, {
                                ...options,
                                offset: windowConfig.offset,
                                limit: windowConfig.limit,
                            })

                        case "enhanced":
                            return variantApi.fetchVariantsEnhanced(appId, {
                                ...options,
                            })

                        default:
                            throw new Error(`Unknown mode: ${mode}`)
                    }
                })()

                promises.push(regularDataPromise)

                // Execute all fetches
                const results = await Promise.all(promises)
                const [priorityData, regularData] =
                    results.length === 2 ? [results[0], results[1]] : [[], results[0]]

                // Merge results
                const allPriorityItems = [
                    ...cachedPriorityItems,
                    ...(Array.isArray(priorityData) ? priorityData : []),
                ]

                const regularVariants = regularData?.variants || []

                return {
                    variants: [...allPriorityItems, ...regularVariants],
                    total: (regularData?.total || 0) + allPriorityItems.length,
                    has_more: regularData?.has_more || false,
                    next_offset: regularData?.next_offset,
                    hasPriorityItems: allPriorityItems.length > 0,
                    priorityCount: allPriorityItems.length,
                }
            },

            // Configuration from priority config
            staleTime: priorityConfig.staleTime,
            enabled: !!appId,
            refetchOnMount: priorityConfig.refetchOnMount,
            refetchOnWindowFocus: priorityConfig.refetchOnWindowFocus,
        }
    }),
)

// Individual variant strategy atom
export const individualVariantStrategyAtom = atomFamily((variantId: string) =>
    atom((get) => {
        const cacheFinder = get(cacheFinderAtom)

        return {
            queryKey: ["variant", variantId],
            createQueryFn: () => async () => {
                // Check cache first
                const cached = cacheFinder.findVariantInCache(variantId)
                if (cached) return cached

                // Fetch individually if not in cache
                return variantApi.fetchVariantById(variantId)
            },
            initialData: () => cacheFinder.findVariantInCache(variantId),
            staleTime: 1000 * 60,
            enabled: !!variantId,
        }
    }),
)

// Batch strategy for multiple individual variants
export const batchVariantStrategyAtom = atomFamily((variantIds: string[]) =>
    atom((get) => {
        const cacheFinder = get(cacheFinderAtom)

        return {
            queryKey: ["variants-batch", variantIds.sort()],
            createQueryFn: () => async () => {
                // Check which ones are already cached
                const cached = variantIds
                    .map((id) => ({id, variant: cacheFinder.findVariantInCache(id)}))
                    .filter((item) => item.variant)

                const uncachedIds = variantIds.filter((id) => !cacheFinder.findVariantInCache(id))

                // Fetch uncached ones
                const uncached =
                    uncachedIds.length > 0
                        ? await Promise.all(
                              uncachedIds.map((id) => variantApi.fetchVariantById(id)),
                          )
                        : []

                // Combine and maintain order
                return variantIds
                    .map((id) => {
                        const cachedItem = cached.find((item) => item.id === id)
                        if (cachedItem) return cachedItem.variant

                        return uncached.find((variant) => variant && variant.id === id)
                    })
                    .filter(Boolean)
            },
            staleTime: 1000 * 60,
            enabled: variantIds.length > 0,
        }
    }),
)
