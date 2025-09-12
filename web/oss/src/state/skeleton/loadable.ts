/**
 * Enhanced Loadable Atoms with Skeleton Data
 *
 * Provides loadable atoms that return skeleton data during loading states
 * for immediate UI rendering and better perceived performance
 */

import deepEqual from "fast-deep-equal"
import {atom, Atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery, AtomWithQueryOptions} from "jotai-tanstack-query"

import {wrapWithSkeletonMeta, createSkeletonMetadata} from "./generators"
import {
    SkeletonData,
    SkeletonConfig,
    SkeletonGenerator,
    LoadingState,
    IncrementalUpdateConfig,
} from "./types"

/**
 * Creates a query atom that returns skeleton data during loading
 */
export function atomWithSkeletonQuery<TData, TError = Error>(
    queryOptions: AtomWithQueryOptions<TData, TError>,
    skeletonGenerator: SkeletonGenerator<TData>,
    config: SkeletonConfig = {},
) {
    const baseQueryAtom = atomWithQuery(queryOptions)

    return eagerAtom((get) => {
        const queryResult = get(baseQueryAtom)

        if (queryResult.isLoading && !queryResult.data) {
            // Return skeleton data during initial loading
            const skeletonData = skeletonGenerator(config)
            return wrapWithSkeletonMeta(skeletonData, {
                loadingStage: "initial",
                priority: config.priority || "medium",
            })
        }

        if (queryResult.isError) {
            // Return skeleton data during error states for graceful degradation
            const skeletonData = skeletonGenerator({...config, count: 1})
            return wrapWithSkeletonMeta(skeletonData, {
                loadingStage: "initial",
                priority: "low",
            })
        }

        if (queryResult.data) {
            // Return real data wrapped with completion metadata
            return wrapWithSkeletonMeta(queryResult.data, {
                isSkeleton: false,
                loadingStage: "complete",
                priority: "high",
                timestamp: Date.now(),
            })
        }

        // Fallback to skeleton data
        const skeletonData = skeletonGenerator(config)
        return wrapWithSkeletonMeta(skeletonData, {
            loadingStage: "initial",
            priority: config.priority || "medium",
        })
    })
}

/**
 * Creates a loadable atom that provides skeleton data during loading
 */
export function skeletonLoadableAtom<T>(
    sourceAtom: Atom<any>,
    skeletonGenerator: SkeletonGenerator<T>,
    config: SkeletonConfig = {},
) {
    return eagerAtom((get) => {
        try {
            const data = get(sourceAtom)

            // Check if source is still loading
            if (data?.isLoading || data?.isPending) {
                const skeletonData = skeletonGenerator(config)
                return wrapWithSkeletonMeta(skeletonData, {
                    loadingStage: "initial",
                    priority: config.priority || "medium",
                })
            }

            // Check if source has error
            if (data?.isError || data?.error) {
                const skeletonData = skeletonGenerator({...config, count: 1})
                return wrapWithSkeletonMeta(skeletonData, {
                    loadingStage: "initial",
                    priority: "low",
                })
            }

            // Return real data if available
            if (data?.data || Array.isArray(data)) {
                const realData = data?.data || data
                return wrapWithSkeletonMeta(realData, {
                    isSkeleton: false,
                    loadingStage: "complete",
                    priority: "high",
                    timestamp: Date.now(),
                })
            }

            // Fallback to skeleton
            const skeletonData = skeletonGenerator(config)
            return wrapWithSkeletonMeta(skeletonData, {
                loadingStage: "initial",
                priority: config.priority || "medium",
            })
        } catch (error) {
            // Error handling - return skeleton data
            const skeletonData = skeletonGenerator({...config, count: 1})
            return wrapWithSkeletonMeta(skeletonData, {
                loadingStage: "initial",
                priority: "low",
            })
        }
    })
}

/**
 * Creates an incremental loading atom that merges partial data with skeleton
 */
export function incrementalLoadingAtom<T>(
    primaryAtom: Atom<any>,
    secondaryAtoms: Atom<any>[],
    skeletonGenerator: SkeletonGenerator<T>,
    mergeConfig: IncrementalUpdateConfig = {},
) {
    return eagerAtom((get) => {
        const primary = get(primaryAtom)
        const {preserveSkeletonStructure = true, mergeStrategy = "merge"} = mergeConfig

        // Start with skeleton data
        let result = skeletonGenerator({count: 5, realisticValues: true})
        let loadingStage: "initial" | "partial" | "complete" = "initial"
        let loadedCount = 0

        // Check primary data
        if (primary?.data && !primary.isLoading) {
            result = primary.data
            loadingStage = "partial"
            loadedCount++
        }

        // Incrementally merge secondary data
        secondaryAtoms.forEach((atom) => {
            try {
                const secondary = get(atom)
                if (secondary?.data && !secondary.isLoading) {
                    if (mergeStrategy === "merge" && Array.isArray(result)) {
                        // Merge additional data into existing structure
                        result = mergePartialData(result, secondary.data, preserveSkeletonStructure)
                    }
                    loadedCount++
                }
            } catch (error) {
                // Continue with partial data if secondary fails
            }
        })

        // Determine final loading stage
        if (loadedCount === 0) {
            loadingStage = "initial"
        } else if (loadedCount < secondaryAtoms.length + 1) {
            loadingStage = "partial"
        } else {
            loadingStage = "complete"
        }

        return wrapWithSkeletonMeta(result, {
            isSkeleton: loadingStage !== "complete",
            loadingStage,
            priority: loadingStage === "complete" ? "high" : "medium",
            timestamp: Date.now(),
        })
    })
}

/**
 * Creates a loading state atom from skeleton data
 */
export function skeletonLoadingStateAtom<T>(
    skeletonDataAtom: Atom<SkeletonData<T>>,
): Atom<LoadingState> {
    return selectAtom(
        skeletonDataAtom,
        (skeletonData) => ({
            isLoading: skeletonData.meta.isSkeleton,
            isSkeleton: skeletonData.meta.isSkeleton,
            loadingStage: skeletonData.meta.loadingStage,
            progress: calculateProgress(skeletonData.meta.loadingStage),
        }),
        deepEqual,
    )
}

/**
 * Utility to merge partial data with skeleton structure
 */
function mergePartialData<T>(
    skeletonData: T[],
    partialData: Partial<T>[],
    preserveStructure: boolean,
): T[] {
    if (!preserveStructure) {
        return partialData as T[]
    }

    // Merge partial data into skeleton structure
    return skeletonData.map((skeleton, index) => {
        const partial = partialData[index]
        if (partial) {
            return {...skeleton, ...partial}
        }
        return skeleton
    })
}

/**
 * Calculate loading progress based on stage
 */
function calculateProgress(stage: "initial" | "partial" | "complete"): number {
    switch (stage) {
        case "initial":
            return 0
        case "partial":
            return 50
        case "complete":
            return 100
        default:
            return 0
    }
}
