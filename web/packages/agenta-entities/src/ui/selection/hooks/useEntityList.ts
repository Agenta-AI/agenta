/**
 * useEntityList Hook
 *
 * Primitive hook for fetching and filtering entity lists.
 * Works with both static atoms and atomFamily patterns.
 */

import {useMemo, useCallback} from "react"

import {useAtomValue, useSetAtom, Atom} from "jotai"

import {searchTermFamily, setSearchTermFamily} from "../state/selectionState"
import type {ListQueryState} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export interface UseEntityListOptions<T> {
    /**
     * Atom returning the list query state
     */
    listAtom: Atom<ListQueryState<T>>

    /**
     * Instance ID for search term management
     */
    instanceId: string

    /**
     * Custom filter function (applied after search)
     */
    filterFn?: (items: T[], searchTerm: string) => T[]

    /**
     * Field to use for default search filtering
     */
    searchField?: keyof T

    /**
     * Minimum search term length before filtering
     * @default 0
     */
    minSearchLength?: number
}

export interface UseEntityListResult<T> {
    /**
     * Filtered items
     */
    items: T[]

    /**
     * All items (unfiltered)
     */
    allItems: T[]

    /**
     * Loading state
     */
    isLoading: boolean

    /**
     * Error state
     */
    error: Error | null

    /**
     * Current search term
     */
    searchTerm: string

    /**
     * Update search term
     */
    setSearchTerm: (term: string) => void

    /**
     * Clear search term
     */
    clearSearch: () => void

    /**
     * Whether the list is empty (after filtering)
     */
    isEmpty: boolean

    /**
     * Whether there are items but none match the search
     */
    hasNoMatches: boolean
}

// ============================================================================
// DEFAULT FILTER
// ============================================================================

/**
 * Default search filter - case insensitive string matching
 */
function defaultFilter<T>(items: T[], searchTerm: string, searchField?: keyof T): T[] {
    if (!searchTerm.trim()) return items

    const term = searchTerm.toLowerCase().trim()

    return items.filter((item) => {
        if (searchField && item[searchField] != null) {
            return String(item[searchField]).toLowerCase().includes(term)
        }

        // Fallback: search in stringified object
        return JSON.stringify(item).toLowerCase().includes(term)
    })
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for fetching and filtering entity lists
 *
 * @example
 * ```typescript
 * const { items, isLoading, searchTerm, setSearchTerm } = useEntityList({
 *   listAtom: appRevision.selectors.apps,
 *   instanceId: 'selector-1',
 *   searchField: 'app_name',
 * })
 * ```
 */
export function useEntityList<T>(options: UseEntityListOptions<T>): UseEntityListResult<T> {
    const {listAtom, instanceId, filterFn, searchField, minSearchLength = 0} = options

    // Get list data from atom
    const queryState = useAtomValue(listAtom)

    // Get search state
    const searchTermAtom = useMemo(() => searchTermFamily(instanceId), [instanceId])
    const setSearchTermAtom = useMemo(() => setSearchTermFamily(instanceId), [instanceId])

    const searchTerm = useAtomValue(searchTermAtom)
    const dispatchSetSearchTerm = useSetAtom(setSearchTermAtom)

    // Derive state from query
    const {data, isPending, isError, error} = useMemo(() => {
        // Handle different query state shapes
        if ("data" in queryState) {
            return {
                data: (queryState.data as T[]) ?? [],
                isPending: (queryState as {isPending?: boolean}).isPending ?? false,
                isError: (queryState as {isError?: boolean}).isError ?? false,
                error: (queryState as {error?: Error | null}).error ?? null,
            }
        }

        // Direct array (for simple atoms)
        if (Array.isArray(queryState)) {
            return {
                data: queryState as T[],
                isPending: false,
                isError: false,
                error: null,
            }
        }

        return {data: [], isPending: false, isError: false, error: null}
    }, [queryState])

    // Filter items
    const filteredItems = useMemo(() => {
        if (searchTerm.length < minSearchLength) return data

        if (filterFn) {
            return filterFn(data, searchTerm)
        }

        return defaultFilter(data, searchTerm, searchField)
    }, [data, searchTerm, filterFn, searchField, minSearchLength])

    // Actions
    const setSearchTerm = useCallback(
        (term: string) => {
            dispatchSetSearchTerm(term)
        },
        [dispatchSetSearchTerm],
    )

    const clearSearch = useCallback(() => {
        dispatchSetSearchTerm("")
    }, [dispatchSetSearchTerm])

    return {
        items: filteredItems,
        allItems: data,
        isLoading: isPending,
        error: isError ? error : null,
        searchTerm,
        setSearchTerm,
        clearSearch,
        isEmpty: filteredItems.length === 0,
        hasNoMatches: data.length > 0 && filteredItems.length === 0,
    }
}
