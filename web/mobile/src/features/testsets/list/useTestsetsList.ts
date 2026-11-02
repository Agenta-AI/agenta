import {queryTestsetsPage} from "@agenta/entities/testset"
import {useInfiniteQuery} from "@tanstack/react-query"

export const TESTSETS_PAGE_SIZE = 50

export const testsetsListQueryKey = (projectId: string, search: string) =>
    ["testsets", "list", projectId, search.trim()] as const

interface UseTestsetsListParams {
    projectId: string
    search: string
}

/**
 * Paged testset list for one project, filtered by name.
 * Errors reach the caller as `isError`. They never turn into an empty list.
 * The caller debounces `search`; this hook does not.
 */
export function useTestsetsList({projectId, search}: UseTestsetsListParams) {
    const enabled = Boolean(projectId)
    const name = search.trim() || undefined

    const query = useInfiniteQuery({
        queryKey: testsetsListQueryKey(projectId, search),
        queryFn: ({pageParam}) =>
            queryTestsetsPage({
                projectId,
                limit: TESTSETS_PAGE_SIZE,
                cursor: pageParam,
                name,
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        enabled,
        retry: false,
    })

    const {hasNextPage, isFetchingNextPage, fetchNextPage, refetch} = query

    const loadMore = () => {
        if (!hasNextPage || isFetchingNextPage) return
        void fetchNextPage()
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
    }
}
