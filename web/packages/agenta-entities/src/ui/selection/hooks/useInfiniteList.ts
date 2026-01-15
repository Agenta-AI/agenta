/**
 * useInfiniteList Hook
 *
 * Manages paginated/infinite list state for entity selection.
 * Supports cursor-based and offset-based pagination with search integration.
 */

import {useMemo, useCallback, useState, useEffect, useRef} from "react"

import {useAtomValue, useSetAtom, Atom} from "jotai"

import {searchTermFamily, setSearchTermFamily} from "../state/selectionState"
import type {PaginatedListQueryState, PaginationParams, PaginationInfo} from "../types"

// ============================================================================
// TYPES
// ============================================================================

export interface UseInfiniteListOptions<T> {
    /**
     * Atom factory returning paginated query state
     * Called with pagination params to get the atom for that page
     */
    listAtomFactory: (params: PaginationParams) => Atom<PaginatedListQueryState<T>>

    /**
     * Instance ID for search term management
     */
    instanceId: string

    /**
     * Page size for pagination
     * @default 50
     */
    pageSize?: number

    /**
     * Whether server-side search is supported
     * When true, search term is included in pagination params
     * @default false
     */
    supportsServerSearch?: boolean

    /**
     * Field to use for client-side search filtering
     * Only used when supportsServerSearch is false
     */
    searchField?: keyof T

    /**
     * Custom filter function for client-side filtering
     * Only used when supportsServerSearch is false
     */
    filterFn?: (items: T[], searchTerm: string) => T[]

    /**
     * Minimum search term length before filtering
     * @default 0
     */
    minSearchLength?: number

    /**
     * Debounce delay for search (ms)
     * @default 300
     */
    searchDebounceMs?: number
}

export interface UseInfiniteListResult<T> {
    /**
     * All loaded items (accumulated across pages)
     */
    items: T[]

    /**
     * Filtered items (after client-side search, if applicable)
     */
    filteredItems: T[]

    /**
     * Loading state for initial load
     */
    isLoading: boolean

    /**
     * Loading state for fetching next page
     */
    isFetchingNextPage: boolean

    /**
     * Whether "load all" is in progress
     */
    isLoadingAll: boolean

    /**
     * Whether more pages exist
     */
    hasNextPage: boolean

    /**
     * Fetch the next page of results
     */
    fetchNextPage: () => void

    /**
     * Load all remaining pages (chained execution)
     * Returns a promise that resolves when all pages are loaded
     */
    loadAllPages: () => Promise<void>

    /**
     * Cancel ongoing "load all" operation
     */
    cancelLoadAll: () => void

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
     * Total count of items (if known from server)
     */
    totalCount: number | null

    /**
     * Whether the list is empty (after filtering)
     */
    isEmpty: boolean

    /**
     * Whether there are items but none match the search
     */
    hasNoMatches: boolean

    /**
     * Reset pagination (go back to first page)
     */
    reset: () => void

    /**
     * Current pagination info
     */
    pagination: PaginationInfo
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
// PAGINATION STATE
// ============================================================================

interface PaginationState {
    cursor: string | null
    offset: number
    pages: number // Number of pages loaded
}

const initialPaginationState: PaginationState = {
    cursor: null,
    offset: 0,
    pages: 0,
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing infinite/paginated entity lists
 *
 * @example
 * ```typescript
 * const {
 *   filteredItems,
 *   isLoading,
 *   hasNextPage,
 *   fetchNextPage,
 *   searchTerm,
 *   setSearchTerm,
 * } = useInfiniteList({
 *   listAtomFactory: (params) => testsetsPaginatedAtom(params),
 *   instanceId: 'selector-1',
 *   pageSize: 25,
 *   supportsServerSearch: true,
 * })
 * ```
 */
export function useInfiniteList<T>(options: UseInfiniteListOptions<T>): UseInfiniteListResult<T> {
    const {
        listAtomFactory,
        instanceId,
        pageSize = 50,
        supportsServerSearch = false,
        searchField,
        filterFn,
        minSearchLength = 0,
        searchDebounceMs = 300,
    } = options

    // ========================================================================
    // SEARCH STATE
    // ========================================================================

    const searchTermAtom = useMemo(() => searchTermFamily(instanceId), [instanceId])
    const setSearchTermAtom = useMemo(() => setSearchTermFamily(instanceId), [instanceId])

    const searchTerm = useAtomValue(searchTermAtom)
    const dispatchSetSearchTerm = useSetAtom(setSearchTermAtom)

    // Debounced search term for server queries
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm)

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm)
        }, searchDebounceMs)

        return () => clearTimeout(timer)
    }, [searchTerm, searchDebounceMs])

    // ========================================================================
    // PAGINATION STATE
    // ========================================================================

    const [paginationState, setPaginationState] = useState<PaginationState>(initialPaginationState)
    const [allItems, setAllItems] = useState<T[]>([])

    // Load all state
    const [isLoadingAll, setIsLoadingAll] = useState(false)
    const loadAllCancelledRef = useRef(false)

    // Reset pagination when search term changes (for server search)
    useEffect(() => {
        if (supportsServerSearch) {
            setPaginationState(initialPaginationState)
            setAllItems([])
        }
    }, [debouncedSearchTerm, supportsServerSearch])

    // ========================================================================
    // QUERY
    // ========================================================================

    // Build pagination params
    const paginationParams: PaginationParams = useMemo(
        () => ({
            pageSize,
            cursor: paginationState.cursor,
            offset: paginationState.offset,
            ...(supportsServerSearch && debouncedSearchTerm
                ? {searchTerm: debouncedSearchTerm}
                : {}),
        }),
        [
            pageSize,
            paginationState.cursor,
            paginationState.offset,
            supportsServerSearch,
            debouncedSearchTerm,
        ],
    )

    // Get the atom for current pagination params
    const listAtom = useMemo(
        () => listAtomFactory(paginationParams),
        [listAtomFactory, paginationParams],
    )

    // Read query state
    const queryState = useAtomValue(listAtom)

    // ========================================================================
    // ACCUMULATE ITEMS
    // ========================================================================

    // Accumulate items across pages
    useEffect(() => {
        if (queryState.data && !queryState.isPending) {
            if (paginationState.pages === 0) {
                // First page - replace all items
                setAllItems(queryState.data)
            } else {
                // Subsequent pages - append items
                setAllItems((prev) => {
                    // Dedupe by checking if items already exist
                    const existingIds = new Set(prev.map((item) => JSON.stringify(item)))
                    const newItems = queryState.data!.filter(
                        (item) => !existingIds.has(JSON.stringify(item)),
                    )
                    return [...prev, ...newItems]
                })
            }
        }
    }, [queryState.data, queryState.isPending, paginationState.pages])

    // ========================================================================
    // CLIENT-SIDE FILTERING
    // ========================================================================

    const filteredItems = useMemo(() => {
        // Skip client-side filtering if using server search
        if (supportsServerSearch) return allItems

        // Skip if search term is too short
        if (searchTerm.length < minSearchLength) return allItems

        if (filterFn) {
            return filterFn(allItems, searchTerm)
        }

        return defaultFilter(allItems, searchTerm, searchField)
    }, [allItems, searchTerm, supportsServerSearch, minSearchLength, filterFn, searchField])

    // ========================================================================
    // PAGINATION INFO
    // ========================================================================

    const pagination: PaginationInfo = useMemo(() => {
        const base = queryState.pagination ?? {
            hasNextPage: false,
            nextCursor: null,
            nextOffset: null,
            totalCount: null,
            isFetchingNextPage: false,
        }

        return {
            ...base,
            isFetchingNextPage: queryState.isPending && paginationState.pages > 0,
        }
    }, [queryState.pagination, queryState.isPending, paginationState.pages])

    // ========================================================================
    // ACTIONS
    // ========================================================================

    const fetchNextPage = useCallback(() => {
        if (!pagination.hasNextPage || queryState.isPending) return

        setPaginationState((prev) => ({
            cursor: pagination.nextCursor,
            offset: pagination.nextOffset ?? prev.offset + pageSize,
            pages: prev.pages + 1,
        }))
    }, [
        pagination.hasNextPage,
        pagination.nextCursor,
        pagination.nextOffset,
        queryState.isPending,
        pageSize,
    ])

    /**
     * Load all remaining pages via chained execution.
     * Fetches pages one by one until no more pages exist.
     */
    const loadAllPages = useCallback(async () => {
        if (isLoadingAll || !pagination.hasNextPage) return

        setIsLoadingAll(true)
        loadAllCancelledRef.current = false

        // Create a promise that resolves when loading is complete
        return new Promise<void>((resolve, reject) => {
            const checkAndFetch = () => {
                // Check if cancelled
                if (loadAllCancelledRef.current) {
                    setIsLoadingAll(false)
                    resolve()
                    return
                }

                // Get current state from refs/closure
                if (!pagination.hasNextPage) {
                    setIsLoadingAll(false)
                    resolve()
                    return
                }

                // Trigger next page fetch
                fetchNextPage()
            }

            // Start the chain
            checkAndFetch()

            // Set up an effect-like check by using interval
            // The actual pagination happens through state updates
            const intervalId = setInterval(() => {
                if (loadAllCancelledRef.current || !pagination.hasNextPage) {
                    clearInterval(intervalId)
                    setIsLoadingAll(false)
                    resolve()
                } else if (!queryState.isPending && pagination.hasNextPage) {
                    fetchNextPage()
                }
            }, 100) // Check every 100ms

            // Timeout safety (5 minutes max)
            setTimeout(
                () => {
                    clearInterval(intervalId)
                    setIsLoadingAll(false)
                    reject(new Error("Load all timed out after 5 minutes"))
                },
                5 * 60 * 1000,
            )
        })
    }, [isLoadingAll, pagination.hasNextPage, queryState.isPending, fetchNextPage])

    const cancelLoadAll = useCallback(() => {
        loadAllCancelledRef.current = true
        setIsLoadingAll(false)
    }, [])

    const setSearchTerm = useCallback(
        (term: string) => {
            dispatchSetSearchTerm(term)
        },
        [dispatchSetSearchTerm],
    )

    const clearSearch = useCallback(() => {
        dispatchSetSearchTerm("")
    }, [dispatchSetSearchTerm])

    const reset = useCallback(() => {
        setPaginationState(initialPaginationState)
        setAllItems([])
    }, [])

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    const isLoading = queryState.isPending && paginationState.pages === 0
    const isFetchingNextPage = queryState.isPending && paginationState.pages > 0
    const isEmpty = filteredItems.length === 0
    const hasNoMatches = allItems.length > 0 && filteredItems.length === 0

    return {
        items: allItems,
        filteredItems,
        isLoading,
        isFetchingNextPage,
        isLoadingAll,
        hasNextPage: pagination.hasNextPage,
        fetchNextPage,
        loadAllPages,
        cancelLoadAll,
        error: queryState.isError ? (queryState.error ?? new Error("Unknown error")) : null,
        searchTerm,
        setSearchTerm,
        clearSearch,
        totalCount: pagination.totalCount,
        isEmpty,
        hasNoMatches,
        reset,
        pagination,
    }
}

// ============================================================================
// SIMPLE INFINITE LIST HOOK
// ============================================================================

/**
 * Simplified hook for cases where you just want infinite scroll
 * without search integration
 */
export interface UseSimpleInfiniteListOptions<T> {
    /**
     * Atom factory returning paginated query state
     */
    listAtomFactory: (params: PaginationParams) => Atom<PaginatedListQueryState<T>>

    /**
     * Page size for pagination
     * @default 50
     */
    pageSize?: number
}

export interface UseSimpleInfiniteListResult<T> {
    items: T[]
    isLoading: boolean
    isFetchingNextPage: boolean
    isLoadingAll: boolean
    hasNextPage: boolean
    fetchNextPage: () => void
    loadAllPages: () => Promise<void>
    cancelLoadAll: () => void
    error: Error | null
    totalCount: number | null
    reset: () => void
}

/**
 * Simplified infinite list hook without search
 */
export function useSimpleInfiniteList<T>(
    options: UseSimpleInfiniteListOptions<T>,
): UseSimpleInfiniteListResult<T> {
    const {listAtomFactory, pageSize = 50} = options

    const [paginationState, setPaginationState] = useState<PaginationState>(initialPaginationState)
    const [allItems, setAllItems] = useState<T[]>([])

    // Load all state
    const [isLoadingAll, setIsLoadingAll] = useState(false)
    const loadAllCancelledRef = useRef(false)

    const paginationParams: PaginationParams = useMemo(
        () => ({
            pageSize,
            cursor: paginationState.cursor,
            offset: paginationState.offset,
        }),
        [pageSize, paginationState.cursor, paginationState.offset],
    )

    const listAtom = useMemo(
        () => listAtomFactory(paginationParams),
        [listAtomFactory, paginationParams],
    )
    const queryState = useAtomValue(listAtom)

    // Accumulate items
    useEffect(() => {
        if (queryState.data && !queryState.isPending) {
            if (paginationState.pages === 0) {
                setAllItems(queryState.data)
            } else {
                setAllItems((prev) => {
                    const existingIds = new Set(prev.map((item) => JSON.stringify(item)))
                    const newItems = queryState.data!.filter(
                        (item) => !existingIds.has(JSON.stringify(item)),
                    )
                    return [...prev, ...newItems]
                })
            }
        }
    }, [queryState.data, queryState.isPending, paginationState.pages])

    const pagination = queryState.pagination ?? {
        hasNextPage: false,
        nextCursor: null,
        nextOffset: null,
        totalCount: null,
        isFetchingNextPage: false,
    }

    const fetchNextPage = useCallback(() => {
        if (!pagination.hasNextPage || queryState.isPending) return

        setPaginationState((prev) => ({
            cursor: pagination.nextCursor,
            offset: pagination.nextOffset ?? prev.offset + pageSize,
            pages: prev.pages + 1,
        }))
    }, [
        pagination.hasNextPage,
        pagination.nextCursor,
        pagination.nextOffset,
        queryState.isPending,
        pageSize,
    ])

    /**
     * Load all remaining pages via chained execution
     */
    const loadAllPages = useCallback(async () => {
        if (isLoadingAll || !pagination.hasNextPage) return

        setIsLoadingAll(true)
        loadAllCancelledRef.current = false

        return new Promise<void>((resolve, reject) => {
            const checkAndFetch = () => {
                if (loadAllCancelledRef.current) {
                    setIsLoadingAll(false)
                    resolve()
                    return
                }

                if (!pagination.hasNextPage) {
                    setIsLoadingAll(false)
                    resolve()
                    return
                }

                fetchNextPage()
            }

            checkAndFetch()

            const intervalId = setInterval(() => {
                if (loadAllCancelledRef.current || !pagination.hasNextPage) {
                    clearInterval(intervalId)
                    setIsLoadingAll(false)
                    resolve()
                } else if (!queryState.isPending && pagination.hasNextPage) {
                    fetchNextPage()
                }
            }, 100)

            setTimeout(
                () => {
                    clearInterval(intervalId)
                    setIsLoadingAll(false)
                    reject(new Error("Load all timed out after 5 minutes"))
                },
                5 * 60 * 1000,
            )
        })
    }, [isLoadingAll, pagination.hasNextPage, queryState.isPending, fetchNextPage])

    const cancelLoadAll = useCallback(() => {
        loadAllCancelledRef.current = true
        setIsLoadingAll(false)
    }, [])

    const reset = useCallback(() => {
        setPaginationState(initialPaginationState)
        setAllItems([])
    }, [])

    return {
        items: allItems,
        isLoading: queryState.isPending && paginationState.pages === 0,
        isFetchingNextPage: queryState.isPending && paginationState.pages > 0,
        isLoadingAll,
        hasNextPage: pagination.hasNextPage,
        fetchNextPage,
        loadAllPages,
        cancelLoadAll,
        error: queryState.isError ? (queryState.error ?? new Error("Unknown error")) : null,
        totalCount: pagination.totalCount,
        reset,
    }
}
