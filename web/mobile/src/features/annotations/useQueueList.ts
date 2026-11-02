import {useCallback, useEffect, useMemo} from "react"

import {useInfiniteTablePagination} from "@agenta/entities/shared"
import {
    simpleQueueKindFilterAtom,
    simpleQueuePaginatedStore,
    simpleQueueSearchTermAtom,
    type SimpleQueueTableRow,
} from "@agenta/entities/simpleQueue"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

const SCOPE_ID = "annotation-queues"
const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 300

export type QueueKindFilter = "traces" | "testcases" | null

/**
 * The queues list: pages of 50, newest first, with the name search and the type filter.
 * The store keeps only default queues of kind traces or test cases.
 */
export const useQueueList = () => {
    const [kind, setKind] = useAtom(simpleQueueKindFilterAtom)
    const searchTerm = useAtomValue(simpleQueueSearchTermAtom)
    const setSearchTerm = useSetAtom(simpleQueueSearchTermAtom)
    const searchBox = useDebouncedAtomSearch(setSearchTerm, SEARCH_DELAY_MS, searchTerm)

    const {rows, paginationInfo, loadNextPage, resetPages, isError, refetch} =
        useInfiniteTablePagination<SimpleQueueTableRow>({
            store: simpleQueuePaginatedStore.store.store,
            scopeId: SCOPE_ID,
            pageSize: PAGE_SIZE,
        })

    // A new search or type starts again from the first page. Pages loaded under the old
    // filter would otherwise stay in the list.
    useEffect(() => {
        resetPages()
    }, [searchTerm, kind, resetPages])

    const loaded = useMemo(() => rows.filter((row) => !row.__isSkeleton), [rows])
    const {hasMore, isFetching} = paginationInfo

    const loadMore = useCallback(() => {
        if (!isError) loadNextPage()
    }, [isError, loadNextPage])

    return {
        rows: loaded,
        isLoading: isFetching && loaded.length === 0 && !isError,
        isError,
        hasMore,
        isLoadingMore: isFetching && loaded.length > 0,
        loadMore,
        refetch,
        search: searchBox.value,
        setSearch: searchBox.onChange,
        /** The term the server filters by. It trails `search` by the debounce. */
        appliedSearch: searchTerm,
        clearSearch: searchBox.reset,
        kind: (kind === "traces" || kind === "testcases" ? kind : null) as QueueKindFilter,
        setKind: (next: QueueKindFilter) => setKind(next),
    }
}
