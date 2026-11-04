import {
    evaluationRunsListQueryKey,
    isRunInProgress,
    queryEvaluationRunsPage,
    seedEvaluationRunCache,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {useInfiniteQuery, useQueryClient} from "@tanstack/react-query"

import type {EvaluationKindTab} from "./useEvaluationRunsFilters"

export const EVALUATION_RUNS_PAGE_SIZE = 30
export const EVALUATION_RUNS_POLL_MS = 5_000

const NONE: EvaluationRun[] = []

/**
 * The runs list, 30 at a time. Search, status, kind and app go to the server (the package fills
 * a page that the kind or app filter would leave short). The list refreshes every five seconds
 * while a run is in progress.
 */
export const useEvaluationRunsList = ({
    projectId,
    kind,
    appId,
    search,
    statuses,
}: {
    projectId: string
    kind: EvaluationKindTab
    appId: string | null
    search: string
    statuses: readonly string[]
}) => {
    const queryClient = useQueryClient()
    const name = search.trim() || undefined
    const filters = {
        name,
        statuses: statuses.length > 0 ? [...statuses] : undefined,
        appId: appId ?? undefined,
        kind: kind === "all" ? undefined : kind,
    }

    const query = useInfiniteQuery({
        queryKey: evaluationRunsListQueryKey(projectId, filters),
        initialPageParam: null as string | null,
        queryFn: async ({pageParam}) => {
            const page = await queryEvaluationRunsPage({
                projectId,
                limit: EVALUATION_RUNS_PAGE_SIZE,
                cursor: pageParam,
                ...filters,
            })
            seedEvaluationRunCache(queryClient, page.runs)
            return page
        },
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        enabled: Boolean(projectId),
        refetchInterval: (current) =>
            current.state.data?.pages.some((page) => page.runs.some(isRunInProgress))
                ? EVALUATION_RUNS_POLL_MS
                : false,
    })

    const runs = query.data ? query.data.pages.flatMap((page) => page.runs) : NONE

    return {
        runs,
        isPending: query.isPending,
        // A failed refresh or "Load more" keeps the rows. Only a list with nothing to show errors.
        isError: query.isError && query.data === undefined,
        refetch: query.refetch,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        fetchNextPage: query.fetchNextPage,
    }
}
