import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {cacheInvalidationAtom, cachePreloadAtom} from "./cache"
import {windowActionsAtom} from "./window"

/**
 * Action Atoms
 * Pure action atoms for state mutations and side effects
 */

// Table actions atom
export const variantTableActionsAtom = atomFamily((windowKey: string) =>
    atom(
        null,
        (
            get,
            set,
            action: {
                type: "loadMore" | "reset" | "refresh" | "setPageSize"
                payload?: any
            },
        ) => {
            const windowActions = get(windowActionsAtom(windowKey))

            switch (action.type) {
                case "loadMore":
                    set(windowActions, {type: "next"})
                    break

                case "reset":
                    set(windowActions, {type: "reset"})
                    break

                case "refresh":
                    // Reset and invalidate cache
                    set(windowActions, {type: "reset"})
                    const cacheInvalidation = get(cacheInvalidationAtom)
                    set(cacheInvalidation, {type: "invalidateAll"})
                    break

                case "setPageSize":
                    const currentConfig = get(windowConfigAtom(windowKey))
                    set(windowConfigAtom(windowKey), {
                        ...currentConfig,
                        limit: action.payload.pageSize,
                        offset: 0, // Reset to first page
                    })
                    break
            }
        },
    ),
)

// Bulk actions atom
export const variantBulkActionsAtom = atom(
    null,
    (
        get,
        set,
        action: {
            type: "preloadVariants" | "invalidateVariants" | "prefetchNext"
            variantIds?: string[]
            appId?: string
            windowKey?: string
        },
    ) => {
        const cachePreload = get(cachePreloadAtom)
        const cacheInvalidation = get(cacheInvalidationAtom)

        switch (action.type) {
            case "preloadVariants":
                if (action.variantIds) {
                    action.variantIds.forEach((id) => {
                        set(cachePreload, {
                            type: "preloadVariant",
                            id,
                            appId: action.appId,
                        })
                    })
                }
                break

            case "invalidateVariants":
                if (action.variantIds) {
                    action.variantIds.forEach((id) => {
                        set(cacheInvalidation, {
                            type: "invalidateVariant",
                            variantId: id,
                        })
                    })
                } else if (action.appId) {
                    set(cacheInvalidation, {
                        type: "invalidateApp",
                        appId: action.appId,
                    })
                }
                break

            case "prefetchNext":
                if (action.windowKey) {
                    const windowConfig = get(windowConfigAtom(action.windowKey))
                    if (windowConfig.hasMore) {
                        // Prefetch next page in background
                        const nextOffset = windowConfig.offset + windowConfig.limit
                        // This would trigger a background fetch
                        console.log("Prefetching next page at offset:", nextOffset)
                    }
                }
                break
        }
    },
)

// Selection actions atom
export const variantSelectionActionsAtom = atom(
    null,
    (
        get,
        set,
        action: {
            type: "selectVariant" | "selectMultiple" | "clearSelection" | "toggleSelection"
            variantId?: string
            variantIds?: string[]
            selected?: boolean
        },
    ) => {
        // This would integrate with selection state management
        switch (action.type) {
            case "selectVariant":
                if (action.variantId) {
                    // Update URL or selection state
                    console.log("Selecting variant:", action.variantId)
                }
                break

            case "selectMultiple":
                if (action.variantIds) {
                    console.log("Selecting multiple variants:", action.variantIds)
                }
                break

            case "clearSelection":
                console.log("Clearing selection")
                break

            case "toggleSelection":
                if (action.variantId) {
                    console.log("Toggling selection for:", action.variantId)
                }
                break
        }
    },
)

// Background sync actions atom
export const backgroundSyncActionsAtom = atom(
    null,
    (
        get,
        set,
        action: {
            type: "startPolling" | "stopPolling" | "syncNow"
            appId?: string
            interval?: number
        },
    ) => {
        switch (action.type) {
            case "startPolling":
                // Start background polling for updates
                console.log("Starting background sync for app:", action.appId)
                break

            case "stopPolling":
                console.log("Stopping background sync")
                break

            case "syncNow":
                // Force immediate sync
                const cacheInvalidation = get(cacheInvalidationAtom)
                if (action.appId) {
                    set(cacheInvalidation, {
                        type: "invalidateApp",
                        appId: action.appId,
                    })
                }
                break
        }
    },
)
