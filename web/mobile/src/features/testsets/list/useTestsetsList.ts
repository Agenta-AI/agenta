import {queryTestsetsPage} from "@agenta/entities/testset"
import {message} from "@agenta/ui/app-message"
import {useInfiniteQuery} from "@tanstack/react-query"

export const TESTSETS_PAGE_SIZE = 50

export const testsetsListQueryKey = (projectId: string, search: string, createdAfter?: string) =>
    ["testsets", "list", projectId, search.trim(), createdAfter ?? null] as const

interface UseTestsetsListParams {
    projectId: string
    search: string
    /** Only test sets created at or after this ISO time. */
    createdAfter?: string
}

/**
 * Paged testset list for one project, filtered by name and, optionally, by creation date.
 * Errors reach the caller as `isError`. They never turn into an empty list.
 * The caller debounces `search`; this hook does not.
 */
export function useTestsetsList({projectId, search, createdAfter}: UseTestsetsListParams) {
    const enabled = Boolean(projectId)
    const name = search.trim() || undefined

    const query = useInfiniteQuery({
        queryKey: testsetsListQueryKey(projectId, search, createdAfter),
        queryFn: ({pageParam}) =>
            queryTestsetsPage({
                projectId,
                limit: TESTSETS_PAGE_SIZE,
                cursor: pageParam,
                name,
                createdAfter,
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        enabled,
        retry: false,
    })

    const {hasNextPage, isFetchingNextPage, fetchNextPage, refetch} = query

    const loadMore = () => {
        if (!hasNextPage || isFetchingNextPage) return
        void fetchNextPage().then((result) => {
            if (result.isError) message.error("Couldn't load more test sets")
        })
    }

    return {
        testsets: query.data?.pages.flatMap((page) => page.testsets) ?? [],
        isPending: enabled && query.isPending,
        isError: query.isError,
        refetch: () => {
            void refetch()
        },
        hasMore: hasNextPage,
        loadMore,
        isLoadingMore: isFetchingNextPage,
        // True from a failed next page until a later one loads.
        loadMoreFailed: query.isFetchNextPageError,
    }
}
