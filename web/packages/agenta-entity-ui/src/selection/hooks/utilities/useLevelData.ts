/**
 * useLevelData Utility
 *
 * Unified data fetching logic for hierarchy levels.
 * Handles both static atoms and atom families based on configuration.
 *
 * Used by both cascading and hierarchical selection modes.
 */

import {useEffect, useMemo} from "react"

import {filterItems as sharedFilterItems} from "@agenta/shared/utils"
import {atom, useAtomValue, type Atom} from "jotai"

import type {
    HierarchyLevel,
    ListQueryState,
    PaginatedListQueryState,
    PaginationParams,
} from "../../types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query state returned by level data hooks
 */
export interface LevelQueryState {
    /** Whether query is loading */
    isPending: boolean
    /** Whether query has error */
    isError: boolean
    /** Error object if any */
    error: Error | null
}

/**
 * Result from useLevelData hook
 */
export interface UseLevelDataResult<T = unknown> {
    /** Items at this level */
    items: T[]
    /** Query state */
    query: LevelQueryState
}

/**
 * Options for useLevelData hook
 */
export interface UseLevelDataOptions<T = unknown> {
    /** Level configuration */
    levelConfig: HierarchyLevel<T>
    /** Parent ID (null for root level) */
    parentId: string | null
    /** Whether this level is enabled (parent has selection) */
    isEnabled: boolean
}

/**
 * Options for paginated data fetching
 */
export interface UsePaginatedLevelDataOptions<T = unknown> extends UseLevelDataOptions<T> {
    /** Pagination parameters */
    paginationParams: PaginationParams
}

/**
 * Result from paginated level data hook
 */
export interface UsePaginatedLevelDataResult<T = unknown> extends UseLevelDataResult<T> {
    /** Pagination info from server */
    hasNextPage: boolean
    /** Whether fetching next page */
    isFetchingNextPage: boolean
    /** Total count if available */
    totalCount: number | null
    /** Next cursor for pagination */
    nextCursor: string | null
    /** Next offset for pagination */
    nextOffset: number | null
}

// ============================================================================
// EMPTY ATOMS
// ============================================================================

const emptyListAtom = atom<ListQueryState<unknown>>({
    data: [],
    isPending: false,
    isError: false,
    error: null,
})

const emptyPaginatedAtom = atom<PaginatedListQueryState<unknown>>({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    pagination: {
        hasNextPage: false,
        nextCursor: null,
        nextOffset: null,
        totalCount: null,
        isFetchingNextPage: false,
    },
})

// ============================================================================
// HOOK: useLevelData
// ============================================================================

/**
 * Hook to fetch data for a hierarchy level.
 *
 * Resolves the appropriate atom (static or family) based on configuration
 * and parent ID. Handles the onBeforeLoad callback for lazy queries.
 *
 * @example
 * ```typescript
 * const { items, query } = useLevelData({
 *     levelConfig: hierarchyLevels[0],
 *     parentId: null, // Root level
 *     isEnabled: true,
 * })
 *
 * // For child levels
 * const { items, query } = useLevelData({
 *     levelConfig: hierarchyLevels[1],
 *     parentId: selectedAppId,
 *     isEnabled: !!selectedAppId,
 * })
 * ```
 */
export function useLevelData<T = unknown>(options: UseLevelDataOptions<T>): UseLevelDataResult<T> {
    const {levelConfig, parentId, isEnabled} = options

    // Resolve the appropriate list atom
    const listAtom = useMemo((): Atom<ListQueryState<T>> => {
        if (!isEnabled) {
            return emptyListAtom as Atom<ListQueryState<T>>
        }

        // For root level, use static listAtom
        if (levelConfig.listAtom && !parentId) {
            return levelConfig.listAtom as Atom<ListQueryState<T>>
        }

        // For child levels, use atom family with parentId
        if (levelConfig.listAtomFamily && parentId) {
            return levelConfig.listAtomFamily(parentId) as Atom<ListQueryState<T>>
        }

        // Fallback to static atom if available (even for non-root)
        if (levelConfig.listAtom) {
            return levelConfig.listAtom as Atom<ListQueryState<T>>
        }

        // Return empty atom if no data source configured
        return emptyListAtom as Atom<ListQueryState<T>>
    }, [levelConfig, parentId, isEnabled])

    // Subscribe to the atom
    const queryState = useAtomValue(listAtom)

    // Call onBeforeLoad if needed (for lazy-enabled queries)
    useEffect(() => {
        if (isEnabled && parentId && levelConfig.onBeforeLoad) {
            levelConfig.onBeforeLoad(parentId)
        }
    }, [isEnabled, parentId, levelConfig])

    // Apply filterItems if configured
    const filteredItems = useMemo(() => {
        const rawItems = (queryState.data ?? []) as T[]
        if (levelConfig.filterItems) {
            return rawItems.filter(levelConfig.filterItems)
        }
        return rawItems
    }, [queryState.data, levelConfig.filterItems])

    return {
        items: filteredItems,
        query: {
            isPending: queryState.isPending,
            isError: queryState.isError,
            error: queryState.error ?? null,
        },
    }
}

// ============================================================================
// HOOK: usePaginatedLevelData
// ============================================================================

/**
 * Hook to fetch paginated data for a hierarchy level.
 *
 * Similar to useLevelData but uses paginated atoms and returns
 * pagination metadata for infinite scroll support.
 *
 * @example
 * ```typescript
 * const { items, query, hasNextPage } = usePaginatedLevelData({
 *     levelConfig: hierarchyLevels[0],
 *     parentId: null,
 *     isEnabled: true,
 *     paginationParams: {
 *         pageSize: 50,
 *         cursor: null,
 *         offset: 0,
 *     },
 * })
 * ```
 */
export function usePaginatedLevelData<T = unknown>(
    options: UsePaginatedLevelDataOptions<T>,
): UsePaginatedLevelDataResult<T> {
    const {levelConfig, parentId, isEnabled, paginationParams} = options

    // Check if level supports pagination
    const supportsPagination = !!(
        levelConfig.paginatedListAtom || levelConfig.paginatedListAtomFamily
    )

    // Resolve the appropriate paginated atom
    const paginatedAtom = useMemo((): Atom<PaginatedListQueryState<T>> => {
        if (!isEnabled || !supportsPagination) {
            return emptyPaginatedAtom as Atom<PaginatedListQueryState<T>>
        }

        // For root level with pagination
        if (levelConfig.paginatedListAtom && !parentId) {
            return levelConfig.paginatedListAtom(paginationParams) as Atom<
                PaginatedListQueryState<T>
            >
        }

        // For child levels with pagination
        if (levelConfig.paginatedListAtomFamily && parentId) {
            return levelConfig.paginatedListAtomFamily(parentId, paginationParams) as Atom<
                PaginatedListQueryState<T>
            >
        }

        // Fallback
        if (levelConfig.paginatedListAtom) {
            return levelConfig.paginatedListAtom(paginationParams) as Atom<
                PaginatedListQueryState<T>
            >
        }

        return emptyPaginatedAtom as Atom<PaginatedListQueryState<T>>
    }, [levelConfig, parentId, isEnabled, supportsPagination, paginationParams])

    // Subscribe to the atom
    const queryState = useAtomValue(paginatedAtom)

    // Call onBeforeLoad if needed
    useEffect(() => {
        if (isEnabled && parentId && levelConfig.onBeforeLoad) {
            levelConfig.onBeforeLoad(parentId)
        }
    }, [isEnabled, parentId, levelConfig])

    const pagination = queryState.pagination ?? {
        hasNextPage: false,
        nextCursor: null,
        nextOffset: null,
        totalCount: null,
        isFetchingNextPage: false,
    }

    // Apply filterItems if configured
    const filteredItems = useMemo(() => {
        const rawItems = (queryState.data ?? []) as T[]
        if (levelConfig.filterItems) {
            return rawItems.filter(levelConfig.filterItems)
        }
        return rawItems
    }, [queryState.data, levelConfig.filterItems])

    return {
        items: filteredItems,
        query: {
            isPending: queryState.isPending,
            isError: queryState.isError,
            error: queryState.error ?? null,
        },
        hasNextPage: pagination.hasNextPage,
        isFetchingNextPage: pagination.isFetchingNextPage,
        totalCount: pagination.totalCount,
        nextCursor: pagination.nextCursor,
        nextOffset: pagination.nextOffset,
    }
}

// ============================================================================
// UTILITY: resolveListAtom
// ============================================================================

/**
 * Utility function to resolve the appropriate list atom without hooks.
 *
 * Useful for building atoms in memoization functions.
 *
 * @example
 * ```typescript
 * const listAtom = useMemo(() =>
 *     resolveListAtom(levelConfig, parentId, isEnabled),
 *     [levelConfig, parentId, isEnabled]
 * )
 * ```
 */
export function resolveListAtom<T = unknown>(
    levelConfig: HierarchyLevel<T> | null,
    parentId: string | null,
    isEnabled: boolean,
): Atom<ListQueryState<T>> {
    if (!isEnabled || !levelConfig) {
        return emptyListAtom as Atom<ListQueryState<T>>
    }

    // For root level, use static listAtom
    if (levelConfig.listAtom && !parentId) {
        return levelConfig.listAtom as Atom<ListQueryState<T>>
    }

    // For child levels, use atom family with parentId
    if (levelConfig.listAtomFamily && parentId) {
        return levelConfig.listAtomFamily(parentId) as Atom<ListQueryState<T>>
    }

    // Fallback to static atom
    if (levelConfig.listAtom) {
        return levelConfig.listAtom as Atom<ListQueryState<T>>
    }

    return emptyListAtom as Atom<ListQueryState<T>>
}

// ============================================================================
// UTILITY: filterItems
// ============================================================================

/**
 * Default client-side filtering function.
 *
 * Searches all JSON-stringified values for the search term.
 * For better performance with large datasets, use server-side search.
 *
 * @example
 * ```typescript
 * const filteredItems = filterItems(items, searchTerm)
 * ```
 */
/**
 * Create a custom filter function using levelConfig's getLabel.
 *
 * More performant than JSON.stringify for large items.
 *
 * @example
 * ```typescript
 * const filter = createLabelFilter(levelConfig)
 * const filteredItems = filter(items, searchTerm)
 * ```
 */
export function createLabelFilter<T>(
    levelConfig: HierarchyLevel<T>,
): (items: T[], searchTerm: string) => T[] {
    return (items: T[], searchTerm: string): T[] =>
        sharedFilterItems(items, searchTerm, levelConfig.getLabel)
}

export {sharedFilterItems as filterItems}
