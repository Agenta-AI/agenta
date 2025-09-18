import {useAtomValue, useSetAtom} from "jotai"

import {
    variantTableActionsAtom,
    variantBulkActionsAtom,
    variantSelectionActionsAtom,
    backgroundSyncActionsAtom,
} from "../atoms/actions"
import {cacheInvalidationAtom} from "../atoms/cache"
import {
    variantTableStateAtom,
    variantSelectionStateAtom,
    enhancedVariantStateAtom,
    variantSearchStateAtom,
} from "../atoms/derived"
import {variantByIdAtom, batchVariantsAtom} from "../atoms/queries"

/**
 * React Hooks - Thin wrappers around atoms
 * These provide the React interface while keeping all logic in testable atoms
 */

// Table hooks
export const useVariantTable = (appId: string, windowKey = "default") => {
    const state = useAtomValue(
        variantTableStateAtom({
            appId,
            mode: "windowed",
            windowKey,
        }),
    )
    const actions = useSetAtom(variantTableActionsAtom(windowKey))

    return {
        ...state,
        loadMore: () => actions({type: "loadMore"}),
        reset: () => actions({type: "reset"}),
        refresh: () => actions({type: "refresh"}),
        setPageSize: (pageSize: number) =>
            actions({
                type: "setPageSize",
                payload: {pageSize},
            }),
    }
}

// Selection hooks
export const useVariantSelection = (appId: string) => {
    const state = useAtomValue(variantSelectionStateAtom(appId))
    const actions = useSetAtom(variantSelectionActionsAtom)

    return {
        ...state,
        selectVariant: (variantId: string) =>
            actions({
                type: "selectVariant",
                variantId,
            }),
        selectMultiple: (variantIds: string[]) =>
            actions({
                type: "selectMultiple",
                variantIds,
            }),
        clearSelection: () => actions({type: "clearSelection"}),
        toggleSelection: (variantId: string) =>
            actions({
                type: "toggleSelection",
                variantId,
            }),
    }
}

// Enhanced variant hooks (for playground)
export const useEnhancedVariants = (appId: string) => {
    return useAtomValue(enhancedVariantStateAtom(appId))
}

// Individual variant hooks
export const useVariantById = (variantId: string) => {
    const {data, isLoading, error} = useAtomValue(variantByIdAtom(variantId))

    return {
        variant: data,
        isLoading,
        error,
        fromCache: !isLoading && !error && data !== undefined,
    }
}

// Batch variant hooks
export const useBatchVariants = (variantIds: string[]) => {
    const {data, isLoading, error} = useAtomValue(batchVariantsAtom(variantIds))

    return {
        variants: data || [],
        isLoading,
        error,
        variantMap: (data || []).reduce(
            (acc, v) => ({...acc, [v.id]: v}),
            {} as Record<string, any>,
        ),
    }
}

// Search hooks
export const useVariantSearch = (config: {
    appId: string
    searchTerm?: string
    filters?: Record<string, any>
}) => {
    return useAtomValue(variantSearchStateAtom(config))
}

// Bulk action hooks
export const useVariantBulkActions = () => {
    return useSetAtom(variantBulkActionsAtom)
}

// Cache management hooks
export const useCacheInvalidation = () => {
    return useSetAtom(cacheInvalidationAtom)
}

// Background sync hooks
export const useBackgroundSync = () => {
    return useSetAtom(backgroundSyncActionsAtom)
}

// Convenience hooks for common patterns
export const useVariantTableWithSearch = (
    appId: string,
    windowKey = "default",
    searchConfig?: {searchTerm?: string; filters?: Record<string, any>},
) => {
    const table = useVariantTable(appId, windowKey)
    const search = searchConfig ? useVariantSearch({appId, ...searchConfig}) : null

    return {
        ...table,
        search,
        // If search is active, use search results instead of table variants
        variants: search?.isFiltered ? search.variants : table.variants,
        total: search?.isFiltered ? search.total : table.total,
    }
}

// Deep link aware hooks
export const useDeepLinkedVariant = () => {
    // This would integrate with router to get the currently deep-linked variant
    // For now, return a placeholder
    return {
        variantId: null,
        isDeepLinked: false,
        variant: null,
        isLoading: false,
    }
}
